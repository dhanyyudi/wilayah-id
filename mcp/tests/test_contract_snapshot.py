from __future__ import annotations

import json
from pathlib import Path
import re
import unittest


MCP_ROOT = Path(__file__).resolve().parents[1]


class LegacyContractSnapshotTests(unittest.TestCase):
    def test_snapshot_matches_decorated_tools(self) -> None:
        snapshot = json.loads(
            (MCP_ROOT / "tests/baseline/current_tool_contracts.json").read_text()
        )
        expected = [tool["name"] for tool in snapshot["tools"]]
        source = (MCP_ROOT / "server.py").read_text()
        actual = re.findall(r"@mcp\.tool\(\)\ndef ([a-z_]+)\(", source)
        self.assertEqual(actual, expected)

    def test_reverse_predicate_is_frozen_for_phase_one(self) -> None:
        source = (MCP_ROOT / "wilayah_mcp/postgis.py").read_text()
        self.assertIn("ST_Intersects(pt.geom, d.geom)", source)

    def test_data_snapshot_records_version_mismatch_explicitly(self) -> None:
        snapshot = json.loads(
            (MCP_ROOT / "tests/baseline/data_snapshot.json").read_text()
        )
        roles = {component["role"] for component in snapshot["components"]}
        self.assertEqual(
            roles,
            {"administrative_geometry", "region_codes", "postal_codes"},
        )
        self.assertEqual(
            snapshot["ground_truth_status"],
            "requires_geometry_code_version_reconciliation",
        )


if __name__ == "__main__":
    unittest.main()
