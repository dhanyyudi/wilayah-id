"""
ETL Script — Import Dukcapil 2024 SHP → PostGIS.

Data source: WebGIS Dukcapil Kemendagri (gis.dukcapil.kemendagri.go.id)
Shared by Andi Setyo Pambudi (Bappenas) via LinkedIn.

Column mapping (Dukcapil SHP → DB):
  Provinsi:  no_prop          → kode_prov (2-digit, zero-padded)
  Kabupaten: kode_kab_s       → kode_kab  (4-digit)
  Kecamatan: kode_kec_s       → kode_kec  (6-digit)
  Desa:      kode_desa_       → kode_desa (10-digit)

Notes:
  - Provinsi SHP is in EPSG:3857, others in EPSG:4326 — auto-reprojected.
  - All geometries are 3D/M → forced to 2D.
  - FID 0 records with null names ("TIDAK TERDEFINISI") are skipped.
  - kabupaten.tipe derived from nama_kab prefix ("KAB."/"KOTA").

Usage:
    conda activate swatmapops
    python etl/import_dukcapil.py
"""

import os
import sys
import time
from pathlib import Path

import argparse

import geopandas as gpd
import pandas as pd
from shapely import force_2d
from shapely.geometry import MultiPolygon
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
from tqdm import tqdm

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# ── SHP paths ──

SHP_PATHS = {
    "provinsi": PROJECT_ROOT / "new_data_from_dukcapil" / "Batas Provinsi" / "Provinsi_Kemdagri.shp",
    "kabupaten": PROJECT_ROOT / "new_data_from_dukcapil" / "Batas Kabupaten" / "Batas Kabupaten Kemendagri 2024.shp",
    "kecamatan": PROJECT_ROOT / "new_data_from_dukcapil" / "Batas Kecamatan" / "Batas Kecamatan Kemendagri 2024.shp",
    "desa": PROJECT_ROOT / "new_data_from_dukcapil" / "Batas Desa" / "Batas Desa Kemdagri 2024.shp",
}

# CSV for authoritative names (region-id)
CSV_PATHS = {
    "provinsi": PROJECT_ROOT / "data-region-id" / "provinces.csv",
    "kabupaten": PROJECT_ROOT / "data-region-id" / "regencies.csv",
    "kecamatan": PROJECT_ROOT / "data-region-id" / "districts.csv",
    "desa": PROJECT_ROOT / "data-region-id" / "villages.csv",
}

POSTAL_CSV = PROJECT_ROOT / "data-postal-codes" / "postal_codes_pos_indonesia.csv"

# Geometry simplification tolerances (degrees)
SIMPLIFY = {
    "provinsi": 0.001,
    "kabupaten": 0.0005,
    "kecamatan": 0.0003,
    "desa": 0.0002,
}


def ensure_multi_2d(geom):
    """Force 2D and ensure MultiPolygon type."""
    if geom is None:
        return None
    geom = force_2d(geom)
    if geom.geom_type == "Polygon":
        return MultiPolygon([geom])
    return geom


def get_engine():
    load_dotenv(PROJECT_ROOT / ".env.local")
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL not set in .env.local")
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


def safe_int(val):
    """Convert to int, return None if invalid."""
    if pd.isna(val):
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def safe_float(val):
    """Convert to float, return None if invalid."""
    if pd.isna(val):
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def safe_str(val):
    """Convert to string, return None if invalid."""
    if pd.isna(val) or str(val).strip() == "" or str(val).strip() == "(null)":
        return None
    return str(val).strip()


def derive_tipe_kabupaten(nama_kab):
    """Derive KABUPATEN/KOTA from nama_kab prefix."""
    if not nama_kab:
        return "KABUPATEN"
    nama = nama_kab.upper().strip()
    if nama.startswith("KOTA"):
        return "KOTA"
    return "KABUPATEN"


def clean_nama_kabupaten(nama_kab):
    """Remove 'KAB. ' or 'KOTA ' prefix and title-case."""
    if not nama_kab:
        return nama_kab
    nama = nama_kab.strip()
    for prefix in ["KAB. ", "KOTA "]:
        if nama.upper().startswith(prefix):
            nama = nama[len(prefix):]
            break
    return nama.strip()


