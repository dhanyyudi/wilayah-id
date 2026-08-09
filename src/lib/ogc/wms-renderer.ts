/**
 * Bounded WMS 1.3.0 map rendering and point queries.
 *
 * This module is framework-free (no Next.js imports) so it stays unit
 * testable. All bounding boxes inside this module use CRS84 axis order
 * [minLon, minLat, maxLon, maxLat]; WMS 1.3.0 EPSG:4326 axis handling is the
 * caller's responsibility.
 *
 * This module owns WMS validation, bounded PostGIS queries, and capabilities.
 * Pure rasterization and image encoding live in wms-raster.ts.
 */

import { create } from "xmlbuilder2";
import type { Geometry } from "geojson";
import { getDb, type DbQueryFunction } from "../db";
import { COLLECTION_IDS, findCollection, type CollectionId } from "./catalog";
import { invalidParameterValue, sanitizedStoreError } from "./errors";
import type { Bbox } from "./params";
import {
  encodeRaster,
  rasterizeLayers,
  type RasterLayer,
  type WmsImageFormat,
} from "./wms-raster";

export type { WmsImageFormat } from "./wms-raster";

/** WMS service limits, also advertised in GetCapabilities. */
export const WMS_MAX_DIMENSION = 2048;
export const WMS_MAX_PIXELS = 4194304;

/** Hard cap on features drawn per layer, keeping render cost bounded. */
export const MAX_FEATURES_PER_LAYER = 5000;

export interface WmsMapRequest {
  /** Bounding box in CRS84 axis order: [minLon, minLat, maxLon, maxLat]. */
  bbox: Bbox;
  width: number;
  height: number;
  layers: CollectionId[];
  transparent: boolean;
  format: WmsImageFormat;
}

/** Service-wide geographic extent of the source data (CRS84). */
const SERVICE_EXTENT: Bbox = [95, -11, 141, 6];

/**
 * Enforces the advertised dimension and pixel limits. Must run before any
 * image buffer is allocated.
 */
export function validateMapDimensions(width: number, height: number): void {
  for (const [name, value] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > WMS_MAX_DIMENSION) {
      throw invalidParameterValue(
        name,
        `Parameter "${name}" must be an integer between 1 and ${WMS_MAX_DIMENSION}, got ${value}`,
      );
    }
  }
  if (width * height > WMS_MAX_PIXELS) {
    throw invalidParameterValue(
      "width,height",
      `Requested image of ${width}x${height} exceeds the maximum pixel count of ${WMS_MAX_PIXELS}`,
    );
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier}"`;
}

/**
 * Renders a bounded map image. The caller has already validated every
 * protocol parameter; this function re-enforces the dimension limits and
 * then performs exactly one clipped, simplified, row-capped query per
 * layer. Database driver errors are sanitized before propagating.
 */
export async function renderWmsMap(
  request: WmsMapRequest,
  db?: DbQueryFunction,
): Promise<Buffer> {
  validateMapDimensions(request.width, request.height);
  const dbFn = () => db ?? getDb();

  const { bbox, width, height } = request;
  // Simplify at half of the larger pixel span: detail below one pixel
  // cannot change the rendered image.
  const tolerance =
    Math.max(
      (bbox[2] - bbox[0]) / width,
      (bbox[3] - bbox[1]) / height,
    ) / 2;

  const layerResults: RasterLayer[] = [];
  for (const layerId of request.layers) {
    const definition = findCollection(layerId);
    if (!definition) {
      throw invalidParameterValue(
        "layers",
        `Unknown layer "${layerId}"; available layers: ${COLLECTION_IDS.join(", ")}`,
      );
    }
    const geom = quoteIdentifier(definition.geometryColumn);
    const text =
      `SELECT ST_AsGeoJSON(` +
      `ST_SimplifyPreserveTopology(` +
      `ST_Intersection(${geom}, ST_MakeEnvelope($1, $2, $3, $4, 4326)), $5), 6)::json AS geometry` +
      ` FROM ${quoteIdentifier(definition.table)}` +
      ` WHERE ST_Intersects(${geom}, ST_MakeEnvelope($1, $2, $3, $4, 4326))` +
      ` LIMIT ${MAX_FEATURES_PER_LAYER}`;

    let rows;
    try {
      rows = await dbFn().query(text, [...bbox, tolerance]);
    } catch (error) {
      throw sanitizedStoreError(`WMS GetMap rendering on ${layerId}`, error);
    }
    const geometries = rows
      .map((row) => (row as { geometry?: unknown }).geometry)
      .filter(
        (geometry): geometry is Geometry =>
          typeof geometry === "object" && geometry !== null,
      );
    layerResults.push({ id: layerId, geometries });
  }

  const pixels = rasterizeLayers(
    layerResults,
    bbox,
    width,
    height,
    request.format,
    request.transparent,
  );
  return encodeRaster(pixels, width, height, request.format);
}

/**
 * Returns the properties of the feature covering the given CRS84 point, or
 * null. Uses ST_Covers so points exactly on a boundary count, per the
 * project's topology policy.
 */
