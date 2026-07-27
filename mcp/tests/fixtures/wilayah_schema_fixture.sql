-- Disposable integration schema for the generic PostGIS adapter.
-- This script only replaces the dedicated mcp_test schema.
\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS mcp_test CASCADE;
CREATE SCHEMA mcp_test;
SET search_path TO mcp_test, public;

CREATE TABLE provinsi (
  id serial PRIMARY KEY,
  kode_prov varchar UNIQUE NOT NULL,
  nama_provinsi varchar NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  area_km2 numeric,
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
  updated_at timestamp DEFAULT now()
);

CREATE TABLE kabupaten (
  id serial PRIMARY KEY,
  kode_kab varchar UNIQUE NOT NULL,
  kode_prov varchar NOT NULL,
  nama_kabupaten varchar NOT NULL,
  tipe varchar,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  area_km2 numeric,
  created_at timestamp DEFAULT now(),
  jumlah_penduduk integer,
  jumlah_kk integer,
  jumlah_kec integer,
  jumlah_desa integer,
  jumlah_kel integer,
  kepadatan numeric,
  luas_wilayah numeric,
  updated_at timestamp DEFAULT now()
);

CREATE TABLE kecamatan (
  id serial PRIMARY KEY,
  kode_kec varchar UNIQUE NOT NULL,
  kode_kab varchar NOT NULL,
  nama_kecamatan varchar NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  area_km2 numeric,
  created_at timestamp DEFAULT now(),
  jumlah_penduduk integer,
  jumlah_kk integer,
  jumlah_desa integer,
  jumlah_kel integer,
  kepadatan numeric,
  luas_wilayah numeric,
  updated_at timestamp DEFAULT now()
);

CREATE TABLE desa (
  id serial PRIMARY KEY,
  kode_desa varchar UNIQUE NOT NULL,
  kode_kec varchar NOT NULL,
  nama_desa varchar NOT NULL,
  tipe varchar,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  area_km2 numeric,
  created_at timestamp DEFAULT now(),
  jumlah_penduduk integer,
  pulau varchar,
  jangkauan varchar,
  updated_at timestamp DEFAULT now()
);

CREATE TABLE postal_code (
  id serial PRIMARY KEY,
  kode_desa varchar NOT NULL,
  kode_pos varchar,
  status varchar,
  confidence numeric,
  sumber text,
  created_at timestamp DEFAULT now()
);

CREATE INDEX idx_fixture_provinsi_geom ON provinsi USING gist (geom);
CREATE INDEX idx_fixture_kabupaten_geom ON kabupaten USING gist (geom);
CREATE INDEX idx_fixture_kecamatan_geom ON kecamatan USING gist (geom);
CREATE INDEX idx_fixture_desa_geom ON desa USING gist (geom);

INSERT INTO provinsi (
  kode_prov, nama_provinsi, geom, jumlah_penduduk
) VALUES
  (
    '10', 'ALPHA',
    ST_Multi(ST_GeomFromText(
      'POLYGON((0 0,2 0,2 2,0 2,0 0))', 4326
    )),
    100
  ),
  (
    '20', 'BETA',
    ST_Multi(ST_GeomFromText(
      'POLYGON((2 0,4 0,4 2,2 2,2 0))', 4326
    )),
    200
  ),
  (
    '30', 'GAMMA INVALID',
    ST_Multi(ST_GeomFromText(
      'POLYGON((5 0,6 1,6 0,5 1,5 0))', 4326
    )),
    300
  );

INSERT INTO kabupaten (
  kode_kab, kode_prov, nama_kabupaten, tipe, geom
) VALUES
  (
    '1001', '10', 'ALPHA WEST', 'KABUPATEN',
    ST_Multi(ST_GeomFromText(
      'POLYGON((0 0,1 0,1 2,0 2,0 0))', 4326
    ))
  ),
  (
    '1002', '10', 'ALPHA EAST', 'KOTA',
    ST_Multi(ST_GeomFromText(
      'POLYGON((1 0,2 0,2 2,1 2,1 0))', 4326
    ))
  ),
  (
    '2001', '20', 'ALPHA EAST', 'KABUPATEN',
    ST_Multi(ST_GeomFromText(
      'POLYGON((2 0,4 0,4 2,2 2,2 0))', 4326
    ))
  );

INSERT INTO kecamatan (
  kode_kec, kode_kab, nama_kecamatan, geom
) VALUES
  (
    '100101', '1001', 'ALPHA DISTRICT',
    ST_Multi(ST_GeomFromText(
      'POLYGON((0 0,1 0,1 2,0 2,0 0))', 4326
    ))
  );

INSERT INTO desa (
  kode_desa, kode_kec, nama_desa, tipe, geom, jumlah_penduduk
) VALUES
  (
    '1001010001', '100101', 'ALPHA VILLAGE', 'DESA',
    ST_Multi(ST_GeomFromText(
      'POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326
    )),
    10
  ),
  (
    '1001010002', '100101', 'BOUNDARY VILLAGE', 'DESA',
    ST_Multi(ST_GeomFromText(
      'POLYGON((0 1,1 1,1 2,0 2,0 1))', 4326
    )),
    20
  );

INSERT INTO postal_code (kode_desa, kode_pos, status)
VALUES ('1001010001', '10000', 'fixture');
