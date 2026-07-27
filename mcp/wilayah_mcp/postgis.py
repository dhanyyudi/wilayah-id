"""Read-only PostGIS adapter for the Wilayah-ID schema."""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from threading import Lock
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

from .errors import RepositoryError
from .models import FeatureRef

SEARCH_SQL = """
(
  SELECT 'PROVINSI' AS tipe, kode_prov AS kode, nama_provinsi AS nama,
         NULL AS nama_provinsi, NULL AS nama_kabupaten, NULL AS nama_kecamatan
  FROM provinsi WHERE UPPER(nama_provinsi) LIKE %s
  LIMIT %s
)
UNION ALL
(
  SELECT k.tipe, k.kode_kab AS kode, k.nama_kabupaten AS nama,
         p.nama_provinsi, NULL AS nama_kabupaten, NULL AS nama_kecamatan
  FROM kabupaten k
  JOIN provinsi p ON k.kode_prov = p.kode_prov
  WHERE UPPER(k.nama_kabupaten) LIKE %s
  LIMIT %s
)
UNION ALL
(
  SELECT 'KECAMATAN' AS tipe, c.kode_kec AS kode, c.nama_kecamatan AS nama,
         p.nama_provinsi, k.nama_kabupaten, NULL AS nama_kecamatan
  FROM kecamatan c
  JOIN kabupaten k ON c.kode_kab = k.kode_kab
  JOIN provinsi p ON k.kode_prov = p.kode_prov
  WHERE UPPER(c.nama_kecamatan) LIKE %s
  LIMIT %s
)
UNION ALL
(
  SELECT d.tipe, d.kode_desa AS kode, d.nama_desa AS nama,
         p.nama_provinsi, k.nama_kabupaten, c.nama_kecamatan
  FROM desa d
  JOIN kecamatan c ON d.kode_kec = c.kode_kec
  JOIN kabupaten k ON c.kode_kab = k.kode_kab
  JOIN provinsi p ON k.kode_prov = p.kode_prov
  WHERE UPPER(d.nama_desa) LIKE %s
  LIMIT %s
)
ORDER BY tipe DESC, nama ASC
LIMIT %s
"""

DETAIL_SQL = {
    2: "SELECT * FROM provinsi WHERE kode_prov = %s",
    4: """
        SELECT k.*, p.nama_provinsi
        FROM kabupaten k
        JOIN provinsi p ON k.kode_prov = p.kode_prov
        WHERE k.kode_kab = %s
    """,
    6: """
        SELECT c.*, k.nama_kabupaten, p.nama_provinsi
        FROM kecamatan c
        JOIN kabupaten k ON c.kode_kab = k.kode_kab
        JOIN provinsi p ON c.kode_prov = p.kode_prov
        WHERE c.kode_kec = %s
    """,
    10: """
        SELECT d.*, c.nama_kecamatan, k.nama_kabupaten, p.nama_provinsi,
               pc.kode_pos
        FROM desa d
        JOIN kecamatan c ON d.kode_kec = c.kode_kec
        JOIN kabupaten k ON c.kode_kab = k.kode_kab
        JOIN provinsi p ON k.kode_prov = p.kode_prov
        LEFT JOIN postal_code pc ON d.kode_desa = pc.kode_desa
        WHERE d.kode_desa = %s
    """,
}

REVERSE_SQL = """
WITH pt AS (
  SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS geom
)
SELECT
  p.kode_prov, p.nama_provinsi,
  k.kode_kab, k.nama_kabupaten, k.tipe AS tipe_kab,
  c.kode_kec, c.nama_kecamatan,
  d.kode_desa, d.nama_desa, d.tipe AS tipe_desa, pc.kode_pos
FROM pt
LEFT JOIN desa d ON ST_Intersects(pt.geom, d.geom)
LEFT JOIN kecamatan c ON d.kode_kec = c.kode_kec
LEFT JOIN kabupaten k ON c.kode_kab = k.kode_kab
LEFT JOIN provinsi p ON k.kode_prov = p.kode_prov
LEFT JOIN postal_code pc ON d.kode_desa = pc.kode_desa
"""

