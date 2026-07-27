"""Repository seam between spatial operations and storage adapters."""

from __future__ import annotations

from typing import Any, Protocol

from .models import FeatureRef


class SpatialRepository(Protocol):
    """Storage seam shared by compatibility and generic spatial operations."""

    dataset_id: str
    layer_ids: tuple[str, ...]

    def get_layer_attributes(self, layer: str) -> tuple[str, ...]:
        ...

    def search_regions(self, query: str, limit: int) -> list[dict[str, Any]]:
        ...

    def get_region_details(self, code: str) -> dict[str, Any] | None:
        ...

    def reverse_geocode(self, lat: float, lng: float) -> dict[str, Any] | None:
        ...

    def get_top_populated_regions(
        self, level: str, limit: int, descending: bool
    ) -> list[dict[str, Any]]:
        ...

    def describe_spatial_service(self) -> dict[str, Any]:
        ...

    def resolve_spatial_entities(
        self,
        query: str,
        *,
        layer: str | None,
        parent_ref: FeatureRef | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        ...

    def get_spatial_entity(
        self,
        feature_ref: FeatureRef,
        *,
        include_geometry: bool,
        max_geometry_points: int,
    ) -> dict[str, Any] | None:
        ...

    def locate_coordinates(
        self,
        latitude: float,
        longitude: float,
        *,
        layers: list[str],
        boundary_policy: str,
    ) -> list[dict[str, Any]]:
        ...

    def relate_spatial_entities(
        self,
        subject_ref: FeatureRef,
        object_ref: FeatureRef,
        *,
        distance_mode: str,
        tolerance_m: float,
    ) -> dict[str, Any] | None:
        ...

    def find_related_spatial_entities(
        self,
        reference_ref: FeatureRef,
        *,
        relation: str,
        target_layer: str,
        max_distance_m: float | None,
        tolerance_m: float,
        limit: int,
    ) -> list[dict[str, Any]]:
        ...

    def extract_spatial_subset(
        self,
        *,
        layer: str,
        aoi: dict[str, Any],
        predicate: str,
        clip: bool,
        attributes: list[str] | None,
        limit: int,
    ) -> dict[str, Any]:
        ...

    def close(self) -> None:
        ...
