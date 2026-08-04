/**
 * OGC WMS (Web Map Service) Endpoint
 * Supports: GetCapabilities, GetMap, GetFeatureInfo
 * Version: 1.3.0
 *
 * Truthful and bounded: GetMap renders real images through the shared OGC
 * renderer (no placeholder stub), every unsupported or malformed parameter
 * is rejected with a WMS 1.3.0 ServiceExceptionReport instead of being
 * silently ignored, dimensions are capped at 2048x2048 / 4,194,304 pixels
 * before any allocation, and EPSG:4326 honours the WMS 1.3.0 lat,lon axis
 * order while CRS:84 uses lon,lat. GetFeatureInfo uses I/J pixel indices
 * and ST_Covers containment so boundary points count.
 */

import { NextRequest, NextResponse } from 'next/server';
import { create } from 'xmlbuilder2';
import { parseOGCParams } from '@/lib/ogc-utils';
import { findCollection, COLLECTION_IDS, type CollectionId } from '@/lib/ogc/catalog';
import { isOgcError, invalidParameterValue } from '@/lib/ogc/errors';
import type { Bbox } from '@/lib/ogc/params';
import {
  generateWmsCapabilities,
  queryFeaturesAtPoint,
  renderWmsMap,
  validateMapDimensions,
  WMS_MAX_DIMENSION,
  WMS_MAX_PIXELS,
  type WmsImageFormat,
} from '@/lib/ogc/wms-renderer';

export const dynamic = 'force-dynamic';

const WMS_VERSION = '1.3.0';
const MAP_CACHE = 'public, max-age=300';
const METADATA_CACHE = 'public, max-age=3600';

const SUPPORTED_CRSS = new Set(['CRS:84', 'EPSG:4326']);
const SUPPORTED_FORMATS = new Set(['image/png', 'image/jpeg']);
const SUPPORTED_INFO_FORMATS = new Set(['application/json', 'text/plain']);

/**
 * WMS 1.3.0 exception with a service-specific code (LayerNotDefined,
 * StyleNotDefined, InvalidCRS, InvalidFormat, InvalidPoint, ...), which the
 * shared OgcError vocabulary does not cover.
 */
class WmsError extends Error {
  readonly httpStatus: number;

  constructor(
    readonly code: string,
    message: string,
    readonly locator?: string,
    httpStatus = 400,
  ) {
    super(message);
    this.name = 'WmsError';
    this.httpStatus = httpStatus;
  }
}

/** Parameter names valid on every WMS request. */
const COMMON_REQUEST_PARAMS = ['service', 'request', 'version'] as const;

/**
 * Allowed parameter names per implemented request, checked before dispatch
 * so unsupported input (TIME, ELEVATION, BGCOLOR, SLD, the legacy X/Y
 * feature-info indices, ...) is rejected instead of silently ignored.
 */
const ALLOWED_PARAMS_BY_REQUEST: Record<string, readonly string[]> = {
  GETCAPABILITIES: COMMON_REQUEST_PARAMS,
  GETMAP: [
    ...COMMON_REQUEST_PARAMS,
    'layers',
    'styles',
    'crs',
    'bbox',
    'width',
    'height',
    'format',
    'transparent',
  ],
  GETFEATUREINFO: [
    ...COMMON_REQUEST_PARAMS,
    'layers',
    'styles',
    'query_layers',
    'crs',
    'bbox',
    'width',
    'height',
    'format',
    'i',
    'j',
    'info_format',
  ],
};

