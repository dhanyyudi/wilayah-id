-- =============================================================
-- wilayah-id: switch boundary geometry to BIG BATASWILAYAH 2026
--
-- Prerequisite: scripts/load-big-stage.sh has loaded the files written
-- by `etl/big_boundaries.py prepare` into schema big2026_stage.
--
-- One transaction. The current tables move to schema
-- archive_dukcapil2024 and stay there for rollback
-- (20261015_big2026_boundaries_rollback.sql). Population, KK, density
-- and the official Dukcapil area are carried over by region code.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v app_role=<read-only role, optional> \
--        -f sql/migrations/20261015_big2026_boundaries.sql
-- =============================================================

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regnamespace('archive_dukcapil2024') IS NOT NULL THEN
    RAISE EXCEPTION 'schema archive_dukcapil2024 exists: migration already applied';
  END IF;
  IF to_regclass('big2026_stage.desa') IS NULL THEN
    RAISE EXCEPTION 'big2026_stage is not loaded';
  END IF;
END $$;

-- ── Archive current tables ──

CREATE SCHEMA archive_dukcapil2024;
ALTER TABLE public.postal_code DROP CONSTRAINT postal_code_kode_desa_fkey;
ALTER TABLE public.desa SET SCHEMA archive_dukcapil2024;
ALTER TABLE public.kecamatan SET SCHEMA archive_dukcapil2024;
ALTER TABLE public.kabupaten SET SCHEMA archive_dukcapil2024;
ALTER TABLE public.provinsi SET SCHEMA archive_dukcapil2024;
CREATE TABLE archive_dukcapil2024.postal_code AS TABLE public.postal_code;

-- ── New tables: same columns as before plus provenance and BIG attributes ──

CREATE TABLE public.provinsi (
  id serial PRIMARY KEY,
  kode_prov varchar(2) NOT NULL UNIQUE,
  nama_provinsi varchar(100) NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  area_km2 numeric(12,4),
  created_at timestamp DEFAULT now(),
  jumlah_penduduk integer,
  jumlah_kk integer,
  jumlah_kab integer,
  jumlah_kota integer,
  jumlah_kec integer,
  jumlah_desa integer,
  jumlah_kel integer,
  kepadatan numeric,
  luas_wilayah numeric,
  updated_at timestamp DEFAULT now(),
  sumber_geometri text,
  edisi_geometri date
);

CREATE TABLE public.kabupaten (
  id serial PRIMARY KEY,
  kode_kab varchar(4) NOT NULL UNIQUE,
  kode_prov varchar(2) NOT NULL REFERENCES public.provinsi (kode_prov),
  nama_kabupaten varchar(100) NOT NULL,
  tipe varchar(15) NOT NULL CHECK (tipe IN ('KABUPATEN', 'KOTA')),
  geom geometry(MultiPolygon, 4326) NOT NULL,
  area_km2 numeric(12,4),
  created_at timestamp DEFAULT now(),
  jumlah_penduduk integer,
  jumlah_kk integer,
  jumlah_kec integer,
  jumlah_desa integer,
  jumlah_kel integer,
  kepadatan numeric,
  luas_wilayah numeric,
  updated_at timestamp DEFAULT now(),
  sumber_geometri text,
  edisi_geometri date
);

CREATE TABLE public.kecamatan (
  id serial PRIMARY KEY,
  kode_kec varchar(6) NOT NULL UNIQUE,
  kode_kab varchar(4) NOT NULL REFERENCES public.kabupaten (kode_kab),
  nama_kecamatan varchar(100) NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  area_km2 numeric(12,4),
  created_at timestamp DEFAULT now(),
  jumlah_penduduk integer,
  jumlah_kk integer,
  jumlah_desa integer,
  jumlah_kel integer,
  kepadatan numeric,
  luas_wilayah numeric,
  updated_at timestamp DEFAULT now(),
  sumber_geometri text,
  edisi_geometri date,
  keterangan_batas text
);

