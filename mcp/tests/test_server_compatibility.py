from __future__ import annotations

import unittest
from unittest.mock import patch

import server
from wilayah_mcp.errors import RepositoryError
from wilayah_mcp.models import SpatialResult


class FastMCPCompatibilityTests(unittest.TestCase):
    def test_import_does_not_open_database_pool(self) -> None:
        self.assertIsNone(server._repository._pool)

    def test_legacy_list_error_shape_is_preserved(self) -> None:
        self.assertEqual(
            server.search_regions("a"),
            [{"error": "Search query must be at least 2 characters long."}],
        )

    def test_internal_repository_detail_is_sanitized(self) -> None:
        with patch.object(
            server._service,
            "get_region_details",
            side_effect=RepositoryError(
                "password authentication failed for db.internal"
            ),
        ):
            result = server.get_region_details("31")
        self.assertEqual(
            result,
            {"error": "The spatial data service is temporarily unavailable."},
        )
        self.assertNotIn("password", result["error"])

    def test_generic_error_uses_machine_readable_envelope(self) -> None:
        result = server.resolve_spatial_entity("x")
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error"]["code"], "INVALID_ARGUMENT")
        self.assertIn("trace_id", result["meta"])

    def test_generic_success_uses_versioned_provenance_envelope(self) -> None:
        with patch.object(
            server._spatial_service,
            "describe_spatial_service",
            return_value=SpatialResult(
                data={"interface_version": "1.0.0"},
                operation="describe_spatial_service",
            ),
        ):
            result = server.describe_spatial_service()
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["data"]["interface_version"], "1.0.0")
        self.assertEqual(result["meta"]["tool_version"], "1.0.0")
        self.assertEqual(result["meta"]["dataset_id"], "wilayah-id")
        self.assertEqual(result["meta"]["crs"], "EPSG:4326")
        self.assertIn("trace_id", result["meta"])
        self.assertGreaterEqual(result["meta"]["latency_ms"], 0)


if __name__ == "__main__":
    unittest.main()