/**
 * Handle WMS requests
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = parseOGCParams(searchParams);

    const service = params['SERVICE'];
    if (service !== undefined && service.toUpperCase() !== 'WMS') {
      throw invalidParameterValue(
        'service',
        `Invalid service "${service}"; expected WMS`,
      );
    }

    const requestType = params['REQUEST'];
    if (!requestType) {
      throw new WmsError(
        'MissingParameterValue',
        'Missing required parameter "REQUEST"',
        'request',
      );
    }

    const version = params['VERSION'];
    if (version !== undefined && version !== WMS_VERSION) {
      throw invalidParameterValue(
        'version',
        `Unsupported version "${version}"; only ${WMS_VERSION} is implemented`,
      );
    }

    const normalizedRequest = requestType.toUpperCase();
    const allowedParams = ALLOWED_PARAMS_BY_REQUEST[normalizedRequest];
    if (allowedParams) {
      const allowed = new Set(allowedParams);
      for (const key of searchParams.keys()) {
        if (!allowed.has(key.toLowerCase())) {
          throw invalidParameterValue(
            key,
            `Unsupported parameter "${key}" for ${normalizedRequest} requests`,
          );
        }
      }
    }

    switch (normalizedRequest) {
      case 'GETCAPABILITIES':
        return handleGetCapabilities(request);

      case 'GETMAP':
        return await handleGetMap(params);

      case 'GETFEATUREINFO':
        return await handleGetFeatureInfo(params);

      default:
        throw new WmsError(
          'OperationNotSupported',
          `Request "${requestType}" is not supported; supported requests are GetCapabilities, GetMap, GetFeatureInfo`,
          'request',
        );
    }
  } catch (error) {
    return wmsExceptionResponse(error);
  }
}

/**
 * Maps any thrown error to a WMS 1.3.0 ServiceExceptionReport. Non-OGC
 * errors are logged server-side and surfaced as a generic NoApplicableCode
 * report so database details never leak to callers.
 */
function wmsExceptionResponse(error: unknown): NextResponse {
  let code = 'NoApplicableCode';
  let httpStatus = 500;
  let message = 'The server could not complete the request';
  let locator: string | undefined;

  if (error instanceof WmsError) {
    code = error.code;
    httpStatus = error.httpStatus;
    message = error.message;
    locator = error.locator;
  } else if (isOgcError(error)) {
    code = error.code;
    httpStatus = error.httpStatus;
    message = error.message;
    locator = error.locator;
  } else {
    console.error('WMS unexpected error:', error);
  }

  const exception = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('ServiceExceptionReport')
    .att('version', '1.3.0')
    .att('xmlns', 'http://www.opengis.net/ogc')
    .ele('ServiceException')
    .att('code', code);
  if (locator) {
    exception.att('locator', locator);
  }
  exception.txt(message);

  return new NextResponse(exception.end({ prettyPrint: true }), {
    status: httpStatus,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

/**
 * Handle GetCapabilities request
 */
function handleGetCapabilities(request: NextRequest) {
  const baseUrl = `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('host')}`;
  const xml = generateWmsCapabilities(baseUrl);

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Cache-Control': METADATA_CACHE,
    },
  });
}

function requireParam(params: Record<string, string>, name: string): string {
  const value = params[name];
  if (value === undefined || value === '') {
    throw new WmsError(
      'MissingParameterValue',
      `Missing required parameter "${name}"`,
      name.toLowerCase(),
    );
  }
  return value;
}

/** GetMap and GetFeatureInfo both require an explicit VERSION. */
function requireVersion(params: Record<string, string>): void {
  requireParam(params, 'VERSION');
}

/**
 * Resolves LAYERS/QUERY_LAYERS against the collection catalog. Unknown
 * names are rejected with the WMS-specific LayerNotDefined code.
 */
function parseLayers(raw: string, locator: string): CollectionId[] {
  const names = raw.split(',').map((name) => name.trim());
  if (names.some((name) => name.length === 0)) {
    throw invalidParameterValue(
      locator,
      `Parameter "${locator}" must be a comma-separated list of layer names without empty entries`,
    );
  }
  return names.map((name) => {
    const id = name.toLowerCase();
    if (!findCollection(id)) {
      throw new WmsError(
        'LayerNotDefined',
        `Layer "${name}" is not offered by this service; available layers: ${COLLECTION_IDS.join(', ')}`,
        locator,
      );
    }
    return id as CollectionId;
  });
}

