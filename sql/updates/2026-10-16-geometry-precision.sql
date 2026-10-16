-- Snap every boundary geometry to a 1e-6 degree grid, 2026-10-16.
--
-- REST, OGC, MCP and the tile export write GeoJSON with 6 decimals. Stored
-- BIG geometry has more, so some rings self-intersect or collapse once
-- rounded (10 provinsi, 22 kabupaten, 42 kecamatan and 111 desa on the
-- 2026-10-16 production data). ST_ReducePrecision snap-rounds to the same
-- grid and returns valid geometry, so what is stored is what is served.
-- etl/big_boundaries.py applies the same grid for later snapshots.
--
-- One transaction; a row that would become empty or invalid, or any row
-- still invalid at 6 decimals, rolls everything back. Only rows whose shape
-- changes are written. Snap rounding is not strictly idempotent near nodes,
-- so a rerun moves a few dozen rows again by less than the grid size (2
-- provinsi, 3 kabupaten, 10 kecamatan and 28 desa on 2026-10-16), all still
-- valid. Run once against the wilayah-id database:
--   psql -v ON_ERROR_STOP=1 -f sql/updates/2026-10-16-geometry-precision.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE precision_report (tbl text, changed bigint) ON COMMIT DROP;

-- Uncoded areas with no area left on the grid carry nothing; drop them
-- (one zero-area sliver on the 2026-10-16 data). Administrative rows that
-- would vanish still abort the transaction below.
WITH gone AS (
  DELETE FROM public.area_tidak_terdefinisi
  WHERE ST_IsEmpty(ST_CollectionExtract(ST_ReducePrecision(geom, 0.000001), 3))
  RETURNING id
)
INSERT INTO precision_report SELECT 'area_tidak_terdefinisi deleted', count(*) FROM gone;

DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['provinsi', 'kabupaten', 'kecamatan', 'desa', 'area_tidak_terdefinisi'] LOOP
    EXECUTE format($q$
      WITH snapped AS (
        SELECT id, ST_Multi(ST_CollectionExtract(ST_ReducePrecision(geom, 0.000001), 3)) AS g
        FROM public.%1$I
      )
      UPDATE public.%1$I t
      SET geom = s.g,
          area_km2 = ROUND((ST_Area(s.g::geography) / 1e6)::numeric, 4)%2$s
      FROM snapped s
      WHERE s.id = t.id AND NOT ST_Equals(s.g, t.geom)
    $q$, t, CASE WHEN t = 'area_tidak_terdefinisi' THEN '' ELSE ', updated_at = now()' END);
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO precision_report VALUES (t, n);
  END LOOP;
END $$;

SELECT tbl, changed FROM precision_report ORDER BY tbl;

DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT geom FROM public.provinsi UNION ALL SELECT geom FROM public.kabupaten
    UNION ALL SELECT geom FROM public.kecamatan UNION ALL SELECT geom FROM public.desa
    UNION ALL SELECT geom FROM public.area_tidak_terdefinisi) g
  WHERE geom IS NULL OR ST_IsEmpty(geom) OR NOT ST_IsValid(geom)
     OR NOT ST_IsValid(ST_GeomFromGeoJSON(ST_AsGeoJSON(geom, 6)));
  IF bad > 0 THEN
    RAISE EXCEPTION '% geometries empty or invalid after snapping', bad;
  END IF;
END $$;

COMMIT;

ANALYZE public.provinsi;
ANALYZE public.kabupaten;
ANALYZE public.kecamatan;
ANALYZE public.desa;
ANALYZE public.area_tidak_terdefinisi;
