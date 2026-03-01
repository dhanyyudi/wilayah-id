"""
ETL Script — Import SHP + CSV → PostGIS (with geometry simplification).

Handles Papua province code mapping:
  SHP uses old KODE_PROV (91/92) with FID suffixes for the 2022 Papua splits.
  FID mapping → Kemendagri code:
    91-A → 91 (Papua)
    91-B → 95 (Papua Pegunungan)
    91-C → 93 (Papua Selatan)
    91-D → 94 (Papua Tengah)
    92-A → 92 (Papua Barat)
    92-B → 96 (Papua Barat Daya)

Corrupt SHP entries (codes with '--') are boundary artifacts and are skipped.

Usage:
    source etl-venv/bin/activate
    python etl/import_all.py
"""

import os
import sys
import time
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely import force_2d
from shapely.geometry import MultiPolygon
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
from tqdm import tqdm

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# ── Papua FID → Kemendagri code mapping ──

PAPUA_FID_TO_KODE = {
    "91-A": "91",  # Papua
    "91-B": "95",  # Papua Pegunungan
    "91-C": "93",  # Papua Selatan
    "91-D": "94",  # Papua Tengah
    "92-A": "92",  # Papua Barat
    "92-B": "96",  # Papua Barat Daya
}

# Reverse: province name → Kemendagri kode_prov (for kabupaten parent remapping)
PAPUA_PROV_NAME_TO_KODE = {
    "Papua":              "91",
    "Papua Barat":        "92",
    "Papua Selatan":      "93",
    "Papua Tengah":       "94",
    "Papua Pegunungan":   "95",
    "Papua Barat Daya":   "96",
}

# ── Layer configs ──

LAYERS = [
    {
        "name": "provinsi",
        "shp": PROJECT_ROOT / "data-batas-administrasi-shp" / "shp_batas_provinsi" / "Provinsi.shp",
        "csv": PROJECT_ROOT / "data-region-id" / "provinces.csv",
        "code_col": "KODE_PROV", "name_col": "PROVINSI",
        "fid_col": "FID",
        "parent_code_col": None,
        "pad": 2, "parent_pad": None,
        "simplify": 0.001,
    },
    {
        "name": "kabupaten",
        "shp": PROJECT_ROOT / "data-batas-administrasi-shp" / "shp_batas_kota_kab" / "Kab_Kota.shp",
        "csv": PROJECT_ROOT / "data-region-id" / "regencies.csv",
        "code_col": "KODE_KK", "name_col": "KAB_KOTA",
        "parent_code_col": "KODE_PROV",
        "prov_name_col": "PROVINSI",
        "pad": 4, "parent_pad": 2,
        "simplify": 0.0005,
    },
    {
        "name": "kecamatan",
        "shp": PROJECT_ROOT / "data-batas-administrasi-shp" / "shp_batas_kecamatan" / "Kecamatan.shp",
        "csv": PROJECT_ROOT / "data-region-id" / "districts.csv",
        "code_col": "KODE_KEC", "name_col": "KECAMATAN",
        "parent_code_col": "KODE_KK",
        "pad": 6, "parent_pad": 4,
        "simplify": 0.0003,
    },
    {
        "name": "desa",
        "shp": PROJECT_ROOT / "data-batas-administrasi-shp" / "shp_batas_desa_kelurahan" / "Kel_Desa.shp",
        "csv": PROJECT_ROOT / "data-region-id" / "villages.csv",
        "code_col": "KODE_KD", "name_col": "KEL_DESA",
        "parent_code_col": "KODE_KEC",
        "jenis_col": "JENIS_KD",
        "pad": 10, "parent_pad": 6,
        "simplify": 0.0002,
    },
]

POSTAL_CSV = PROJECT_ROOT / "data-postal-codes" / "postal_codes_pos_indonesia.csv"


def normalize_code(raw, pad):
    """Strip dots, zero-pad. Returns '' if invalid."""
    if pd.isna(raw) or str(raw).strip() == "":
        return ""
    s = str(raw).strip().replace(".", "")
    # Skip corrupt codes containing dashes
    if "-" in s:
        return ""
    return s.zfill(pad)


def is_corrupt_code(raw_code):
    """Check if a dot-separated code contains '--' placeholders."""
    if pd.isna(raw_code):
        return True
    return "--" in str(raw_code)


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
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)
    return create_engine(url)


# ── Type mappings ──

REG_TYPE_MAP = {"regency": "KABUPATEN", "city": "KOTA"}
VIL_TYPE_MAP = {"village": "DESA", "sub_district": "KELURAHAN"}