TOP_POPULATION_SQL = {
    "provinsi": """
        SELECT kode_prov AS kode, nama_provinsi AS nama, jumlah_penduduk,
               jumlah_kk, kepadatan, luas_wilayah
        FROM provinsi
        ORDER BY jumlah_penduduk {order} NULLS LAST LIMIT %s
    """,
    "kabupaten": """
        SELECT kode_kab AS kode, nama_kabupaten AS nama, tipe,
               jumlah_penduduk, jumlah_kk, kepadatan, luas_wilayah
        FROM kabupaten
        ORDER BY jumlah_penduduk {order} NULLS LAST LIMIT %s
    """,
    "kecamatan": """
        SELECT c.kode_kec AS kode, c.nama_kecamatan AS nama, k.nama_kabupaten,
               c.jumlah_penduduk, c.jumlah_kk, c.kepadatan, c.luas_wilayah
        FROM kecamatan c
        JOIN kabupaten k ON c.kode_kab = k.kode_kab
        ORDER BY c.jumlah_penduduk {order} NULLS LAST LIMIT %s
    """,
    "desa": """
        SELECT d.kode_desa AS kode, d.nama_desa AS nama, c.nama_kecamatan,
               d.jumlah_penduduk, d.pulau, d.jangkauan
        FROM desa d
        JOIN kecamatan c ON d.kode_kec = c.kode_kec
        ORDER BY d.jumlah_penduduk {order} NULLS LAST LIMIT %s
    """,
}


@dataclass(frozen=True)
class LayerSpec:
    layer_id: str
    title: str
    table: str
    alias: str
    id_column: str
    name_column: str
    type_column: str | None
    parent_layer: str | None
    parent_column: str | None
    child_layer: str | None
    attributes: tuple[str, ...]


LAYER_SPECS = {
    "province": LayerSpec(
        layer_id="province",
        title="Indonesian provinces",
        table="provinsi",
        alias="p",
        id_column="kode_prov",
        name_column="nama_provinsi",
        type_column=None,
        parent_layer=None,
        parent_column=None,
        child_layer="regency",
        attributes=(
            "kode_prov",
            "nama_provinsi",
            "area_km2",
            "jumlah_penduduk",
            "jumlah_kk",
            "jumlah_kab",
            "jumlah_kota",
            "jumlah_kec",
            "jumlah_desa",
            "jumlah_kel",
            "kepadatan",
            "luas_wilayah",
        ),
    ),
    "regency": LayerSpec(
        layer_id="regency",
        title="Indonesian regencies and cities",
        table="kabupaten",
        alias="k",
        id_column="kode_kab",
        name_column="nama_kabupaten",
        type_column="tipe",
        parent_layer="province",
        parent_column="kode_prov",
        child_layer="district",
        attributes=(
            "kode_kab",
            "kode_prov",
            "nama_kabupaten",
            "tipe",
            "area_km2",
            "jumlah_penduduk",
            "jumlah_kk",
            "jumlah_kec",
            "jumlah_desa",
            "jumlah_kel",
            "kepadatan",
            "luas_wilayah",
        ),
    ),
    "district": LayerSpec(
        layer_id="district",
        title="Indonesian districts",
        table="kecamatan",
        alias="c",
        id_column="kode_kec",
        name_column="nama_kecamatan",
        type_column=None,
        parent_layer="regency",
        parent_column="kode_kab",
        child_layer="village",
        attributes=(
            "kode_kec",
            "kode_kab",
            "nama_kecamatan",
            "area_km2",
            "jumlah_penduduk",
            "jumlah_kk",
            "jumlah_desa",
            "jumlah_kel",
            "kepadatan",
            "luas_wilayah",
        ),
    ),
    "village": LayerSpec(
        layer_id="village",
        title="Indonesian villages and urban wards",
        table="desa",
        alias="d",
        id_column="kode_desa",
        name_column="nama_desa",
        type_column="tipe",
        parent_layer="district",
        parent_column="kode_kec",
        child_layer=None,
        attributes=(
            "kode_desa",
            "kode_kec",
            "nama_desa",
            "tipe",
            "area_km2",
            "jumlah_penduduk",
            "pulau",
            "jangkauan",
        ),
    ),
}


