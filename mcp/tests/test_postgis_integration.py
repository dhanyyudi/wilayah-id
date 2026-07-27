from __future__ import annotations

import os
import unittest

from wilayah_mcp.models import FeatureRef
from wilayah_mcp.postgis import PostgisSpatialRepository

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


@unittest.skipUnless(TEST_DATABASE_URL, "TEST_DATABASE_URL is not configured")
class PostgisSpatialRepositoryIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repository = PostgisSpatialRepository(
            TEST_DATABASE_URL,
            min_connections=1,
            max_connections=2,
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls.repository.close()

    def test_discovery_and_resolution(self) -> None:
        description = self.repository.describe_spatial_service()
        counts = {
            layer["layer"]: layer["feature_count"]
            for layer in description["layers"]
        }
        self.assertEqual(counts["province"], 3)
        candidates = self.repository.resolve_spatial_entities(
            "ALPHA",
            layer="province",
            parent_ref=None,
            limit=5,
        )
        self.assertEqual(candidates[0]["feature_id"], "10")
        self.assertEqual(candidates[0]["match_reason"], "exact_name")
        ambiguous = self.repository.resolve_spatial_entities(
            "ALPHA EAST",
            layer="regency",
            parent_ref=None,
            limit=5,
        )
        self.assertEqual(len(ambiguous), 2)
        scoped = self.repository.resolve_spatial_entities(
            "ALPHA EAST",
            layer="regency",
            parent_ref=FeatureRef(
                dataset_id="wilayah-id",
                layer="province",
                feature_id="20",
            ),
            limit=5,
        )
        self.assertEqual([row["feature_id"] for row in scoped], ["2001"])

    def test_entity_includes_canonical_hierarchy(self) -> None:
        row = self.repository.get_spatial_entity(
            FeatureRef(
                dataset_id="wilayah-id",
                layer="village",
                feature_id="1001010001",
            ),
            include_geometry=False,
            max_geometry_points=100,
        )
        self.assertIsNotNone(row)
        self.assertEqual(
            [item["feature_ref"]["layer"] for item in row["hierarchy"]],
            ["province", "regency", "district"],
        )
        self.assertEqual(row["parent_feature_id"], "100101")

    def test_boundary_location_distinguishes_covers(self) -> None:
        covers = self.repository.locate_coordinates(
            1,
            1,
            layers=["village"],
            boundary_policy="covers",
        )
        strict = self.repository.locate_coordinates(
            1,
            1,
            layers=["village"],
            boundary_policy="strict_contains",
        )
        self.assertEqual(len(covers), 2)
        self.assertEqual(strict, [])
        self.assertTrue(all(row["on_boundary"] for row in covers))

    def test_topology_distance_and_neighbors(self) -> None:
        alpha = FeatureRef(
            dataset_id="wilayah-id",
            layer="province",
            feature_id="10",
        )
        beta = FeatureRef(
            dataset_id="wilayah-id",
            layer="province",
            feature_id="20",
        )
        relation = self.repository.relate_spatial_entities(
            alpha,
            beta,
            distance_mode="boundary",
            tolerance_m=1,
        )
        self.assertTrue(relation["touches"])
        self.assertEqual(relation["distance_m"], 0)
        neighbors = self.repository.find_related_spatial_entities(
            alpha,
            relation="neighbors",
            target_layer="province",
            max_distance_m=None,
            tolerance_m=0,
            limit=5,
        )
        self.assertEqual([row["feature_id"] for row in neighbors], ["20"])

    def test_invalid_geometry_is_repaired_and_reported(self) -> None:
        relation = self.repository.relate_spatial_entities(
            FeatureRef(
                dataset_id="wilayah-id",
                layer="province",
                feature_id="10",
            ),
            FeatureRef(
                dataset_id="wilayah-id",
                layer="province",
                feature_id="30",
            ),
            distance_mode="boundary",
            tolerance_m=0,
        )
        self.assertIsNotNone(relation)
        self.assertFalse(relation["object_valid"])
        self.assertTrue(relation["disjoint"])

    def test_hierarchy_and_subset(self) -> None:
        children = self.repository.find_related_spatial_entities(
            FeatureRef(
                dataset_id="wilayah-id",
                layer="province",
                feature_id="10",
            ),
            relation="children",
            target_layer="regency",
            max_distance_m=None,
            tolerance_m=0,
            limit=10,
        )
        self.assertEqual(len(children), 2)
        subset = self.repository.extract_spatial_subset(
            layer="village",
            aoi={
                "kind": "bbox",
                "bbox": [0, 0, 1, 1],
                "buffer_m": 0,
            },
            predicate="intersects",
            clip=True,
            attributes=["kode_desa", "nama_desa"],
            limit=10,
        )
        self.assertEqual(subset["number_matched"], 2)
        self.assertEqual(subset["number_returned"], 1)
        self.assertFalse(subset["truncated"])
        self.assertIn("clipping produced no polygonal area", subset["warnings"][0])
        self.assertEqual(
            subset["feature_collection"]["features"][0]["type"],
            "Feature",
        )


if __name__ == "__main__":
    unittest.main()