def import_provinsi(engine, layer):
    """Import provinsi with Papua FID→code mapping."""
    print(f"\n{'='*60}\n  PROVINSI\n{'='*60}")

    gdf = gpd.read_file(layer["shp"], engine="pyogrio")
    print(f"  Read {len(gdf)} features")

    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    # Build CSV lookup
    csv_df = pd.read_csv(layer["csv"], dtype=str)
    csv_lookup = {str(r["code"]).zfill(2): r["name"] for _, r in csv_df.iterrows()}

    # Simplify + force 2D
    gdf["geometry"] = gdf["geometry"].simplify(layer["simplify"], preserve_topology=True)
    gdf["geometry"] = gdf["geometry"].apply(ensure_multi_2d)

    with engine.connect() as conn:
        inserted = 0
        for _, row in gdf.iterrows():
            fid = str(row["FID"]).strip()
            kode_prov_raw = str(row["KODE_PROV"]).strip()
            nama_shp = str(row["PROVINSI"]).strip()

            # Determine the real Kemendagri code
            if fid in PAPUA_FID_TO_KODE:
                kode = PAPUA_FID_TO_KODE[fid]
            else:
                kode = kode_prov_raw.zfill(2)

            # Get authoritative name from CSV
            nama = csv_lookup.get(kode, nama_shp)

            geom_wkt = row["geometry"].wkt if row["geometry"] else None
            if not geom_wkt:
                continue

            savepoint = conn.begin_nested()
            try:
                conn.execute(text("""
                    INSERT INTO provinsi (kode_prov, nama_provinsi, geom, area_km2)
                    VALUES (:kode, :nama, ST_Force2D(ST_Multi(ST_GeomFromText(:geom, 4326))),
                            ROUND(CAST(ST_Area(ST_Force2D(ST_GeomFromText(:geom, 4326))::geography)/1000000 AS NUMERIC), 4))
                    ON CONFLICT (kode_prov) DO NOTHING
                """), {"kode": kode, "nama": nama, "geom": geom_wkt})
                savepoint.commit()
                inserted += 1
            except Exception as e:
                savepoint.rollback()
                print(f"  Error inserting {kode} ({nama}): {e}")

            if inserted % 10 == 0:
                conn.commit()
        conn.commit()

    print(f"  Inserted: {inserted}")
    return inserted


def import_kabupaten(engine, layer):
    """Import kabupaten with Papua province remapping."""
    print(f"\n{'='*60}\n  KABUPATEN\n{'='*60}")

    gdf = gpd.read_file(layer["shp"], engine="pyogrio")
    print(f"  Read {len(gdf)} features")

    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    # Build CSV lookup
    csv_df = pd.read_csv(layer["csv"], dtype=str)
    csv_lookup = {}
    for _, r in csv_df.iterrows():
        code = str(r["code"]).zfill(4)
        csv_lookup[code] = {"name": r["name"], "type": r.get("type", "regency")}

    gdf["geometry"] = gdf["geometry"].simplify(layer["simplify"], preserve_topology=True)
    gdf["geometry"] = gdf["geometry"].apply(ensure_multi_2d)

    # Filter corrupt codes
    gdf = gdf[~gdf["KODE_KK"].apply(is_corrupt_code)].copy()
    print(f"  After filtering corrupt codes: {len(gdf)} features")

    with engine.connect() as conn:
        inserted = 0
        skipped = 0

        for _, row in tqdm(gdf.iterrows(), total=len(gdf), desc="  Inserting kabupaten"):
            kode = normalize_code(row["KODE_KK"], 4)
            if not kode:
                skipped += 1
                continue

            # Determine parent province code
            kode_prov_raw = str(row["KODE_PROV"]).strip()
            prov_name = str(row.get("PROVINSI", "")).strip()

            # Remap Papua province codes using province name
            if prov_name in PAPUA_PROV_NAME_TO_KODE:
                kode_prov = PAPUA_PROV_NAME_TO_KODE[prov_name]
            else:
                kode_prov = kode_prov_raw.zfill(2)

            csv_entry = csv_lookup.get(kode, {})
            nama = csv_entry.get("name", str(row["KAB_KOTA"]).strip())
            tipe = REG_TYPE_MAP.get(csv_entry.get("type", ""), "KABUPATEN")

            geom_wkt = row["geometry"].wkt if row["geometry"] else None
            if not geom_wkt:
                skipped += 1
                continue

            savepoint = conn.begin_nested()
            try:
                conn.execute(text("""
                    INSERT INTO kabupaten (kode_kab, kode_prov, nama_kabupaten, tipe, geom, area_km2)
                    VALUES (:kode, :parent, :nama, :tipe, ST_Force2D(ST_Multi(ST_GeomFromText(:geom, 4326))),
                            ROUND(CAST(ST_Area(ST_Force2D(ST_GeomFromText(:geom, 4326))::geography)/1000000 AS NUMERIC), 4))
                    ON CONFLICT (kode_kab) DO NOTHING
                """), {"kode": kode, "parent": kode_prov, "nama": nama, "tipe": tipe, "geom": geom_wkt})
                savepoint.commit()
                inserted += 1
            except Exception as e:
                savepoint.rollback()
                skipped += 1
                if skipped <= 5:
                    print(f"  Error inserting {kode}: {e}")

            if inserted % 100 == 0 and inserted > 0:
                conn.commit()
        conn.commit()

    print(f"  Inserted: {inserted}, Skipped: {skipped}")