FROM_CLAUSES = {
    "province": "provinsi p",
    "regency": """
        kabupaten k
        LEFT JOIN provinsi p ON k.kode_prov = p.kode_prov
    """,
    "district": """
        kecamatan c
        LEFT JOIN kabupaten k ON c.kode_kab = k.kode_kab
        LEFT JOIN provinsi p ON k.kode_prov = p.kode_prov
    """,
    "village": """
        desa d
        LEFT JOIN kecamatan c ON d.kode_kec = c.kode_kec
        LEFT JOIN kabupaten k ON c.kode_kab = k.kode_kab
        LEFT JOIN provinsi p ON k.kode_prov = p.kode_prov
    """,
}


ANCESTOR_EXPRESSIONS = {
    "province": {"province": ("p.kode_prov", "p.nama_provinsi")},
    "regency": {
        "province": ("p.kode_prov", "p.nama_provinsi"),
        "regency": ("k.kode_kab", "k.nama_kabupaten"),
    },
    "district": {
        "province": ("p.kode_prov", "p.nama_provinsi"),
        "regency": ("k.kode_kab", "k.nama_kabupaten"),
        "district": ("c.kode_kec", "c.nama_kecamatan"),
    },
    "village": {
        "province": ("p.kode_prov", "p.nama_provinsi"),
        "regency": ("k.kode_kab", "k.nama_kabupaten"),
        "district": ("c.kode_kec", "c.nama_kecamatan"),
        "village": ("d.kode_desa", "d.nama_desa"),
    },
}


def _parent_projection(spec: LayerSpec) -> str:
    if spec.parent_layer is None:
        return """
            NULL::text AS parent_layer,
            NULL::text AS parent_feature_id,
            NULL::text AS parent_name
        """
    id_expression, name_expression = ANCESTOR_EXPRESSIONS[spec.layer_id][
        spec.parent_layer
    ]
    return f"""
        '{spec.parent_layer}'::text AS parent_layer,
        {id_expression}::text AS parent_feature_id,
        {name_expression}::text AS parent_name
    """


def _summary_projection(spec: LayerSpec) -> str:
    alias = spec.alias
    feature_type = (
        f"{alias}.{spec.type_column}::text"
        if spec.type_column is not None
        else "NULL::text"
    )
    return f"""
        'wilayah-id'::text AS dataset_id,
        '{spec.layer_id}'::text AS layer,
        {alias}.{spec.id_column}::text AS feature_id,
        {alias}.{spec.name_column}::text AS name,
        {feature_type} AS feature_type,
        {_parent_projection(spec)}
    """


def _hierarchy_from_row(
    row: dict[str, Any],
    layer: str,
) -> list[dict[str, Any]]:
    hierarchy = []
    for ancestor_layer in ("province", "regency", "district"):
        if ancestor_layer == layer:
            break
        feature_id = row.pop(f"{ancestor_layer}_feature_id", None)
        name = row.pop(f"{ancestor_layer}_name", None)
        if feature_id is not None:
            hierarchy.append(
                {
                    "feature_ref": {
                        "dataset_id": "wilayah-id",
                        "layer": ancestor_layer,
                        "feature_id": str(feature_id),
                    },
                    "name": name,
                }
            )
    return hierarchy


