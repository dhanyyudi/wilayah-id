#!/usr/bin/env bash
# Load the output of `etl/big_boundaries.py prepare` into schema big2026_stage.
#
# Only big2026_stage is replaced; public tables are not touched. Run
# sql/migrations/20261015_big2026_boundaries.sql afterwards to switch.
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:5432/wilayah_id \
#     scripts/load-big-stage.sh data-big/prepared
set -euo pipefail

prepared="${1:?usage: load-big-stage.sh <prepared dir>}"
: "${DATABASE_URL:?DATABASE_URL is required}"
command -v ogr2ogr >/dev/null || { echo "ogr2ogr (GDAL with Parquet driver) is required" >&2; exit 1; }

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -c "DROP SCHEMA IF EXISTS big2026_stage CASCADE" \
  -c "CREATE SCHEMA big2026_stage"

for layer in provinsi kabupaten kecamatan desa area_tidak_terdefinisi; do
  file="$prepared/$layer.parquet"
  [ -f "$file" ] || { echo "missing $file" >&2; exit 1; }
  ogr2ogr -f PostgreSQL "PG:$DATABASE_URL" "$file" \
    -nln "big2026_stage.$layer" \
    -lco GEOMETRY_NAME=geom -lco FID=fid -lco SPATIAL_INDEX=GIST \
    -nlt PROMOTE_TO_MULTI -t_srs EPSG:4326 \
    --config PG_USE_COPY YES
  count=$(psql "$DATABASE_URL" -Atc "select count(*) from big2026_stage.$layer")
  echo "big2026_stage.$layer: $count rows"
done
