"""Shared models for the dataset-independent MCP response contract."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, Field, model_validator

DataT = TypeVar("DataT")


class FeatureRef(BaseModel):
    """Canonical reference that does not expose a database table name."""

    dataset_id: str = Field(min_length=1, max_length=100)
    layer: str = Field(min_length=1, max_length=100)
    feature_id: str = Field(min_length=1, max_length=200)


class AreaOfInterest(BaseModel):
    """Exactly one geometry source for a spatial subset request."""

    bbox: tuple[float, float, float, float] | None = None
    geojson: dict[str, Any] | None = None
    feature_ref: FeatureRef | None = None
    buffer_m: float = Field(default=0, ge=0, le=100_000)

    @model_validator(mode="after")
    def validate_one_source(self) -> AreaOfInterest:
        sources = (
            self.bbox is not None,
            self.geojson is not None,
            self.feature_ref is not None,
        )
        if sum(sources) != 1:
            raise ValueError(
                "AOI requires exactly one of bbox, geojson, or feature_ref"
            )
        return self


class ProvenanceRecord(BaseModel):
    source: str
    snapshot: str
    accessed_at: str | None = None


class ResponseMeta(BaseModel):
    tool_version: str = "1.0.0"
    dataset_id: str = "wilayah-id"
    snapshot: str = "dukcapil-2024-s1+kepmendagri-2025"
    crs: str = "EPSG:4326"
    operation: str
    method: str = "postgis"
    trace_id: str
    latency_ms: float = Field(ge=0)
    provenance: list[ProvenanceRecord] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class SuccessEnvelope(BaseModel, Generic[DataT]):
    status: Literal["success"] = "success"
    data: DataT
    meta: ResponseMeta


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorEnvelope(BaseModel):
    status: Literal["error"] = "error"
    error: ErrorDetail
    meta: dict[str, Any] = Field(default_factory=dict)


@dataclass(frozen=True)
class SpatialResult:
    """Transport-neutral result produced by the deep spatial module."""

    data: Any
    operation: str
    dataset_id: str = "wilayah-id"
    snapshot: str = "dukcapil-2024-s1+kepmendagri-2025"
    crs: str = "EPSG:4326"
    method: str = "postgis"
    provenance: list[ProvenanceRecord] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
