/**
 * Shared OGC repository.
 *
 * Framework-free data access for every spatial protocol (WFS, WMS, OGC API
 * Features). SQL identifiers come only from the fixed collection catalog;
 * all caller-supplied values are bound as `pg` parameters. Database driver
 * errors are logged server-side and surfaced to callers as sanitized
 * NoApplicableCode errors.
 */

import { getDb, type DbQueryFunction } from "../db";
import {
  COLLECTION_IDS,
  findCollection,
  type CollectionDefinition,
} from "./catalog";
import {
  OgcError,
  invalidParameterValue,
  sanitizedStoreError,
} from "./errors";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type Bbox,
  type FeatureQuery,
} from "./params";

export interface GeoJsonFeature {
  type: "Feature";
  id: string;
  geometry: unknown;
  properties: Record<string, unknown>;
}

export interface FeatureListResult {
  features: GeoJsonFeature[];
  numberMatched: number;
  numberReturned: number;
}

export interface OgcRepository {
  listCollections(): CollectionDefinition[];
  getCollection(id: string): CollectionDefinition;
  listFeatures(
    id: string,
    query?: Partial<FeatureQuery>,
  ): Promise<FeatureListResult>;
  getFeature(id: string, featureId: string): Promise<GeoJsonFeature>;
}

function requireCollection(id: string): CollectionDefinition {
  const definition = findCollection(id);
  if (!definition) {
    throw new OgcError(
      "NotFound",
      `Collection "${id}" does not exist; available collections: ${COLLECTION_IDS.join(", ")}`,
      { locator: "collectionId" },
    );
  }
  return definition;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier}"`;
}

function resolveProperties(
  definition: CollectionDefinition,
  requested: string[] | undefined,
): string[] {
  if (!requested) {
    return [...definition.propertyColumns];
  }
  const selected = new Set<string>([definition.idColumn, definition.nameColumn]);
  for (const property of requested) {
    if (!definition.propertyColumns.includes(property)) {
      throw invalidParameterValue(
        "properties",
        `Unknown property "${property}" for collection "${definition.id}"; available properties: ${definition.propertyColumns.join(", ")}`,
      );
    }
    selected.add(property);
  }
  return [...selected];
}

function validatePaging(limit: number, offset: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw invalidParameterValue(
      "limit",
      `Parameter "limit" must be an integer between 1 and ${MAX_LIMIT}, got ${limit}`,
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw invalidParameterValue(
      "offset",
      `Parameter "offset" must be a non-negative integer, got ${offset}`,
    );
  }
}

function buildBBoxClause(
  definition: CollectionDefinition,
  bbox: Bbox,
  values: unknown[],
): string {
  values.push(bbox[0], bbox[1], bbox[2], bbox[3]);
  const base = values.length - 4;
  return `ST_Intersects(${quoteIdentifier(definition.geometryColumn)}, ST_MakeEnvelope($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, 4326))`;
}

function rowToFeature(
  row: Record<string, unknown>,
  idColumn: string,
): GeoJsonFeature {
  const { geometry, ...properties } = row;
  return {
    type: "Feature",
    id: String(properties[idColumn] ?? ""),
    geometry,
    properties,
  };
}

export function createOgcRepository(db?: DbQueryFunction): OgcRepository {
  const getDbFn = () => db ?? getDb();

  return {
    listCollections(): CollectionDefinition[] {
      return COLLECTION_IDS.map((id) => findCollection(id)!);
    },

    getCollection(id: string): CollectionDefinition {
      return requireCollection(id);
    },

    async listFeatures(
      id: string,
      query: Partial<FeatureQuery> = {},
    ): Promise<FeatureListResult> {
      const definition = requireCollection(id);
      const limit = query.limit ?? DEFAULT_LIMIT;
      const offset = query.offset ?? 0;
      validatePaging(limit, offset);

      const columns = resolveProperties(definition, query.properties);
      const selectList = columns.map(quoteIdentifier).join(", ");
      const geometrySelect = `ST_AsGeoJSON(${quoteIdentifier(definition.geometryColumn)}, 6)::json AS geometry`;
      const table = quoteIdentifier(definition.table);

      const whereValues: unknown[] = [];
      const whereClause = query.bbox
        ? ` WHERE ${buildBBoxClause(definition, query.bbox, whereValues)}`
        : "";

      let countRows;
      try {
        countRows = await getDbFn().query(
          `SELECT COUNT(*)::int AS matched FROM ${table}${whereClause}`,
          whereValues,
        );
      } catch (error) {
        throw sanitizedStoreError(`listFeatures count on ${definition.id}`, error);
      }
      const numberMatched = Number(countRows[0]?.matched ?? 0);

      const selectValues = [...whereValues, limit, offset];
      const limitPlaceholder = `$${whereValues.length + 1}`;
      const offsetPlaceholder = `$${whereValues.length + 2}`;
      const text =
        `SELECT ${selectList}, ${geometrySelect} FROM ${table}${whereClause}` +
        ` ORDER BY ${quoteIdentifier(definition.idColumn)}` +
        ` LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`;

      let rows;
      try {
        rows = await getDbFn().query(text, selectValues);
      } catch (error) {
        throw sanitizedStoreError(`listFeatures on ${definition.id}`, error);
      }

      const features = rows.map((row) =>
        rowToFeature(row as Record<string, unknown>, definition.idColumn),
      );
      return {
        features,
        numberMatched,
        numberReturned: features.length,
      };
    },

    async getFeature(id: string, featureId: string): Promise<GeoJsonFeature> {
      const definition = requireCollection(id);
      const selectList = definition.propertyColumns
        .map(quoteIdentifier)
        .join(", ");
      const geometrySelect = `ST_AsGeoJSON(${quoteIdentifier(definition.geometryColumn)}, 6)::json AS geometry`;
      const text =
        `SELECT ${selectList}, ${geometrySelect} FROM ${quoteIdentifier(definition.table)}` +
        ` WHERE ${quoteIdentifier(definition.idColumn)} = $1 LIMIT 1`;

      let rows;
      try {
        rows = await getDbFn().query(text, [featureId]);
      } catch (error) {
        throw sanitizedStoreError(`getFeature on ${definition.id}`, error);
      }
      if (rows.length === 0) {
        throw new OgcError(
          "NotFound",
          `Feature "${featureId}" does not exist in collection "${definition.id}"`,
        );
      }
      return rowToFeature(rows[0] as Record<string, unknown>, definition.idColumn);
    },
  };
}
