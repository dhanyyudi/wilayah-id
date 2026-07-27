from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from wilayah_mcp.artifacts import ArtifactStore
from wilayah_mcp.errors import (
    InvalidArgumentError,
    QueryLimitExceededError,
    UnsupportedOperationError,
)
from wilayah_mcp.generic_service import SpatialInteroperabilityService
from wilayah_mcp.models import AreaOfInterest, FeatureRef


class FakeGenericRepository:
    dataset_id = "wilayah-id"
    layer_ids = ("province", "regency", "district", "village")

    def __init__(self) -> None:
        self.calls: list[tuple[Any, ...]] = []
        self.entity: dict[str, Any] | None = {
            "dataset_id": "wilayah-id",
            "layer": "province",
            "feature_id": "31",
            "name": "DKI JAKARTA",
            "feature_type": None,
            "properties": {
                "kode_prov": "31",
                "nama_provinsi": "DKI JAKARTA",
                "jumlah_penduduk": 1,
            },
            "hierarchy": [],
            "child_count": 6,
            "bbox": [106, -7, 107, -5],
            "representative_point": {
                "type": "Point",
                "coordinates": [106.8, -6.2],
            },
            "geometry": None,
        }

    def get_layer_attributes(self, layer: str) -> tuple[str, ...]:
        return {
            "province": (
                "kode_prov",
                "nama_provinsi",
                "jumlah_penduduk",
            ),
            "regency": ("kode_kab", "nama_kabupaten"),
            "district": ("kode_kec", "nama_kecamatan"),
            "village": ("kode_desa", "nama_desa"),
        }[layer]

    def describe_spatial_service(self) -> dict[str, Any]:
        return {
            "interface_version": "1.0.0",
            "layers": [{"layer": "province"}],
            "warnings": ["snapshot warning"],
        }

    def resolve_spatial_entities(self, query: str, **kwargs: Any):
        self.calls.append(("resolve", query, kwargs))
        return [
            {
                "dataset_id": "wilayah-id",
                "layer": "regency",
                "feature_id": "3273",
                "name": "KOTA BANDUNG",
                "feature_type": "KOTA",
                "parent_layer": "province",
                "parent_feature_id": "32",
                "parent_name": "JAWA BARAT",
                "match_score": 0.95,
                "match_reason": "exact_name",
            },
            {
                "dataset_id": "wilayah-id",
                "layer": "regency",
                "feature_id": "3373",
                "name": "KOTA BANDUNG",
                "match_score": 0.95,
                "match_reason": "exact_name",
            },
        ]

    def get_spatial_entity(self, feature_ref: FeatureRef, **kwargs: Any):
        self.calls.append(("get", feature_ref, kwargs))
        return self.entity

    def locate_coordinates(self, latitude: float, longitude: float, **kwargs: Any):
        return [
            {
                "dataset_id": "wilayah-id",
                "layer": "province",
                "feature_id": "31",
                "name": "DKI JAKARTA",
                "on_boundary": True,
            }
        ]

    def relate_spatial_entities(self, *args: Any, **kwargs: Any):
        return {
            "contains": False,
            "within": False,
            "touches": True,
            "intersects": True,
            "overlaps": False,
            "disjoint": False,
            "distance_m": 12.5,
            "bearing_degrees": 90.0,
            "de9im": "FF2F11212",
            "subject_valid": True,
            "object_valid": True,
            "within_tolerance": True,
        }

    def find_related_spatial_entities(self, reference_ref: FeatureRef, **kwargs: Any):
        self.calls.append(("find", reference_ref, kwargs))
        return [
            {
                "dataset_id": "wilayah-id",
                "layer": kwargs["target_layer"],
                "feature_id": "3171",
                "name": "KOTA JAKARTA SELATAN",
            }
        ]

    def extract_spatial_subset(self, **kwargs: Any):
        self.calls.append(("subset", kwargs))
        return {
            "feature_collection": {
                "type": "FeatureCollection",
                "numberMatched": 1,
                "numberReturned": 1,
                "features": [
                    {
                        "type": "Feature",
                        "id": "31",
                        "properties": {"nama_provinsi": "DKI JAKARTA"},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [
                                [[106, -7], [107, -7], [107, -6], [106, -7]]
                            ],
                        },
                    }
                ],
            },
            "number_matched": 1,
            "number_returned": 1,
            "warnings": [],
        }

    def close(self) -> None:
        pass


class SpatialInteroperabilityServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.repository = FakeGenericRepository()
        self.store = ArtifactStore(
            self.temp_dir.name,
            ttl_seconds=60,
            public_base_url="https://example.test",
        )
        self.service = SpatialInteroperabilityService(
            self.repository,
            self.store,
        )

    def test_describe_separates_warnings_from_data(self) -> None:
        result = self.service.describe_spatial_service()
        self.assertEqual(result.data["interface_version"], "1.0.0")
        self.assertNotIn("warnings", result.data)
        self.assertEqual(result.warnings, ["snapshot warning"])

    def test_resolve_reports_equally_ranked_ambiguity(self) -> None:
        result = self.service.resolve_spatial_entity("Bandung")
        self.assertTrue(result.data["ambiguous"])
        self.assertEqual(
            result.data["candidates"][0]["feature_ref"]["feature_id"],
            "3273",
        )

    def test_get_filters_attributes_and_warns_for_omitted_geometry(self) -> None:
        result = self.service.get_spatial_entity(
            FeatureRef(
                dataset_id="wilayah-id",
                layer="province",
                feature_id="31",
            ),
            include_geometry=True,
            attributes=["nama_provinsi"],
        )
        self.assertEqual(
            result.data["properties"],
            {"nama_provinsi": "DKI JAKARTA"},
        )
        self.assertTrue(result.warnings)

    def test_get_rejects_unknown_attribute(self) -> None:
        with self.assertRaisesRegex(InvalidArgumentError, "unknown attributes"):
            self.service.get_spatial_entity(
                FeatureRef(
                    dataset_id="wilayah-id",
                    layer="province",
                    feature_id="31",
                ),
                attributes=["password"],
            )

    def test_locate_reports_boundary_policy_and_warning(self) -> None:
        result = self.service.locate_coordinates(
            -6.2,
            106.8,
            layers=["province"],
            boundary_policy="covers",
        )
        self.assertEqual(result.data["boundary_policy"], "covers")
        self.assertTrue(result.data["matches"][0]["on_boundary"])
        self.assertTrue(result.warnings)

    def test_relate_shapes_distance_and_direction(self) -> None:
        subject = FeatureRef(
            dataset_id="wilayah-id",
            layer="province",
            feature_id="31",
        )
        object_ref = FeatureRef(
            dataset_id="wilayah-id",
            layer="province",
            feature_id="32",
        )
        result = self.service.relate_spatial_entities(
            subject,
            object_ref,
            relations=["touches", "distance", "direction"],
        )
        self.assertTrue(result.data["relations"]["touches"])
        self.assertEqual(result.data["relations"]["direction"]["cardinal"], "E")
        self.assertEqual(
            result.data["relations"]["distance"]["meters"],
            12.5,
        )

    def test_find_children_chooses_immediate_child_layer(self) -> None:
        reference = FeatureRef(
            dataset_id="wilayah-id",
            layer="province",
            feature_id="31",
        )
        result = self.service.find_related_spatial_entities(
            reference,
            relation="children",
        )
        self.assertEqual(result.data["target_layer"], "regency")
        self.assertEqual(
            self.repository.calls[-1][2]["target_layer"],
            "regency",
        )

    def test_parent_of_root_layer_is_rejected(self) -> None:
        reference = FeatureRef(
            dataset_id="wilayah-id",
            layer="province",
            feature_id="31",
        )
        with self.assertRaises(UnsupportedOperationError):
            self.service.find_related_spatial_entities(
                reference,
                relation="parent",
            )

    def test_subset_creates_downloadable_geojson_with_checksum(self) -> None:
        result = self.service.extract_spatial_subset(
            layer="province",
            aoi=AreaOfInterest(bbox=(106, -7, 107, -6)),
            attributes=["nama_provinsi"],
            output_format="geojson",
            limit=10,
        )
        artifact = result.data["artifact"]
        path = self.store.resolve(
            artifact["artifact_id"],
            artifact["filename"],
        )
        self.assertIsNotNone(path)
        payload = json.loads(Path(path).read_text())
        self.assertEqual(payload["type"], "FeatureCollection")
        self.assertEqual(len(artifact["sha256"]), 64)
        self.assertTrue(artifact["download_url"].startswith("https://example.test"))

    def test_subset_rejects_unknown_attribute_before_repository_call(self) -> None:
        with self.assertRaisesRegex(InvalidArgumentError, "unknown attributes"):
            self.service.extract_spatial_subset(
                layer="province",
                aoi=AreaOfInterest(bbox=(106, -7, 107, -6)),
                attributes=["secret"],
            )
        self.assertFalse(
            any(call[0] == "subset" for call in self.repository.calls)
        )

    def test_artifact_store_rejects_path_traversal_and_expired_files(self) -> None:
        result = self.service.extract_spatial_subset(
            layer="province",
            aoi=AreaOfInterest(bbox=(106, -7, 107, -6)),
        )
        artifact = result.data["artifact"]
        self.assertIsNone(
            self.store.resolve(
                artifact["artifact_id"],
                "../province-subset.geojson",
            )
        )
        artifact_dir = Path(self.temp_dir.name) / artifact["artifact_id"]
        os.utime(artifact_dir, (0, 0))
        self.assertIsNone(
            self.store.resolve(
                artifact["artifact_id"],
                artifact["filename"],
            )
        )
        self.assertFalse(artifact_dir.exists())

    def test_artifact_store_rejects_output_above_byte_limit(self) -> None:
        store = ArtifactStore(
            Path(self.temp_dir.name) / "bounded",
            ttl_seconds=60,
            max_bytes=32,
        )
        with self.assertRaises(QueryLimitExceededError):
            store.create(
                layer="province",
                feature_collection={
                    "type": "FeatureCollection",
                    "features": [],
                },
                output_format="geojson",
                target_crs="EPSG:4326",
            )
        self.assertEqual(list(store.root.iterdir()), [])

    def test_subset_rejects_geojson_aoi_above_byte_limit(self) -> None:
        self.service.max_aoi_bytes = 16
        with self.assertRaises(QueryLimitExceededError):
            self.service.extract_spatial_subset(
                layer="province",
                aoi=AreaOfInterest(
                    geojson={
                        "type": "Polygon",
                        "coordinates": [
                            [[106, -7], [107, -7], [107, -6], [106, -7]]
                        ],
                    }
                ),
            )
        self.assertFalse(
            any(call[0] == "subset" for call in self.repository.calls)
        )

    @unittest.skipUnless(shutil.which("ogr2ogr"), "ogr2ogr is not installed")
    def test_subset_creates_valid_geopackage_in_requested_crs(self) -> None:
        result = self.service.extract_spatial_subset(
            layer="province",
            aoi=AreaOfInterest(bbox=(106, -7, 107, -6)),
            attributes=["nama_provinsi"],
            target_crs="EPSG:32748",
            output_format="geopackage",
            limit=10,
        )
        artifact = result.data["artifact"]
        path = self.store.resolve(
            artifact["artifact_id"],
            artifact["filename"],
        )
        self.assertIsNotNone(path)
        artifact_path = Path(path)
        self.assertEqual(artifact_path.read_bytes()[:16], b"SQLite format 3\x00")
        inspection = subprocess.run(
            ["ogrinfo", "-ro", "-so", "-al", str(artifact_path)],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertIn("32748", inspection.stdout)


if __name__ == "__main__":
    unittest.main()
