from __future__ import annotations

import re
import unittest
from pathlib import Path

from wilayah_mcp.generic_service import PROVENANCE
from wilayah_mcp.models import ResponseMeta, SpatialResult
from wilayah_mcp.postgis import LAYER_SPECS
from wilayah_mcp.provenance import DATA_SOURCES, DATASET_SNAPSHOT

MCP_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = MCP_ROOT.parent


class ProvenanceTests(unittest.TestCase):
    def test_snapshot_names_big_geometry_edition(self) -> None:
        self.assertEqual(
            DATASET_SNAPSHOT,
            "big-2026-06-12+kepmendagri-2025+dukcapil-2024-s1",
        )
        self.assertEqual(
            ResponseMeta(operation="x", trace_id="t", latency_ms=0).snapshot,
            DATASET_SNAPSHOT,
        )
        self.assertEqual(
            SpatialResult(data=None, operation="x").snapshot,
            DATASET_SNAPSHOT,
        )

    def test_geometry_source_is_big(self) -> None:
        geometry = [s for s in DATA_SOURCES if s["role"] == "geometry"]
        self.assertEqual(len(geometry), 1)
        self.assertIn("Badan Informasi Geospasial", geometry[0]["name"])
        self.assertEqual(geometry[0]["snapshot"], "2026-06-12")
        self.assertEqual(
            [(r.source, r.snapshot) for r in PROVENANCE],
            [(s["name"], s["snapshot"]) for s in DATA_SOURCES],
        )

    def test_village_layer_exposes_boundary_status(self) -> None:
        attributes = LAYER_SPECS["village"].attributes
        self.assertIn("status_batas", attributes)
        self.assertIn("edisi_geometri", attributes)

    def test_no_hardcoded_dukcapil_geometry_snapshot(self) -> None:
        for path in ("server.py", "wilayah_mcp/postgis.py",
                     "wilayah_mcp/models.py", "wilayah_mcp/generic_service.py"):
            source = (MCP_ROOT / path).read_text()
            self.assertNotIn("dukcapil-2024-s1+kepmendagri-2025", source, path)
            self.assertNotIn("Dukcapil Kemendagri administrative boundaries",
                             source, path)

    def test_web_module_uses_the_same_snapshot(self) -> None:
        web = REPO_ROOT / "src/lib/provenance.ts"
        if not web.exists():
            self.skipTest("web source not present in this checkout")
        match = re.search(
            r'DATASET_SNAPSHOT =\s*"([^"]+)"', web.read_text()
        )
        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), DATASET_SNAPSHOT)


if __name__ == "__main__":
    unittest.main()