# ──────────────────────────────────────────────────────────────
#  TRUNCATE ALL (reverse FK order)
# ──────────────────────────────────────────────────────────────

def truncate_all(engine):
    """Truncate all tables in FK-safe order."""
    print("\n" + "=" * 60)
    print("  TRUNCATING ALL TABLES")
    print("=" * 60)
    with engine.connect() as conn:
        conn.execute(text("TRUNCATE TABLE postal_code CASCADE"))
        conn.execute(text("TRUNCATE TABLE desa CASCADE"))
        conn.execute(text("TRUNCATE TABLE kecamatan CASCADE"))
        conn.execute(text("TRUNCATE TABLE kabupaten CASCADE"))
        conn.execute(text("TRUNCATE TABLE provinsi CASCADE"))
        conn.commit()
    print("  ✓ All tables truncated")


# ──────────────────────────────────────────────────────────────
#  IMPORT PROVINSI
# ──────────────────────────────────────────────────────────────

def import_provinsi(engine):
    print(f"\n{'=' * 60}\n  PROVINSI\n{'=' * 60}")

    gdf = gpd.read_file(SHP_PATHS["provinsi"], engine="pyogrio")
    print(f"  Read {len(gdf)} features from SHP")

    # Reproject from EPSG:3857 → 4326
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        print(f"  Reprojecting from {gdf.crs} → EPSG:4326")
        gdf = gdf.to_crs(epsg=4326)

    # CSV lookup for authoritative names
    csv_df = pd.read_csv(CSV_PATHS["provinsi"], dtype=str)
    csv_lookup = {str(r["code"]).zfill(2): r["name"] for _, r in csv_df.iterrows()}

    # Simplify + force 2D
    gdf["geometry"] = gdf["geometry"].simplify(SIMPLIFY["provinsi"], preserve_topology=True)
    gdf["geometry"] = gdf["geometry"].apply(ensure_multi_2d)

    # Filter out null/invalid records
    gdf = gdf[gdf["nama_prop"].notna() & (gdf["nama_prop"] != "")].copy()
    print(f"  After filtering: {len(gdf)} features")

    inserted = 0
    for _, row in gdf.iterrows():
        kode = str(int(row["no_prop"])).zfill(2)
        nama = csv_lookup.get(kode, safe_str(row["nama_prop"]) or "")

        geom_wkt = row["geometry"].wkt if row["geometry"] else None
        if not geom_wkt:
            continue

        jumlah_penduduk = safe_int(row.get("jumlah_pen"))
        jumlah_kk = safe_int(row.get("jumlah_kk"))
        jumlah_kab = safe_int(row.get("jumlah_kab"))
        jumlah_kota = safe_int(row.get("jumlah_kot"))
        jumlah_kec = safe_int(row.get("jumlah_kec"))
        jumlah_desa = safe_int(row.get("jumlah_des"))
        jumlah_kel = safe_int(row.get("jumlah_kel"))
        kepadatan = safe_float(row.get("kepadatan_"))
        luas_wilayah = safe_float(row.get("luas_wilay"))

        with engine.connect() as conn:
            try:
                conn.execute(text("""
                    INSERT INTO provinsi (kode_prov, nama_provinsi, geom, area_km2,
                                          jumlah_penduduk, jumlah_kk, jumlah_kab, jumlah_kota,
                                          jumlah_kec, jumlah_desa, jumlah_kel, kepadatan,
                                          luas_wilayah, updated_at)
                    VALUES (:kode, :nama,
                            ST_Force2D(ST_Multi(ST_GeomFromText(:geom, 4326))),
                            ROUND(CAST(ST_Area(ST_Force2D(ST_GeomFromText(:geom, 4326))::geography)/1000000 AS NUMERIC), 4),
                            :jml_pend, :jml_kk, :jml_kab, :jml_kota,
                            :jml_kec, :jml_desa, :jml_kel, :kepadatan,
                            :luas_wil, NOW())
                    ON CONFLICT (kode_prov) DO UPDATE SET
                        nama_provinsi = EXCLUDED.nama_provinsi,
                        geom = EXCLUDED.geom,
                        area_km2 = EXCLUDED.area_km2,
                        jumlah_penduduk = EXCLUDED.jumlah_penduduk,
                        jumlah_kk = EXCLUDED.jumlah_kk,
                        jumlah_kab = EXCLUDED.jumlah_kab,
                        jumlah_kota = EXCLUDED.jumlah_kota,
                        jumlah_kec = EXCLUDED.jumlah_kec,
                        jumlah_desa = EXCLUDED.jumlah_desa,
                        jumlah_kel = EXCLUDED.jumlah_kel,
                        kepadatan = EXCLUDED.kepadatan,
                        luas_wilayah = EXCLUDED.luas_wilayah,
                        updated_at = NOW()
                """), {
                    "kode": kode, "nama": nama, "geom": geom_wkt,
                    "jml_pend": jumlah_penduduk, "jml_kk": jumlah_kk,
                    "jml_kab": jumlah_kab, "jml_kota": jumlah_kota,
                    "jml_kec": jumlah_kec, "jml_desa": jumlah_desa,
                    "jml_kel": jumlah_kel, "kepadatan": kepadatan,
                    "luas_wil": luas_wilayah,
                })
                conn.commit()
                inserted += 1
            except Exception as e:
                print(f"  Error inserting provinsi {kode}: {e}")

    print(f"  Inserted: {inserted}")
    return inserted


