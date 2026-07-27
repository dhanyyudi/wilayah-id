-- Minimal PostGIS fixture and executable predicate assertions.
-- Execute inside a disposable transaction; no production table is modified.
BEGIN;

CREATE TEMP TABLE spatial_fixture_polygon (
  fixture_id text PRIMARY KEY,
  expected_state text NOT NULL,
  geom geometry(Polygon, 4326) NOT NULL
) ON COMMIT DROP;

INSERT INTO spatial_fixture_polygon (fixture_id, expected_state, geom) VALUES
  ('adjacent_a', 'valid', ST_GeomFromText(
    'POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326
  )),
  ('adjacent_b', 'valid', ST_GeomFromText(
    'POLYGON((1 0,2 0,2 1,1 1,1 0))', 4326
  )),
  ('overlapping', 'valid', ST_GeomFromText(
    'POLYGON((0.5 0.5,1.5 0.5,1.5 1.5,0.5 1.5,0.5 0.5))', 4326
  )),
  ('separate', 'valid', ST_GeomFromText(
    'POLYGON((3 0,4 0,4 1,3 1,3 0))', 4326
  )),
  ('bow_tie', 'invalid', ST_GeomFromText(
    'POLYGON((0 0,1 1,1 0,0 1,0 0))', 4326
  ));

CREATE TEMP TABLE spatial_fixture_point (
  fixture_id text PRIMARY KEY,
  expected_state text NOT NULL,
  geom geometry(Point, 4326) NOT NULL
) ON COMMIT DROP;

INSERT INTO spatial_fixture_point (fixture_id, expected_state, geom) VALUES
  ('inside_a', 'interior', ST_SetSRID(ST_MakePoint(0.25, 0.25), 4326)),
  ('shared_boundary', 'boundary', ST_SetSRID(ST_MakePoint(1, 0.5), 4326)),
  ('outside_all', 'outside', ST_SetSRID(ST_MakePoint(5, 5), 4326));

DO $$
DECLARE
  adjacent_a geometry;
  adjacent_b geometry;
  overlapping geometry;
  separate geometry;
  bow_tie geometry;
  shared_boundary geometry;
BEGIN
  SELECT geom INTO adjacent_a
  FROM spatial_fixture_polygon WHERE fixture_id = 'adjacent_a';
  SELECT geom INTO adjacent_b
  FROM spatial_fixture_polygon WHERE fixture_id = 'adjacent_b';
  SELECT geom INTO overlapping
  FROM spatial_fixture_polygon WHERE fixture_id = 'overlapping';
  SELECT geom INTO separate
  FROM spatial_fixture_polygon WHERE fixture_id = 'separate';
  SELECT geom INTO bow_tie
  FROM spatial_fixture_polygon WHERE fixture_id = 'bow_tie';
  SELECT geom INTO shared_boundary
  FROM spatial_fixture_point WHERE fixture_id = 'shared_boundary';

  IF NOT ST_Touches(adjacent_a, adjacent_b) THEN
    RAISE EXCEPTION 'expected adjacent polygons to touch';
  END IF;
  IF NOT ST_Overlaps(adjacent_a, overlapping) THEN
    RAISE EXCEPTION 'expected polygons to overlap';
  END IF;
  IF NOT ST_Disjoint(adjacent_a, separate) THEN
    RAISE EXCEPTION 'expected polygons to be disjoint';
  END IF;
  IF ST_IsValid(bow_tie) THEN
    RAISE EXCEPTION 'expected bow-tie polygon to be invalid';
  END IF;
  IF NOT ST_IsValid(ST_MakeValid(bow_tie)) THEN
    RAISE EXCEPTION 'expected ST_MakeValid result to be valid';
  END IF;
  IF NOT ST_Covers(adjacent_a, shared_boundary) THEN
    RAISE EXCEPTION 'expected ST_Covers to include boundary point';
  END IF;
  IF ST_Contains(adjacent_a, shared_boundary) THEN
    RAISE EXCEPTION 'expected ST_Contains to exclude boundary point';
  END IF;
END
$$;

ROLLBACK;
