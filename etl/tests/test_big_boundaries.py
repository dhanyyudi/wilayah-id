import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from big_boundaries import (  # noqa: E402
    big_display_name,
    desa_type,
    dominant,
    edition_from_metadata,
    hierarchy_report,
    kabupaten_type,
    normalize_code,
    pick_name,
)

try:
    import numpy as np
    import shapely
    from shapely import wkt

    HAS_COVERAGE = hasattr(shapely, "coverage_simplify") and shapely.geos_version >= (3, 12, 0)
except ImportError:  # Data CI's plain job runs without geometry libraries
    HAS_COVERAGE = False


class AttributeRules(unittest.TestCase):
    def test_codes_lose_dots_and_must_have_the_level_length(self):
        self.assertEqual(normalize_code("32.71.03.1008", 10), "3271031008")
        self.assertEqual(normalize_code("11.05", 4), "1105")
        self.assertIsNone(normalize_code("73.--.--", 6))
        self.assertIsNone(normalize_code(" ", 4))
        self.assertIsNone(normalize_code(None, 4))
        self.assertIsNone(normalize_code(float("nan"), 6))
        self.assertIsNone(normalize_code("32.71.03", 10))

    def test_edition_comes_from_the_metadata_date(self):
        self.assertEqual(edition_from_metadata("TASWIL1000020260612DESAKEL_AR"), "2026-06-12")
        self.assertEqual(edition_from_metadata("TASWIL5000020221227KABKOTA"), "2022-12-27")
        self.assertIsNone(edition_from_metadata("something else"))
        self.assertIsNone(edition_from_metadata(None))

    def test_types_prefer_region_id_then_tipadm(self):
        self.assertEqual(kabupaten_type("city", "4"), "KOTA")
        self.assertEqual(kabupaten_type("regency", "5"), "KABUPATEN")
        self.assertEqual(kabupaten_type(None, "5"), "KOTA")
        self.assertEqual(kabupaten_type(None, "4"), "KABUPATEN")
        self.assertEqual(desa_type("urban_village", "1"), "KELURAHAN")
        self.assertEqual(desa_type(None, "2"), "KELURAHAN")
        self.assertEqual(desa_type(None, "1"), "DESA")

    def test_kepmendagri_name_wins_and_big_names_get_a_prefix(self):
        regionid = {"1307": {"name": "Kabupaten Lima Puluh Kota"}}
        self.assertEqual(pick_name("1307", regionid, "Lima Puluh Kota", "kabupaten", "KABUPATEN"),
                         ("Kabupaten Lima Puluh Kota", "kepmendagri-2025"))
        self.assertEqual(pick_name("9999", regionid, "Bontang", "kabupaten", "KOTA"),
                         ("Kota Bontang", "big"))
        self.assertEqual(big_display_name("Kota Bontang", "kabupaten", "KOTA"), "Kota Bontang")
        self.assertEqual(big_display_name("Air Kuning", "desa", "DESA"), "Air Kuning")

    def test_dominant_value_is_weighted_by_area(self):
        self.assertEqual(dominant(["a", "b", "a"], [1, 5, 1]), "b")
        self.assertEqual(dominant([None, "x"], [9, 1]), "x")
        self.assertIsNone(dominant([None], [1]))

    def test_hierarchy_report_lists_missing_parents(self):
        tables = {
            "provinsi": {"kode_prov": ["11"]},
            "kabupaten": {"kode_prov": ["11", "12"], "kode_kab": ["1101", "1201"]},
            "kecamatan": {"kode_kab": ["1101"], "kode_kec": ["110101"]},
            "desa": {"kode_kec": ["110101"]},
        }
        report = hierarchy_report(tables)
        self.assertEqual(report["kabupaten_without_parent"]["parent_codes"], ["12"])
        self.assertEqual(report["kecamatan_without_parent"]["count"], 0)
        self.assertEqual(report["desa_without_parent"]["count"], 0)