/** Only the default style exists; anything else is StyleNotDefined. */
function validateStyles(raw: string | undefined, layerCount: number): void {
  if (raw === undefined) {
    return;
  }
  const styles = raw.split(',');
  if (styles.length !== layerCount) {
    throw invalidParameterValue(
      'styles',
      `Parameter "STYLES" must contain exactly one (possibly empty) entry per requested layer, got ${styles.length} for ${layerCount} layers`,
    );
  }
  for (const style of styles) {
    const name = style.trim();
    if (name !== '' && name !== 'default') {
      throw new WmsError(
        'StyleNotDefined',
        `Style "${name}" is not defined; only the default style exists`,
        'styles',
      );
    }
  }
}

function parseCrs(raw: string): 'CRS:84' | 'EPSG:4326' {
  if (!SUPPORTED_CRSS.has(raw)) {
    throw new WmsError(
      'InvalidCRS',
      `CRS "${raw}" is not supported; supported CRS are CRS:84 (lon,lat) and EPSG:4326 (lat,lon)`,
      'crs',
    );
  }
  return raw as 'CRS:84' | 'EPSG:4326';
}

/**
 * Parses BBOX honouring WMS 1.3.0 axis order: EPSG:4326 carries
 * minLat,minLon,maxLat,maxLon while CRS:84 carries
 * minLon,minLat,maxLon,maxLat. Always returns CRS84 order.
 */
function parseWmsBbox(raw: string, crs: 'CRS:84' | 'EPSG:4326'): Bbox {
  const parts = raw.split(',').map((part) => part.trim());
  if (parts.length !== 4) {
    throw invalidParameterValue(
      'bbox',
      `Parameter "BBOX" must have exactly 4 ordinates, got ${parts.length}`,
    );
  }
  const numbers = parts.map((part) => {
    const value = Number(part);
    if (!Number.isFinite(value)) {
      throw invalidParameterValue(
        'bbox',
        `Parameter "BBOX" contains a non-numeric ordinate: "${part}"`,
      );
    }
    return value;
  });

  // EPSG:4326 ordinates are lat,lon per WMS 1.3.0 axis ordering.
  const [minLon, minLat, maxLon, maxLat]: Bbox =
    crs === 'EPSG:4326'
      ? [numbers[1], numbers[0], numbers[3], numbers[2]]
      : [numbers[0], numbers[1], numbers[2], numbers[3]];

  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
    throw invalidParameterValue(
      'bbox',
      'Parameter "BBOX" ordinates must be within longitude [-180, 180] and latitude [-90, 90] for the requested CRS axis order',
    );
  }
  if (minLon >= maxLon || minLat >= maxLat) {
    throw invalidParameterValue(
      'bbox',
      'Parameter "BBOX" minimum ordinates must be smaller than maximum ordinates',
    );
  }
  return [minLon, minLat, maxLon, maxLat];
}

function parseDimension(params: Record<string, string>, name: 'WIDTH' | 'HEIGHT'): number {
  const raw = requireParam(params, name);
  const value = Number(raw);
  // Range and pixel-cap enforcement happens here, before any database
  // query or image buffer allocation.
  validateMapDimensions(
    name === 'WIDTH' ? value : 1,
    name === 'HEIGHT' ? value : 1,
  );
  return value;
}

function parseTransparent(raw: string | undefined): boolean {
  if (raw === undefined) {
    return false;
  }
  const normalized = raw.toUpperCase();
  if (normalized !== 'TRUE' && normalized !== 'FALSE') {
    throw invalidParameterValue(
      'transparent',
      `Parameter "TRANSPARENT" must be TRUE or FALSE, got "${raw}"`,
    );
  }
  return normalized === 'TRUE';
}

interface SharedMapParams {
  layers: CollectionId[];
  bbox: Bbox;
  width: number;
  height: number;
}

function parseSharedMapParams(params: Record<string, string>): SharedMapParams {
  const layers = parseLayers(requireParam(params, 'LAYERS'), 'layers');
  const crs = parseCrs(requireParam(params, 'CRS'));
  const bbox = parseWmsBbox(requireParam(params, 'BBOX'), crs);
  const width = parseDimension(params, 'WIDTH');
  const height = parseDimension(params, 'HEIGHT');
  // Enforce the combined pixel cap before any allocation.
  validateMapDimensions(width, height);
  if (width * height > WMS_MAX_PIXELS || width > WMS_MAX_DIMENSION) {
    // Unreachable: validateMapDimensions already enforces both limits.
    throw invalidParameterValue('width,height', 'Requested image exceeds service limits');
  }
  return { layers, bbox, width, height };
}