def import_kecamatan(engine, layer):
    """Import kecamatan, skipping corrupt codes."""
    print(f"\n{'='*60}\n  KECAMATAN\n{'='*60}")

    gdf = gpd.read_file(layer["shp"], engine="pyogrio")
    print(f"  Read {len(gdf)} features")

    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    csv_df = pd.read_csv(layer["csv"], dtype=str)
    csv_lookup = {str(r["code"]).zfill(6): r["name"] for _, r in csv_df.iterrows()}

    gdf["geometry"] = gdf["geometry"].simplify(layer["simplify"], preserve_topology=True)
    gdf["geometry"] = gdf["geometry"].apply(ensure_multi_2d)

    # Filter corrupt codes
    gdf = gdf[~gdf["KODE_KEC"].apply(is_corrupt_code)].copy()
    print(f"  After filtering corrupt codes: {len(gdf)} features")

    with engine.connect() as conn:
        inserted = 0
        skipped = 0

        for _, row in tqdm(gdf.iterrows(), total=len(gdf), desc="  Inserting kecamatan"):
            kode = normalize_code(row["KODE_KEC"], 6)
            parent = normalize_code(row["KODE_KK"], 4)
            if not kode or not parent:
                skipped += 1
                continue

            nama = csv_lookup.get(kode, str(row["KECAMATAN"]).strip())
            geom_wkt = row["geometry"].wkt if row["geometry"] else None
            if not geom_wkt:
                skipped += 1
                continue

            savepoint = conn.begin_nested()
            try:
                conn.execute(text("""
                    INSERT INTO kecamatan (kode_kec, kode_kab, nama_kecamatan, geom, area_km2)
                    VALUES (:kode, :parent, :nama, ST_Force2D(ST_Multi(ST_GeomFromText(:geom, 4326))),
                            ROUND(CAST(ST_Area(ST_Force2D(ST_GeomFromText(:geom, 4326))::geography)/1000000 AS NUMERIC), 4))
                    ON CONFLICT (kode_kec) DO NOTHING
                """), {"kode": kode, "parent": parent, "nama": nama, "geom": geom_wkt})
                savepoint.commit()
                inserted += 1
            except Exception as e:
                savepoint.rollback()
                skipped += 1
                if skipped <= 5:
                    print(f"  Error {kode}: {e}")

            if inserted % 1000 == 0 and inserted > 0:
                conn.commit()
        conn.commit()

    print(f"  Inserted: {inserted}, Skipped: {skipped}")


