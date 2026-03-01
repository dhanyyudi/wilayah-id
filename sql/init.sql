-- =============================================================
-- wilayah-id — Database Initialization
-- Dijalankan otomatis saat container PostgreSQL pertama kali start
-- =============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Log
DO $$
BEGIN
  RAISE NOTICE 'PostGIS version: %', PostGIS_Version();
  RAISE NOTICE 'Database initialized: wilayah_id';
END
$$;
