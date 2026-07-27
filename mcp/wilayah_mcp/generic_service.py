"""Dataset-independent spatial behavior behind the MCP interface."""

from __future__ import annotations

import json
import math
import os
import re
from typing import Any

from .artifacts import ArtifactStore
from .errors import (
    DatasetNotFoundError,
    FeatureNotFoundError,
    InvalidArgumentError,
    LayerNotFoundError,
    QueryLimitExceededError,
    UnsupportedOperationError,
)
from .models import AreaOfInterest, FeatureRef, ProvenanceRecord, SpatialResult
from .repository import SpatialRepository

PROVENANCE = [
    ProvenanceRecord(
        source="Ditjen Dukcapil Kemendagri administrative boundaries",
        snapshot="2024-semester-1",
    ),
    ProvenanceRecord(
        source="Kepmendagri-derived region codes",
        snapshot="2025",
    ),
]
RELATIONS = {
    "contains",
    "within",
    "touches",
    "intersects",
    "overlaps",
    "disjoint",
    "distance",
    "direction",
}
RELATED_RELATIONS = {
    "parent",
    "children",
    "neighbors",
    "within",
    "contains",
    "intersects",
    "nearest",
}
SUBSET_PREDICATES = {"intersects", "within", "contains", "centroid_within"}
BOUNDARY_POLICIES = {"covers", "strict_contains"}
DISTANCE_MODES = {"boundary", "representative_point"}
EPSG_RE = re.compile(r"^EPSG:[1-9][0-9]{3,5}$")
GEOJSON_TYPES = {
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
}