def import_desa(engine, layer):
    """Import desa, skipping corrupt codes."""
    print(f"\n{'='*60}\n  DESA\n{'='*60}")

    gdf = gpd.read_file(layer["shp"], engine="pyogrio")
    print(f"  Read {len(gdf)} features")

    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    csv_df = pd.read_csv(layer["csv"], dtype=str)
    csv_lookup = {}
    for _, r in csv_df.iterrows():
        code = str(r["code"]).zfill(10)
        csv_lookup[code] = {"name": r["name"], "type": r.get("type", "village")}

    gdf["geometry"] = gdf["geometry"].simplify(layer["simplify"], preserve_topology=True)
    gdf["geometry"] = gdf["geometry"].apply(ensure_multi_2d)

    # Filter corrupt codes (-- in code) and slashes (merged entries)
    gdf = gdf[~gdf["KODE_KD"].apply(is_corrupt_code)].copy()
    gdf = gdf[~gdf["KODE_KD"].str.contains("/", na=True)].copy()
    print(f"  After filtering corrupt/merged codes: {len(gdf)} features")

    with engine.connect() as conn:
        inserted = 0
        skipped = 0

        for _, row in tqdm(gdf.iterrows(), total=len(gdf), desc="  Inserting desa"):
            kode = normalize_code(row["KODE_KD"], 10)
            parent = normalize_code(row["KODE_KEC"], 6)
            if not kode or not parent:
                skipped += 1
                continue

            csv_entry = csv_lookup.get(kode, {})
            nama = csv_entry.get("name", str(row["KEL_DESA"]).strip())
            jenis = str(row.get("JENIS_KD", "Desa")).strip() if pd.notna(row.get("JENIS_KD")) else "Desa"
            tipe = VIL_TYPE_MAP.get(csv_entry.get("type", ""), jenis.upper() if jenis else "DESA")

            geom_wkt = row["geometry"].wkt if row["geometry"] else None
            if not geom_wkt:
                skipped += 1
                continue

            savepoint = conn.begin_nested()
            try:
                conn.execute(text("""
                    INSERT INTO desa (kode_desa, kode_kec, nama_desa, tipe, geom, area_km2)
                    VALUES (:kode, :parent, :nama, :tipe, ST_Force2D(ST_Multi(ST_GeomFromText(:geom, 4326))),
                            ROUND(CAST(ST_Area(ST_Force2D(ST_GeomFromText(:geom, 4326))::geography)/1000000 AS NUMERIC), 4))
                    ON CONFLICT (kode_desa) DO NOTHING
                """), {"kode": kode, "parent": parent, "nama": nama, "tipe": tipe, "geom": geom_wkt})
                savepoint.commit()
                inserted += 1
            except Exception as e:
                savepoint.rollback()
                skipped += 1
                if skipped <= 5:
                    print(f"  Error {kode}: {e}")

            if inserted % 1000 == 0 and inserted > 0:
                conn.commit()
        conn.commit()

    print(f"  Inserted: {inserted}, Skipped: {skipped}")


def import_postal_codes(engine):
    print(f"\n{'='*60}\n  POSTAL CODES\n{'='*60}")

    df = pd.read_csv(POSTAL_CSV, dtype=str)
    print(f"  Read {len(df)} records")

    with engine.connect() as conn:
        result = conn.execute(text("SELECT kode_desa FROM desa"))
        valid_codes = {row[0] for row in result}
        print(f"  Valid village codes: {len(valid_codes)}")

        inserted = 0
        skipped = 0

        for _, row in tqdm(df.iterrows(), total=len(df), desc="  Importing"):
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

            conn.execute(text("""
                INSERT INTO postal_code (kode_desa, kode_pos, status, confidence, sumber)
                VALUES (:kd, :kp, :st, :cf, :sr)
            """), {"kd": vc, "kp": pc, "st": status, "cf": conf, "sr": src})
            inserted += 1

            if inserted % 5000 == 0:
                conn.commit()

        conn.commit()

    print(f"  Inserted: {inserted}, Skipped: {skipped}")


def validate(engine):
    print(f"\n{'='*60}\n  VALIDATION\n{'='*60}")
    with engine.connect() as conn:
        for t in ["provinsi", "kabupaten", "kecamatan", "desa", "postal_code"]:
            c = conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
            print(f"  {t}: {c} rows")

        # Check Papua provinces specifically
        result = conn.execute(text(
            "SELECT kode_prov, nama_provinsi FROM provinsi WHERE kode_prov >= '91' ORDER BY kode_prov"
        ))
        print("\n  Papua provinces:")
        for row in result:
            print(f"    {row[0]}: {row[1]}")

        orphan = conn.execute(text(
            "SELECT COUNT(*) FROM desa d WHERE NOT EXISTS (SELECT 1 FROM postal_code pc WHERE pc.kode_desa = d.kode_desa)"
        )).scalar()
        print(f"\n  Desa without postal code: {orphan}")

        storage = conn.execute(text(
            "SELECT pg_size_pretty(pg_database_size(current_database()))"
        )).scalar()
        print(f"  Database size: {storage}")


def main():
    print("╔══════════════════════════════════════════════╗")
    print("║  wilayah-id ETL — Fixed Papua Mapping        ║")
    print("╚══════════════════════════════════════════════╝")

    engine = get_engine()
    with engine.connect() as conn:
        v = conn.execute(text("SELECT PostGIS_Version()")).scalar()
        print(f"PostGIS: {v}")

    import_provinsi(engine, LAYERS[0])
    import_kabupaten(engine, LAYERS[1])
    import_kecamatan(engine, LAYERS[2])
    import_desa(engine, LAYERS[3])
    import_postal_codes(engine)
    validate(engine)

    print("\n🎉 ETL complete!")


if __name__ == "__main__":
    main()
