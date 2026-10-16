"""
Prepare BIG BATASWILAYAH boundaries for wilayah-id.

Reads a BIG BATASWILAYAH boundary snapshot (one GeoParquet file per
level plus manifest.json) and the region-id CSVs, and writes one GeoParquet
file per wilayah-id table, a layer of uncoded areas, reports and a manifest.
Loading into PostGIS is done by sql/migrations/20261015_big2026_boundaries.sql
after ogr2ogr has copied these files into the big2026_stage schema.

Rules are documented in docs/BIG_2026_MIGRATION.md.

Usage:
    python etl/big_boundaries.py prepare \
        --snapshot data-big/source/big-2026-06-12 \
        --region-id data-region-id \
        --out data-big/prepared
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

LEVELS = {
    # wilayah-id table: BIG layer, code column, code length, tolerance (deg).
    # kabupaten and provinsi are built from the kecamatan coverage.
    "kecamatan": {"layer": "kecamatan", "key": "KDCPUM", "digits": 6, "tolerance": 0.0003, "scale": "1:10.000"},
    "desa": {"layer": "desakel", "key": "KDEPUM", "digits": 10, "tolerance": 0.0002, "scale": "1:10.000"},
}
KABKOTA = {"layer": "kabkota", "tolerance": 0.0005}
PROVINCE_TOLERANCE = 0.001
SOURCE_LABEL = "BIG BATASWILAYAH"
BIG_COLUMNS = ["NAMOBJ", "REMARK", "METADATA", "KDPPUM", "KDPKAB", "KDCPUM", "KDEPUM",
               "KDEBPS", "UUPP", "Status", "TIPADM", "geometry"]
METADATA_DATE = re.compile(r"^TASWIL\d+?(20\d{2})(\d{2})(\d{2})[A-Z_]+$")


def log(message: str) -> None:
    print(message, flush=True)


# ── Attribute rules (pure functions, unit-tested) ──

def normalize_code(raw, digits: int) -> str | None:
    """'32.71.03.1008' -> '3271031008'; None when the code is absent or malformed."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text or text.lower() == "nan":
        return None
    code = text.replace(".", "")
    if len(code) != digits or not code.isdigit():
        return None
    return code


def edition_from_metadata(metadata) -> str | None:
    """'TASWIL1000020260612DESAKEL_AR' -> '2026-06-12'."""
    if not metadata:
        return None
    match = METADATA_DATE.match(str(metadata).strip())
    if not match:
        return None
    year, month, day = match.groups()
    return f"{year}-{month}-{day}"


def clean_text(value) -> str | None:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    if not text or text.lower() in {"nan", "none", "<null>", "-"}:
        return None
    return text


def kabupaten_type(regionid_type, tipadm) -> str:
    """KABUPATEN or KOTA. region-id first, BIG TIPADM (5 = kota) second."""
    if regionid_type in ("city", "regency"):
        return "KOTA" if regionid_type == "city" else "KABUPATEN"
    return "KOTA" if str(tipadm) == "5" else "KABUPATEN"


def desa_type(regionid_type, tipadm) -> str:
    """DESA or KELURAHAN. region-id first, BIG TIPADM (2 = kelurahan) second."""
    if regionid_type in ("village", "urban_village"):
        return "KELURAHAN" if regionid_type == "urban_village" else "DESA"
    return "KELURAHAN" if str(tipadm) == "2" else "DESA"


def big_display_name(name: str | None, table: str, tipe: str | None) -> str | None:
    """BIG names lack the Kabupaten/Kota prefix that region-id uses."""
    if not name:
        return None
    if table != "kabupaten":
        return name
    if re.match(r"^(kabupaten|kota)\b", name, flags=re.IGNORECASE):
        return name
    return f"{'Kota' if tipe == 'KOTA' else 'Kabupaten'} {name}"