# ──────────────────────────────────────────────────────────────
#  IMPORT KABUPATEN
# ──────────────────────────────────────────────────────────────

def import_kabupaten(engine):
    print(f"\n{'=' * 60}\n  KABUPATEN\n{'=' * 60}")

    gdf = gpd.read_file(SHP_PATHS["kabupaten"], engine="pyogrio")
    print(f"  Read {len(gdf)} features from SHP")

    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    # CSV lookup
    csv_df = pd.read_csv(CSV_PATHS["kabupaten"], dtype=str)
    csv_lookup = {}
    for _, r in csv_df.iterrows():
        code = str(r["code"]).zfill(4)
        csv_lookup[code] = {"name": r["name"], "type": r.get("type", "regency")}

    gdf["geometry"] = gdf["geometry"].simplify(SIMPLIFY["kabupaten"], preserve_topology=True)
    gdf["geometry"] = gdf["geometry"].apply(ensure_multi_2d)

    # Filter null records
    gdf = gdf[gdf["nama_kab"].notna() & (gdf["nama_kab"] != "")].copy()
    print(f"  After filtering: {len(gdf)} features")

    REG_TYPE_MAP = {"regency": "KABUPATEN", "city": "KOTA"}

    inserted = 0
    skipped = 0

    for _, row in tqdm(gdf.iterrows(), total=len(gdf), desc="  Inserting kabupaten"):
        kode_kab_raw = row.get("kode_kab_s")
        if pd.isna(kode_kab_raw):
            skipped += 1
            continue
        kode = str(int(kode_kab_raw)).zfill(4)

        kode_prov_raw = row.get("kode_prop_", row.get("no_prop"))
        if pd.isna(kode_prov_raw):
            skipped += 1
            continue
        kode_prov = str(int(kode_prov_raw)).zfill(2)

        csv_entry = csv_lookup.get(kode, {})
        nama = csv_entry.get("name", clean_nama_kabupaten(safe_str(row["nama_kab"])) or "")
        tipe = REG_TYPE_MAP.get(csv_entry.get("type", ""), derive_tipe_kabupaten(safe_str(row["nama_kab"])))

        geom_wkt = row["geometry"].wkt if row["geometry"] else None
        if not geom_wkt:
            skipped += 1
            continue

        jumlah_penduduk = safe_int(row.get("jumlah_pen"))
        jumlah_kk = safe_int(row.get("jumlah_kk"))
        jumlah_kec = safe_int(row.get("jumlah_kec"))
        jumlah_desa = safe_int(row.get("jumlah_des"))
        jumlah_kel = safe_int(row.get("jumlah_kel"))
        kepadatan = safe_float(row.get("kepadatan_"))
        luas_wilayah = safe_float(row.get("luas_wilay"))

        with engine.connect() as conn:
            try:
                conn.execute(text("""
                    INSERT INTO kabupaten (kode_kab, kode_prov, nama_kabupaten, tipe, geom, area_km2,
                                           jumlah_penduduk, jumlah_kk, jumlah_kec, jumlah_desa,
                                           jumlah_kel, kepadatan, luas_wilayah, updated_at)
                    VALUES (:kode, :parent, :nama, :tipe,
                            ST_Force2D(ST_Multi(ST_GeomFromText(:geom, 4326))),
                            ROUND(CAST(ST_Area(ST_Force2D(ST_GeomFromText(:geom, 4326))::geography)/1000000 AS NUMERIC), 4),
                            :jml_pend, :jml_kk, :jml_kec, :jml_desa,
                            :jml_kel, :kepadatan, :luas_wil, NOW())
                    ON CONFLICT (kode_kab) DO UPDATE SET
                        nama_kabupaten = EXCLUDED.nama_kabupaten,
                        tipe = EXCLUDED.tipe,
                        geom = EXCLUDED.geom,
                        area_km2 = EXCLUDED.area_km2,
                        jumlah_penduduk = EXCLUDED.jumlah_penduduk,
                        jumlah_kk = EXCLUDED.jumlah_kk,
                        jumlah_kec = EXCLUDED.jumlah_kec,
                        jumlah_desa = EXCLUDED.jumlah_desa,
                        jumlah_kel = EXCLUDED.jumlah_kel,
                        kepadatan = EXCLUDED.kepadatan,
                        luas_wilayah = EXCLUDED.luas_wilayah,
                        updated_at = NOW()
                """), {
                    "kode": kode, "parent": kode_prov, "nama": nama, "tipe": tipe,
                    "geom": geom_wkt,
                    "jml_pend": jumlah_penduduk, "jml_kk": jumlah_kk,
                    "jml_kec": jumlah_kec, "jml_desa": jumlah_desa,
                    "jml_kel": jumlah_kel, "kepadatan": kepadatan,
                    "luas_wil": luas_wilayah,
                })
                conn.commit()
                inserted += 1
            except Exception as e:
                skipped += 1
                if skipped <= 5:
                    print(f"  Error inserting {kode}: {e}")

    print(f"  Inserted: {inserted}, Skipped: {skipped}")
    return inserted


