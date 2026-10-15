#!/usr/bin/env bash
# Build the assets of a wilayah-id data release from a database.
#
# Run against a staging copy, never against production directly. Nothing is
# uploaded: the script prints the gh command to publish the folder.
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:port/wilayah_id \
#     scripts/release-data.sh <out dir> [prepared dir]
#
# Environment:
#   DATABASE_URL  database read by psql and ogr2ogr
#   PG_DUMP       pg_dump command (default: pg_dump). Its major version must not
#                 be newer than the PostgreSQL that will restore the dump, e.g.
#                 PG_DUMP="docker exec -i staging-db pg_dump"
#   DUMP_URL      connection string for PG_DUMP (default: DATABASE_URL)
#   RELEASE_TAG   tag name for the printed gh command
set -euo pipefail

out="${1:?usage: release-data.sh <out dir> [prepared dir]}"
prepared="${2:-}"
: "${DATABASE_URL:?DATABASE_URL is required}"
pg_dump_cmd="${PG_DUMP:-pg_dump}"
dump_url="${DUMP_URL:-$DATABASE_URL}"
tag="${RELEASE_TAG:-data-$(date -u +%Y%m%d)}"
exclude=(--exclude-schema=archive_dukcapil2024 --exclude-schema=big2026_stage
         --exclude-schema=rolled_back_big2026 --exclude-schema=archive_dukcapil2024_restored)

mkdir -p "$out"
rm -f "$out"/wilayah_id.dump "$out"/wilayah_id.sql.gz "$out"/*.parquet "$out"/*.gpkg "$out"/checksums.txt

echo "pg_dump: $($pg_dump_cmd --version)"
# shellcheck disable=SC2086
$pg_dump_cmd "$dump_url" --format=custom --compress=9 --no-owner --no-privileges "${exclude[@]}" \
  > "$out/wilayah_id.dump"
# shellcheck disable=SC2086
$pg_dump_cmd "$dump_url" --format=plain --no-owner --no-privileges "${exclude[@]}" \
  | gzip -9 > "$out/wilayah_id.sql.gz"

tables=(provinsi kabupaten kecamatan desa area_tidak_terdefinisi)
for table in "${tables[@]}"; do
  ogr2ogr -f Parquet "$out/wilayah-id-$table.parquet" "PG:$DATABASE_URL" \
    -sql "SELECT * FROM public.$table ORDER BY 1" -nln "$table" \
    -lco COMPRESSION=ZSTD -lco GEOMETRY_ENCODING=WKB
  ogr2ogr -f GPKG -update -append "$out/wilayah-id-boundaries.gpkg" "PG:$DATABASE_URL" \
    -sql "SELECT * FROM public.$table ORDER BY 1" -nln "$table"
done

psql "$DATABASE_URL" -At -F $'\t' -c "
  SELECT 'provinsi', count(*) FROM public.provinsi UNION ALL
  SELECT 'kabupaten', count(*) FROM public.kabupaten UNION ALL
  SELECT 'kecamatan', count(*) FROM public.kecamatan UNION ALL
  SELECT 'desa', count(*) FROM public.desa UNION ALL
  SELECT 'area_tidak_terdefinisi', count(*) FROM public.area_tidak_terdefinisi UNION ALL
  SELECT 'postal_code', count(*) FROM public.postal_code" > "$out/counts.tsv"

if [ -n "$prepared" ]; then
  cp "$prepared/manifest.json" "$out/manifest.json"
  (cd "$prepared" && zip -qr - report) > "$out/report.zip"
fi

(cd "$out" && find . -maxdepth 1 -type f ! -name checksums.txt ! -name RELEASE_NOTES.md -print \
  | sed 's|^\./||' | sort | xargs shasum -a 256 > checksums.txt)

echo "Assets in $out:"
ls -lh "$out"
echo
echo "To publish (after review and the BIG license check):"
echo "  gh release create $tag $out/* --repo dhanyyudi/wilayah-id --title \"Data release $tag\" --notes-file $out/RELEASE_NOTES.md"
