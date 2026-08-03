/**
 * OGC WFS (Web Feature Service) Endpoint
 * Supports: GetCapabilities, DescribeFeatureType, GetFeature
 * Version: 2.0.0
 *
 * Truthful and bounded: every unsupported or malformed parameter is
 * rejected with an ows:ExceptionReport instead of being silently ignored,
 * FILTER is refused with OperationNotSupported until a safe filter grammar
 * exists, and GetFeature paging is bounded to a count of 1..1000 with a
 * default of 10. Data access goes through the shared OGC repository, so
 * WFS serves exactly the collections and fields the catalog advertises.
 */

import { NextRequest, NextResponse } from 'next/server';
import { create } from 'xmlbuilder2';
import { generateWFSCapabilities, parseOGCParams } from '@/lib/ogc-utils';
import { geoJSONToGML } from '@/lib/gml-utils';
import type { GMLFeatureCollection } from '@/lib/gml-utils';
import { findCollection, COLLECTION_IDS } from '@/lib/ogc/catalog';
import {
  OgcError,
  isOgcError,
  invalidParameterValue,
} from '@/lib/ogc/errors';
import { parseFeatureQuery } from '@/lib/ogc/params';
import { createOgcRepository, type OgcRepository } from '@/lib/ogc/repository';
import { generateFeatureTypeSchema } from '@/lib/ogc/xsd';

export const dynamic = 'force-dynamic';

const WFS_VERSION = '2.0.0';
const FEATURES_CACHE = 'public, max-age=300';
const METADATA_CACHE = 'public, max-age=3600';

const GEOJSON_FORMATS = new Set([
  'application/geo+json',
  'geojson',
  'json',
  'application/json',
]);
const GML_FORMATS = new Set([
  'application/gml+xml; version=3.2',
  'application/gml+xml',
  'text/xml; subtype=gml/3.2',
  'gml',
  'gml3',
  'xml',
]);
const DESCRIBE_FORMATS = new Set([
  'application/gml+xml; version=3.2',
  'application/gml+xml',
  'text/xml; subtype=gml/3.2',
  'xmlschema',
  'application/xml',
  'text/xml',
]);
const SRSNAME_SPELLINGS = new Set([
  'EPSG:4326',
  'urn:ogc:def:crs:EPSG::4326',
  'CRS84',
  'OGC:CRS84',
  'urn:ogc:def:crs:OGC::CRS84',
  'urn:ogc:def:crs:OGC:1.3:CRS84',
  'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
]);

/** Protocol-level parameters the route consumes itself; everything else is
 * handed to the shared feature query parser, which rejects unknown names. */
const WFS_PROTOCOL_PARAMS = new Set([
  'service',
  'request',
  'version',
  'acceptversions',
  'typename',
  'typenames',
  'outputformat',
  'maxfeatures',
  'count',
  'startindex',
  'srsname',
  'filter',
  'filter_language',
]);

/** Parameter names valid on every WFS request. FILTER is "known" here so it
 * reaches the dedicated OperationNotSupported rejection instead of the
 * generic unsupported-parameter one. */
const COMMON_REQUEST_PARAMS = [
  'service',
  'request',
  'version',
  'filter',
  'filter_language',
] as const;

/**
 * Allowed parameter names per implemented request, checked in GET before
 * dispatch so unsupported input is rejected for every operation and never
 * silently ignored. For GetFeature the feature-level names (bbox, limit,
 * offset, properties, crs, datetime) are whitelisted here and
 * value-validated by the shared parseFeatureQuery in the handler.
 */
const ALLOWED_PARAMS_BY_REQUEST: Record<string, readonly string[]> = {
  GETCAPABILITIES: COMMON_REQUEST_PARAMS,
  DESCRIBEFEATURETYPE: [
    ...COMMON_REQUEST_PARAMS,
    'typename',
    'typenames',
    'outputformat',
  ],
  GETFEATURE: [
    ...COMMON_REQUEST_PARAMS,
    'typename',
    'typenames',
    'outputformat',
    'maxfeatures',
    'count',
    'startindex',
    'srsname',
    'bbox',
    'limit',
    'offset',
    'properties',
    'crs',
    'datetime',
  ],
};