def pick_name(code: str, regionid: dict, big_name: str | None, table: str, tipe: str | None):
    """Return (name, source). region-id (Kepmendagri 2025) wins when it has the code."""
    if code in regionid and regionid[code].get("name"):
        return regionid[code]["name"], "kepmendagri-2025"
    return big_display_name(big_name, table, tipe), "big"


def dominant(values, weights):
    """Value with the largest total weight, ignoring empty values."""
    totals: Counter = Counter()
    for value, weight in zip(values, weights):
        if value is not None:
            totals[value] += weight
    return totals.most_common(1)[0][0] if totals else None


# ── Geometry steps ──

def polygonal(geoms):
    """make_valid every invalid geometry and keep only polygon parts as MultiPolygons."""
    import numpy as np
    import shapely

    invalid = ~shapely.is_valid(geoms)
    fixed = geoms.copy()
    if invalid.any():
        fixed[invalid] = shapely.make_valid(geoms[invalid], method="structure", keep_collapsed=False)
    out = np.empty(len(fixed), dtype=object)
    for i, geom in enumerate(fixed):
        parts = [p for p in shapely.get_parts(shapely.force_2d(geom)) if p.geom_type == "Polygon" and not p.is_empty]
        if not parts and geom.geom_type == "GeometryCollection":
            parts = [p for g in geom.geoms for p in shapely.get_parts(g) if p.geom_type == "Polygon"]
        out[i] = shapely.MultiPolygon(parts) if parts else None
    return out, int(invalid.sum())


def simplify_coverage(geoms, tolerance: float):
    """coverage_simplify keeps shared edges identical; falls back per feature if GEOS refuses."""
    import shapely

    try:
        return shapely.coverage_simplify(geoms, tolerance, simplify_boundary=True), "coverage_simplify"
    except Exception as exc:  # GEOS raises on some non-coverage inputs
        log(f"    coverage_simplify failed ({exc}); falling back to per-feature simplify")
        return shapely.simplify(geoms, tolerance, preserve_topology=True), "simplify_preserve_topology"


def union_groups(keys, geoms):
    """Dissolve geometries sharing a key. Groups of one keep their geometry as is."""
    import shapely

    groups: dict = {}
    for key, geom in zip(keys, geoms):
        if geom is not None and not geom.is_empty:
            groups.setdefault(key, []).append(geom)
    merged = {}
    for key, items in groups.items():
        if len(items) == 1:
            merged[key] = items[0]
            continue
        union = shapely.union_all(items)
        parts = [p for p in shapely.get_parts(union) if p.geom_type == "Polygon"]
        merged[key] = shapely.MultiPolygon(parts)
    return merged


def as_multi(geom):
    import shapely

    if geom is None or geom.is_empty:
        return None
    if geom.geom_type == "Polygon":
        return shapely.MultiPolygon([geom])
    if geom.geom_type == "MultiPolygon":
        return geom
    parts = [p for p in shapely.get_parts(geom) if p.geom_type == "Polygon"]
    return shapely.MultiPolygon(parts) if parts else None


# ── Inputs ──

def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def read_regionid(directory: Path) -> dict:
    import pandas as pd

    tables = {
        "provinsi": "provinces.csv",
        "kabupaten": "regencies.csv",
        "kecamatan": "districts.csv",
        "desa": "villages.csv",
    }
    out = {}
    for table, filename in tables.items():
        frame = pd.read_csv(directory / filename, dtype=str, keep_default_na=False)
        out[table] = {
            row["code"]: {"name": clean_text(row.get("name")), "type": clean_text(row.get("type"))}
            for row in frame.to_dict("records")
        }
    return out


def read_layer(snapshot: Path, layer: str):
    import geopandas as gpd

    frame = gpd.read_parquet(snapshot / f"{layer}.parquet", columns=BIG_COLUMNS)
    if frame.crs is None or frame.crs.to_epsg() != 4326:
        frame = frame.to_crs(4326) if frame.crs else frame.set_crs(4326)
    return frame


# ── Prepare ──