CREATE TABLE public.desa (
  id serial PRIMARY KEY,
  kode_desa varchar(10) NOT NULL UNIQUE,
  kode_kec varchar(6) NOT NULL REFERENCES public.kecamatan (kode_kec),
  nama_desa varchar(100) NOT NULL,
  tipe varchar(15) NOT NULL CHECK (tipe IN ('DESA', 'KELURAHAN')),
  geom geometry(MultiPolygon, 4326) NOT NULL,
  area_km2 numeric(12,4),
  created_at timestamp DEFAULT now(),
  jumlah_penduduk integer,
  pulau varchar(100),
  jangkauan varchar(100),
  updated_at timestamp DEFAULT now(),
  sumber_geometri text,
  edisi_geometri date,
  status_batas varchar(30),
  keterangan_batas text,
  dasar_hukum text,
  kode_bps varchar(10)
);

CREATE TABLE public.area_tidak_terdefinisi (
  id serial PRIMARY KEY,
  level varchar(15) NOT NULL,
  kode_prov varchar(2),
  kode_kab varchar(4),
  kode_kec varchar(6),
  kode_big text,
  nama_big text,
  keterangan text,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  area_km2 numeric(12,4),
  sumber_geometri text,
  edisi_geometri date
);

CREATE TABLE IF NOT EXISTS public.dataset_snapshot (
  id serial PRIMARY KEY,
  component varchar(30) NOT NULL,
  name text NOT NULL,
  edition text NOT NULL,
  url text,
  note text,
  active boolean NOT NULL DEFAULT true,
  loaded_at timestamptz NOT NULL DEFAULT now()
);

-- ── Fill from staging ──

INSERT INTO public.provinsi (kode_prov, nama_provinsi, geom, area_km2, jumlah_penduduk, jumlah_kk,
                             kepadatan, luas_wilayah, sumber_geometri, edisi_geometri)
SELECT s.kode_prov,
       COALESCE(s.nama_provinsi, a.nama_provinsi),
       s.geom,
       ROUND((ST_Area(s.geom::geography) / 1e6)::numeric, 4),
       a.jumlah_penduduk, a.jumlah_kk, a.kepadatan, a.luas_wilayah,
       s.sumber_geometri, s.edisi_geometri::date
FROM big2026_stage.provinsi s
LEFT JOIN archive_dukcapil2024.provinsi a USING (kode_prov)
ORDER BY s.kode_prov;

INSERT INTO public.kabupaten (kode_kab, kode_prov, nama_kabupaten, tipe, geom, area_km2,
                              jumlah_penduduk, jumlah_kk, kepadatan, luas_wilayah,
                              sumber_geometri, edisi_geometri)
SELECT s.kode_kab, s.kode_prov, s.nama_kabupaten, s.tipe, s.geom,
       ROUND((ST_Area(s.geom::geography) / 1e6)::numeric, 4),
       a.jumlah_penduduk, a.jumlah_kk, a.kepadatan, a.luas_wilayah,
       s.sumber_geometri, s.edisi_geometri::date
FROM big2026_stage.kabupaten s
LEFT JOIN archive_dukcapil2024.kabupaten a USING (kode_kab)
ORDER BY s.kode_kab;

INSERT INTO public.kecamatan (kode_kec, kode_kab, nama_kecamatan, geom, area_km2,
                              jumlah_penduduk, jumlah_kk, kepadatan, luas_wilayah,
                              sumber_geometri, edisi_geometri, keterangan_batas)
SELECT s.kode_kec, s.kode_kab, s.nama_kecamatan, s.geom,
       ROUND((ST_Area(s.geom::geography) / 1e6)::numeric, 4),
       a.jumlah_penduduk, a.jumlah_kk, a.kepadatan, a.luas_wilayah,
       s.sumber_geometri, s.edisi_geometri::date, s.keterangan_batas
