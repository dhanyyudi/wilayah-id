/**
 * Shared OGC query parameter parsing.
 *
 * Produces a FeatureQuery consumed by the OGC repository. Unsupported
 * parameters are rejected with InvalidParameterValue and never silently
 * ignored, per OGC API Features requirements classes.
 */

import { z } from "zod";
import { invalidParameterValue } from "./errors";

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 1000;
export const DEFAULT_CRS = "CRS84";

/** Bounding box in CRS84 axis order: [minLon, minLat, maxLon, maxLat]. */
export type Bbox = [number, number, number, number];

export interface FeatureQuery {
  bbox?: Bbox;
  /**
   * Reserved for OGC API conformance. The source data has no temporal
   * field, so any `datetime` parameter is currently rejected with
   * InvalidParameterValue instead of being silently ignored.
   */
  datetime?: string;
  limit: number;
  offset: number;
  properties?: string[];
  crs: string;
}

/** Parameters this shared layer understands. Protocol-specific parameters
 * (for example `f` for content negotiation) must be handled by the route
 * handler before calling this parser. */
const SUPPORTED_PARAMETERS = new Set([
  "bbox",
  "datetime",
  "limit",
  "offset",
  "properties",
  "crs",
]);

const CRS84_SPELLINGS = new Set([
  "CRS84",
  "OGC:CRS84",
  "urn:ogc:def:crs:OGC:1.3:CRS84",
  "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
]);

const limitSchema = z.coerce.number().int().min(1).max(MAX_LIMIT);
const offsetSchema = z.coerce.number().int().min(0);
const ordinateSchema = z.coerce.number().finite();

export type FeatureQueryParams =
  | URLSearchParams
  | Record<string, string | undefined>;

function toEntries(
  params: FeatureQueryParams,
): Array<[string, string]> {
  if (params instanceof URLSearchParams) {
    return Array.from(params.entries());
  }
  return Object.entries(params).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
}

function parseInteger(
  schema: typeof limitSchema,
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw === "") {
    if (raw === "") {
      throw invalidParameterValue(name, `Parameter "${name}" must not be empty`);
    }
    return fallback;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw invalidParameterValue(
      name,
      `Parameter "${name}" must be an integer between 1 and ${MAX_LIMIT}, got "${raw}"`,
    );
  }
  return result.data;
}

function parseBbox(raw: string): Bbox {
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.length !== 4) {
    throw invalidParameterValue(
      "bbox",
      `Parameter "bbox" must have exactly 4 ordinates (minLon,minLat,maxLon,maxLat), got ${parts.length}`,
    );
  }
  const numbers = parts.map((part) => {
    const result = ordinateSchema.safeParse(part);
    if (!result.success) {
      throw invalidParameterValue(
        "bbox",
        `Parameter "bbox" contains a non-numeric ordinate: "${part}"`,
      );
    }
    return result.data;
  });
  const [minLon, minLat, maxLon, maxLat] = numbers as Bbox;
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
    throw invalidParameterValue(
      "bbox",
      `Parameter "bbox" ordinates must be within longitude [-180, 180] and latitude [-90, 90]`,
    );
  }
  if (minLon > maxLon || minLat > maxLat) {
    throw invalidParameterValue(
      "bbox",
      `Parameter "bbox" minimum ordinates must not exceed maximum ordinates`,
    );
  }
  return [minLon, minLat, maxLon, maxLat];
}

function parseProperties(raw: string): string[] | undefined {
  const properties = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return properties.length > 0 ? properties : undefined;
}

/**
 * Parses raw query parameters into a validated FeatureQuery.
 * Throws OgcError with code InvalidParameterValue for any malformed,
 * out-of-range, or unsupported input.
 */
export function parseFeatureQuery(params: FeatureQueryParams): FeatureQuery {
  const entries = toEntries(params);
  const raw: Record<string, string> = {};
  for (const [key, value] of entries) {
    const normalizedKey = key.toLowerCase();
    if (!SUPPORTED_PARAMETERS.has(normalizedKey)) {
      throw invalidParameterValue(
        key,
        `Unsupported parameter "${key}"; supported parameters are: ${Array.from(SUPPORTED_PARAMETERS).join(", ")}`,
      );
    }
    raw[normalizedKey] = value;
  }

  if (raw.datetime !== undefined) {
    throw invalidParameterValue(
      "datetime",
      'Parameter "datetime" is not supported: the source data has no temporal field',
    );
  }

  let crs = DEFAULT_CRS;
  if (raw.crs !== undefined) {
    if (!CRS84_SPELLINGS.has(raw.crs)) {
      throw invalidParameterValue(
        "crs",
        `Unsupported crs "${raw.crs}"; only CRS84 is offered`,
      );
    }
    crs = DEFAULT_CRS;
  }

  return {
    bbox: raw.bbox !== undefined ? parseBbox(raw.bbox) : undefined,
    limit: parseInteger(limitSchema, "limit", raw.limit, DEFAULT_LIMIT),
    offset: parseInteger(offsetSchema, "offset", raw.offset, 0),
    properties:
      raw.properties !== undefined ? parseProperties(raw.properties) : undefined,
    crs,
  };
}
