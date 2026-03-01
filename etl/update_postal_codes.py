"""
Update Postal Codes from upstream (nicnocquee/postal-code-id).

Extracts the downloaded ZIP and updates postal_codes_pos_indonesia.csv.
Run AFTER the GitHub Actions download step (or manually download the ZIP first).

Usage:
    source etl-venv/bin/activate
    # Optionally download manually:
    # curl -L -o data-downloads/postal-code-id-latest.zip \
    #   https://github.com/nicnocquee/postal-code-id/archive/refs/heads/main.zip
    python etl/update_postal_codes.py
"""

import shutil
import sys
import zipfile
from pathlib import Path

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DOWNLOAD_DIR = PROJECT_ROOT / "data-downloads"
DATA_DIR = PROJECT_ROOT / "data-postal-codes"
POSTAL_TARGET = DATA_DIR / "postal_codes_pos_indonesia.csv"

# Possible CSV filenames inside the upstream ZIP
POSTAL_CANDIDATES = [
    "postal_codes_pos_indonesia.csv",
    "postal_codes.csv",
    "kode_pos.csv",
]


def find_postal_csv(directory: Path) -> Path | None:
    for name in POSTAL_CANDIDATES:
        for path in directory.rglob(name):
            return path
    # Fallback: any CSV with 'postal' or 'kode' in the name
    for path in directory.rglob("*.csv"):
        if "postal" in path.name.lower() or "kode" in path.name.lower():
            return path
    return None


def main() -> None:
    print("=== Update Postal Codes ===")

    zip_path = DOWNLOAD_DIR / "postal-code-id-latest.zip"
    if not zip_path.exists():
        print(f"ERROR: {zip_path} not found.")
        print("Download first:")
        print("  curl -L -o data-downloads/postal-code-id-latest.zip \\")
        print("    https://github.com/nicnocquee/postal-code-id/archive/refs/heads/main.zip")
        sys.exit(1)

    extract_dir = DOWNLOAD_DIR / "postal-code-extracted"
    extract_dir.mkdir(parents=True, exist_ok=True)

    print(f"  Extracting {zip_path.name}...")
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(extract_dir)

    src = find_postal_csv(extract_dir)
    if src is None:
        shutil.rmtree(extract_dir, ignore_errors=True)
        print("ERROR: Could not find postal codes CSV inside ZIP.")
        sys.exit(1)

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Backup existing file
    if POSTAL_TARGET.exists():
        backup = DATA_DIR / "postal_codes_pos_indonesia.bak.csv"
        shutil.copy2(POSTAL_TARGET, backup)
        print(f"  Backed up existing file → {backup.name}")

    shutil.copy2(src, POSTAL_TARGET)
    row_count = len(pd.read_csv(POSTAL_TARGET))
    print(f"  Updated {POSTAL_TARGET.name}: {row_count} rows")

    shutil.rmtree(extract_dir, ignore_errors=True)
    print("\nDone. Re-run ETL to apply changes to database: python etl/import_all.py")


if __name__ == "__main__":
    main()
