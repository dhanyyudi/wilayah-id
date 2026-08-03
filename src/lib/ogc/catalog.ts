/**
 * Shared OGC collection catalog.
 *
 * One descriptor per administrative level, consumed by every spatial
 * protocol (WFS, WMS, OGC API Features). Table and column identifiers live
 * only here; SQL is built exclusively from these fixed values, never from
 * caller input.
 */

export type CollectionId = "provinces" | "regencies" | "districts" | "villages";

export interface CollectionDefinition {
  id: CollectionId;
  title: string;
  table: "provinsi" | "kabupaten" | "kecamatan" | "desa";
  idColumn: string;
  nameColumn: string;
  geometryColumn: "geom";
  /**
   * Non-geometry attribute columns callers may select through the
   * `properties` query parameter. Always includes idColumn and nameColumn.
   */
  propertyColumns: readonly string[];
}

export const COLLECTIONS: Record<CollectionId, CollectionDefinition> = {
  provinces: {
    id: "provinces",
    title: "Provinces",
    table: "provinsi",
    idColumn: "kode_prov",
    nameColumn: "nama_provinsi",
    geometryColumn: "geom",
    propertyColumns: [
      "kode_prov",
      "nama_provinsi",
      "area_km2",
      "jumlah_penduduk",
      "jumlah_kk",
      "kepadatan",
      "luas_wilayah",
      "jumlah_kab",
      "jumlah_kota",
      "jumlah_kec",
      "jumlah_desa",
      "jumlah_kel",
    ],
  },
  regencies: {
    id: "regencies",
    title: "Regencies/Cities",
    table: "kabupaten",
    idColumn: "kode_kab",
    nameColumn: "nama_kabupaten",
    geometryColumn: "geom",
    propertyColumns: [
      "kode_kab",
      "kode_prov",
      "nama_kabupaten",
      "tipe",
      "area_km2",
      "jumlah_penduduk",
      "jumlah_kk",
      "kepadatan",
      "luas_wilayah",
      "jumlah_kec",
      "jumlah_desa",
      "jumlah_kel",
    ],
  },
  districts: {
    id: "districts",
    title: "Districts",
    table: "kecamatan",
    idColumn: "kode_kec",
    nameColumn: "nama_kecamatan",
    geometryColumn: "geom",
    propertyColumns: [
      "kode_kec",
      "kode_kab",
      "nama_kecamatan",
      "area_km2",
      "jumlah_penduduk",
      "jumlah_kk",
      "kepadatan",
      "luas_wilayah",
      "jumlah_desa",
      "jumlah_kel",
    ],
  },
  villages: {
    id: "villages",
    title: "Villages",
    table: "desa",
    idColumn: "kode_desa",
    nameColumn: "nama_desa",
    geometryColumn: "geom",
    propertyColumns: [
      "kode_desa",
      "kode_kec",
      "nama_desa",
      "tipe",
      "area_km2",
      "jumlah_penduduk",
      "pulau",
      "jangkauan",
    ],
  },
};

export const COLLECTION_IDS = Object.keys(COLLECTIONS) as CollectionId[];

/**
 * Looks up a collection definition by id. Returns null for unknown ids.
 */
export function findCollection(id: string): CollectionDefinition | null {
  return (COLLECTIONS as Record<string, CollectionDefinition>)[id] ?? null;
}
