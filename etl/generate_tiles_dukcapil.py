#!/usr/bin/env python3
"""
Generate static vector tiles from PostGIS → GeoJSON → Tippecanoe → .pbf

Updated for Dukcapil 2024 data with demographic properties.
Outputs to tiles-dukcapil-2024/ directory.

Workflow:
  1. Export each layer from PostGIS as GeoJSON (with denormalized properties)
  2. Run Tippecanoe to create .mbtiles per layer
  3. Extract to static .pbf directory via mb-util

Usage:
    source etl-venv/bin/activate
    python etl/generate_tiles_dukcapil.py

Prerequisites:
    - tippecanoe (brew install tippecanoe)
    - mb-util (pip install mbutil)
    - PostGIS data loaded (run import_dukcapil.py first)
"""

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TILE_WORK_DIR = PROJECT_ROOT / "tiles-work-dukcapil"
TILE_OUTPUT_DIR = PROJECT_ROOT / "tiles-dukcapil-2024"

# Layer definitions with zoom ranges — includes demographic properties
LAYERS = [
    {
        "name": "provinsi",
        "min_zoom": 3,
        "max_zoom": 9,
        "simplification": 2,
        "sql": """
            SELECT
                kode_prov,
                nama_provinsi,
                area_km2,
                jumlah_penduduk,
                jumlah_kk,
                jumlah_kab,
                jumlah_kota,
                jumlah_kec,
                ST_AsGeoJSON(geom, 6) AS geojson_geom
            FROM provinsi
            ORDER BY kode_prov
        """,
        "properties": ["kode_prov", "nama_provinsi", "area_km2",
                        "jumlah_penduduk", "jumlah_kk",
                        "jumlah_kab", "jumlah_kota", "jumlah_kec"],
    },
    {
        "name": "kabupaten",
        "min_zoom": 7,
        "max_zoom": 11,
        "simplification": 3,
        "sql": """
            SELECT
                kb.kode_kab,
                kb.kode_prov,
                kb.nama_kabupaten,
                kb.tipe,
                p.nama_provinsi,
                kb.area_km2,
                kb.jumlah_penduduk,
                kb.jumlah_kk,
                kb.jumlah_kec,
                kb.jumlah_desa,
                kb.kepadatan,
                ST_AsGeoJSON(kb.geom, 6) AS geojson_geom
            FROM kabupaten kb
            JOIN provinsi p ON kb.kode_prov = p.kode_prov
            ORDER BY kb.kode_kab
        """,
        "properties": ["kode_kab", "kode_prov", "nama_kabupaten", "tipe",
                        "nama_provinsi", "area_km2",
                        "jumlah_penduduk", "jumlah_kk",
                        "jumlah_kec", "jumlah_desa", "kepadatan"],
    },
    {
        "name": "kecamatan",
        "min_zoom": 10,
        "max_zoom": 12,
        "simplification": 4,
        "sql": """
            SELECT
                kc.kode_kec,
                kc.kode_kab,
                kc.nama_kecamatan,
                kb.nama_kabupaten,
                kb.tipe AS tipe_kabupaten,
                p.kode_prov,
                p.nama_provinsi,
                kc.area_km2,
                kc.jumlah_penduduk,
                kc.jumlah_kk,
                kc.jumlah_desa,
                ST_AsGeoJSON(kc.geom, 6) AS geojson_geom
            FROM kecamatan kc
            JOIN kabupaten kb ON kc.kode_kab = kb.kode_kab
            JOIN provinsi p ON kb.kode_prov = p.kode_prov
            ORDER BY kc.kode_kec
        """,
        "properties": ["kode_kec", "kode_kab", "nama_kecamatan", "nama_kabupaten",
                        "tipe_kabupaten", "kode_prov", "nama_provinsi", "area_km2",
                        "jumlah_penduduk", "jumlah_kk", "jumlah_desa"],
    },
    {
        "name": "desa",
        "min_zoom": 12,
        "max_zoom": 14,
        "simplification": 5,
        "extra_opts": ["--drop-densest-as-needed"],
        "sql": """
            SELECT
                d.kode_desa,
                d.kode_kec,
                d.nama_desa,
                d.tipe AS tipe_desa,
                kc.nama_kecamatan,
                kb.kode_kab,
                kb.nama_kabupaten,
                kb.tipe AS tipe_kabupaten,
                p.kode_prov,
                p.nama_provinsi,
                pc.kode_pos,
                d.area_km2,
                d.jumlah_penduduk,
                d.pulau,
                d.jangkauan,
                ST_AsGeoJSON(d.geom, 5) AS geojson_geom
            FROM desa d
            JOIN kecamatan kc ON d.kode_kec = kc.kode_kec
            JOIN kabupaten kb ON kc.kode_kab = kb.kode_kab
            JOIN provinsi p ON kb.kode_prov = p.kode_prov
            LEFT JOIN postal_code pc ON d.kode_desa = pc.kode_desa
            ORDER BY d.kode_desa
        """,
        "properties": ["kode_desa", "kode_kec", "nama_desa", "tipe_desa",
                        "nama_kecamatan", "kode_kab", "nama_kabupaten",
                        "tipe_kabupaten", "kode_prov", "nama_provinsi",
                        "kode_pos", "area_km2",
                        "jumlah_penduduk", "pulau", "jangkauan"],
    },
]