def prepare_level(table: str, cfg: dict, snapshot: Path, regionid: dict, report: dict):
    """Return (coded GeoDataFrame, uncoded GeoDataFrame, valid full-resolution frame)."""
    import geopandas as gpd
    import numpy as np
    import shapely

    started = time.time()
    frame = read_layer(snapshot, cfg["layer"])
    log(f"  {table}: {len(frame)} BIG features from {cfg['layer']}")
    geoms, invalid = polygonal(np.asarray(frame.geometry.values, dtype=object))
    frame = frame.assign(geometry=gpd.GeoSeries(geoms, crs=4326))
    frame["code"] = [normalize_code(v, cfg["digits"]) for v in frame[cfg["key"]]]
    frame["area_deg"] = shapely.area(geoms)
    empty = frame.geometry.isna()

    log(f"    invalid fixed: {invalid}; empty after fix: {int(empty.sum())}")
    work = frame[~empty].reset_index(drop=True)
    simplified, method = simplify_coverage(np.asarray(work.geometry.values, dtype=object), cfg["tolerance"])
    simplified = np.array([as_multi(g) for g in simplified], dtype=object)
    lost = sum(1 for g in simplified if g is None)
    work = work.assign(simple=simplified)
    log(f"    {method} at {cfg['tolerance']} deg: {lost} features collapsed")

    coded = work[work.code.notna() & work.simple.notna()]
    uncoded = work[work.code.isna() & work.simple.notna()]
    merged = union_groups(coded.code.values, coded.simple.values)

    rows = []
    names_from_big = []
    for code, group in coded.groupby("code", sort=True):
        weights = group.area_deg.tolist()
        big_name = dominant([clean_text(v) for v in group.NAMOBJ], weights)
        tipadm = dominant([str(int(v)) if v == v and v is not None else None for v in group.TIPADM], weights)
        rid = regionid[table].get(code, {})
        row = {"code": code}
        if table == "kabupaten":
            row["tipe"] = kabupaten_type(rid.get("type"), tipadm)
        elif table == "desa":
            row["tipe"] = desa_type(rid.get("type"), tipadm)
        name, name_source = pick_name(code, regionid[table], big_name, table, row.get("tipe"))
        if name_source == "big":
            names_from_big.append({"code": code, "name": name})
        editions = [e for e in (edition_from_metadata(m) for m in group.METADATA) if e]
        row.update({
            "name": name,
            "nama_big": big_name,
            "sumber_nama": name_source,
            "keterangan_batas": dominant([clean_text(v) for v in group.REMARK], weights),
            "status_batas": dominant([clean_text(v) for v in group.Status], weights),
            "dasar_hukum": dominant([clean_text(v) for v in group.UUPP], weights),
            "kode_bps": dominant([normalize_code(v, 10) for v in group.KDEBPS], weights),
            "edisi_geometri": max(editions) if editions else None,
            "jumlah_fitur_big": len(group),
            "geometry": merged[code],
        })
        rows.append(row)
    out = gpd.GeoDataFrame(rows, geometry="geometry", crs=4326)

    uncoded_out = gpd.GeoDataFrame({
        "level": table,
        "kode_prov": [normalize_code(v, 2) for v in uncoded.KDPPUM],
        "kode_kab": [normalize_code(v, 4) for v in uncoded.KDPKAB],
        "kode_kec": [normalize_code(v, 6) for v in uncoded.KDCPUM],
        "kode_big": [clean_text(v) for v in uncoded[cfg["key"]]],
        "nama_big": [clean_text(v) for v in uncoded.NAMOBJ],
        "keterangan": [clean_text(v) for v in uncoded.REMARK],
        "edisi_geometri": [edition_from_metadata(v) for v in uncoded.METADATA],
        "geometry": list(uncoded.simple.values),
    }, geometry="geometry", crs=4326)

    report[table] = {
        "big_layer": cfg["layer"],
        "big_features": int(len(frame)),
        "invalid_fixed": invalid,
        "empty_after_fix": int(empty.sum()),
        "simplify_method": method,
        "tolerance_deg": cfg["tolerance"],
        "collapsed_by_simplify": lost,
        "coded_features": int(len(coded)),
        "codes": int(len(out)),
        "codes_with_multiple_features": int((out.jumlah_fitur_big > 1).sum()),
        "uncoded_features": int(len(uncoded_out)),
        "names_from_kepmendagri": int((out.sumber_nama == "kepmendagri-2025").sum()),
        "names_from_big": len(names_from_big),
        "codes_missing_in_kepmendagri_2025": len(names_from_big),
        "coordinates_before": int(shapely.get_num_coordinates(np.asarray(work.geometry.values, dtype=object)).sum()),
        "coordinates_after": int(shapely.get_num_coordinates(np.asarray(out.geometry.values, dtype=object)).sum()),
        "seconds": round(time.time() - started, 1),
    }
    log(f"    {len(out)} codes, {len(uncoded_out)} uncoded, {round(time.time() - started)} s")
    return out, uncoded_out, work