let repository: OgcRepository | undefined;

/** Lazily created shared repository; replaced by tests via module mock. */
function getOgcRepository(): OgcRepository {
  repository ??= createOgcRepository();
  return repository;
}

/**
 * Handle WFS requests
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = parseOGCParams(searchParams);

    // FILTER is refused for every operation until a safe filter grammar
    // exists; silently ignoring it would return unbounded wrong results.
    if (params['FILTER'] !== undefined || params['FILTER_LANGUAGE'] !== undefined) {
      throw new OgcError(
        'OperationNotSupported',
        'The FILTER parameter is not supported by this service; no filter grammar is implemented',
        { locator: 'FILTER' },
      );
    }

    const service = params['SERVICE'];
    if (service !== undefined && service.toUpperCase() !== 'WFS') {
      throw invalidParameterValue(
        'service',
        `Invalid service "${service}"; expected WFS`,
      );
    }

    const requestType = params['REQUEST'];
    if (!requestType) {
      throw new OgcError(
        'MissingParameterValue',
        'Missing required parameter "REQUEST"',
        { locator: 'request' },
      );
    }

    const version = params['VERSION'];
    if (version !== undefined && version !== WFS_VERSION) {
      throw invalidParameterValue(
        'version',
        `Unsupported version "${version}"; only ${WFS_VERSION} is implemented`,
      );
    }

    // Reject any parameter the requested operation does not implement,
    // before dispatch, so nothing is silently ignored. Unknown request
    // types fall through to the OperationNotSupported report below.
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

      case 'DESCRIBEFEATURETYPE':
        return handleDescribeFeatureType(params);

      case 'GETFEATURE':
        return await handleGetFeature(params, searchParams);

      default:
        throw new OgcError(
          'OperationNotSupported',
          `Request "${requestType}" is not supported; supported requests are GetCapabilities, DescribeFeatureType, GetFeature`,
          { locator: 'request' },
        );
    }
  } catch (error) {
    return wfsExceptionResponse(error);
  }
}

/**
 * Maps any thrown error to an OWS 1.1 exception report. Non-OGC errors are
 * logged server-side and surfaced as a generic NoApplicableCode report so
 * database details never leak to callers.
 */
function wfsExceptionResponse(error: unknown): NextResponse {
  const ogcError = isOgcError(error)
    ? error
    : new OgcError(
        'NoApplicableCode',
        'The server could not complete the request',
      );
  if (!isOgcError(error)) {
    console.error('WFS unexpected error:', error);
  }

  const xml = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('ows:ExceptionReport')
    .att('xmlns:ows', 'http://www.opengis.net/ows/1.1')
    .att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance')
    .att('version', '1.0.0')
    .att('xml:lang', 'en')
    .ele('ows:Exception')
    .att('exceptionCode', ogcError.code);
  if (ogcError.locator) {
    xml.att('locator', ogcError.locator);
  }
  xml.ele('ows:ExceptionText').txt(ogcError.message);

  return new NextResponse(xml.end({ prettyPrint: true }), {
    status: ogcError.httpStatus,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

/**
 * Handle GetCapabilities request
 */
function handleGetCapabilities(request: NextRequest) {
  const baseUrl = `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('host')}`;
  const xml = generateWFSCapabilities(baseUrl);

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Cache-Control': METADATA_CACHE,
    },
  });
}

/**
 * Resolves and validates the requested type names against the catalog.
 * TYPENAMES (WFS 2.0) wins over the legacy TYPENAME spelling.
 */
function resolveTypeNames(params: Record<string, string>): string[] {
  const raw = params['TYPENAMES'] ?? params['TYPENAME'];
  if (!raw) {
    throw new OgcError(
      'MissingParameterValue',
      'Missing required parameter "TYPENAMES"',
      { locator: 'typeName' },
    );
  }
  const names = raw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) {
    throw invalidParameterValue('typeName', 'Parameter "TYPENAMES" must not be empty');
  }
  return names;
}

