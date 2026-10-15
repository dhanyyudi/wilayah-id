"""
Update Region Codes from upstream (lokabisa-oss/region-id).

Downloads the CSV assets of one region-id release, checks each against the
SHA-256 in that release's metadata, copies them into data-region-id/, then
reapplies the local name corrections in data-region-id/name-corrections.csv.

Usage:
    source etl-venv/bin/activate
    python etl/update_regions.py                 # pinned release
    python etl/update_regions.py --tag v1.0.3    # another release
"""

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

from region_names import CorrectionMismatch, apply_corrections, artifact_report

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data-region-id"

REPO = "lokabisa-oss/region-id"
DEFAULT_TAG = "v1.0.2"
ASSETS = ["provinces.csv", "regencies.csv", "districts.csv", "villages.csv", "regions_id.csv"]


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as resp:
        return resp.read()


def main() -> None:
    parser = argparse.ArgumentParser(description="Update region-id CSVs")
    parser.add_argument("--tag", default=DEFAULT_TAG, help=f"release tag (default {DEFAULT_TAG})")
    args = parser.parse_args()
    version = args.tag.lstrip("v")

    print(f"=== Update Region Codes ({REPO} {args.tag}) ===")
    meta_name = f"region-id-{version}.json"
    meta_raw = fetch(f"https://raw.githubusercontent.com/{REPO}/{args.tag}/metadata/releases/{meta_name}")
    expected = json.loads(meta_raw)["assets"]

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        for name in ASSETS:
            data = fetch(f"https://github.com/{REPO}/releases/download/{args.tag}/{name}")
            digest = hashlib.sha256(data).hexdigest()
            if digest != expected[name]["sha256"]:
                print(f"ERROR: {name} sha256 {digest} does not match release metadata")
                sys.exit(1)
            (tmp_dir / name).write_bytes(data)
            print(f"  Downloaded {name}: {len(data):,} bytes, sha256 ok")

        for name in ASSETS:
            shutil.copy2(tmp_dir / name, DATA_DIR / name)

    for old_meta in DATA_DIR.glob("region-id-*.json"):
        old_meta.unlink()
    (DATA_DIR / meta_name).write_bytes(meta_raw)

    try:
        result = apply_corrections(DATA_DIR)
    except CorrectionMismatch as exc:
        print(f"ERROR: upstream changed a corrected name, review name-corrections.csv: {exc}")
        sys.exit(1)
    for filename, changed in result.items():
        print(f"  {filename}: {changed} names corrected locally")

    leftovers = artifact_report(DATA_DIR)
    if leftovers:
        print(f"\n{len(leftovers)} names still look like PDF artifacts; review them:")
        for level, code, name, labels in leftovers:
            print(f"  {level:9} {code:12} {name!r} ({', '.join(labels)})")

    print("\nDone. Re-run ETL to apply changes to database: python etl/import_dukcapil.py")


if __name__ == "__main__":
    main()