def assign_kabupaten(work, snapshot: Path):
    """kode_kab for every simplified kecamatan piece.

    Coded kecamatan use their own code. Uncoded areas ("Area Tidak Terdefinisi")
    use KDPKAB when present, otherwise the BIG kab/kota polygon that contains a
    point on their surface. Pieces outside every kab/kota keep only KDPPUM.
    """
    import numpy as np
    import shapely

    kab_layer = read_layer(snapshot, KABKOTA["layer"])
    geoms, _ = polygonal(np.asarray(kab_layer.geometry.values, dtype=object))
    kab_layer = kab_layer.assign(valid_geometry=geoms)
    kab_codes = [normalize_code(v, 4) for v in kab_layer.KDPKAB]
    usable = [i for i, (g, c) in enumerate(zip(geoms, kab_codes)) if g is not None and c]
    tree = shapely.STRtree([geoms[i] for i in usable])

    # Only kab/kota that own at least one coded kecamatan are real; BIG also
    # carries placeholders such as 12.-- and an unknown 35.36 on uncoded areas.
    known = {code[:4] for code in work.code if code}
    kab_keys, prov_keys, by_point = [], [], 0
    for code, kdpkab, kdppum, geom in zip(work.code, work.KDPKAB, work.KDPPUM, work.simple):
        prov_keys.append(normalize_code(kdppum, 2))
        if code:
            kab_keys.append(code[:4])
            continue
        kab = normalize_code(kdpkab, 4)
        if kab not in known:
            hits = tree.query(shapely.point_on_surface(geom), predicate="within") if geom is not None else []
            candidates = [kab_codes[usable[h]] for h in hits if kab_codes[usable[h]] in known]
            kab = candidates[0] if candidates else None
            by_point += kab is not None
        kab_keys.append(kab)
    return kab_layer, kab_keys, prov_keys, by_point