# ──────────────────────────────────────────────────────────────
#  IMPORT KECAMATAN
# ──────────────────────────────────────────────────────────────

def import_kecamatan(engine):
    print(f"\n{'=' * 60}\n  KECAMATAN\n{'=' * 60}")

    gdf = gpd.read_file(SHP_PATHS["kecamatan"], engine="pyogrio")
    print(f"  Read {len(gdf)} features from SHP")

    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    # CSV lookup
    csv_df = pd.read_csv(CSV_PATHS["kecamatan"], dtype=str)
    csv_lookup = {str(r["code"]).zfill(6): r["name"] for _, r in csv_df.iterrows()}

    gdf["geometry"] = gdf["geometry"].simplify(SIMPLIFY["kecamatan"], preserve_topology=True)
    gdf["geometry"] = gdf["geometry"].apply(ensure_multi_2d)

    # Filter null records
    gdf = gdf[gdf["nama_kec"].notna() & (gdf["nama_kec"].str.strip() != "") &
              (gdf["nama_kec"] != "TIDAK TERDEFINISI")].copy()
    print(f"  After filtering: {len(gdf)} features")

    inserted = 0
    skipped = 0

    for _, row in tqdm(gdf.iterrows(), total=len(gdf), desc="  Inserting kecamatan"):
        kode_kec_raw = row.get("kode_kec_s")
        if pd.isna(kode_kec_raw):
            skipped += 1
            continue
        kode = str(int(kode_kec_raw)).zfill(6)

        kode_kab_raw = row.get("kode_kab_s")
        if pd.isna(kode_kab_raw):
            skipped += 1
            continue
        parent = str(int(kode_kab_raw)).zfill(4)

        nama = csv_lookup.get(kode, safe_str(row["nama_kec"]) or "")

        geom_wkt = row["geometry"].wkt if row["geometry"] else None
        if not geom_wkt:
            skipped += 1
            continue

        jumlah_penduduk = safe_int(row.get("jumlah_pen"))
        jumlah_kk = safe_int(row.get("jumlah_kk"))
        jumlah_desa = safe_int(row.get("jumlah_des"))
        jumlah_kel_raw = row.get("jumlah_kel")
        jumlah_kel = safe_int(jumlah_kel_raw)
        kepadatan = safe_float(row.get("kepadatan_"))
        luas_wilayah = safe_float(row.get("luas_wilay"))

        with engine.connect() as conn:
            try:
                conn.execute(text("""
                    INSERT INTO kecamatan (kode_kec, kode_kab, nama_kecamatan, geom, area_km2,
                                            jumlah_penduduk, jumlah_kk, jumlah_desa, jumlah_kel,
                                            kepadatan, luas_wilayah, updated_at)
                    VALUES (:kode, :parent, :nama,
                            ST_Force2D(ST_Multi(ST_GeomFromText(:geom, 4326))),
                            ROUND(CAST(ST_Area(ST_Force2D(ST_GeomFromText(:geom, 4326))::geography)/1000000 AS NUMERIC), 4),
                            :jml_pend, :jml_kk, :jml_desa, :jml_kel,
                            :kepadatan, :luas_wil, NOW())
                    ON CONFLICT (kode_kec) DO UPDATE SET
                        nama_kecamatan = EXCLUDED.nama_kecamatan,
                        geom = EXCLUDED.geom,
                        area_km2 = EXCLUDED.area_km2,
                        jumlah_penduduk = EXCLUDED.jumlah_penduduk,
                        jumlah_kk = EXCLUDED.jumlah_kk,
                        jumlah_desa = EXCLUDED.jumlah_desa,
                        jumlah_kel = EXCLUDED.jumlah_kel,
                        kepadatan = EXCLUDED.kepadatan,
                        luas_wilayah = EXCLUDED.luas_wilayah,
                        updated_at = NOW()
                """), {
                    "kode": kode, "parent": parent, "nama": nama, "geom": geom_wkt,
                    "jml_pend": jumlah_penduduk, "jml_kk": jumlah_kk,
                    "jml_desa": jumlah_desa, "jml_kel": jumlah_kel,
                    "kepadatan": kepadatan, "luas_wil": luas_wilayah,
                })
                conn.commit()
                inserted += 1
            except Exception as e:
                skipped += 1
                if skipped <= 5:
                    print(f"  Error {kode}: {e}")

    print(f"  Inserted: {inserted}, Skipped: {skipped}")
    return inserted