FROM big2026_stage.kecamatan s
LEFT JOIN archive_dukcapil2024.kecamatan a USING (kode_kec)
ORDER BY s.kode_kec;

-- Old desa codes that BIG renumbered: same normalized name, same kabupaten,
-- exactly one candidate on each side.
CREATE TEMP TABLE desa_code_map ON COMMIT DROP AS
WITH old AS (
  SELECT a.kode_desa, a.nama_desa,
         regexp_replace(lower(a.nama_desa), '[^a-z0-9]', '', 'g') AS n
  FROM archive_dukcapil2024.desa a
  WHERE NOT EXISTS (SELECT 1 FROM big2026_stage.desa s WHERE s.kode_desa = a.kode_desa)
), new AS (
  SELECT s.kode_desa, regexp_replace(lower(s.nama_desa), '[^a-z0-9]', '', 'g') AS n
  FROM big2026_stage.desa s
  WHERE NOT EXISTS (SELECT 1 FROM archive_dukcapil2024.desa a WHERE a.kode_desa = s.kode_desa)
), pairs AS (
  SELECT o.kode_desa AS old_code, n.kode_desa AS new_code,
         count(*) OVER (PARTITION BY o.kode_desa) AS per_old,
         count(*) OVER (PARTITION BY n.kode_desa) AS per_new
  FROM old o
  JOIN new n ON n.n = o.n AND left(n.kode_desa, 4) = left(o.kode_desa, 4)
)
SELECT old_code, new_code FROM pairs WHERE per_old = 1 AND per_new = 1;

INSERT INTO public.desa (kode_desa, kode_kec, nama_desa, tipe, geom, area_km2,
                         jumlah_penduduk, pulau, jangkauan, sumber_geometri, edisi_geometri,
                         status_batas, keterangan_batas, dasar_hukum, kode_bps)
SELECT s.kode_desa, s.kode_kec, s.nama_desa, s.tipe, s.geom,
       ROUND((ST_Area(s.geom::geography) / 1e6)::numeric, 4),
       a.jumlah_penduduk, a.pulau, a.jangkauan,
       s.sumber_geometri, s.edisi_geometri::date,
       s.status_batas, s.keterangan_batas, s.dasar_hukum, s.kode_bps
FROM big2026_stage.desa s
LEFT JOIN desa_code_map m ON m.new_code = s.kode_desa
LEFT JOIN archive_dukcapil2024.desa a ON a.kode_desa = COALESCE(m.old_code, s.kode_desa)
ORDER BY s.kode_desa;

-- Valid desa codes without BIG polygon: keep the part of the Dukcapil
-- polygon that BIG desa do not cover, when at least half of it remains.
CREATE TEMP TABLE desa_retained ON COMMIT DROP AS
WITH missing AS (
  SELECT a.*
  FROM archive_dukcapil2024.desa a
  WHERE NOT EXISTS (SELECT 1 FROM public.desa d WHERE d.kode_desa = a.kode_desa)
    AND NOT EXISTS (SELECT 1 FROM desa_code_map m WHERE m.old_code = a.kode_desa)
    AND EXISTS (SELECT 1 FROM public.kecamatan k WHERE k.kode_kec = a.kode_kec)
), clipped AS (
  SELECT m.*,
         ST_Multi(ST_CollectionExtract(ST_MakeValid(
           COALESCE(ST_Difference(m.geom, (
             SELECT ST_Union(d.geom) FROM public.desa d WHERE d.geom && m.geom
                                                         AND ST_Intersects(d.geom, m.geom)
           )), m.geom)
         ), 3)) AS clipped_geom
  FROM missing m
)
SELECT *,
       ST_Area(clipped_geom::geography) / NULLIF(ST_Area(geom::geography), 0) AS kept_ratio
FROM clipped;

INSERT INTO public.desa (kode_desa, kode_kec, nama_desa, tipe, geom, area_km2,
                         jumlah_penduduk, pulau, jangkauan, sumber_geometri, edisi_geometri,
                         keterangan_batas)
