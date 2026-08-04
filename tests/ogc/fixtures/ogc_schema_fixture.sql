-- Disposable integration schema for the OGC web services (OGC API
-- Features, WFS 2.0, WMS 1.3.0). This script only replaces the dedicated
-- ogc_test schema; it never touches the public schema. Plain SQL only (no
-- psql meta-commands) so it can be executed by psql and by node-postgres.

DROP SCHEMA IF EXISTS ogc_test CASCADE;
CREATE SCHEMA ogc_test;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE ogc_test.provinsi (
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

CREATE TABLE ogc_test.kabupaten (
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

CREATE TABLE ogc_test.kecamatan (
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

CREATE TABLE ogc_test.desa (
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

CREATE INDEX idx_ogc_test_provinsi_geom ON ogc_test.provinsi USING gist (geom);
CREATE INDEX idx_ogc_test_kabupaten_geom ON ogc_test.kabupaten USING gist (geom);
CREATE INDEX idx_ogc_test_kecamatan_geom ON ogc_test.kecamatan USING gist (geom);
CREATE INDEX idx_ogc_test_desa_geom ON ogc_test.desa USING gist (geom);

-- 12 provinces so the default page (limit 10) paginates. ALPHA and BETA
-- share an edge; GAMMA INVALID carries a self-intersecting bowtie polygon
-- to prove invalid source geometry is served without a server error.
INSERT INTO ogc_test.provinsi (kode_prov, nama_provinsi, geom, jumlah_penduduk) VALUES
  ('10', 'ALPHA', ST_Multi(ST_GeomFromText('POLYGON((0 0,2 0,2 2,0 2,0 0))', 4326)), 100),
  ('20', 'BETA', ST_Multi(ST_GeomFromText('POLYGON((2 0,4 0,4 2,2 2,2 0))', 4326)), 200),
  ('30', 'GAMMA INVALID', ST_Multi(ST_GeomFromText('POLYGON((5 0,6 1,6 0,5 1,5 0))', 4326)), 300),
  ('40', 'DELTA', ST_Multi(ST_GeomFromText('POLYGON((8 0,9 0,9 1,8 1,8 0))', 4326)), 400),
  ('50', 'ECHO', ST_Multi(ST_GeomFromText('POLYGON((10 0,11 0,11 1,10 1,10 0))', 4326)), 500),
  ('60', 'FOXTROT', ST_Multi(ST_GeomFromText('POLYGON((12 0,13 0,13 1,12 1,12 0))', 4326)), 600),
  ('70', 'GOLF', ST_Multi(ST_GeomFromText('POLYGON((14 0,15 0,15 1,14 1,14 0))', 4326)), 700),
  ('80', 'HOTEL', ST_Multi(ST_GeomFromText('POLYGON((16 0,17 0,17 1,16 1,16 0))', 4326)), 800),
  ('90', 'INDIA', ST_Multi(ST_GeomFromText('POLYGON((18 0,19 0,19 1,18 1,18 0))', 4326)), 900),
  ('91', 'JULIET', ST_Multi(ST_GeomFromText('POLYGON((20 0,21 0,21 1,20 1,20 0))', 4326)), 910),
  ('92', 'KILO', ST_Multi(ST_GeomFromText('POLYGON((22 0,23 0,23 1,22 1,22 0))', 4326)), 920),
  ('93', 'LIMA', ST_Multi(ST_GeomFromText('POLYGON((24 0,25 0,25 1,24 1,24 0))', 4326)), 930);

-- ALPHA EAST exists in two provinces: ambiguous name fixture.
INSERT INTO ogc_test.kabupaten (kode_kab, kode_prov, nama_kabupaten, tipe, geom) VALUES
  ('1001', '10', 'ALPHA WEST', 'KABUPATEN', ST_Multi(ST_GeomFromText('POLYGON((0 0,1 0,1 2,0 2,0 0))', 4326))),
  ('1002', '10', 'ALPHA EAST', 'KOTA', ST_Multi(ST_GeomFromText('POLYGON((1 0,2 0,2 2,1 2,1 0))', 4326))),
  ('2001', '20', 'ALPHA EAST', 'KABUPATEN', ST_Multi(ST_GeomFromText('POLYGON((2 0,4 0,4 2,2 2,2 0))', 4326)));

INSERT INTO ogc_test.kecamatan (kode_kec, kode_kab, nama_kecamatan, geom) VALUES
  ('100101', '1001', 'ALPHA DISTRICT', ST_Multi(ST_GeomFromText('POLYGON((0 0,1 0,1 2,0 2,0 0))', 4326)));

-- The two villages share the edge y=1: the point (0.5, 1) is a boundary
-- point that ST_Covers must count while ST_Contains would miss it.
INSERT INTO ogc_test.desa (kode_desa, kode_kec, nama_desa, tipe, geom, jumlah_penduduk) VALUES
  ('1001010001', '100101', 'ALPHA VILLAGE', 'DESA', ST_Multi(ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326)), 10),
  ('1001010002', '100101', 'BOUNDARY VILLAGE', 'DESA', ST_Multi(ST_GeomFromText('POLYGON((0 1,1 1,1 2,0 2,0 1))', 4326)), 20);