def prepare_kabupaten_provinsi(kec_work, snapshot: Path, regionid: dict, report: dict):
    """kab/kota = union of the simplified BIG kecamatan coverage per kode_kab;
    provinsi = union of those kab/kota per kode_prov.

    The BIG kab/kota layer is 1:50.000 and partly older (2022 to 2025 editions),
    while kecamatan is 1:10.000 edition 2026; building upwards keeps one edition
    and makes every kecamatan nest in its kab/kota. Both levels are simplified
    again at their own tolerance.
    """
    import geopandas as gpd
    import numpy as np
    import shapely

    started = time.time()
    kab_layer, kab_keys, prov_keys, by_point = assign_kabupaten(kec_work, snapshot)
    pieces = list(kec_work.simple.values)
    merged = union_groups(kab_keys, pieces)
    merged.pop(None, None)
    kab_codes = sorted(merged)
    simplified, method = simplify_coverage(np.array([merged[c] for c in kab_codes], dtype=object),
                                           KABKOTA["tolerance"])

    editions: dict = {}
    for key, metadata in zip(kab_keys, kec_work.METADATA):
        edition = edition_from_metadata(metadata)
        if key and edition:
            editions[key] = max(editions.get(key, edition), edition)
    layer_codes = [normalize_code(v, 4) for v in kab_layer.KDPKAB]
    weights = [shapely.area(g) if g is not None else 0.0 for g in kab_layer.valid_geometry]
    rows = []
    for code, geom in zip(kab_codes, simplified):
        mine = [i for i, c in enumerate(layer_codes) if c == code]
        tipadm = dominant([str(int(kab_layer.TIPADM.iloc[i])) for i in mine], [weights[i] for i in mine])
        big_name = dominant([clean_text(kab_layer.NAMOBJ.iloc[i]) for i in mine], [weights[i] for i in mine])
        tipe = kabupaten_type(regionid["kabupaten"].get(code, {}).get("type"), tipadm)
        name, source = pick_name(code, regionid["kabupaten"], big_name, "kabupaten", tipe)
        rows.append({"code": code, "tipe": tipe, "name": name, "nama_big": big_name, "sumber_nama": source,
                     "edisi_geometri": editions.get(code), "geometry": as_multi(geom)})
    kab = gpd.GeoDataFrame(rows, geometry="geometry", crs=4326)

    # Provinces: simplified kab/kota plus uncoded pieces that only know KDPPUM.
    prov_keys_all = [c[:2] for c in kab.code] + [p for k, p in zip(kab_keys, prov_keys) if k is None]
    prov_geoms = list(kab.geometry.values) + [g for k, g in zip(kab_keys, pieces) if k is None]
    prov_merged = union_groups(prov_keys_all, prov_geoms)
    prov_merged.pop(None, None)
    prov_codes = sorted(prov_merged)
    prov_simple, prov_method = simplify_coverage(np.array([prov_merged[c] for c in prov_codes], dtype=object),
                                                 PROVINCE_TOLERANCE)
    prov_rows = []
    for code, geom in zip(prov_codes, prov_simple):
        name, source = pick_name(code, regionid["provinsi"], None, "provinsi", None)
        kab_editions = [e for c, e in editions.items() if c.startswith(code)]
        prov_rows.append({"code": code, "name": name, "sumber_nama": source,
                          "edisi_geometri": max(kab_editions) if kab_editions else None,
                          "geometry": as_multi(geom)})
    prov = gpd.GeoDataFrame(prov_rows, geometry="geometry", crs=4326)

    unassigned = sum(1 for k in kab_keys if k is None)
    report["kabupaten"] = {
        "derived_from": "union of simplified BIG kecamatan per kode_kab",
        "uncoded_kecamatan_assigned_by_kdpkab_or_point": int(sum(1 for c, k in zip(kec_work.code, kab_keys)
                                                                  if c is None and k is not None)),
        "uncoded_kecamatan_assigned_by_point": int(by_point),
        "uncoded_kecamatan_without_kabupaten": int(unassigned),
        "codes": len(kab),
        "codes_missing_in_kepmendagri_2025": int((kab.sumber_nama == "big").sum()),
        "big_kabkota_codes_not_in_kecamatan": sorted(set(c for c in layer_codes if c) - set(kab.code)),
        "simplify_method": method,
        "tolerance_deg": KABKOTA["tolerance"],
        "coordinates_after": int(sum(len(g.exterior.coords) + sum(len(r.coords) for r in g.interiors)
                                     for m in kab.geometry for g in m.geoms)),
    }
    report["provinsi"] = {
        "derived_from": "union of kab/kota per kode_prov plus uncoded areas by KDPPUM",
        "codes": len(prov),
        "simplify_method": prov_method,
        "tolerance_deg": PROVINCE_TOLERANCE,
        "missing_names": int(prov.name.isna().sum()),
        "seconds": round(time.time() - started, 1),
    }
    log(f"  kabupaten: {len(kab)} from kecamatan ({by_point} uncoded areas placed by point, "
        f"{unassigned} only by province); provinsi: {len(prov)}; {round(time.time() - started)} s")
    return kab, prov