SELECT r.kode_desa, r.kode_kec, r.nama_desa, r.tipe, r.clipped_geom,
       ROUND((ST_Area(r.clipped_geom::geography) / 1e6)::numeric, 4),
       r.jumlah_penduduk, r.pulau, r.jangkauan,
       'Dukcapil Kemendagri 2024 S1, dipotong dengan coverage BIG', NULL,
       'Tidak ada poligon di BIG BATASWILAYAH; geometri lama di luar desa BIG'
FROM desa_retained r
WHERE r.kept_ratio >= 0.5 AND NOT ST_IsEmpty(r.clipped_geom);

INSERT INTO public.area_tidak_terdefinisi (level, kode_prov, kode_kab, kode_kec, kode_big, nama_big,
                                           keterangan, geom, area_km2, sumber_geometri, edisi_geometri)
SELECT s.level, s.kode_prov, s.kode_kab, s.kode_kec, s.kode_big, s.nama_big, s.keterangan, s.geom,
       ROUND((ST_Area(s.geom::geography) / 1e6)::numeric, 4),
       'BIG BATASWILAYAH', s.edisi_geometri::date
FROM big2026_stage.area_tidak_terdefinisi s;

-- ── Counts from the new hierarchy ──

UPDATE public.kecamatan k SET
  jumlah_desa = c.desa, jumlah_kel = c.kel
FROM (SELECT kode_kec,
             count(*) FILTER (WHERE tipe = 'DESA') AS desa,
             count(*) FILTER (WHERE tipe = 'KELURAHAN') AS kel
      FROM public.desa GROUP BY kode_kec) c
WHERE c.kode_kec = k.kode_kec;

UPDATE public.kabupaten b SET
  jumlah_kec = c.kec, jumlah_desa = c.desa, jumlah_kel = c.kel
FROM (SELECT left(d.kode_kec, 4) AS kode_kab,
             count(DISTINCT d.kode_kec) AS kec,
             count(*) FILTER (WHERE d.tipe = 'DESA') AS desa,
             count(*) FILTER (WHERE d.tipe = 'KELURAHAN') AS kel
      FROM public.desa d GROUP BY 1) c
WHERE c.kode_kab = b.kode_kab;

UPDATE public.provinsi p SET
  jumlah_kab = c.kab, jumlah_kota = c.kota,
  jumlah_kec = (SELECT count(*) FROM public.kecamatan k WHERE left(k.kode_kec, 2) = p.kode_prov),
  jumlah_desa = (SELECT count(*) FROM public.desa d WHERE left(d.kode_desa, 2) = p.kode_prov AND d.tipe = 'DESA'),
  jumlah_kel = (SELECT count(*) FROM public.desa d WHERE left(d.kode_desa, 2) = p.kode_prov AND d.tipe = 'KELURAHAN')
FROM (SELECT kode_prov,
             count(*) FILTER (WHERE tipe = 'KABUPATEN') AS kab,
             count(*) FILTER (WHERE tipe = 'KOTA') AS kota
      FROM public.kabupaten GROUP BY kode_prov) c
WHERE c.kode_prov = p.kode_prov;

-- ── Postal codes follow renumbered desa; rows without desa are archived ──

UPDATE public.postal_code pc SET kode_desa = m.new_code
FROM desa_code_map m
WHERE pc.kode_desa = m.old_code
  AND NOT EXISTS (SELECT 1 FROM public.postal_code x WHERE x.kode_desa = m.new_code);

CREATE TABLE archive_dukcapil2024.postal_code_dropped AS
SELECT pc.* FROM public.postal_code pc
WHERE NOT EXISTS (SELECT 1 FROM public.desa d WHERE d.kode_desa = pc.kode_desa);

