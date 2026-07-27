from __future__ import annotations

from typing import Any
import unittest

from wilayah_mcp.errors import (
    FeatureNotFoundError,
    InvalidArgumentError,
    RepositoryError,
)
from wilayah_mcp.service import WilayahSpatialService


class FakeRepository:
    def __init__(self) -> None:
        self.calls: list[tuple[Any, ...]] = []
        self.details: dict[str, dict[str, Any]] = {
            "31": {
                "kode_prov": "31",
                "nama_provinsi": "DKI JAKARTA",
                "jumlah_penduduk": 1,
                "jumlah_kk": 2,
                "ignored": "not demographic",
            }
        }
        self.reverse_result: dict[str, Any] | None = None

    def search_regions(self, query: str, limit: int) -> list[dict[str, Any]]:
        self.calls.append(("search", query, limit))
        return [{"kode": "31", "nama": query}]

    def get_region_details(self, code: str) -> dict[str, Any] | None:
        self.calls.append(("details", code))
        return self.details.get(code)

    def reverse_geocode(self, lat: float, lng: float) -> dict[str, Any] | None:
        self.calls.append(("reverse", lat, lng))
        return self.reverse_result

    def get_top_populated_regions(
        self, level: str, limit: int, descending: bool
    ) -> list[dict[str, Any]]:
        self.calls.append(("top", level, limit, descending))
        return [{"kode": "31"}]

    def close(self) -> None:
        pass


class WilayahSpatialServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repository = FakeRepository()
        self.service = WilayahSpatialService(self.repository)

    def test_search_validates_before_repository_call(self) -> None:
        with self.assertRaisesRegex(InvalidArgumentError, "at least 2"):
            self.service.search_regions(" ")
        self.assertEqual(self.repository.calls, [])

    def test_search_normalizes_query_and_clamps_limit(self) -> None:
        result = self.service.search_regions(" Jakarta ", 500)
        self.assertEqual(result[0]["nama"], "Jakarta")
        self.assertEqual(self.repository.calls[-1], ("search", "Jakarta", 100))

    def test_code_requires_supported_numeric_length(self) -> None:
        for code in ("3x", "123", "12345678"):
            with self.subTest(code=code), self.assertRaises(InvalidArgumentError):
                self.service.get_region_details(code)

    def test_missing_region_has_level_specific_message(self) -> None:
        with self.assertRaisesRegex(
            FeatureNotFoundError, "District with code 9999 not found"
        ):
            self.service.get_region_details("9999")

    def test_reverse_bounds_are_checked_before_repository_call(self) -> None:
        with self.assertRaisesRegex(InvalidArgumentError, "Latitude"):
            self.service.reverse_geocode(-12, 110)
        with self.assertRaisesRegex(InvalidArgumentError, "Longitude"):
            self.service.reverse_geocode(-6, 150)
        self.assertEqual(self.repository.calls, [])

    def test_reverse_empty_result_preserves_legacy_shape(self) -> None:
        result = self.service.reverse_geocode(-6.2, 106.8)
        self.assertEqual(result["result"], "No land boundary found")
        self.assertNotIn("coordinate", result)

    def test_reverse_result_preserves_legacy_shape(self) -> None:
        self.repository.reverse_result = {
            "kode_prov": "31",
            "nama_provinsi": "DKI JAKARTA",
            "kode_kab": "3173",
            "nama_kabupaten": "KOTA JAKARTA BARAT",
            "tipe_kab": "KOTA",
            "kode_kec": "317301",
            "nama_kecamatan": "CENGKARENG",
            "kode_desa": "3173011001",
            "nama_desa": "CENGKARENG BARAT",
            "tipe_desa": "KELURAHAN",
            "kode_pos": "11730",
        }
        result = self.service.reverse_geocode(-6.2, 106.8)
        self.assertEqual(result["provinsi"]["kode"], "31")
        self.assertEqual(result["desa"]["kode_pos"], "11730")

    def test_top_population_normalizes_and_clamps(self) -> None:
        self.service.get_top_populated_regions("DESA", 0, "anything")
        self.assertEqual(self.repository.calls[-1], ("top", "desa", 1, False))

    def test_demographic_summary_selects_only_supported_fields(self) -> None:
        result = self.service.get_demographic_summary("31")
        self.assertEqual(
            result,
            {
                "kode": "31",
                "nama": "DKI JAKARTA",
                "jumlah_penduduk": 1,
                "jumlah_kk": 2,
            },
        )

    def test_repository_error_never_exposes_internal_detail(self) -> None:
        error = RepositoryError("password authentication failed for db.internal")
        self.assertNotIn("password", error.public_message)
        self.assertEqual(
            error.public_message,
            "The spatial data service is temporarily unavailable.",
        )


if __name__ == "__main__":
    unittest.main()