# ──────────────────────────────────────────────────────────────
#  IMPORT DESA
# ──────────────────────────────────────────────────────────────

def import_desa(engine):
    print(f"\n{'=' * 60}\n  DESA\n{'=' * 60}")

    gdf = gpd.read_file(SHP_PATHS["desa"], engine="pyogrio")
    print(f"  Read {len(gdf)} features from SHP")

    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    # CSV lookup
    csv_df = pd.read_csv(CSV_PATHS["desa"], dtype=str)
    csv_lookup = {}
    for _, r in csv_df.iterrows():
        code = str(r["code"]).zfill(10)
        csv_lookup[code] = {"name": r["name"], "type": r.get("type", "village")}

    VIL_TYPE_MAP = {"village": "DESA", "sub_district": "KELURAHAN"}

    gdf["geometry"] = gdf["geometry"].simplify(SIMPLIFY["desa"], preserve_topology=True)
    gdf["geometry"] = gdf["geometry"].apply(ensure_multi_2d)

    # Filter null records
    gdf = gdf[gdf["nama_kel"].notna() & (gdf["nama_kel"].str.strip() != "")].copy()
    # Filter out records with null kode_desa_
    gdf = gdf[gdf["kode_desa_"].notna() & (gdf["kode_desa_"] > 0)].copy()
    print(f"  After filtering: {len(gdf)} features")

    inserted = 0
    skipped = 0

    for _, row in tqdm(gdf.iterrows(), total=len(gdf), desc="  Inserting desa"):
        kode_desa_raw = row.get("kode_desa_")
        if pd.isna(kode_desa_raw) or kode_desa_raw == 0:
            skipped += 1
            continue
        kode = str(int(kode_desa_raw)).zfill(10)

        # Derive parent kecamatan code from first 6 digits
        parent = kode[:6]

        csv_entry = csv_lookup.get(kode, {})
        nama = csv_entry.get("name", safe_str(row["nama_kel"]) or "")
        tipe = VIL_TYPE_MAP.get(csv_entry.get("type", ""), "DESA")

        geom_wkt = row["geometry"].wkt if row["geometry"] else None
        if not geom_wkt:
            skipped += 1
            continue

        jumlah_penduduk = safe_int(row.get("jumlah_pen"))
        pulau = safe_str(row.get("pulau"))
        jangkauan = safe_str(row.get("jangkauan"))

        with engine.connect() as conn:
            try:
                conn.execute(text("""
                    INSERT INTO desa (kode_desa, kode_kec, nama_desa, tipe, geom, area_km2,
                                      jumlah_penduduk, pulau, jangkauan, updated_at)
                    VALUES (:kode, :parent, :nama, :tipe,
                            ST_Force2D(ST_Multi(ST_GeomFromText(:geom, 4326))),
                            ROUND(CAST(ST_Area(ST_Force2D(ST_GeomFromText(:geom, 4326))::geography)/1000000 AS NUMERIC), 4),
                            :jml_pend, :pulau, :jangkauan, NOW())
                    ON CONFLICT (kode_desa) DO UPDATE SET
                        nama_desa = EXCLUDED.nama_desa,
                        tipe = EXCLUDED.tipe,
                        geom = EXCLUDED.geom,
                        area_km2 = EXCLUDED.area_km2,
                        jumlah_penduduk = EXCLUDED.jumlah_penduduk,
                        pulau = EXCLUDED.pulau,
                        jangkauan = EXCLUDED.jangkauan,
                        updated_at = NOW()
                """), {
                    "kode": kode, "parent": parent, "nama": nama, "tipe": tipe,
                    "geom": geom_wkt,
                    "jml_pend": jumlah_penduduk, "pulau": pulau,
                    "jangkauan": jangkauan,
                })
                conn.commit()
                inserted += 1
            except Exception as e:
                skipped += 1
                if skipped <= 10:
                    print(f"  Error {kode}: {e}")

    print(f"  Inserted: {inserted}, Skipped: {skipped}")
    return inserted


