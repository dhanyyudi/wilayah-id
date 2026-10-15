"""
Local name corrections for the region-id CSVs.

region-id (lokabisa-oss/region-id) parses the Kepmendagri PDF. Release v1.0.2
fixed the regency names; some district and village names still carry PDF
artifacts such as "A u r" or "Kedungpomahanwet an". The fixes live in
data-region-id/name-corrections.csv and are applied to every CSV that holds the
name, including regions_id.csv. A correction whose old_name no longer matches
the source stops the run, so an upstream change is reviewed instead of being
overwritten.

Usage:
    python etl/region_names.py            # apply corrections
    python etl/region_names.py --check    # list artifact-like names
"""

import argparse
import csv
import io
import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data-region-id"
CORRECTIONS_CSV = DATA_DIR / "name-corrections.csv"

# level -> (file, code column, name column)
LEVEL_FILES = {
    "province": ("provinces.csv", "code", "name"),
    "regency": ("regencies.csv", "code", "name"),
    "district": ("districts.csv", "code", "name"),
    "village": ("villages.csv", "code", "name"),
}

# level -> (code column, name column) in the denormalized regions_id.csv
REGIONS_ID_COLUMNS = {
    "province": ("province_code", "province_name"),
    "regency": ("regency_code", "regency_name"),
    "district": ("district_code", "district_name"),
    "village": ("village_code", "village_name"),
}

ARTIFACT_PATTERNS = {
    "letter spacing": re.compile(r"\b\w( \w){2,}\b"),
    "split word": re.compile(r"[a-z]{3,} [a-z]{1,2}$"),
    # Abbreviations such as "Murung A." or "Bedeng SS." keep their period.
    "trailing period": re.compile(r"\b(?=[A-Za-z]*[a-z])[A-Za-z]{3,}\.$"),
    "footnote marker": re.compile(r"\*"),
    "untrimmed whitespace": re.compile(r"^\s|\s$|\s{2,}"),
}


class CorrectionMismatch(ValueError):
    pass


def find_artifacts(name: str) -> list[str]:
    return [label for label, pattern in ARTIFACT_PATTERNS.items() if pattern.search(name)]


def load_corrections(path: Path = CORRECTIONS_CSV) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    for row in rows:
        if row["level"] not in LEVEL_FILES:
            raise ValueError(f"unknown level {row['level']!r} for code {row['code']}")
    return rows


def _read(path: Path) -> tuple[list[list[str]], str]:
    with open(path, newline="", encoding="utf-8") as fh:
        raw = fh.read()
    newline = "\r\n" if "\r\n" in raw else "\n"
    return list(csv.reader(io.StringIO(raw, newline=""))), newline


def _write(path: Path, rows: list[list[str]], newline: str) -> None:
    out = io.StringIO(newline="")
    csv.writer(out, lineterminator=newline).writerows(rows)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        fh.write(out.getvalue())


def _apply_to_rows(rows, code_col, name_col, fixes, source) -> int:
    header = rows[0]
    ci, ni = header.index(code_col), header.index(name_col)
    changed = 0
    for row in rows[1:]:
        fix = fixes.get(row[ci])
        if fix is None or row[ni] == fix["new_name"]:
            continue
        if row[ni] != fix["old_name"]:
            raise CorrectionMismatch(
                f"{source}: {code_col}={row[ci]} is {row[ni]!r}, "
                f"expected {fix['old_name']!r} or {fix['new_name']!r}"
            )
        row[ni] = fix["new_name"]
        changed += 1
    return changed


def apply_corrections(data_dir: Path = DATA_DIR, corrections: list[dict] | None = None) -> dict[str, int]:
    """Apply corrections in place. Returns the number of changed rows per file."""
    if corrections is None:
        corrections = load_corrections()
    by_level: dict[str, dict[str, dict]] = {}
    for fix in corrections:
        by_level.setdefault(fix["level"], {})[fix["code"]] = fix

    # Validate every file before writing any of them.
    pending = []
    for level, fixes in by_level.items():
        filename, code_col, name_col = LEVEL_FILES[level]
        path = data_dir / filename
        rows, newline = _read(path)
        changed = _apply_to_rows(rows, code_col, name_col, fixes, filename)
        missing = set(fixes) - {row[rows[0].index(code_col)] for row in rows[1:]}
        if missing:
            raise CorrectionMismatch(f"{filename}: codes not found: {sorted(missing)}")
        pending.append((path, rows, newline, changed))

    regions_path = data_dir / "regions_id.csv"
    if regions_path.exists():
        rows, newline = _read(regions_path)
        changed = sum(
            _apply_to_rows(rows, *REGIONS_ID_COLUMNS[level], fixes, regions_path.name)
            for level, fixes in by_level.items()
        )
        pending.append((regions_path, rows, newline, changed))

    result = {}
    for path, rows, newline, changed in pending:
        if changed:
            _write(path, rows, newline)
        result[path.name] = result.get(path.name, 0) + changed
    return result


def artifact_report(data_dir: Path = DATA_DIR) -> list[tuple[str, str, str, list[str]]]:
    found = []
    for level, (filename, code_col, name_col) in LEVEL_FILES.items():
        with open(data_dir / filename, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                labels = find_artifacts(row[name_col])
                if labels:
                    found.append((level, row[code_col], row[name_col], labels))
    return found


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--check", action="store_true", help="list artifact-like names only")
    args = parser.parse_args()

    if args.check:
        for level, code, name, labels in artifact_report():
            print(f"{level:9} {code:12} {name!r:40} {', '.join(labels)}")
        return

    try:
        result = apply_corrections()
    except CorrectionMismatch as exc:
        print(f"ERROR: {exc}")
        sys.exit(1)
    for filename, changed in result.items():
        print(f"  {filename}: {changed} names corrected")


if __name__ == "__main__":
    main()
