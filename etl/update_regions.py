"""
Update Region Codes from upstream (nicnocquee/region-id).

Extracts the downloaded ZIP and updates CSV files in data-region-id/.
Run AFTER the GitHub Actions download step (or manually download the ZIP first).

Usage:
    source etl-venv/bin/activate
    # Optionally download manually:
    # curl -L -o data-downloads/region-id-latest.zip \
    #   https://github.com/nicnocquee/region-id/archive/refs/heads/main.zip
    python etl/update_regions.py
"""

import shutil
import sys
import zipfile
from pathlib import Path

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DOWNLOAD_DIR = PROJECT_ROOT / "data-downloads"
DATA_DIR = PROJECT_ROOT / "data-region-id"

# CSV files to update: local filename → possible names inside ZIP
CSV_MAP = {
    "provinces.csv":  ["provinces.csv"],
    "regencies.csv":  ["regencies.csv"],
    "districts.csv":  ["districts.csv"],
    "villages.csv":   ["villages.csv"],
}


def find_file_in_dir(directory: Path, candidates: list[str]) -> Path | None:
    for name in candidates:
        for path in directory.rglob(name):
            return path
    return None


def main() -> None:
    print("=== Update Region Codes ===")

    zip_path = DOWNLOAD_DIR / "region-id-latest.zip"
    if not zip_path.exists():
        print(f"ERROR: {zip_path} not found.")
        print("Download first:")
        print("  curl -L -o data-downloads/region-id-latest.zip \\")
        print("    https://github.com/nicnocquee/region-id/archive/refs/heads/main.zip")
        sys.exit(1)

    extract_dir = DOWNLOAD_DIR / "region-id-extracted"
    extract_dir.mkdir(parents=True, exist_ok=True)

    print(f"  Extracting {zip_path.name}...")
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(extract_dir)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    updated = 0

    for local_name, candidates in CSV_MAP.items():
        src = find_file_in_dir(extract_dir, candidates)
        if src is None:
            print(f"  WARNING: {local_name} not found in ZIP, skipping")
            continue

        dst = DATA_DIR / local_name
        shutil.copy2(src, dst)
        row_count = len(pd.read_csv(dst))
        print(f"  Updated {local_name}: {row_count} rows")
        updated += 1

    shutil.rmtree(extract_dir, ignore_errors=True)
    print(f"\nUpdated {updated}/{len(CSV_MAP)} CSV files in {DATA_DIR.name}/")
    print("Done. Re-run ETL to apply changes to database: python etl/import_all.py")


if __name__ == "__main__":
    main()
