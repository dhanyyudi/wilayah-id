"""Shared models for the dataset-independent MCP response contract."""

from __future__ import annotations

from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, Field


DataT = TypeVar("DataT")


class FeatureRef(BaseModel):
    """Canonical reference that does not expose a database table name."""

    dataset_id: str
    layer: str
    feature_id: str


class ProvenanceRecord(BaseModel):
    source: str
    snapshot: str
    accessed_at: str | None = None


class ResponseMeta(BaseModel):
    tool_version: str = "0.1.0"
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