/**
 * Handle DescribeFeatureType request
 * Returns an XML Schema (application/xml) generated from the catalog.
 */
function handleDescribeFeatureType(params: Record<string, string>) {
  const outputFormat = params['OUTPUTFORMAT'];
  if (outputFormat !== undefined && !DESCRIBE_FORMATS.has(outputFormat.toLowerCase())) {
    throw invalidParameterValue(
      'outputFormat',
      `Unsupported outputFormat "${outputFormat}" for DescribeFeatureType; supported: application/gml+xml; version=3.2`,
    );
  }

  const typeNames = resolveTypeNames(params);
  const xsd = generateFeatureTypeSchema(typeNames);

  return new NextResponse(xsd, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': METADATA_CACHE,
    },
  });
}

/**
 * Handle GetFeature request
 * Returns features in GeoJSON or GML 3.2 format, paged and bounded.
 */
async function handleGetFeature(
  params: Record<string, string>,
  searchParams: URLSearchParams,
) {
  const typeNames = resolveTypeNames(params);
  if (typeNames.length > 1) {
    throw new OgcError(
      'OperationNotSupported',
      'Queries over multiple type names are not supported; request one type per call',
      { locator: 'typeNames' },
    );
  }
  const typeName = typeNames[0];
  const collection = findCollection(typeName.toLowerCase());
  if (!collection) {
    throw invalidParameterValue(
      'typeName',
      `Unknown feature type "${typeName}"; valid types are: ${COLLECTION_IDS.join(', ')}`,
    );
  }

  const outputFormat = params['OUTPUTFORMAT'] ?? 'application/geo+json';
  const normalizedFormat = outputFormat.toLowerCase();
  const isGml = GML_FORMATS.has(normalizedFormat);
  if (!isGml && !GEOJSON_FORMATS.has(normalizedFormat)) {
    throw invalidParameterValue(
      'outputFormat',
      `Unsupported outputFormat "${outputFormat}"; supported: application/gml+xml; version=3.2, application/geo+json`,
    );
  }

  const srsName = params['SRSNAME'];
  if (srsName !== undefined && !SRSNAME_SPELLINGS.has(srsName)) {
    throw invalidParameterValue(
      'srsName',
      `Unsupported srsName "${srsName}"; only CRS84 (longitude/latitude) is offered`,
    );
  }

  // Strip the protocol parameters this handler consumes, map the WFS paging
  // vocabulary onto the shared one, and let the shared parser validate and
  // reject anything it does not know.
  const cleaned = new URLSearchParams();
  searchParams.forEach((value, key) => {
    if (!WFS_PROTOCOL_PARAMS.has(key.toLowerCase())) {
      cleaned.append(key, value);
    }
  });
  const count = params['COUNT'] ?? params['MAXFEATURES'];
  if (count !== undefined) {
    cleaned.set('limit', count);
  }
  if (params['STARTINDEX'] !== undefined) {
    cleaned.set('offset', params['STARTINDEX']);
  }
  const query = parseFeatureQuery(cleaned);

  const result = await getOgcRepository().listFeatures(collection.id, {
    bbox: query.bbox,
    limit: query.limit,
    offset: query.offset,
    properties: query.properties,
    crs: query.crs,
  });

  if (isGml) {
    const featureCollection: GMLFeatureCollection & {
      numberMatched: number;
      numberReturned: number;
    } = {
      type: 'FeatureCollection',
      numberMatched: result.numberMatched,
      numberReturned: result.numberReturned,
      features: result.features as unknown as GMLFeatureCollection['features'],
    };
    const gml = geoJSONToGML(featureCollection, collection.id);
    return new NextResponse(gml, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Cache-Control': FEATURES_CACHE,
      },
    });
  }

  return NextResponse.json(
    {
      type: 'FeatureCollection',
      numberMatched: result.numberMatched,
      numberReturned: result.numberReturned,
      timeStamp: new Date().toISOString(),
      features: result.features,
    },
    {
      headers: {
        'Content-Type': 'application/geo+json',
        'Cache-Control': FEATURES_CACHE,
      },
    },
  );
}
