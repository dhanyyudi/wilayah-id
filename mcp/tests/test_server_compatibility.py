from __future__ import annotations

import unittest
from unittest.mock import patch

import server
from wilayah_mcp.errors import RepositoryError


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


if __name__ == "__main__":
    unittest.main()