/**
 * Handle GetMap request
 * Renders a real bounded map image (PNG or JPEG) through the OGC renderer.
 */
async function handleGetMap(params: Record<string, string>) {
  requireVersion(params);
  const { layers, bbox, width, height } = parseSharedMapParams(params);
  validateStyles(params['STYLES'], layers.length);

  const format = requireParam(params, 'FORMAT');
  if (!SUPPORTED_FORMATS.has(format)) {
    throw new WmsError(
      'InvalidFormat',
      `Format "${format}" is not supported; supported formats are image/png, image/jpeg`,
      'format',
    );
  }

  const transparent = parseTransparent(params['TRANSPARENT']);
  if (transparent && format === 'image/jpeg') {
    throw invalidParameterValue(
      'transparent',
      'TRANSPARENT=TRUE is incompatible with FORMAT=image/jpeg, which has no alpha channel',
    );
  }

  const image = await renderWmsMap({
    bbox,
    width,
    height,
    layers,
    transparent,
    format: format as WmsImageFormat,
  });

  return new NextResponse(new Uint8Array(image), {
    status: 200,
    headers: {
      'Content-Type': format,
      'Cache-Control': MAP_CACHE,
    },
  });
}

/**
 * Handle GetFeatureInfo request
 * Returns properties of features covering the requested pixel position,
 * using WMS 1.3.0 I/J indices and ST_Covers containment.
 */
async function handleGetFeatureInfo(params: Record<string, string>) {
  requireVersion(params);
  const { layers, bbox, width, height } = parseSharedMapParams(params);
  // GetFeatureInfo embeds the full GetMap parameter set (WMS 1.3.0 §7.4),
  // so STYLES is accepted and validated exactly as in GetMap.
  validateStyles(params['STYLES'], layers.length);
  const queryLayers = parseLayers(
    requireParam(params, 'QUERY_LAYERS'),
    'query_layers',
  );
  for (const layer of queryLayers) {
    if (!layers.includes(layer)) {
      throw new WmsError(
        'LayerNotDefined',
        `Query layer "${layer}" is not part of the LAYERS parameter`,
        'query_layers',
      );
    }
  }

  const infoFormat = params['INFO_FORMAT'] ?? 'application/json';
  if (!SUPPORTED_INFO_FORMATS.has(infoFormat)) {
    throw new WmsError(
      'InvalidFormat',
      `Info format "${infoFormat}" is not supported; supported formats are application/json, text/plain`,
      'info_format',
    );
  }

  const i = parsePixelIndex(params, 'I', width);
  const j = parsePixelIndex(params, 'J', height);

  const [minLon, minLat, maxLon, maxLat] = bbox;
  const lon = minLon + (i / width) * (maxLon - minLon);
  const lat = maxLat - (j / height) * (maxLat - minLat); // J counts from the top

  const results: Record<string, Record<string, unknown>> = {};
  for (const layer of queryLayers) {
    const properties = await queryFeaturesAtPoint(layer, lon, lat);
    if (properties) {
      results[layer] = properties;
    }
  }

  if (infoFormat === 'application/json') {
    return NextResponse.json({
      type: 'FeatureInfo',
      coordinate: { lon, lat },
      layers: results,
    });
  }

  const text =
    Object.entries(results)
      .map(([layer, properties]) => `${layer}: ${JSON.stringify(properties)}`)
      .join('\n') || 'No features found';
  return new NextResponse(text, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function parsePixelIndex(
  params: Record<string, string>,
  name: 'I' | 'J',
  extent: number,
): number {
  const raw = requireParam(params, name);
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw invalidParameterValue(
      name.toLowerCase(),
      `Parameter "${name}" must be an integer pixel index, got "${raw}"`,
    );
  }
  if (value < 0 || value >= extent) {
    throw new WmsError(
      'InvalidPoint',
      `Parameter "${name}"=${value} is outside the map extent [0, ${extent - 1}]`,
      name.toLowerCase(),
    );
  }
  return value;
}
