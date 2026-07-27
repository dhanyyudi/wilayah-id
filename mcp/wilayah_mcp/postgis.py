"""Read-only PostGIS adapter for the Wilayah-ID schema."""

from __future__ import annotations

from contextlib import contextmanager
import os
from threading import Lock
from typing import Any, Iterator

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

from .errors import RepositoryError


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
  JOIN kabupaten k ON d.kode_kab = k.kode_kab
  JOIN provinsi p ON d.kode_prov = p.kode_prov
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
        JOIN kabupaten k ON d.kode_kab = k.kode_kab
        JOIN provinsi p ON d.kode_prov = p.kode_prov
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
LEFT JOIN kabupaten k ON d.kode_kab = k.kode_kab
LEFT JOIN provinsi p ON d.kode_prov = p.kode_prov
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


class PostgisSpatialRepository:
    """Wilayah-ID implementation of the storage-independent repository seam."""

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
        with self._connection() as connection:
            with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(sql, params)
                return [dict(row) for row in cursor.fetchall()]

    def _fetch_one(
        self, sql: str, params: tuple[Any, ...]
    ) -> dict[str, Any] | None:
        with self._connection() as connection:
            with connection.cursor(cursor_factory=RealDictCursor) as cursor:
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

    def close(self) -> None:
        if self._pool is not None:
            self._pool.closeall()
            self._pool = None