# ──────────────────────────────────────────────────────────────
#  RE-IMPORT POSTAL CODES
# ──────────────────────────────────────────────────────────────

def import_postal_codes(engine):
    print(f"\n{'=' * 60}\n  POSTAL CODES\n{'=' * 60}")

    df = pd.read_csv(POSTAL_CSV, dtype=str)
    print(f"  Read {len(df)} records from CSV")

    with engine.connect() as conn:
        result = conn.execute(text("SELECT kode_desa FROM desa"))
        valid_codes = {row[0] for row in result}
    print(f"  Valid village codes in DB: {len(valid_codes)}")

    inserted = 0
    skipped = 0
    batch = []

    for _, row in tqdm(df.iterrows(), total=len(df), desc="  Importing postal codes"):
        vc = str(row["village_code"]).zfill(10)
        if vc not in valid_codes:
            skipped += 1
            continue

        pc = str(row["postal_code"]).strip() if pd.notna(row.get("postal_code")) else None
        status = str(row.get("status", "AUGMENTED")).upper()
        if status not in ("OFFICIAL", "AUGMENTED", "UNASSIGNED"):
            status = "AUGMENTED"
        conf = float(row["confidence"]) if pd.notna(row.get("confidence")) else None
        src = str(row.get("source", "")) if pd.notna(row.get("source")) else None

        batch.append({"kd": vc, "kp": pc, "st": status, "cf": conf, "sr": src})

        if len(batch) >= 500:
            with engine.connect() as conn:
                for item in batch:
                    conn.execute(text("""
                        INSERT INTO postal_code (kode_desa, kode_pos, status, confidence, sumber)
                        VALUES (:kd, :kp, :st, :cf, :sr)
                    """), item)
                conn.commit()
            inserted += len(batch)
            batch = []

    if batch:
        with engine.connect() as conn:
            for item in batch:
                conn.execute(text("""
                    INSERT INTO postal_code (kode_desa, kode_pos, status, confidence, sumber)
                    VALUES (:kd, :kp, :st, :cf, :sr)
                """), item)
            conn.commit()
        inserted += len(batch)

    print(f"  Inserted: {inserted}, Skipped: {skipped}")
    return inserted