def get_engine():
    load_dotenv(PROJECT_ROOT / ".env.local")
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_recycle=120,
        connect_args={
            "keepalives": 1,
            "keepalives_idle": 30,
            "keepalives_interval": 10,
            "keepalives_count": 5,
            "connect_timeout": 30,
        },
    )


def check_tools():
    """Verify tippecanoe and mb-util are installed."""
    for tool in ["tippecanoe", "mb-util"]:
        if shutil.which(tool) is None:
            print(f"ERROR: {tool} not found. Install it first.")
            sys.exit(1)
    print("✓ tippecanoe and mb-util found")


def export_geojson(engine, layer):
    """Export a layer from PostGIS as GeoJSON FeatureCollection."""
    name = layer["name"]
    outpath = TILE_WORK_DIR / f"{name}.geojson"

    print(f"\n  Exporting {name} → GeoJSON...")
    t0 = time.time()

    features = []
    with engine.connect() as conn:
        result = conn.execute(text(layer["sql"]))
        rows = result.fetchall()
        columns = list(result.keys())

        for row in rows:
            row_dict = dict(zip(columns, row))
            geom = json.loads(row_dict["geojson_geom"])

            properties = {}
            for prop in layer["properties"]:
                val = row_dict.get(prop)
                if val is not None:
                    # Convert Decimal to float for JSON
                    properties[prop] = float(val) if hasattr(val, "as_integer_ratio") else val
                else:
                    properties[prop] = None

            features.append({
                "type": "Feature",
                "properties": properties,
                "geometry": geom,
            })

    fc = {
        "type": "FeatureCollection",
        "features": features,
    }

    with open(outpath, "w") as f:
        json.dump(fc, f)

    size_mb = outpath.stat().st_size / (1024 * 1024)
    print(f"    {len(features)} features, {size_mb:.1f} MB ({time.time()-t0:.1f}s)")
    return outpath


def run_tippecanoe(layer, geojson_path):
    """Generate .mbtiles from GeoJSON using tippecanoe."""
    name = layer["name"]
    mbtiles_path = TILE_WORK_DIR / f"{name}.mbtiles"

    # Remove existing mbtiles
    if mbtiles_path.exists():
        mbtiles_path.unlink()

    cmd = [
        "tippecanoe",
        "-o", str(mbtiles_path),
        f"--layer={name}",
        f"--minimum-zoom={layer['min_zoom']}",
        f"--maximum-zoom={layer['max_zoom']}",
        f"--simplification={layer['simplification']}",
        "--no-tile-compression",  # uncompressed for direct serving
        "--force",
    ]

    # Add extra options (e.g. --drop-densest-as-needed for desa)
    if "extra_opts" in layer:
        cmd.extend(layer["extra_opts"])

    cmd.append(str(geojson_path))

    print(f"\n  Running tippecanoe for {name}...")
    print(f"    zoom: {layer['min_zoom']}-{layer['max_zoom']}")
    t0 = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"    ERROR: {result.stderr}")
        sys.exit(1)

    size_mb = mbtiles_path.stat().st_size / (1024 * 1024)
    print(f"    ✓ {mbtiles_path.name}: {size_mb:.1f} MB ({time.time()-t0:.1f}s)")
    return mbtiles_path