def finalize(table: str, frame, snapshot_edition: str):
    """Rename to wilayah-id columns and add parent codes."""
    source = f"{SOURCE_LABEL} {snapshot_edition}"
    frame = frame.copy()
    frame["sumber_geometri"] = source
    if table == "provinsi":
        cols = {"code": "kode_prov", "name": "nama_provinsi"}
    elif table == "kabupaten":
        frame["kode_prov"] = frame.code.str[:2]
        cols = {"code": "kode_kab", "name": "nama_kabupaten"}
    elif table == "kecamatan":
        frame["kode_kab"] = frame.code.str[:4]
        cols = {"code": "kode_kec", "name": "nama_kecamatan"}
    else:
        frame["kode_kec"] = frame.code.str[:6]
        cols = {"code": "kode_desa", "name": "nama_desa"}
    frame = frame.rename(columns=cols)
    keep = {
        "provinsi": ["kode_prov", "nama_provinsi"],
        "kabupaten": ["kode_kab", "kode_prov", "nama_kabupaten", "tipe"],
        "kecamatan": ["kode_kec", "kode_kab", "nama_kecamatan", "keterangan_batas"],
        "desa": ["kode_desa", "kode_kec", "nama_desa", "tipe", "status_batas",
                 "keterangan_batas", "dasar_hukum", "kode_bps"],
    }[table]
    extra = ["nama_big", "sumber_nama"] if "nama_big" in frame else ["sumber_nama"]
    frame = frame[keep + extra + ["sumber_geometri", "edisi_geometri", "geometry"]]
    return as_text_columns(frame)


def as_text_columns(frame):
    """Write attributes as strings: an all-empty column would otherwise get the
    Arrow null type, which ogr2ogr drops when loading into PostGIS."""
    frame = frame.copy()
    for column in frame.columns:
        if column != frame.geometry.name:
            frame[column] = frame[column].astype("string")
    return frame


def hierarchy_report(tables: dict) -> dict:
    """Codes whose parent code is absent at the level above."""
    pairs = [("kabupaten", "kode_prov", "provinsi", "kode_prov"),
             ("kecamatan", "kode_kab", "kabupaten", "kode_kab"),
             ("desa", "kode_kec", "kecamatan", "kode_kec")]
    out = {}
    for child, child_col, parent, parent_col in pairs:
        parents = set(tables[parent][parent_col])
        orphans = sorted(set(tables[child][child_col]) - parents)
        out[f"{child}_without_parent"] = {"count": len(orphans), "parent_codes": orphans}
    return out


def name_differences(table: str, frame, code_col: str, name_col: str):
    import pandas as pd

    def norm(value):
        value = re.sub(r"^(kabupaten|kota)\s+", "", str(value or ""), flags=re.IGNORECASE)
        return re.sub(r"[^a-z0-9]", "", value.lower())

    rows = frame[(frame.sumber_nama == "kepmendagri-2025") & frame.nama_big.notna()]
    diff = rows[[norm(a) != norm(b) for a, b in zip(rows[name_col], rows.nama_big)]]
    return pd.DataFrame({"level": table, "code": diff[code_col], "nama_kepmendagri": diff[name_col],
                         "nama_big": diff.nama_big})