export async function queryFeaturesAtPoint(
  id: CollectionId,
  lon: number,
  lat: number,
  db?: DbQueryFunction,
): Promise<Record<string, unknown> | null> {
  const definition = findCollection(id);
  if (!definition) {
    throw invalidParameterValue(
      "query_layers",
      `Unknown layer "${id}"; available layers: ${COLLECTION_IDS.join(", ")}`,
    );
  }
  const columns = definition.propertyColumns.map(quoteIdentifier).join(", ");
  const text =
    `SELECT ${columns} FROM ${quoteIdentifier(definition.table)}` +
    ` WHERE ST_Covers(${quoteIdentifier(definition.geometryColumn)}, ST_SetSRID(ST_MakePoint($1, $2), 4326))` +
    ` LIMIT 1`;

  let rows;
  try {
    rows = await (db ?? getDb()).query(text, [lon, lat]);
  } catch (error) {
    throw sanitizedStoreError(`WMS GetFeatureInfo on ${id}`, error);
  }
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}

/**
 * Generates the WMS 1.3.0 GetCapabilities document. Truthful by
 * construction: layers come from the shared collection catalog, only the
 * implemented formats (PNG, JPEG), CRS (CRS:84, EPSG:4326), the single
 * default style, and the enforced dimension limits are advertised.
 */
export function generateWmsCapabilities(baseUrl: string): string {
  const doc = create({ version: "1.0", encoding: "UTF-8" })
    .ele("http://www.opengis.net/wms", "WMS_Capabilities")
    .att("version", "1.3.0")
    .att("xmlns", "http://www.opengis.net/wms")
    .att("xmlns:xlink", "http://www.w3.org/1999/xlink")
    .att("xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance");

  const service = doc.ele("Service");
  service.ele("Name").txt("WMS");
  service.ele("Title").txt("wilayah-id WMS Service");
  service
    .ele("Abstract")
    .txt("Web Map Service for Indonesian Administrative Boundaries");
  service.ele("OnlineResource").att("xlink:href", baseUrl);
  service.ele("MaxWidth").txt(String(WMS_MAX_DIMENSION));
  service.ele("MaxHeight").txt(String(WMS_MAX_DIMENSION));

  const capability = doc.ele("Capability");
  const request = capability.ele("Request");

  const operations: Array<[string, string[]]> = [
    ["GetCapabilities", ["text/xml"]],
    ["GetMap", ["image/png", "image/jpeg"]],
    ["GetFeatureInfo", ["application/json", "text/plain"]],
  ];
  for (const [name, formats] of operations) {
    const operation = request.ele(name);
    for (const format of formats) {
      operation.ele("Format").txt(format);
    }
    operation
      .ele("DCPType")
      .ele("HTTP")
      .ele("Get")
      .ele("OnlineResource")
      .att("xlink:href", `${baseUrl}/api/v1/ogc/wms`);
  }

  capability.ele("Exception").ele("Format").txt("XML");

  const rootLayer = capability.ele("Layer");
  rootLayer.ele("Title").txt("wilayah-id Layers");
  rootLayer.ele("CRS").txt("CRS:84");
  rootLayer.ele("CRS").txt("EPSG:4326");
  rootLayer
    .ele("EX_GeographicBoundingBox")
    .ele("westBoundLongitude")
    .txt(String(SERVICE_EXTENT[0]))
    .up()
    .ele("eastBoundLongitude")
    .txt(String(SERVICE_EXTENT[2]))
    .up()
    .ele("southBoundLatitude")
    .txt(String(SERVICE_EXTENT[1]))
    .up()
    .ele("northBoundLatitude")
    .txt(String(SERVICE_EXTENT[3]));

  for (const id of COLLECTION_IDS) {
    const collection = findCollection(id)!;
    const layer = rootLayer.ele("Layer").att("queryable", "1");
    layer.ele("Name").txt(collection.id);
    layer.ele("Title").txt(collection.title);
    layer
      .ele("Abstract")
      .txt(`Indonesian administrative boundaries: ${collection.title}.`);
    layer.ele("CRS").txt("CRS:84");
    layer.ele("CRS").txt("EPSG:4326");
    layer
      .ele("EX_GeographicBoundingBox")
      .ele("westBoundLongitude")
      .txt(String(SERVICE_EXTENT[0]))
      .up()
      .ele("eastBoundLongitude")
      .txt(String(SERVICE_EXTENT[2]))
      .up()
      .ele("southBoundLatitude")
      .txt(String(SERVICE_EXTENT[1]))
      .up()
      .ele("northBoundLatitude")
      .txt(String(SERVICE_EXTENT[3]));
    layer
      .ele("BoundingBox")
      .att("CRS", "CRS:84")
      .att("minx", String(SERVICE_EXTENT[0]))
      .att("miny", String(SERVICE_EXTENT[1]))
      .att("maxx", String(SERVICE_EXTENT[2]))
      .att("maxy", String(SERVICE_EXTENT[3]));
    // WMS 1.3.0 EPSG:4326 axis order: minx/miny carry latitude first.
    layer
      .ele("BoundingBox")
      .att("CRS", "EPSG:4326")
      .att("minx", String(SERVICE_EXTENT[1]))
      .att("miny", String(SERVICE_EXTENT[0]))
      .att("maxx", String(SERVICE_EXTENT[3]))
      .att("maxy", String(SERVICE_EXTENT[2]));
    const style = layer.ele("Style");
    style.ele("Name").txt("default");
    style.ele("Title").txt("Default style");
  }

  return doc.end({ prettyPrint: true });
}