def extract_tiles(mbtiles_path, layer_name):
    """Extract .mbtiles → directory of .pbf tiles using mb-util."""
    output_dir = TILE_OUTPUT_DIR / layer_name

    # Clean existing tiles for this layer
    if output_dir.exists():
        shutil.rmtree(output_dir)

    print(f"\n  Extracting {layer_name} tiles with mb-util...")
    t0 = time.time()

    cmd = [
        "mb-util",
        "--image_format=pbf",
        str(mbtiles_path),
        str(output_dir),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"    ERROR: {result.stderr}")
        sys.exit(1)

    # Count generated tiles
    tile_count = sum(1 for _ in output_dir.rglob("*.pbf"))
    print(f"    ✓ {tile_count} tiles extracted ({time.time()-t0:.1f}s)")
    return output_dir


def rename_tiles_to_pbf(layer_dir):
    """mb-util extracts without extension — rename files and restructure to {z}/{x}/{y}.pbf format."""
    renamed = 0
    for tile_file in layer_dir.rglob("*"):
        if tile_file.is_file() and tile_file.suffix == "":
            new_path = tile_file.with_suffix(".pbf")
            tile_file.rename(new_path)
            renamed += 1
    if renamed:
        print(f"    Renamed {renamed} tiles to .pbf")

    # Remove metadata.json created by mb-util
    meta = layer_dir / "metadata.json"
    if meta.exists():
        meta.unlink()


def main():
    print("╔══════════════════════════════════════════════════════════╗")
    print("║  wilayah-id — Dukcapil 2024 Vector Tile Generation       ║")
    print("╚══════════════════════════════════════════════════════════╝")

    check_tools()
    engine = get_engine()

    # Create working directory
    TILE_WORK_DIR.mkdir(exist_ok=True)
    TILE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    total_tiles = 0

    for layer in LAYERS:
        name = layer["name"]
        print(f"\n{'='*60}")
        print(f"  {name.upper()} (zoom {layer['min_zoom']}-{layer['max_zoom']})")
        print(f"{'='*60}")

        # Step 1: Export GeoJSON
        geojson_path = export_geojson(engine, layer)

        # Step 2: Generate .mbtiles
        mbtiles_path = run_tippecanoe(layer, geojson_path)

        # Step 3: Extract to .pbf directory
        tile_dir = extract_tiles(mbtiles_path, name)

        # Step 4: Rename tiles to .pbf extension
        rename_tiles_to_pbf(tile_dir)

        tile_count = sum(1 for _ in tile_dir.rglob("*.pbf"))
        total_tiles += tile_count

    # Summary
    print(f"\n{'='*60}")
    print(f"  SUMMARY")
    print(f"{'='*60}")
    print(f"  Total tiles generated: {total_tiles}")

    # Calculate total size
    total_size = sum(
        f.stat().st_size for f in TILE_OUTPUT_DIR.rglob("*.pbf")
    )
    print(f"  Total tile size: {total_size / (1024*1024):.1f} MB")
    print(f"  Output directory: {TILE_OUTPUT_DIR}")

    # Cleanup working dir
    print(f"\n  Working files in: {TILE_WORK_DIR}")
    print(f"  (delete manually when no longer needed)")

    print("\n🎉 Tile generation complete!")
    print(f"   Tiles output: {TILE_OUTPUT_DIR}")


if __name__ == "__main__":
    main()