def cmd_prepare(args) -> int:
    import pandas as pd

    snapshot, out_dir = Path(args.snapshot), Path(args.out)
    manifest_in = json.loads((snapshot / "manifest.json").read_text())
    edition = manifest_in.get("edition")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report").mkdir(exist_ok=True)
    regionid_dir = Path(args.region_id)
    regionid = read_regionid(regionid_dir)

    log(f"BIG snapshot {manifest_in.get('snapshot_id')} edition {edition}")
    report: dict = {}
    prepared, uncoded_parts = {}, []
    for table, cfg in LEVELS.items():
        if args.levels and table not in args.levels:
            continue
        frame, uncoded, work = prepare_level(table, cfg, snapshot, regionid, report)
        prepared[table] = frame
        uncoded_parts.append(uncoded)
        if table == "kecamatan":
            prepared["kabupaten"], prepared["provinsi"] = prepare_kabupaten_provinsi(work, snapshot, regionid, report)
        del work

    outputs = {}
    finals = {}
    for table in ["provinsi", "kabupaten", "kecamatan", "desa"]:
        if table not in prepared:
            continue
        final = finalize(table, prepared[table], edition)
        finals[table] = final
        path = out_dir / f"{table}.parquet"
        final.to_parquet(path, compression="zstd", index=False)
        outputs[path.name] = sha256(path)
    if uncoded_parts:
        uncoded = as_text_columns(pd.concat(uncoded_parts, ignore_index=True))
        path = out_dir / "area_tidak_terdefinisi.parquet"
        uncoded.to_parquet(path, compression="zstd", index=False)
        outputs[path.name] = sha256(path)
        report["area_tidak_terdefinisi"] = {"features": int(len(uncoded))}

    diffs = []
    for table, code_col, name_col in [("kabupaten", "kode_kab", "nama_kabupaten"),
                                      ("kecamatan", "kode_kec", "nama_kecamatan"),
                                      ("desa", "kode_desa", "nama_desa")]:
        if table in finals:
            diffs.append(name_differences(table, finals[table], code_col, name_col))
            missing = finals[table][finals[table].sumber_nama == "big"][[code_col, name_col]]
            missing.to_csv(out_dir / "report" / f"{table}_not_in_kepmendagri_2025.csv", index=False)
    if diffs:
        pd.concat(diffs).to_csv(out_dir / "report" / "name_differences_kepmendagri_vs_big.csv", index=False)
    if len(finals) == 4:
        report["hierarchy"] = hierarchy_report(finals)

    manifest = {
        "dataset": "wilayah-id boundaries",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tool": "etl/big_boundaries.py prepare",
        "crs": "EPSG:4326",
        "geometry_source": {
            "name": "Badan Informasi Geospasial (BIG), layanan BATASWILAYAH",
            "service_root": manifest_in.get("source", {}).get("service_root"),
            "edition": edition,
            "snapshot_id": manifest_in.get("snapshot_id"),
            "layers": {k: {"metadata_values": v.get("metadata_values"), "count": v.get("fetched_count")}
                       for k, v in manifest_in.get("layers", {}).items()},
            "files": {p.name: sha256(p) for p in sorted(snapshot.glob("*.parquet"))},
        },
        "names_source": {
            "name": "region-id (Kepmendagri 2025) with wilayah-id corrections",
            "files": {p.name: sha256(p) for p in sorted(regionid_dir.glob("*.csv"))},
        },
        "parameters": {
            "tolerance_deg": {**{t: c["tolerance"] for t, c in LEVELS.items()},
                              "kabupaten": KABKOTA["tolerance"], "provinsi": PROVINCE_TOLERANCE},
            "make_valid": "shapely make_valid method=structure, polygon parts only",
            "simplify": "shapely coverage_simplify per level, simplify_boundary=True",
            "kabupaten": "union of simplified BIG kecamatan per kode_kab, simplified again",
            "provinsi": "union of kab/kota per kode_prov, simplified again",
        },
        "outputs": outputs,
        "report": report,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    (out_dir / "report" / "summary.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    log(f"Wrote {len(outputs)} files to {out_dir}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    prep = sub.add_parser("prepare", help="BIG snapshot -> prepared GeoParquet")
    prep.add_argument("--snapshot", required=True, help="folder with {kabkota,kecamatan,desakel}.parquet and manifest.json")
    prep.add_argument("--region-id", default="data-region-id", help="folder with region-id CSVs")
    prep.add_argument("--out", required=True)
    prep.add_argument("--levels", nargs="*", choices=list(LEVELS),
                      help="limit to some levels (kabupaten and provinsi come with kecamatan)")
    args = parser.parse_args(argv)
    if args.command == "prepare":
        return cmd_prepare(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