class SpatialInteroperabilityService:
    """Deep module for generic discovery, reasoning, and spatial extraction."""

    def __init__(
        self,
        repository: SpatialRepository,
        artifact_store: ArtifactStore,
    ) -> None:
        self.repository = repository
        self.artifact_store = artifact_store
        self.max_geometry_points = int(
            os.getenv("MCP_MAX_GEOMETRY_POINTS", "50000")
        )
        self.max_subset_features = int(
            os.getenv("MCP_MAX_SUBSET_FEATURES", "5000")
        )
        self.max_aoi_bytes = int(os.getenv("MCP_MAX_AOI_BYTES", "1048576"))

    def describe_spatial_service(
        self,
        dataset_id: str | None = None,
    ) -> SpatialResult:
        self._validate_dataset(dataset_id or self.repository.dataset_id)
        description = self.repository.describe_spatial_service()
        warnings = list(description.pop("warnings", []))
        description["operational_limits"] = {
            "entity_resolution_max_features": 20,
            "related_features_max": 100,
            "subset_max_features": self.max_subset_features,
            "geometry_max_points": self.max_geometry_points,
            "aoi_buffer_max_m": 100_000,
            "aoi_max_bytes": self.max_aoi_bytes,
            "artifact_max_bytes": self.artifact_store.max_bytes,
            "artifact_ttl_seconds": self.artifact_store.ttl_seconds,
        }
        return self._result(
            description,
            operation="describe_spatial_service",
            warnings=warnings,
        )

    def resolve_spatial_entity(
        self,
        query: str,
        *,
        dataset_id: str | None = None,
        layer: str | None = None,
        parent_ref: FeatureRef | None = None,
        limit: int = 10,
    ) -> SpatialResult:
        self._validate_dataset(dataset_id or self.repository.dataset_id)
        normalized = query.strip()
        if len(normalized) < 2:
            raise InvalidArgumentError("query must contain at least 2 characters")
        if layer is not None:
            self._validate_layer(layer)
        if parent_ref is not None:
            self._validate_ref(parent_ref)
        safe_limit = self._bounded_limit(limit, maximum=20)
        candidates = self.repository.resolve_spatial_entities(
            normalized,
            layer=layer,
            parent_ref=parent_ref,
            limit=safe_limit,
        )
        canonical = [self._canonical_candidate(row) for row in candidates]
        ambiguous = len(canonical) > 1 and (
            canonical[0]["match_score"] == canonical[1]["match_score"]
        )
        return self._result(
            {
                "query": normalized,
                "candidates": canonical,
                "candidate_count": len(canonical),
                "ambiguous": ambiguous,
            },
            operation="resolve_spatial_entity",
            warnings=(
                ["Multiple equally ranked candidates require disambiguation."]
                if ambiguous
                else []
            ),
        )

    def get_spatial_entity(
        self,
        feature_ref: FeatureRef,
        *,
        include_geometry: bool = False,
        include_hierarchy: bool = True,
        attributes: list[str] | None = None,
    ) -> SpatialResult:
        self._validate_ref(feature_ref)
        row = self.repository.get_spatial_entity(
            feature_ref,
            include_geometry=include_geometry,
            max_geometry_points=self.max_geometry_points,
        )
        if row is None:
            raise FeatureNotFoundError(
                f"Feature {feature_ref.feature_id} was not found in layer "
                f"{feature_ref.layer}."
            )
        available = set(row.get("properties", {}))
        requested = self._validate_attributes(attributes, available)
        properties = row.get("properties", {})
        if requested is not None:
            properties = {key: properties.get(key) for key in requested}
        warnings: list[str] = []
        geometry = row.get("geometry")
        if include_geometry and geometry is None:
            warnings.append(
                "Geometry was omitted because it exceeds the configured point limit."
            )
        entity = self._canonical_entity(row)
        entity["properties"] = properties
        entity["hierarchy"] = row.get("hierarchy", []) if include_hierarchy else []
        entity["child_count"] = row.get("child_count")
        entity["bbox"] = row.get("bbox")
        entity["representative_point"] = row.get("representative_point")
        if include_geometry:
            entity["geometry"] = geometry
        return self._result(
            entity,
            operation="get_spatial_entity",
            warnings=warnings,
        )

    def locate_coordinates(
        self,
        latitude: float,
        longitude: float,
        *,
        dataset_id: str | None = None,
        layers: list[str] | None = None,
        boundary_policy: str = "covers",
    ) -> SpatialResult:
        self._validate_dataset(dataset_id or self.repository.dataset_id)
        if not (-90 <= latitude <= 90) or not (-180 <= longitude <= 180):
            raise InvalidArgumentError("coordinate is outside valid WGS84 bounds")
        if boundary_policy not in BOUNDARY_POLICIES:
            raise UnsupportedOperationError(
                "boundary_policy must be covers or strict_contains"
            )
        selected_layers = list(layers or self.repository.layer_ids)
        for layer in selected_layers:
            self._validate_layer(layer)
        rows = self.repository.locate_coordinates(
            latitude,
            longitude,
            layers=selected_layers,
            boundary_policy=boundary_policy,
        )
        matches = [self._canonical_entity(row) for row in rows]
        boundary_matches = [
            match for match, row in zip(matches, rows) if row.get("on_boundary")
        ]
        counts: dict[str, int] = {}
        for match in matches:
            layer = match["feature_ref"]["layer"]
            counts[layer] = counts.get(layer, 0) + 1
        warnings = []
        if boundary_matches:
            warnings.append(
                "At least one coordinate match lies on a feature boundary."
            )
        if any(count > 1 for count in counts.values()):
            warnings.append(
                "Multiple features matched within the same layer; inspect overlap."
            )
        if not matches:
            warnings.append("No feature matched the coordinate in the selected layers.")
        return self._result(
            {
                "coordinate": {
                    "latitude": latitude,
                    "longitude": longitude,
                    "crs": "EPSG:4326",
                },
                "boundary_policy": boundary_policy,
                "matches": matches,
            },
            operation=boundary_policy,
            warnings=warnings,
        )

    def relate_spatial_entities(
        self,
        subject_ref: FeatureRef,
        object_ref: FeatureRef,
        *,
        relations: list[str] | None = None,
        distance_mode: str = "boundary",
        tolerance_m: float = 0,
    ) -> SpatialResult:
        self._validate_ref(subject_ref)
        self._validate_ref(object_ref)
        selected = list(relations or sorted(RELATIONS))
        unsupported = sorted(set(selected) - RELATIONS)
        if unsupported:
            raise UnsupportedOperationError(
                f"unsupported relations: {', '.join(unsupported)}"
            )
        if distance_mode not in DISTANCE_MODES:
            raise UnsupportedOperationError(
                "distance_mode must be boundary or representative_point"
            )
        if not (0 <= tolerance_m <= 100_000):
            raise InvalidArgumentError("tolerance_m must be between 0 and 100000")
        raw = self.repository.relate_spatial_entities(
            subject_ref,
            object_ref,
            distance_mode=distance_mode,
            tolerance_m=tolerance_m,
        )
        if raw is None:
            raise FeatureNotFoundError("subject or object feature was not found")

        relation_values: dict[str, Any] = {}
        for relation in selected:
            if relation == "distance":
                relation_values[relation] = {
                    "meters": raw.get("distance_m"),
                    "mode": distance_mode,
                }
            elif relation == "direction":
                bearing = raw.get("bearing_degrees")
                relation_values[relation] = {
                    "bearing_degrees": bearing,
                    "cardinal": self._cardinal_direction(bearing),
                    "representation": "ST_PointOnSurface",
                }
            else:
                relation_values[relation] = bool(raw.get(relation))

        warnings = []
        if not raw.get("subject_valid", True) or not raw.get("object_valid", True):
            warnings.append("At least one source geometry is invalid.")
        return self._result(
            {
                "subject_ref": subject_ref.model_dump(),
                "object_ref": object_ref.model_dump(),
                "relations": relation_values,
                "de9im": raw.get("de9im"),
                "tolerance_m": tolerance_m,
                "within_tolerance": raw.get("within_tolerance"),
            },
            operation="relate_spatial_entities",
            warnings=warnings,
        )

    def find_related_spatial_entities(
        self,
        reference_ref: FeatureRef,
        *,
        relation: str,
        target_layer: str | None = None,
        max_distance_m: float | None = None,
        tolerance_m: float = 0,
        limit: int = 20,
    ) -> SpatialResult:
        self._validate_ref(reference_ref)
        if relation not in RELATED_RELATIONS:
            raise UnsupportedOperationError(
                f"relation must be one of: {', '.join(sorted(RELATED_RELATIONS))}"
            )
        resolved_target = target_layer or self._default_target_layer(
            reference_ref.layer,
            relation,
        )
        self._validate_layer(resolved_target)
        layer_index = list(self.repository.layer_ids).index(reference_ref.layer)
        if relation == "parent":
            if layer_index == 0:
                raise UnsupportedOperationError(
                    f"Layer {reference_ref.layer} has no parent layer."
                )
            expected = self.repository.layer_ids[layer_index - 1]
            if resolved_target != expected:
                raise UnsupportedOperationError(
                    f"parent relation for {reference_ref.layer} targets {expected}"
                )
        if relation == "children":
            if layer_index == len(self.repository.layer_ids) - 1:
                raise UnsupportedOperationError(
                    f"Layer {reference_ref.layer} has no child layer."
                )
            expected = self.repository.layer_ids[layer_index + 1]
            if resolved_target != expected:
                raise UnsupportedOperationError(
                    f"children relation for {reference_ref.layer} targets {expected}"
                )
        if max_distance_m is not None and not (0 < max_distance_m <= 1_000_000):
            raise InvalidArgumentError(
                "max_distance_m must be greater than 0 and at most 1000000"
            )
        if not (0 <= tolerance_m <= 100_000):
            raise InvalidArgumentError("tolerance_m must be between 0 and 100000")
        safe_limit = self._bounded_limit(limit, maximum=100)
        if (
            self.repository.get_spatial_entity(
                reference_ref,
                include_geometry=False,
                max_geometry_points=self.max_geometry_points,
            )
            is None
        ):
            raise FeatureNotFoundError(
                f"Feature {reference_ref.feature_id} was not found."
            )
        rows = self.repository.find_related_spatial_entities(
            reference_ref,
            relation=relation,
            target_layer=resolved_target,
            max_distance_m=max_distance_m,
            tolerance_m=tolerance_m,
            limit=safe_limit,
        )
        return self._result(
            {
                "reference_ref": reference_ref.model_dump(),
                "relation": relation,
                "target_layer": resolved_target,
                "features": [self._canonical_entity(row) for row in rows],
                "count": len(rows),
                "relation_method": self._related_method(
                    relation,
                    tolerance_m=tolerance_m,
                ),
                "ordering": (
                    "distance_ascending"
                    if relation in {"neighbors", "nearest"}
                    else "name_ascending"
                ),
                "tolerance_m": tolerance_m,
                "max_distance_m": max_distance_m,
            },
            operation=relation,
        )

    def extract_spatial_subset(
        self,
        *,
        layer: str,
        aoi: AreaOfInterest,
        predicate: str = "intersects",
        clip: bool = False,
        attributes: list[str] | None = None,
        target_crs: str = "EPSG:4326",
        output_format: str = "geojson",
        limit: int = 1000,
    ) -> SpatialResult:
        self._validate_layer(layer)
        if predicate not in SUBSET_PREDICATES:
            raise UnsupportedOperationError(
                f"predicate must be one of: {', '.join(sorted(SUBSET_PREDICATES))}"
            )
        if not EPSG_RE.fullmatch(target_crs):
            raise InvalidArgumentError("target_crs must be an EPSG code")
        if aoi.feature_ref is not None:
            self._validate_ref(aoi.feature_ref)
            if (
                self.repository.get_spatial_entity(
                    aoi.feature_ref,
                    include_geometry=False,
                    max_geometry_points=self.max_geometry_points,
                )
                is None
            ):
                raise FeatureNotFoundError(
                    f"AOI feature {aoi.feature_ref.feature_id} was not found."
                )
        if output_format not in {"geojson", "geopackage"}:
            raise UnsupportedOperationError(
                "output_format must be geojson or geopackage"
            )
        if attributes is not None:
            available = set(self.repository.get_layer_attributes(layer))
            unknown = sorted(set(attributes) - available)
            if unknown:
                raise InvalidArgumentError(
                    f"unknown attributes: {', '.join(unknown)}"
                )
        normalized_aoi = self._normalize_aoi(aoi)
        safe_limit = self._bounded_limit(
            limit,
            maximum=self.max_subset_features,
        )
        raw = self.repository.extract_spatial_subset(
            layer=layer,
            aoi=normalized_aoi,
            predicate=predicate,
            clip=clip,
            attributes=attributes,
            limit=safe_limit,
        )
        artifact = self.artifact_store.create(
            layer=layer,
            feature_collection=raw["feature_collection"],
            output_format=output_format,
            target_crs=target_crs,
        )
        warnings = list(raw.get("warnings", []))
        if raw.get("truncated", False):
            warnings.append(
                "Subset was truncated at the configured feature limit."
            )
        if artifact["download_url"] is None:
            warnings.append(
                "MCP_PUBLIC_BASE_URL is not configured; use relative_url from "
                "the MCP HTTP origin."
            )
        return self._result(
            {
                "layer": layer,
                "predicate": predicate,
                "clip": clip,
                "aoi": normalized_aoi,
                "attributes": attributes,
                "requested_limit": safe_limit,
                "number_matched": raw["number_matched"],
                "number_returned": raw["number_returned"],
                "source_crs": "EPSG:4326",
                "artifact": artifact,
            },
            operation="extract_spatial_subset",
            crs=target_crs,
            warnings=warnings,
        )

    def _result(
        self,
        data: Any,
        *,
        operation: str,
        crs: str = "EPSG:4326",
        warnings: list[str] | None = None,
    ) -> SpatialResult:
        return SpatialResult(
            data=data,
            operation=operation,
            dataset_id=self.repository.dataset_id,
            crs=crs,
            provenance=list(PROVENANCE),
            warnings=list(warnings or []),
        )

    def _validate_dataset(self, dataset_id: str) -> None:
        if dataset_id != self.repository.dataset_id:
            raise DatasetNotFoundError(f"Dataset {dataset_id} is not available.")

    def _validate_layer(self, layer: str) -> None:
        if layer not in self.repository.layer_ids:
            raise LayerNotFoundError(
                f"Layer {layer} is not available. Choose one of: "
                f"{', '.join(self.repository.layer_ids)}."
            )

    def _validate_ref(self, feature_ref: FeatureRef) -> None:
        self._validate_dataset(feature_ref.dataset_id)
        self._validate_layer(feature_ref.layer)

    @staticmethod
    def _bounded_limit(value: int, *, maximum: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError) as exc:
            raise InvalidArgumentError("limit must be an integer") from exc
        if parsed < 1 or parsed > maximum:
            raise InvalidArgumentError(
                f"limit must be between 1 and {maximum}"
            )
        return parsed

    @staticmethod
    def _validate_attributes(
        attributes: list[str] | None,
        available: set[str],
    ) -> list[str] | None:
        if attributes is None:
            return None
        unknown = sorted(set(attributes) - available)
        if unknown:
            raise InvalidArgumentError(
                f"unknown attributes: {', '.join(unknown)}"
            )
        return list(dict.fromkeys(attributes))

    def _normalize_aoi(self, aoi: AreaOfInterest) -> dict[str, Any]:
        if aoi.bbox is not None:
            min_x, min_y, max_x, max_y = aoi.bbox
            if not (
                -180 <= min_x < max_x <= 180
                and -90 <= min_y < max_y <= 90
            ):
                raise InvalidArgumentError(
                    "bbox must be ordered WGS84 coordinates"
                )
            return {
                "kind": "bbox",
                "bbox": [min_x, min_y, max_x, max_y],
                "buffer_m": aoi.buffer_m,
            }
        if aoi.geojson is not None:
            geometry_type = aoi.geojson.get("type")
            if geometry_type not in GEOJSON_TYPES:
                raise InvalidArgumentError(
                    "geojson must be a supported GeoJSON geometry"
                )
            if "coordinates" not in aoi.geojson:
                raise InvalidArgumentError("geojson coordinates are required")
            encoded = json.dumps(aoi.geojson, separators=(",", ":"))
            if len(encoded.encode("utf-8")) > self.max_aoi_bytes:
                raise QueryLimitExceededError(
                    "GeoJSON AOI exceeds the configured byte limit."
                )
            return {
                "kind": "geojson",
                "geojson": encoded,
                "buffer_m": aoi.buffer_m,
            }
        assert aoi.feature_ref is not None
        return {
            "kind": "feature_ref",
            "feature_ref": aoi.feature_ref.model_dump(),
            "buffer_m": aoi.buffer_m,
        }

    def _default_target_layer(self, reference_layer: str, relation: str) -> str:
        layers = list(self.repository.layer_ids)
        index = layers.index(reference_layer)
        if relation in {"parent", "within"}:
            if index == 0:
                raise UnsupportedOperationError(
                    f"Layer {reference_layer} has no parent layer."
                )
            return layers[index - 1]
        if relation in {"children", "contains"}:
            if index == len(layers) - 1:
                raise UnsupportedOperationError(
                    f"Layer {reference_layer} has no child layer."
                )
            return layers[index + 1]
        return reference_layer

    @staticmethod
    def _related_method(relation: str, *, tolerance_m: float) -> str:
        if relation == "neighbors":
            return (
                "ST_Touches"
                if tolerance_m == 0
                else "ST_Touches_or_ST_DWithin"
            )
        return {
            "parent": "declared_hierarchy",
            "children": "declared_hierarchy",
            "within": "ST_Covers",
            "contains": "ST_Covers",
            "intersects": "ST_Intersects",
            "nearest": "PostGIS_KNN",
        }[relation]

    @staticmethod
    def _canonical_candidate(row: dict[str, Any]) -> dict[str, Any]:
        candidate = SpatialInteroperabilityService._canonical_entity(row)
        candidate["match_score"] = float(row.get("match_score", 0))
        candidate["match_reason"] = row.get("match_reason")
        return candidate

    @staticmethod
    def _canonical_entity(row: dict[str, Any]) -> dict[str, Any]:
        result: dict[str, Any] = {
            "feature_ref": {
                "dataset_id": row.get("dataset_id", "wilayah-id"),
                "layer": row["layer"],
                "feature_id": str(row["feature_id"]),
            },
            "name": row.get("name"),
        }
        if row.get("feature_type") is not None:
            result["feature_type"] = row["feature_type"]
        if row.get("parent_feature_id") is not None:
            result["parent"] = {
                "feature_ref": {
                    "dataset_id": row.get("dataset_id", "wilayah-id"),
                    "layer": row.get("parent_layer"),
                    "feature_id": str(row["parent_feature_id"]),
                },
                "name": row.get("parent_name"),
            }
        if row.get("distance_m") is not None:
            result["distance_m"] = float(row["distance_m"])
        if row.get("on_boundary") is not None:
            result["on_boundary"] = bool(row["on_boundary"])
        return result

    @staticmethod
    def _cardinal_direction(bearing: float | None) -> str | None:
        if bearing is None or not math.isfinite(float(bearing)):
            return None
        labels = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
        return labels[int((float(bearing) + 22.5) // 45) % 8]
