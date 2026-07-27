"""Dataset-facing behavior independent from FastMCP and PostGIS."""

from __future__ import annotations

from typing import Any

from .errors import FeatureNotFoundError, InvalidArgumentError
from .repository import SpatialRepository


VALID_CODE_LENGTHS = {2, 4, 6, 10}
VALID_LEVELS = ("provinsi", "kabupaten", "kecamatan", "desa")
DEMOGRAPHIC_FIELDS = (
    "jumlah_penduduk",
    "jumlah_kk",
    "kepadatan",
    "luas_wilayah",
    "area_km2",
    "jumlah_kab",
    "jumlah_kota",
    "jumlah_kec",
    "jumlah_desa",
    "jumlah_kel",
)


class WilayahSpatialService:
    """Validation and response shaping for the five legacy MCP tools."""

    def __init__(self, repository: SpatialRepository) -> None:
        self.repository = repository

    def search_regions(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        normalized = query.strip()
        if len(normalized) < 2:
            raise InvalidArgumentError(
                "Search query must be at least 2 characters long."
            )
        safe_limit = min(max(int(limit), 1), 100)
        return self.repository.search_regions(normalized, safe_limit)

    def get_region_details(self, code: str) -> dict[str, Any]:
        normalized = self._validate_code(code)
        result = self.repository.get_region_details(normalized)
        if result is None:
            labels = {
                2: "Province",
                4: "District",
                6: "Subdistrict",
                10: "Village",
            }
            raise FeatureNotFoundError(
                f"{labels[len(normalized)]} with code {normalized} not found."
            )
        return result

    def reverse_geocode(self, lat: float, lng: float) -> dict[str, Any]:
        if not (-11.0 <= lat <= 6.0):
            raise InvalidArgumentError(
                f"Latitude {lat} is outside Indonesia bounds (-11 to 6)."
            )
        if not (95.0 <= lng <= 141.0):
            raise InvalidArgumentError(
                f"Longitude {lng} is outside Indonesia bounds (95 to 141)."
            )

        row = self.repository.reverse_geocode(lat, lng)
        if row is None or not row.get("kode_prov"):
            return {
                "result": "No land boundary found",
                "notes": (
                    "Coordinates are within Indonesia bounds but likely over "
                    "water or border areas."
                ),
            }

        return {
            "coordinate": {"lat": lat, "lng": lng},
            "provinsi": {
                "kode": row.get("kode_prov"),
                "nama": row.get("nama_provinsi"),
            },
            "kabupaten": {
                "kode": row.get("kode_kab"),
                "nama": row.get("nama_kabupaten"),
                "tipe": row.get("tipe_kab"),
            },
            "kecamatan": {
                "kode": row.get("kode_kec"),
                "nama": row.get("nama_kecamatan"),
            },
            "desa": {
                "kode": row.get("kode_desa"),
                "nama": row.get("nama_desa"),
                "tipe": row.get("tipe_desa"),
                "kode_pos": row.get("kode_pos"),
            },
        }

    def get_top_populated_regions(
        self, level: str = "provinsi", limit: int = 10, order: str = "desc"
    ) -> list[dict[str, Any]]:
        normalized_level = level.lower()
        if normalized_level not in VALID_LEVELS:
            raise InvalidArgumentError(
                f"Invalid level. Must be one of: {', '.join(VALID_LEVELS)}"
            )
        safe_limit = min(max(int(limit), 1), 50)
        descending = order.lower() == "desc"
        return self.repository.get_top_populated_regions(
            normalized_level, safe_limit, descending
        )

    def get_demographic_summary(self, code: str) -> dict[str, Any]:
        normalized = self._validate_code(code)
        details = self.get_region_details(normalized)
        name_fields = {
            2: "nama_provinsi",
            4: "nama_kabupaten",
            6: "nama_kecamatan",
            10: "nama_desa",
        }
        summary: dict[str, Any] = {
            "kode": normalized,
            "nama": details.get(name_fields[len(normalized)]),
        }
        for field in DEMOGRAPHIC_FIELDS:
            if field in details:
                summary[field] = details[field]
        return summary

    @staticmethod
    def _validate_code(code: str) -> str:
        if not code or not code.isdigit():
            raise InvalidArgumentError("Invalid administrative code format.")
        if len(code) not in VALID_CODE_LENGTHS:
            raise InvalidArgumentError(
                "Invalid code length. Expected 2, 4, 6, or 10 digits."
            )
        return code
