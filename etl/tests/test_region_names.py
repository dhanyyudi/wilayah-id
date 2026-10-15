import csv
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from region_names import (  # noqa: E402
    DATA_DIR,
    LEVEL_FILES,
    REGIONS_ID_COLUMNS,
    CorrectionMismatch,
    apply_corrections,
    artifact_report,
    find_artifacts,
    load_corrections,
)

# Flagged by the artifact patterns but left unchanged until a source confirms
# the spelling (Kepmendagri prints them this way, and so does BIG 2026).
UNVERIFIED_NAMES = {("village", "3527132005"), ("village", "7505112001")}

# Regency names of region-id v1.0.1 that carried text from neighbouring PDF cells.
V1_0_1_REGENCY_ERRORS = [
    "Kota Sabang Sumatera Utara", "Kota Subulussalam Darussalam",
    "Kabupaten Samosir Bedagai", "Kabupaten Serdang Bedagai Bedagai",
    "Kabupaten Lima Puluh", "Kabupaten Penukal Abab Lematang",
    "Kota Depok Kotamadya Daerah", "Kabupaten Pasuruan Kecamatan Bangil",
    "Kota Cilegon Kotamadya Daerah", "Kabupaten Tanah Bumbu Balangan",
    "Kabupaten Balangan Balangan", "Kabupaten Kutai Barat Kutai",
    "Kabupaten Kutai Timur Kutai", "Kota Bontang Kutai", "Kabupaten Malinau Kutai",
    "Kabupaten Nunukan Kutai", "Kabupaten Minahasa Selatan Tomohon",
    "Kabupaten Kepulauan Siau Tagulandang", "Kota Tomohon Tomohon",
    "Kabupaten Pangkajene", "Kabupaten Luwu Timur Utara",
    "Kabupaten Bone Bolango Pohuwato", "Kabupaten Pohuwato Pohuwato",
    "Kabupaten Pasangkayu Utara", "Kabupaten Kepulauan Aru Seram",
    "Kabupaten Halmahera Barat Halmahera", "Kabupaten Halmahera Utara Halmahera",
    "Kabupaten Halmahera Selatan Halmahera", "Kabupaten Kepulauan Sula Halmahera",
    "Kabupaten Halmahera Timur Halmahera", "Kota Tidore Kepulauan Halmahera",
    "Kabupaten Nabire Paniai",
]


def read_rows(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


class FindArtifactsTest(unittest.TestCase):
    def test_flags_pdf_artifacts(self):
        for name in ["A u r", "S a d u", "Kedungpomahanwet an", "Losung Batu.", "Teuw*", " Aur", "Aur  Baru"]:
            with self.subTest(name=name):
                self.assertTrue(find_artifacts(name))

    def test_keeps_genuine_names(self):
        for name in ["Aur", "Pasi ie Leubeue", "Baji pa'mai", "Murung A.", "Bedeng SS.", "Siantar Ca.", "19 Nopember", "Juli"]:
            with self.subTest(name=name):
                self.assertEqual(find_artifacts(name), [])


class DatasetTest(unittest.TestCase):
    def test_every_correction_is_applied(self):
        corrections = load_corrections()
        self.assertTrue(corrections)
        regions = read_rows(DATA_DIR / "regions_id.csv")
        for fix in corrections:
            filename, code_col, name_col = LEVEL_FILES[fix["level"]]
            names = {r[code_col]: r[name_col] for r in read_rows(DATA_DIR / filename)}
            with self.subTest(level=fix["level"], code=fix["code"]):
                self.assertEqual(names[fix["code"]], fix["new_name"])
                code_col, name_col = REGIONS_ID_COLUMNS[fix["level"]]
                seen = {r[name_col] for r in regions if r[code_col] == fix["code"]}
                self.assertEqual(seen, {fix["new_name"]})

    def test_no_unreviewed_artifacts(self):
        found = [(level, code, name) for level, code, name, _ in artifact_report()
                 if (level, code) not in UNVERIFIED_NAMES]
        self.assertEqual(found, [])

    def test_regency_names_from_v1_0_1_are_gone(self):
        names = {r["name"] for r in read_rows(DATA_DIR / "regencies.csv")}
        names |= {r["regency_name"] for r in read_rows(DATA_DIR / "regions_id.csv")}
        self.assertEqual(sorted(names & set(V1_0_1_REGENCY_ERRORS)), [])


class ApplyCorrectionsTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir)
        files = {
            "provinces.csv": "code,name,capital\r\n12,Sumatera Utara,Medan\r\n",
            "regencies.csv": "code,province_code,name,capital,type,is_administrative\r\n1271,12,Kota Medan,Medan,city,False\r\n",
            "districts.csv": "code,regency_code,name\r\n127115,1271,Medan Maimun\r\n",
            "villages.csv": "code,district_code,name,type\r\n1271151001,127115,A u r,urban_village\r\n1271151002,127115,\"Sei Mati, Baru\",urban_village\r\n",
            "regions_id.csv": (
                "province_code,province_name,province_capital,regency_code,regency_name,regency_type,"
                "regency_capital,district_code,district_name,village_code,village_name,village_type\r\n"
                "12,Sumatera Utara,Medan,1271,Kota Medan,city,Medan,127115,Medan Maimun,1271151001,A u r,urban_village\r\n"
            ),
        }
        for name, text in files.items():
            (self.dir / name).write_bytes(text.encode("utf-8"))
        self.fix = [{"level": "village", "code": "1271151001", "old_name": "A u r", "new_name": "Aur"}]

    def test_applies_once_and_keeps_bytes_otherwise(self):
        result = apply_corrections(self.dir, self.fix)
        self.assertEqual(result, {"villages.csv": 1, "regions_id.csv": 1})
        raw = (self.dir / "villages.csv").read_bytes()
        self.assertIn(b"1271151001,127115,Aur,urban_village\r\n", raw)
        self.assertIn(b'"Sei Mati, Baru"', raw)
        self.assertEqual(apply_corrections(self.dir, self.fix), {"villages.csv": 0, "regions_id.csv": 0})

    def test_stops_when_upstream_name_changed(self):
        fix = [{**self.fix[0], "old_name": "A U R"}]
        before = (self.dir / "villages.csv").read_bytes()
        with self.assertRaises(CorrectionMismatch):
            apply_corrections(self.dir, fix)
        self.assertEqual((self.dir / "villages.csv").read_bytes(), before)

    def test_stops_when_code_is_missing(self):
        fix = [{**self.fix[0], "code": "1271159999"}]
        with self.assertRaises(CorrectionMismatch):
            apply_corrections(self.dir, fix)


if __name__ == "__main__":
    unittest.main()
