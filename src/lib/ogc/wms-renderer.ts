/**
 * Bounded WMS 1.3.0 map rendering and point queries.
 *
 * This module is framework-free (no Next.js imports) so it stays unit
 * testable. All bounding boxes inside this module use CRS84 axis order
 * [minLon, minLat, maxLon, maxLat]; WMS 1.3.0 EPSG:4326 axis handling is the
 * caller's responsibility.
 *
 * Rendering pipeline: one bounded PostGIS query per layer (intersection
 * filter, clip to the requested envelope, simplify at a pixel-derived
 * tolerance, hard row cap), GeoJSON projection to a bounded RGBA canvas,
 * then pure-JavaScript PNG or JPEG encoding. Dimension and pixel limits are
 * enforced before any image buffer is allocated.
 */

import { zlibSync } from "fflate";
import { encode as encodeJpeg } from "jpeg-js";
import { create } from "xmlbuilder2";
import type { Geometry, MultiPolygon, Polygon, Position } from "geojson";
import { getDb, type DbQueryFunction } from "../db";
import { COLLECTION_IDS, findCollection, type CollectionId } from "./catalog";
import { invalidParameterValue, sanitizedStoreError } from "./errors";
import type { Bbox } from "./params";

/** WMS service limits, also advertised in GetCapabilities. */
export const WMS_MAX_DIMENSION = 2048;
export const WMS_MAX_PIXELS = 4194304;

/** Hard cap on features drawn per layer, keeping render cost bounded. */
export const MAX_FEATURES_PER_LAYER = 5000;

export type WmsImageFormat = "image/png" | "image/jpeg";

export interface WmsMapRequest {
  /** Bounding box in CRS84 axis order: [minLon, minLat, maxLon, maxLat]. */
  bbox: Bbox;
  width: number;
  height: number;
  layers: CollectionId[];
  transparent: boolean;
  format: WmsImageFormat;
}

export interface LayerGeometries {
  id: CollectionId;
  geometries: Geometry[];
}

/**
 * The single default style per layer. Only this style exists; the route
 * rejects any other STYLES value with StyleNotDefined.
 */
const LAYER_STYLES: Record<CollectionId, { fill: string; stroke: string }> = {
  provinces: { fill: "#4c78a8", stroke: "#2f4b7c" },
  regencies: { fill: "#72b7b2", stroke: "#3a7d78" },
  districts: { fill: "#f2a65a", stroke: "#a8641c" },
  villages: { fill: "#e45756", stroke: "#8f2f2e" },
};

const FILL_OPACITY = 0.45;

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
 * Projects GeoJSON polygonal geometries into an SVG document sized exactly
 * to the requested image. Layers are drawn in the given order, so the first
 * layer ends up at the bottom of the stack, as WMS requires.
 */
export function buildMapSvg(
  layers: LayerGeometries[],
  bbox: Bbox,
  width: number,
  height: number,
): string {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const spanLon = maxLon - minLon;
  const spanLat = maxLat - minLat;

  const project = ([lon, lat]: Position): string => {
    const x = Math.round(((lon - minLon) / spanLon) * width * 100) / 100;
    const y = Math.round((1 - (lat - minLat) / spanLat) * height * 100) / 100;
    return `${x},${y}`;
  };

  const ringToPath = (ring: Position[]): string =>
    `M${ring.map(project).join("L")}Z`;

  const geometryToPath = (geometry: Geometry): string => {
    if (geometry.type === "Polygon") {
      return (geometry as Polygon).coordinates.map(ringToPath).join(" ");
    }
    if (geometry.type === "MultiPolygon") {
      return (geometry as MultiPolygon).coordinates
        .map((polygon) => polygon.map(ringToPath).join(" "))
        .join(" ");
    }
    return "";
  };

  const paths: string[] = [];
  for (const layer of layers) {
    const style = LAYER_STYLES[layer.id];
    for (const geometry of layer.geometries) {
      const d = geometryToPath(geometry);
      if (!d) {
        continue;
      }
      paths.push(
        `<path data-layer="${layer.id}" d="${d}" fill="${style.fill}" fill-opacity="${FILL_OPACITY}" fill-rule="evenodd" stroke="${style.stroke}" stroke-width="1"/>`,
      );
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    paths.join("") +
    `</svg>`
  );
}

interface PixelColor {
  red: number;
  green: number;
  blue: number;
}

const PNG_SIGNATURE = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
]);

function parseHexColor(value: string): PixelColor {
  return {
    red: Number.parseInt(value.slice(1, 3), 16),
    green: Number.parseInt(value.slice(3, 5), 16),
    blue: Number.parseInt(value.slice(5, 7), 16),
  };
}

function projectPosition(
  [lon, lat]: Position,
  bbox: Bbox,
  width: number,
  height: number,
): [number, number] {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return [
    ((lon - minLon) / (maxLon - minLon)) * width,
    (1 - (lat - minLat) / (maxLat - minLat)) * height,
  ];
}