DELETE FROM public.postal_code pc
WHERE NOT EXISTS (SELECT 1 FROM public.desa d WHERE d.kode_desa = pc.kode_desa);

ALTER TABLE public.postal_code
  ADD CONSTRAINT postal_code_kode_desa_fkey FOREIGN KEY (kode_desa) REFERENCES public.desa (kode_desa);

-- ── Indexes ──

CREATE INDEX idx_provinsi_geom ON public.provinsi USING gist (geom);
CREATE INDEX idx_kabupaten_geom ON public.kabupaten USING gist (geom);
CREATE INDEX idx_kecamatan_geom ON public.kecamatan USING gist (geom);
CREATE INDEX idx_desa_geom ON public.desa USING gist (geom);
CREATE INDEX idx_area_tidak_terdefinisi_geom ON public.area_tidak_terdefinisi USING gist (geom);
CREATE INDEX idx_kabupaten_kode_prov ON public.kabupaten (kode_prov);
CREATE INDEX idx_kecamatan_kode_kab ON public.kecamatan (kode_kab);
CREATE INDEX idx_desa_kode_kec ON public.desa (kode_kec);

-- ── Provenance ──

UPDATE public.dataset_snapshot SET active = false WHERE active;
INSERT INTO public.dataset_snapshot (component, name, edition, url, note)
SELECT 'geometry', 'Badan Informasi Geospasial (BIG), layanan BATASWILAYAH',
       max(edisi_geometri)::text,
       'https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH',
       'desa dan kecamatan skala 1:10.000, kab/kota 1:50.000; provinsi = gabungan kab/kota'
FROM public.desa WHERE edisi_geometri IS NOT NULL;
INSERT INTO public.dataset_snapshot (component, name, edition, url, note) VALUES
  ('names', 'region-id (Kepmendagri 2025) dengan koreksi wilayah-id', '2025', NULL, 'data-region-id/'),
  ('demographics', 'Ditjen Dukcapil Kemendagri', '2024-semester-1', 'https://gis.dukcapil.kemendagri.go.id/peta/',
   'jumlah penduduk, KK, kepadatan, luas wilayah resmi'),
  ('postal_codes', 'postal-code-id', 'lihat data-postal-codes/', 'https://github.com/nicnocquee/postal-code-id', NULL);

-- ── Grants for the application role ──

\if :{?app_role}
GRANT SELECT ON public.provinsi, public.kabupaten, public.kecamatan, public.desa,
                public.area_tidak_terdefinisi, public.dataset_snapshot TO :"app_role";
\endif

-- ── Checks: fail the transaction instead of committing a broken state ──

DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM public.provinsi;
  IF bad <> 38 THEN RAISE EXCEPTION 'expected 38 provinsi, got %', bad; END IF;
  SELECT count(*) INTO bad FROM public.kabupaten;
  IF bad < 514 THEN RAISE EXCEPTION 'expected at least 514 kabupaten, got %', bad; END IF;
  SELECT count(*) INTO bad FROM public.kecamatan;
  IF bad < 7240 THEN RAISE EXCEPTION 'expected at least 7240 kecamatan, got %', bad; END IF;
  SELECT count(*) INTO bad FROM public.desa;
  IF bad < 82000 THEN RAISE EXCEPTION 'expected at least 82000 desa, got %', bad; END IF;
  SELECT count(*) INTO bad FROM (
    SELECT geom FROM public.provinsi UNION ALL SELECT geom FROM public.kabupaten
    UNION ALL SELECT geom FROM public.kecamatan UNION ALL SELECT geom FROM public.desa) g
  WHERE NOT ST_IsValid(geom) OR ST_IsEmpty(geom);
  IF bad > 0 THEN RAISE EXCEPTION '% invalid or empty geometries', bad; END IF;
END $$;

COMMIT;

ANALYZE public.provinsi;
ANALYZE public.kabupaten;
ANALYZE public.kecamatan;
ANALYZE public.desa;
ANALYZE public.postal_code;