# ──────────────────────────────────────────────────────────────
#  VALIDATE
# ──────────────────────────────────────────────────────────────

def validate(engine):
    print(f"\n{'=' * 60}\n  VALIDATION\n{'=' * 60}")
    with engine.connect() as conn:
        for t in ["provinsi", "kabupaten", "kecamatan", "desa", "postal_code"]:
            c = conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
            print(f"  {t}: {c} rows")

        # Orphan checks
        orphan_kab = conn.execute(text(
            "SELECT COUNT(*) FROM kabupaten kb WHERE NOT EXISTS "
            "(SELECT 1 FROM provinsi p WHERE p.kode_prov = kb.kode_prov)"
        )).scalar()
        print(f"\n  Orphan kabupaten (no parent prov): {orphan_kab}")

        orphan_kec = conn.execute(text(
            "SELECT COUNT(*) FROM kecamatan kc WHERE NOT EXISTS "
            "(SELECT 1 FROM kabupaten kb WHERE kb.kode_kab = kc.kode_kab)"
        )).scalar()
        print(f"  Orphan kecamatan (no parent kab): {orphan_kec}")

        orphan_desa = conn.execute(text(
            "SELECT COUNT(*) FROM desa d WHERE NOT EXISTS "
            "(SELECT 1 FROM kecamatan kc WHERE kc.kode_kec = d.kode_kec)"
        )).scalar()
        print(f"  Orphan desa (no parent kec): {orphan_desa}")

        orphan_postal = conn.execute(text(
            "SELECT COUNT(*) FROM desa d WHERE NOT EXISTS "
            "(SELECT 1 FROM postal_code pc WHERE pc.kode_desa = d.kode_desa)"
        )).scalar()
        print(f"  Desa without postal code: {orphan_postal}")

        # Spot check ACEH
        aceh = conn.execute(text(
            "SELECT kode_prov, nama_provinsi, jumlah_penduduk FROM provinsi WHERE kode_prov = '11'"
        )).fetchone()
        if aceh:
            print(f"\n  Spot check ACEH: kode={aceh[0]}, nama={aceh[1]}, penduduk={aceh[2]}")

        # Storage
        storage = conn.execute(text(
            "SELECT pg_size_pretty(pg_database_size(current_database()))"
        )).scalar()
        print(f"  Database size: {storage}")


# ──────────────────────────────────────────────────────────────
#  MAIN
# ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Import Dukcapil 2024 SHP → PostGIS")
    parser.add_argument("--skip-to", choices=["kabupaten", "kecamatan", "desa", "postal", "validate"],
                        help="Skip to a specific import step (for resuming after partial import)")
    parser.add_argument("--no-truncate", action="store_true",
                        help="Skip truncation (use when resuming)")
    args = parser.parse_args()

    print("╔══════════════════════════════════════════════════════╗")
    print("║  wilayah-id ETL — Dukcapil 2024 Import               ║")
    print("╚══════════════════════════════════════════════════════╝")

    engine = get_engine()
    with engine.connect() as conn:
        v = conn.execute(text("SELECT PostGIS_Version()")).scalar()
        print(f"PostGIS: {v}")

    t0 = time.time()

    steps = ["truncate", "provinsi", "kabupaten", "kecamatan", "desa", "postal", "validate"]
    skip_to = args.skip_to or "truncate"
    if args.no_truncate:
        skip_to = skip_to if skip_to != "truncate" else "provinsi"

    start_idx = steps.index(skip_to) if skip_to in steps else 0

    if start_idx <= steps.index("truncate") and not args.no_truncate:
        truncate_all(engine)
    if start_idx <= steps.index("provinsi"):
        import_provinsi(engine)
    if start_idx <= steps.index("kabupaten"):
        import_kabupaten(engine)
    if start_idx <= steps.index("kecamatan"):
        import_kecamatan(engine)
    if start_idx <= steps.index("desa"):
        import_desa(engine)
    if start_idx <= steps.index("postal"):
        import_postal_codes(engine)
    validate(engine)

    elapsed = time.time() - t0
    print(f"\n🎉 ETL complete! ({elapsed / 60:.1f} min)")


if __name__ == "__main__":
    main()