function blendPixel(
  data: Uint8Array,
  offset: number,
  color: PixelColor,
  alpha: number,
): void {
  const sourceAlpha = alpha / 255;
  const destinationAlpha = data[offset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha === 0) {
    return;
  }

  data[offset] = Math.round(
    (color.red * sourceAlpha +
      data[offset] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  );
  data[offset + 1] = Math.round(
    (color.green * sourceAlpha +
      data[offset + 1] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  );
  data[offset + 2] = Math.round(
    (color.blue * sourceAlpha +
      data[offset + 2] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  );
  data[offset + 3] = Math.round(outputAlpha * 255);
}

function drawFilledPolygon(
  data: Uint8Array,
  width: number,
  height: number,
  rings: Position[][],
  bbox: Bbox,
  color: PixelColor,
): void {
  const projectedRings = rings.map((ring) =>
    ring.map((position) => projectPosition(position, bbox, width, height)),
  );
  const allPoints = projectedRings.flat();
  if (allPoints.length < 3) {
    return;
  }

  const minY = Math.max(
    0,
    Math.floor(Math.min(...allPoints.map(([, y]) => y))),
  );
  const maxY = Math.min(
    height - 1,
    Math.ceil(Math.max(...allPoints.map(([, y]) => y))),
  );

  // Scanline filling uses the even-odd rule across all rings, so interior
  // holes remain transparent without requiring a separate polygon library.
  for (let y = minY; y <= maxY; y += 1) {
    const scanY = y + 0.5;
    const intersections: number[] = [];
    for (const ring of projectedRings) {
      for (let index = 0; index < ring.length; index += 1) {
        const [x1, y1] = ring[index];
        const [x2, y2] = ring[(index + 1) % ring.length];
        if ((y1 > scanY) !== (y2 > scanY)) {
          intersections.push(x1 + ((scanY - y1) * (x2 - x1)) / (y2 - y1));
        }
      }
    }
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const start = Math.max(0, Math.ceil(intersections[index] - 0.5));
      const end = Math.min(
        width - 1,
        Math.ceil(intersections[index + 1] - 0.5) - 1,
      );
    for (let x = start; x <= end; x += 1) {
        blendPixel(data, (y * width + x) * 4, color, FILL_OPACITY * 255);
      }
    }
  }
}

function drawStroke(
  data: Uint8Array,
  width: number,
  height: number,
  [x1, y1]: [number, number],
  [x2, y2]: [number, number],
  color: PixelColor,
): void {
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - 1));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(x1, x2) + 1));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - 1));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(y1, y2) + 1));
  const deltaX = x2 - x1;
  const deltaY = y2 - y1;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const pointX = x + 0.5;
      const pointY = y + 0.5;
      const projection =
        lengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((pointX - x1) * deltaX + (pointY - y1) * deltaY) /
                  lengthSquared,
              ),
            );
      const closestX = x1 + projection * deltaX;
      const closestY = y1 + projection * deltaY;
      if ((pointX - closestX) ** 2 + (pointY - closestY) ** 2 <= 0.5 ** 2) {
        blendPixel(data, (y * width + x) * 4, color, 255);
      }
    }
  }
}

function rasterizeLayers(
  layers: LayerGeometries[],
  bbox: Bbox,
  width: number,
  height: number,
  format: WmsImageFormat,
  transparent: boolean,
): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  if (!transparent || format === "image/jpeg") {
    // JPEG has no alpha; opaque PNG flattens onto the default white WMS
    // background.
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = 255;
    }
  }

  for (const layer of layers) {
    const style = LAYER_STYLES[layer.id];
    const fill = parseHexColor(style.fill);
    const stroke = parseHexColor(style.stroke);
    for (const geometry of layer.geometries) {
      const polygons =
        geometry.type === "Polygon"
          ? [geometry.coordinates]
          : geometry.type === "MultiPolygon"
            ? geometry.coordinates
            : [];
      for (const rings of polygons) {
        drawFilledPolygon(data, width, height, rings, bbox, fill);
        // Draw the one-pixel boundary with the layer stroke to retain the
        // original WMS style while keeping the rasterizer dependency-free.
        const projectedRings = rings.map((ring) =>
          ring.map((position) =>
            projectPosition(position, bbox, width, height),
          ),
        );
        for (const ring of projectedRings) {
          for (let index = 0; index < ring.length; index += 1) {
            drawStroke(
              data,
              width,
              height,
              ring[index],
              ring[(index + 1) % ring.length],
              stroke,
            );
          }
        }
      }
    }
  }
  return data;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(
    8 + data.length,
    crc32(chunk.subarray(4, 8 + data.length)),
  );
  return chunk;
}

function encodePng(data: Uint8Array, width: number, height: number): Buffer {
  const scanlines = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    scanlines[rowOffset] = 0;
    scanlines.set(
      data.subarray(y * width * 4, (y + 1) * width * 4),
      rowOffset + 1,
    );
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const png = concatBytes(
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlibSync(scanlines)),
    pngChunk("IEND", new Uint8Array()),
  );
  return Buffer.from(png);
}

function encodeRaster(
  data: Uint8Array,
  width: number,
  height: number,
  format: WmsImageFormat,
): Buffer {
  if (format === "image/png") {
    return encodePng(data, width, height);
  }
  return Buffer.from(
    encodeJpeg({ data, width, height }, 90).data,
  );
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

  const layerResults: LayerGeometries[] = [];
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
