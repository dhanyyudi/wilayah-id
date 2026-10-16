/**
 * Data provenance for every REST and OGC response.
 *
 * One place for source names, editions and attribution so routes do not
 * repeat them. The values mirror the active rows of `public.dataset_snapshot`
 * written by `sql/migrations/20261015_big2026_boundaries.sql`; update both
 * together when a new snapshot is loaded. The MCP server keeps the same
 * values in `mcp/wilayah_mcp/provenance.py`.
 */

export interface DataSource {
  name: string;
  edition: string;
  url: string;
}

export const DATA_SOURCES = {
  geometry: {
    name: "Badan Informasi Geospasial (BIG), BATASWILAYAH",
    edition: "2026-06-12",
    url: "https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH",
  },
  names: {
    name: "Kepmendagri 2025 via region-id",
    edition: "2025",
    url: "https://github.com/lokabisa-oss/region-id",
  },
  demographics: {
    name: "Ditjen Dukcapil Kemendagri",
    edition: "2024 Semester 1",
    url: "https://gis.dukcapil.kemendagri.go.id/peta/",
  },
} as const satisfies Record<string, DataSource>;

/** Machine-readable identifier of the combined data snapshot. */
export const DATASET_SNAPSHOT =
  "big-2026-06-12+kepmendagri-2025+dukcapil-2024-s1";

/** Geometry source label, equal to `sumber_geometri` of BIG-derived rows. */
export const GEOMETRY_SOURCE = `BIG BATASWILAYAH ${DATA_SOURCES.geometry.edition}`;

export const ATTRIBUTION =
  "Badan Informasi Geospasial (BIG); Kemendagri; Ditjen Dukcapil Kemendagri";

/** `meta` block for region listings and lookups. */
export const REGION_META = {
  source:
    `${GEOMETRY_SOURCE}; names Kepmendagri ${DATA_SOURCES.names.edition}; ` +
    `population Dukcapil ${DATA_SOURCES.demographics.edition}`,
  snapshot: DATASET_SNAPSHOT,
  attribution: ATTRIBUTION,
} as const;

/** Postal code source, unchanged by the boundary migration. */
export const POSTAL_CODE_SOURCE = "postal-code-id v2026Q1 (lokabisa-oss)";

/**
 * Geometry source of one feature. Villages carry their own
 * `sumber_geometri`, because a village without a BIG polygon may keep a
 * clipped Dukcapil geometry; other levels are always built from BIG.
 */
export function featureGeometrySource(sumberGeometri?: unknown): string {
  return typeof sumberGeometri === "string" && sumberGeometri.length > 0
    ? sumberGeometri
    : GEOMETRY_SOURCE;
}
