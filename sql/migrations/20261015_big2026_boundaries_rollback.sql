-- =============================================================
-- Roll back 20261015_big2026_boundaries.sql.
--
-- Restores the Dukcapil 2024 tables from archive_dukcapil2024 and the
-- postal codes as they were before the migration. The BIG tables are
-- moved to schema rolled_back_big2026 instead of being dropped.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f sql/migrations/20261015_big2026_boundaries_rollback.sql
-- =============================================================

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regclass('archive_dukcapil2024.desa') IS NULL THEN
    RAISE EXCEPTION 'archive_dukcapil2024.desa not found: nothing to roll back';
  END IF;
  IF to_regnamespace('rolled_back_big2026') IS NOT NULL THEN
    RAISE EXCEPTION 'schema rolled_back_big2026 exists: drop or rename it first';
  END IF;
END $$;

CREATE SCHEMA rolled_back_big2026;
ALTER TABLE public.postal_code DROP CONSTRAINT postal_code_kode_desa_fkey;
ALTER TABLE public.desa SET SCHEMA rolled_back_big2026;
ALTER TABLE public.kecamatan SET SCHEMA rolled_back_big2026;
ALTER TABLE public.kabupaten SET SCHEMA rolled_back_big2026;
ALTER TABLE public.provinsi SET SCHEMA rolled_back_big2026;
ALTER TABLE public.area_tidak_terdefinisi SET SCHEMA rolled_back_big2026;

ALTER TABLE archive_dukcapil2024.provinsi SET SCHEMA public;
ALTER TABLE archive_dukcapil2024.kabupaten SET SCHEMA public;
ALTER TABLE archive_dukcapil2024.kecamatan SET SCHEMA public;
ALTER TABLE archive_dukcapil2024.desa SET SCHEMA public;

TRUNCATE public.postal_code;
INSERT INTO public.postal_code SELECT * FROM archive_dukcapil2024.postal_code;
ALTER TABLE public.postal_code
  ADD CONSTRAINT postal_code_kode_desa_fkey FOREIGN KEY (kode_desa) REFERENCES public.desa (kode_desa);

UPDATE public.dataset_snapshot SET active = false WHERE active;
INSERT INTO public.dataset_snapshot (component, name, edition, url, note) VALUES
  ('geometry', 'Ditjen Dukcapil Kemendagri', '2024-semester-1',
   'https://gis.dukcapil.kemendagri.go.id/peta/', 'rollback dari BIG 2026');

ALTER SCHEMA archive_dukcapil2024 RENAME TO archive_dukcapil2024_restored;

COMMIT;