class PostgisSpatialRepository:
    """Wilayah-ID implementation of the storage-independent repository seam."""

    dataset_id = "wilayah-id"
    layer_ids = ("province", "regency", "district", "village")

    def get_layer_attributes(self, layer: str) -> tuple[str, ...]:
        return LAYER_SPECS[layer].attributes

    def __init__(
        self,
        database_url: str | None = None,
        *,
        min_connections: int | None = None,
        max_connections: int | None = None,
        statement_timeout_ms: int | None = None,
    ) -> None:
        self.database_url = database_url or os.getenv("DATABASE_URL")
        self.min_connections = min_connections or int(
            os.getenv("MCP_DB_POOL_MIN", "1")
        )
        self.max_connections = max_connections or int(
            os.getenv("MCP_DB_POOL_MAX", "5")
        )
        self.statement_timeout_ms = statement_timeout_ms or int(
            os.getenv("MCP_STATEMENT_TIMEOUT_MS", "5000")
        )
        self._pool: ThreadedConnectionPool | None = None
        self._pool_lock = Lock()

    def _get_pool(self) -> ThreadedConnectionPool:
        if not self.database_url:
            raise RepositoryError("DATABASE_URL is not configured")
        if self._pool is None:
            with self._pool_lock:
                if self._pool is None:
                    try:
                        self._pool = ThreadedConnectionPool(
                            self.min_connections,
                            self.max_connections,
                            self.database_url,
                        )
                    except psycopg2.Error as exc:
                        raise RepositoryError("Could not initialize database pool") from exc
        return self._pool

    @contextmanager
    def _connection(self) -> Iterator[Any]:
        pool = self._get_pool()
        connection = None
        try:
            connection = pool.getconn()
            connection.set_session(readonly=True, autocommit=False)
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT set_config('statement_timeout', %s, true)",
                    (str(self.statement_timeout_ms),),
                )
            yield connection
        except psycopg2.Error as exc:
            if connection is not None:
                try:
                    connection.rollback()
                except psycopg2.Error:
                    pass
            raise RepositoryError("PostGIS query failed") from exc
        finally:
            if connection is not None:
                try:
                    connection.rollback()
                    pool.putconn(connection)
                except psycopg2.Error:
                    pool.putconn(connection, close=True)

    def _fetch_all(
        self, sql: str, params: tuple[Any, ...]
    ) -> list[dict[str, Any]]:
        with (
            self._connection() as connection,
            connection.cursor(cursor_factory=RealDictCursor) as cursor,
        ):
            cursor.execute(sql, params)
            return [dict(row) for row in cursor.fetchall()]

    def _fetch_one(
        self, sql: str, params: tuple[Any, ...]
    ) -> dict[str, Any] | None:
        with (
            self._connection() as connection,
            connection.cursor(cursor_factory=RealDictCursor) as cursor,
        ):
            cursor.execute(sql, params)
            row = cursor.fetchone()
            return dict(row) if row is not None else None

    def search_regions(self, query: str, limit: int) -> list[dict[str, Any]]:
        search_query = f"%{query.upper()}%"
        params = (
            search_query,
            limit,
            search_query,
            limit,
            search_query,
            limit,
            search_query,
            limit,
            limit,
        )
        return self._fetch_all(SEARCH_SQL, params)

    def get_region_details(self, code: str) -> dict[str, Any] | None:
        row = self._fetch_one(DETAIL_SQL[len(code)], (code,))
        if row is None:
            return None
        row.pop("geom", None)
        if len(code) == 2:
            count = self._fetch_one(
                "SELECT COUNT(*) AS count FROM kabupaten WHERE kode_prov = %s",
                (code,),
            )
            row["jumlah_kabupaten"] = count["count"] if count else 0
        return row

    def reverse_geocode(self, lat: float, lng: float) -> dict[str, Any] | None:
        return self._fetch_one(REVERSE_SQL, (lng, lat))

    def get_top_populated_regions(
        self, level: str, limit: int, descending: bool
    ) -> list[dict[str, Any]]:
        order = "DESC" if descending else "ASC"
        sql = TOP_POPULATION_SQL[level].format(order=order)
        return self._fetch_all(sql, (limit,))

    def describe_spatial_service(self) -> dict[str, Any]:
        layers = []
        for spec in LAYER_SPECS.values():
            row = self._fetch_one(
                f"""
                SELECT
                  COUNT(*)::integer AS feature_count,
                  json_build_array(
                    ST_XMin(ST_Extent(geom)),
                    ST_YMin(ST_Extent(geom)),
                    ST_XMax(ST_Extent(geom)),
                    ST_YMax(ST_Extent(geom))
                  ) AS bbox
                FROM {spec.table}
                """,
                (),
            )
            layers.append(
                {
                    "layer": spec.layer_id,
                    "title": spec.title,
                    "geometry_type": "MultiPolygon",
                    "crs": "EPSG:4326",
                    "feature_count": row["feature_count"] if row else 0,
                    "bbox": row["bbox"] if row else None,
                    "attributes": list(spec.attributes),
                    "parent_layer": spec.parent_layer,
                    "child_layer": spec.child_layer,
                    "operations": [
                        "resolve",
                        "inspect",
                        "locate",
                        "relate",
                        "find_related",
                        "extract_subset",
                    ],
                }
            )
        return {
            "interface_version": "1.0.0",
            "service": {
                "name": "Wilayah-ID Spatial Interoperability Service",
                "dataset_id": self.dataset_id,
                "description": (
                    "Administrative-boundary case study exposed through a "
                    "dataset-independent spatial interface."
                ),
            },
            "snapshot": "dukcapil-2024-s1+kepmendagri-2025",
            "crs": "EPSG:4326",
            "data_sources": [
                {
                    "name": "Ditjen Dukcapil Kemendagri administrative boundaries",
                    "snapshot": "2024-semester-1",
                    "role": "geometry",
                },
                {
                    "name": "Kepmendagri-derived region codes",
                    "snapshot": "2025",
                    "role": "identifiers-and-hierarchy",
                },
            ],
            "license": {
                "status": "verification_required",
                "note": (
                    "Verify source redistribution terms before publishing "
                    "download artifacts."
                ),
            },
            "attribution": (
                "Ditjen Dukcapil Kemendagri; Kepmendagri-derived region codes"
            ),
            "layers": layers,
            "supported_relations": [
                "contains",
                "within",
                "touches",
                "intersects",
                "overlaps",
                "disjoint",
                "distance",
                "direction",
            ],
            "supported_subset_formats": ["geojson", "geopackage"],
            "warnings": [
                (
                    "Geometry and region-code snapshots require version "
                    "reconciliation before benchmark ground truth is finalized."
                ),
                "Source licensing terms must be verified before redistribution.",
            ],
        }

    def resolve_spatial_entities(
        self,
        query: str,
        *,
        layer: str | None,
        parent_ref: FeatureRef | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        specs = [LAYER_SPECS[layer]] if layer else list(LAYER_SPECS.values())
        statements: list[str] = []
        params: list[Any] = []
        contains = f"%{query}%"
        prefix = f"{query}%"

        for spec in specs:
            alias = spec.alias
            parent_filter = ""
            parent_params: list[Any] = []
            if parent_ref is not None:
                expressions = ANCESTOR_EXPRESSIONS[spec.layer_id]
                if parent_ref.layer not in expressions:
                    continue
                parent_id_expression, _ = expressions[parent_ref.layer]
                if parent_ref.layer == spec.layer_id:
                    continue
                parent_filter = f"AND {parent_id_expression}::text = %s"
                parent_params.append(parent_ref.feature_id)
            statements.append(
                f"""
                SELECT
                  {_summary_projection(spec)},
                  CASE
                    WHEN {alias}.{spec.id_column}::text = %s THEN 1.0
                    WHEN UPPER({alias}.{spec.name_column}) = UPPER(%s) THEN 0.95
                    WHEN {alias}.{spec.name_column} ILIKE %s THEN 0.80
                    ELSE 0.60
                  END::double precision AS match_score,
                  CASE
                    WHEN {alias}.{spec.id_column}::text = %s THEN 'identifier'
                    WHEN UPPER({alias}.{spec.name_column}) = UPPER(%s) THEN 'exact_name'
                    WHEN {alias}.{spec.name_column} ILIKE %s THEN 'name_prefix'
                    ELSE 'name_contains'
                  END::text AS match_reason
                FROM {FROM_CLAUSES[spec.layer_id]}
                WHERE (
                  {alias}.{spec.id_column}::text = %s
                  OR {alias}.{spec.name_column} ILIKE %s
                )
                {parent_filter}
                """
            )
            params.extend(
                [
                    query,
                    query,
                    prefix,
                    query,
                    query,
                    prefix,
                    query,
                    contains,
                    *parent_params,
                ]
            )

        if not statements:
            return []
        sql = f"""
            SELECT *
            FROM ({" UNION ALL ".join(statements)}) AS candidates
            ORDER BY match_score DESC, length(name), name, layer
            LIMIT %s
        """
        params.append(limit)
        return self._fetch_all(sql, tuple(params))

    def get_spatial_entity(
        self,
        feature_ref: FeatureRef,
        *,
        include_geometry: bool,
        max_geometry_points: int,
    ) -> dict[str, Any] | None:
        spec = LAYER_SPECS[feature_ref.layer]
        alias = spec.alias
        hierarchy_columns = []
        for ancestor_layer in ("province", "regency", "district"):
            expressions = ANCESTOR_EXPRESSIONS[spec.layer_id]
            if ancestor_layer not in expressions or ancestor_layer == spec.layer_id:
                continue
            ancestor_id, ancestor_name = expressions[ancestor_layer]
            hierarchy_columns.extend(
                [
                    f"{ancestor_id}::text AS {ancestor_layer}_feature_id",
                    f"{ancestor_name}::text AS {ancestor_layer}_name",
                ]
            )
        hierarchy_sql = (
            ",\n".join(hierarchy_columns)
            if hierarchy_columns
            else "NULL::text AS unused_hierarchy"
        )

        child_count_sql = "NULL::integer"
        if spec.child_layer is not None:
            child = LAYER_SPECS[spec.child_layer]
            child_count_sql = (
                f"(SELECT COUNT(*)::integer FROM {child.table} child "
                f"WHERE child.{child.parent_column}::text = "
                f"{alias}.{spec.id_column}::text)"
            )

        row = self._fetch_one(
            f"""
            SELECT
              {_summary_projection(spec)},
              to_jsonb({alias})
                - 'id' - 'geom' - 'created_at' - 'updated_at' AS properties,
              ST_AsGeoJSON(ST_PointOnSurface({alias}.geom), 6)::json
                AS representative_point,
              json_build_array(
                ST_XMin(Box2D({alias}.geom)),
                ST_YMin(Box2D({alias}.geom)),
                ST_XMax(Box2D({alias}.geom)),
                ST_YMax(Box2D({alias}.geom))
              ) AS bbox,
              ST_NPoints({alias}.geom)::integer AS geometry_points,
              CASE
                WHEN %s AND ST_NPoints({alias}.geom) <= %s
                THEN ST_AsGeoJSON({alias}.geom, 6)::json
                ELSE NULL
              END AS geometry,
              {child_count_sql} AS child_count,
              {hierarchy_sql}
            FROM {FROM_CLAUSES[spec.layer_id]}
            WHERE {alias}.{spec.id_column}::text = %s
            """,
            (include_geometry, max_geometry_points, feature_ref.feature_id),
        )
        if row is None:
            return None
        row["hierarchy"] = _hierarchy_from_row(row, spec.layer_id)
        row.pop("unused_hierarchy", None)
        return row

    def locate_coordinates(
        self,
        latitude: float,
        longitude: float,
        *,
        layers: list[str],
        boundary_policy: str,
    ) -> list[dict[str, Any]]:
        predicate = "ST_Covers" if boundary_policy == "covers" else "ST_Contains"
        matches: list[dict[str, Any]] = []
        for layer in layers:
            spec = LAYER_SPECS[layer]
            alias = spec.alias
            rows = self._fetch_all(
                f"""
                WITH point AS (
                  SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS geom
                )
                SELECT
                  {_summary_projection(spec)},
                  ST_Touches({alias}.geom, point.geom) AS on_boundary
                FROM {FROM_CLAUSES[layer]}, point
                WHERE {predicate}({alias}.geom, point.geom)
                ORDER BY ST_Area({alias}.geom::geography), feature_id
                LIMIT 10
                """,
                (longitude, latitude),
            )
            matches.extend(rows)
        return matches

    def relate_spatial_entities(
        self,
        subject_ref: FeatureRef,
        object_ref: FeatureRef,
        *,
        distance_mode: str,
        tolerance_m: float,
    ) -> dict[str, Any] | None:
        subject = LAYER_SPECS[subject_ref.layer]
        object_spec = LAYER_SPECS[object_ref.layer]
        subject_distance = (
            "ST_PointOnSurface(subject.geom)"
            if distance_mode == "representative_point"
            else "subject.geom"
        )
        object_distance = (
            "ST_PointOnSurface(object.geom)"
            if distance_mode == "representative_point"
            else "object.geom"
        )
        return self._fetch_one(
            f"""
            WITH subject AS (
              SELECT geom AS original_geom, ST_MakeValid(geom) AS geom
              FROM {subject.table}
              WHERE {subject.id_column}::text = %s
            ),
            object AS (
              SELECT geom AS original_geom, ST_MakeValid(geom) AS geom
              FROM {object_spec.table}
              WHERE {object_spec.id_column}::text = %s
            )
            SELECT
              ST_Contains(subject.geom, object.geom) AS contains,
              ST_Within(subject.geom, object.geom) AS within,
              ST_Touches(subject.geom, object.geom) AS touches,
              ST_Intersects(subject.geom, object.geom) AS intersects,
              ST_Overlaps(subject.geom, object.geom) AS overlaps,
              ST_Disjoint(subject.geom, object.geom) AS disjoint,
              ST_Distance(
                {subject_distance}::geography,
                {object_distance}::geography
              )::double precision AS distance_m,
              degrees(
                ST_Azimuth(
                  ST_PointOnSurface(subject.geom),
                  ST_PointOnSurface(object.geom)
                )
              )::double precision AS bearing_degrees,
              ST_Relate(subject.geom, object.geom) AS de9im,
              ST_IsValid(subject.original_geom) AS subject_valid,
              ST_IsValid(object.original_geom) AS object_valid,
              ST_DWithin(
                subject.geom::geography,
                object.geom::geography,
                %s
              ) AS within_tolerance
            FROM subject CROSS JOIN object
            """,
            (
                subject_ref.feature_id,
                object_ref.feature_id,
                tolerance_m,
            ),
        )

    def find_related_spatial_entities(
        self,
        reference_ref: FeatureRef,
        *,
        relation: str,
        target_layer: str,
        max_distance_m: float | None,
        tolerance_m: float,
        limit: int,
    ) -> list[dict[str, Any]]:
        reference = LAYER_SPECS[reference_ref.layer]
        target = LAYER_SPECS[target_layer]
        target_alias = target.alias

        if relation == "parent":
            return self._fetch_all(
                f"""
                WITH reference AS (
                  SELECT {reference.parent_column}::text AS target_id
                  FROM {reference.table}
                  WHERE {reference.id_column}::text = %s
                )
                SELECT {_summary_projection(target)}
                FROM {FROM_CLAUSES[target_layer]}, reference
                WHERE {target_alias}.{target.id_column}::text = reference.target_id
                LIMIT %s
                """,
                (reference_ref.feature_id, limit),
            )

        if relation == "children":
            return self._fetch_all(
                f"""
                SELECT {_summary_projection(target)}
                FROM {FROM_CLAUSES[target_layer]}
                WHERE {target_alias}.{target.parent_column}::text = %s
                ORDER BY name, feature_id
                LIMIT %s
                """,
                (reference_ref.feature_id, limit),
            )

        relation_predicates = {
            "neighbors": (
                f"(ST_Touches(reference.geom, {target_alias}.geom) "
                f"OR (%s > 0 AND ST_DWithin(reference.geom::geography, "
                f"{target_alias}.geom::geography, %s)))"
            ),
            "within": f"ST_Covers({target_alias}.geom, reference.geom)",
            "contains": f"ST_Covers(reference.geom, {target_alias}.geom)",
            "intersects": f"ST_Intersects(reference.geom, {target_alias}.geom)",
            "nearest": "TRUE",
        }
        predicate = relation_predicates[relation]
        params: list[Any] = [reference_ref.feature_id]
        if relation == "neighbors":
            params.extend([tolerance_m, tolerance_m])

        where = [predicate]
        if reference_ref.layer == target_layer:
            where.append(
                f"{target_alias}.{target.id_column}::text <> %s"
            )
            params.append(reference_ref.feature_id)
        if max_distance_m is not None:
            where.append(
                f"ST_DWithin(reference.geom::geography, "
                f"{target_alias}.geom::geography, %s)"
            )
            params.append(max_distance_m)

        if relation == "nearest":
            order = f"reference.geom <-> {target_alias}.geom, feature_id"
        elif relation == "neighbors":
            order = "distance_m, feature_id"
        else:
            order = "name, feature_id"
        params.append(limit)
        return self._fetch_all(
            f"""
            WITH reference AS (
              SELECT geom
              FROM {reference.table}
              WHERE {reference.id_column}::text = %s
            )
            SELECT
              {_summary_projection(target)},
              ST_Distance(
                reference.geom::geography,
                {target_alias}.geom::geography
              )::double precision AS distance_m
            FROM {FROM_CLAUSES[target_layer]}, reference
            WHERE {" AND ".join(where)}
            ORDER BY {order}
            LIMIT %s
            """,
            tuple(params),
        )

    def extract_spatial_subset(
        self,
        *,
        layer: str,
        aoi: dict[str, Any],
        predicate: str,
        clip: bool,
        attributes: list[str] | None,
        limit: int,
    ) -> dict[str, Any]:
        spec = LAYER_SPECS[layer]
        alias = spec.alias
        raw_aoi_sql: str
        params: list[Any]

        if aoi["kind"] == "bbox":
            raw_aoi_sql = (
                "SELECT ST_MakeEnvelope(%s, %s, %s, %s, 4326) AS geom"
            )
            params = list(aoi["bbox"])
        elif aoi["kind"] == "geojson":
            raw_aoi_sql = (
                "SELECT ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) AS geom"
            )
            params = [aoi["geojson"]]
        else:
            feature_ref = aoi["feature_ref"]
            reference = LAYER_SPECS[feature_ref["layer"]]
            raw_aoi_sql = (
                f"SELECT geom FROM {reference.table} "
                f"WHERE {reference.id_column}::text = %s"
            )
            params = [feature_ref["feature_id"]]

        params.append(aoi.get("buffer_m", 0))
        predicate_sql = {
            "intersects": f"ST_Intersects({alias}.geom, aoi.geom)",
            "within": f"ST_CoveredBy({alias}.geom, aoi.geom)",
            "contains": f"ST_Covers({alias}.geom, aoi.geom)",
            "centroid_within": (
                f"ST_Covers(aoi.geom, ST_PointOnSurface({alias}.geom))"
            ),
        }[predicate]
        geometry_sql = f"{alias}.geom"
        if clip:
            geometry_sql = (
                "ST_Multi(ST_CollectionExtract("
                f"ST_Intersection(ST_MakeValid({alias}.geom), aoi.geom), 3))"
            )

        property_sql = (
            f"to_jsonb({alias}) - 'id' - 'geom' - 'created_at' - 'updated_at'"
        )
        if attributes is not None:
            pairs = []
            for attribute in attributes:
                if attribute not in spec.attributes:
                    raise RepositoryError(
                        f"Unknown attribute requested for {layer}: {attribute}"
                    )
                pairs.extend([f"'{attribute}'", f"{alias}.{attribute}"])
            property_sql = (
                f"jsonb_build_object({', '.join(pairs)})"
                if pairs
                else "'{}'::jsonb"
            )

        params.append(limit)
        rows = self._fetch_all(
            f"""
            WITH raw_aoi AS (
              {raw_aoi_sql}
            ),
            aoi AS (
              SELECT
                CASE
                  WHEN %s > 0
                  THEN ST_Buffer(ST_MakeValid(geom)::geography, %s)::geometry
                  ELSE ST_MakeValid(geom)
                END AS geom
              FROM raw_aoi
            ),
            matches AS (
              SELECT
                {alias}.{spec.id_column}::text AS feature_id,
                {property_sql} AS properties,
                {geometry_sql} AS result_geom
              FROM {spec.table} {alias}, aoi
              WHERE {predicate_sql}
            ),
            valid_matches AS (
              SELECT *
              FROM matches
              WHERE result_geom IS NOT NULL AND NOT ST_IsEmpty(result_geom)
            ),
            match_counts AS (
              SELECT
                (SELECT COUNT(*)::integer FROM matches) AS number_matched,
                (SELECT COUNT(*)::integer FROM valid_matches) AS number_valid
            )
            SELECT
              match_counts.number_matched,
              match_counts.number_valid,
              CASE
                WHEN selected.feature_id IS NULL THEN NULL
                ELSE json_build_object(
                  'type', 'Feature',
                  'id', selected.feature_id,
                  'properties', selected.properties,
                  'geometry', ST_AsGeoJSON(selected.result_geom, 6)::json
                )
              END AS feature
            FROM match_counts
            LEFT JOIN LATERAL (
              SELECT *
              FROM valid_matches
              ORDER BY feature_id
              LIMIT %s
            ) AS selected ON TRUE
            ORDER BY selected.feature_id
            """,
            tuple(
                params[:-1]
                + [aoi.get("buffer_m", 0), params[-1]]
            ),
        )
        features = [row["feature"] for row in rows if row["feature"] is not None]
        number_matched = rows[0]["number_matched"] if rows else 0
        number_valid = rows[0]["number_valid"] if rows else 0
        warnings = []
        if number_valid < number_matched:
            warnings.append(
                f"{number_matched - number_valid} feature(s) were omitted because "
                "clipping produced no polygonal area."
            )
        return {
            "feature_collection": {
                "type": "FeatureCollection",
                "numberMatched": number_matched,
                "numberReturned": len(features),
                "features": features,
            },
            "number_matched": number_matched,
            "number_returned": len(features),
            "truncated": number_valid > len(features),
            "warnings": warnings,
        }

    def close(self) -> None:
        if self._pool is not None:
            self._pool.closeall()
            self._pool = None