@unittest.skipUnless(HAS_COVERAGE, "needs Shapely 2.1+ on GEOS 3.12+ (etl/requirements-big.txt)")
class GeometrySteps(unittest.TestCase):
    def test_coverage_simplify_keeps_the_shared_edge_shared(self):
        from big_boundaries import simplify_coverage

        # Two squares share a wiggly edge; both must be simplified identically.
        left = wkt.loads("POLYGON((0 0, 1 0, 1.0001 0.25, 1 0.5, 1.0001 0.75, 1 1, 0 1, 0 0))")
        right = wkt.loads("POLYGON((1 0, 2 0, 2 1, 1 1, 1.0001 0.75, 1 0.5, 1.0001 0.25, 1 0))")
        out, method = simplify_coverage(np.array([left, right], dtype=object), 0.001)
        self.assertEqual(method, "coverage_simplify")
        self.assertTrue(all(shapely.is_valid(out)))
        overlap = shapely.area(shapely.intersection(out[0], out[1]))
        gap = 2.0 - shapely.area(shapely.union(out[0], out[1]))
        self.assertAlmostEqual(overlap, 0.0, places=9)
        self.assertAlmostEqual(gap, 0.0, places=6)

    def test_invalid_geometry_becomes_valid_multipolygon(self):
        from big_boundaries import polygonal

        bowtie = wkt.loads("POLYGON((0 0, 1 1, 1 0, 0 1, 0 0))")
        square = wkt.loads("POLYGON((2 0, 3 0, 3 1, 2 1, 2 0))")
        out, invalid = polygonal(np.array([bowtie, square], dtype=object))
        self.assertEqual(invalid, 1)
        self.assertTrue(all(g.geom_type == "MultiPolygon" and g.is_valid for g in out))
        self.assertAlmostEqual(out[0].area, 0.5)

    def test_features_with_the_same_code_are_dissolved(self):
        from big_boundaries import union_groups

        a = wkt.loads("POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))")
        b = wkt.loads("POLYGON((1 0, 2 0, 2 1, 1 1, 1 0))")
        c = wkt.loads("POLYGON((5 5, 6 5, 6 6, 5 6, 5 5))")
        merged = union_groups(["1101", "1101", "1102"], [a, b, c])
        self.assertEqual(merged["1101"].geom_type, "MultiPolygon")
        self.assertEqual(len(merged["1101"].geoms), 1)
        self.assertAlmostEqual(merged["1101"].area, 2.0)
        self.assertIs(merged["1102"], c)


@unittest.skipUnless(HAS_COVERAGE, "needs Shapely 2.1+ on GEOS 3.12+ (etl/requirements-big.txt)")
class OutputGrid(unittest.TestCase):
    def test_output_stays_valid_when_written_with_six_decimals(self):
        from big_boundaries import OUTPUT_GRID, snap_to_output_grid

        # The hole sits 3e-7 deg above the shell: valid as stored, but rounding
        # to 6 decimals puts it on the shell edge.
        polygon = wkt.loads(
            "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0),"
            " (0.2 0.0000003, 0.2 0.5, 0.8 0.5, 0.8 0.0000003, 0.2 0.0000003))"
        )
        self.assertTrue(polygon.is_valid)
        naive = shapely.set_precision(polygon, OUTPUT_GRID, mode="pointwise")
        self.assertFalse(naive.is_valid)

        snapped = snap_to_output_grid(polygon)
        self.assertEqual(snapped.geom_type, "MultiPolygon")
        self.assertTrue(snapped.is_valid)
        rounded = shapely.from_geojson(shapely.to_geojson(snapped, indent=None))
        self.assertTrue(shapely.set_precision(rounded, OUTPUT_GRID, mode="pointwise").is_valid)
        self.assertTrue(shapely.equals(shapely.set_precision(rounded, OUTPUT_GRID, mode="pointwise"), snapped))

    def test_collapsed_geometry_becomes_none(self):
        from big_boundaries import snap_to_output_grid

        sliver = wkt.loads("POLYGON((0 0, 0.0000002 0, 0.0000002 0.0000002, 0 0.0000002, 0 0))")
        self.assertIsNone(snap_to_output_grid(sliver))
        self.assertIsNone(snap_to_output_grid(None))


if __name__ == "__main__":
    unittest.main()
