"""Repository seam between spatial operations and storage adapters."""

from __future__ import annotations

from typing import Any, Protocol


class SpatialRepository(Protocol):
    """Storage operations required by the compatibility service."""

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

    def close(self) -> None:
        ...
