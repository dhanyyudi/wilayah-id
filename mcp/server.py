"""Thin FastMCP compatibility adapter for Wilayah-ID."""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable
from time import perf_counter
from typing import Any
from uuid import uuid4

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse

from wilayah_mcp.artifacts import ArtifactStore
from wilayah_mcp.errors import SpatialServiceError
from wilayah_mcp.generic_service import SpatialInteroperabilityService
from wilayah_mcp.http_runtime import run_configured_transport
from wilayah_mcp.models import (
    AreaOfInterest,
    ErrorDetail,
    ErrorEnvelope,
    FeatureRef,
    ResponseMeta,
    SpatialResult,
    SuccessEnvelope,
)
from wilayah_mcp.postgis import PostgisSpatialRepository
from wilayah_mcp.service import WilayahSpatialService

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(message)s")
LOGGER = logging.getLogger("wilayah-id-mcp")


def _csv_env(name: str) -> list[str]:
    """Return non-empty comma-separated environment values."""

    return [
        item.strip()
        for item in os.getenv(name, "").split(",")
        if item.strip()
    ]


def _transport() -> str:
    """Return a supported MCP transport without silently accepting typos."""

    transport = os.getenv("MCP_TRANSPORT", "stdio").strip().lower()
    if transport not in {"stdio", "sse", "streamable-http"}:
        raise ValueError(
            "MCP_TRANSPORT must be stdio, sse, or streamable-http"
        )
    return transport


def _build_mcp() -> FastMCP:
    """Build the transport adapter from explicit runtime settings."""

    host = os.getenv("MCP_HOST", "127.0.0.1")
    port = int(os.getenv("MCP_PORT", "8000"))
    allowed_hosts = _csv_env("MCP_ALLOWED_HOSTS")
    allowed_origins = _csv_env("MCP_ALLOWED_ORIGINS")

    if (
        _transport() != "stdio"
        and host not in {"127.0.0.1", "localhost", "::1"}
        and not allowed_hosts
    ):
        raise ValueError(
            "MCP_ALLOWED_HOSTS is required for a non-loopback HTTP listener"
        )

    transport_security = None
    if allowed_hosts or allowed_origins:
        transport_security = TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=allowed_hosts,
            allowed_origins=allowed_origins,
        )

    return FastMCP(
        "wilayah-id",
        instructions="Indonesian Administrative Regions (Wilayah-ID) API",
        host=host,
        port=port,
        streamable_http_path="/mcp",
        transport_security=transport_security,
    )


mcp = _build_mcp()

_repository = PostgisSpatialRepository()
_service = WilayahSpatialService(_repository)
_artifact_store = ArtifactStore()
_spatial_service = SpatialInteroperabilityService(
    _repository,
    _artifact_store,
)


def _invoke(
    operation: str,
    callback: Callable[[], Any],
    *,
    list_response: bool = False,
) -> Any:
    """Run one operation with structured logging and caller-safe errors."""

    trace_id = str(uuid4())
    started = perf_counter()
    try:
        result = callback()
        LOGGER.info(
            json.dumps(
                {
                    "event": "mcp_operation",
                    "operation": operation,
                    "status": "success",
                    "trace_id": trace_id,
                    "latency_ms": round((perf_counter() - started) * 1000, 3),
                }
            )
        )
        return result
    except SpatialServiceError as exc:
        LOGGER.warning(
            json.dumps(
                {
                    "event": "mcp_operation",
                    "operation": operation,
                    "status": "error",
                    "error_code": exc.code,
                    "trace_id": trace_id,
                    "latency_ms": round((perf_counter() - started) * 1000, 3),
                }
            ),
            exc_info=exc.code == "INTERNAL_ERROR",
        )
        payload = {"error": exc.public_message}
        return [payload] if list_response else payload
    except Exception:
        LOGGER.exception(
            json.dumps(
                {
                    "event": "mcp_operation",
                    "operation": operation,
                    "status": "error",
                    "error_code": "INTERNAL_ERROR",
                    "trace_id": trace_id,
                    "latency_ms": round((perf_counter() - started) * 1000, 3),
                }
            )
        )
        payload = {"error": "The spatial data service could not complete the request."}
        return [payload] if list_response else payload


def _invoke_generic(
    operation: str,
    callback: Callable[[], SpatialResult],
) -> dict[str, Any]:
    """Run a generic spatial operation and return its stable envelope."""

    trace_id = str(uuid4())
    started = perf_counter()
    try:
        result = callback()
        latency_ms = round((perf_counter() - started) * 1000, 3)
        LOGGER.info(
            json.dumps(
                {
                    "event": "mcp_operation",
                    "operation": operation,
                    "status": "success",
                    "trace_id": trace_id,
                    "latency_ms": latency_ms,
                }
            )
        )
        return SuccessEnvelope(
            data=result.data,
            meta=ResponseMeta(
                dataset_id=result.dataset_id,
                snapshot=result.snapshot,
                crs=result.crs,
                operation=result.operation,
                method=result.method,
                trace_id=trace_id,
                latency_ms=latency_ms,
                provenance=result.provenance,
                warnings=result.warnings,
            ),
        ).model_dump(mode="json")
    except SpatialServiceError as exc:
        latency_ms = round((perf_counter() - started) * 1000, 3)
        LOGGER.warning(
            json.dumps(
                {
                    "event": "mcp_operation",
                    "operation": operation,
                    "status": "error",
                    "error_code": exc.code,
                    "trace_id": trace_id,
                    "latency_ms": latency_ms,
                }
            ),
            exc_info=exc.code in {"INTERNAL_ERROR", "ARTIFACT_ERROR"},
        )
        return ErrorEnvelope(
            error=ErrorDetail(code=exc.code, message=exc.public_message),
            meta={
                "operation": operation,
                "trace_id": trace_id,
                "latency_ms": latency_ms,
            },
        ).model_dump(mode="json")
    except Exception:
        latency_ms = round((perf_counter() - started) * 1000, 3)
        LOGGER.exception(
            json.dumps(
                {
                    "event": "mcp_operation",
                    "operation": operation,
                    "status": "error",
                    "error_code": "INTERNAL_ERROR",
                    "trace_id": trace_id,
                    "latency_ms": latency_ms,
                }
            )
        )
        return ErrorEnvelope(
            error=ErrorDetail(
                code="INTERNAL_ERROR",
                message="The spatial data service could not complete the request.",
            ),
            meta={
                "operation": operation,
                "trace_id": trace_id,
                "latency_ms": latency_ms,
            },
        ).model_dump(mode="json")


@mcp.tool()
def search_regions(query: str, limit: int = 20) -> list[dict[str, Any]]:
    """Search Indonesian administrative regions by name."""

    return _invoke(
        "search_regions",
        lambda: _service.search_regions(query, limit),
        list_response=True,
    )


@mcp.tool()
def get_region_details(code: str) -> dict[str, Any]:
    """Get region attributes and hierarchy from an administrative code."""

    return _invoke(
        "get_region_details",
        lambda: _service.get_region_details(code),
    )


@mcp.tool()
def reverse_geocode(lat: float, lng: float) -> dict[str, Any]:
    """Find the administrative hierarchy for a latitude and longitude."""

    return _invoke(
        "reverse_geocode",
        lambda: _service.reverse_geocode(lat, lng),
    )


@mcp.tool()
def get_top_populated_regions(
    level: str = "provinsi",
    limit: int = 10,
    order: str = "desc",
) -> list[dict[str, Any]]:
    """Return regions ordered by population for one administrative level."""

    return _invoke(
        "get_top_populated_regions",
        lambda: _service.get_top_populated_regions(level, limit, order),
        list_response=True,
    )


@mcp.tool()
def get_demographic_summary(code: str) -> dict[str, Any]:
    """Return selected demographic attributes for one region."""

    return _invoke(
        "get_demographic_summary",
        lambda: _service.get_demographic_summary(code),
    )


@mcp.tool()
def describe_spatial_service(
    dataset_id: str | None = None,
) -> dict[str, Any]:
    """Discover datasets, layers, attributes, operations, limits, and snapshots."""

    return _invoke_generic(
        "describe_spatial_service",
        lambda: _spatial_service.describe_spatial_service(dataset_id),
    )


@mcp.tool()
def resolve_spatial_entity(
    query: str,
    dataset_id: str | None = None,
    layer: str | None = None,
    parent_ref: FeatureRef | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    """Resolve a name or identifier to ranked canonical spatial entities."""

    return _invoke_generic(
        "resolve_spatial_entity",
        lambda: _spatial_service.resolve_spatial_entity(
            query,
            dataset_id=dataset_id,
            layer=layer,
            parent_ref=parent_ref,
            limit=limit,
        ),
    )


@mcp.tool()
def get_spatial_entity(
    feature_ref: FeatureRef,
    include_geometry: bool = False,
    include_hierarchy: bool = True,
    attributes: list[str] | None = None,
) -> dict[str, Any]:
    """Inspect one canonical spatial entity with optional geometry and hierarchy."""

    return _invoke_generic(
        "get_spatial_entity",
        lambda: _spatial_service.get_spatial_entity(
            feature_ref,
            include_geometry=include_geometry,
            include_hierarchy=include_hierarchy,
            attributes=attributes,
        ),
    )


@mcp.tool()
def locate_coordinates(
    latitude: float,
    longitude: float,
    dataset_id: str | None = None,
    layers: list[str] | None = None,
    boundary_policy: str = "covers",
) -> dict[str, Any]:
    """Locate WGS84 coordinates in layers using an explicit boundary policy."""

    return _invoke_generic(
        "locate_coordinates",
        lambda: _spatial_service.locate_coordinates(
            latitude,
            longitude,
            dataset_id=dataset_id,
            layers=layers,
            boundary_policy=boundary_policy,
        ),
    )


@mcp.tool()
def relate_spatial_entities(
    subject_ref: FeatureRef,
    object_ref: FeatureRef,
    relations: list[str] | None = None,
    distance_mode: str = "boundary",
    tolerance_m: float = 0,
) -> dict[str, Any]:
    """Compute declared topological, metric, and directional relations."""

    return _invoke_generic(
        "relate_spatial_entities",
        lambda: _spatial_service.relate_spatial_entities(
            subject_ref,
            object_ref,
            relations=relations,
            distance_mode=distance_mode,
            tolerance_m=tolerance_m,
        ),
    )


@mcp.tool()
def find_related_spatial_entities(
    reference_ref: FeatureRef,
    relation: str,
    target_layer: str | None = None,
    max_distance_m: float | None = None,
    tolerance_m: float = 0,
    limit: int = 20,
) -> dict[str, Any]:
    """Find parent, children, neighbors, intersections, or nearest entities."""

    return _invoke_generic(
        "find_related_spatial_entities",
        lambda: _spatial_service.find_related_spatial_entities(
            reference_ref,
            relation=relation,
            target_layer=target_layer,
            max_distance_m=max_distance_m,
            tolerance_m=tolerance_m,
            limit=limit,
        ),
    )


@mcp.tool()
def extract_spatial_subset(
    layer: str,
    aoi: AreaOfInterest,
    predicate: str = "intersects",
    clip: bool = False,
    attributes: list[str] | None = None,
    target_crs: str = "EPSG:4326",
    output_format: str = "geojson",
    limit: int = 1000,
) -> dict[str, Any]:
    """Create a bounded GeoJSON or GeoPackage artifact for a QGIS workflow."""

    return _invoke_generic(
        "extract_spatial_subset",
        lambda: _spatial_service.extract_spatial_subset(
            layer=layer,
            aoi=aoi,
            predicate=predicate,
            clip=clip,
            attributes=attributes,
            target_crs=target_crs,
            output_format=output_format,
            limit=limit,
        ),
    )


@mcp.custom_route(
    "/health",
    methods=["GET"],
    include_in_schema=False,
)
async def health(_request: Request):
    return JSONResponse(
        {"status": "ok"},
        headers={"Cache-Control": "no-store"},
    )


@mcp.custom_route(
    "/artifacts/{artifact_id}/{filename}",
    methods=["GET"],
    name="download-spatial-artifact",
    include_in_schema=False,
)
async def download_spatial_artifact(request: Request):
    """Download an unexpired artifact without accepting arbitrary paths."""

    artifact_id = request.path_params["artifact_id"]
    filename = request.path_params["filename"]
    path = _artifact_store.resolve(artifact_id, filename)
    if path is None:
        return JSONResponse(
            {"error": {"code": "ARTIFACT_NOT_FOUND", "message": "Artifact not found."}},
            status_code=404,
            headers={"Cache-Control": "no-store"},
        )
    media_type = (
        "application/geopackage+sqlite3"
        if path.suffix == ".gpkg"
        else "application/geo+json"
    )
    return FileResponse(
        path,
        media_type=media_type,
        filename=path.name,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@mcp.prompt()
def indonesian_region_assistant() -> str:
    """Prompt for assisting users with Indonesian administrative boundaries."""

    return """You are a geospatial data assistant specializing in Indonesian administrative boundaries.

When helping users:
1. Call `describe_spatial_service` before assuming layer names or capabilities.
2. Use `resolve_spatial_entity` and `get_spatial_entity` for canonical features.
3. Use `locate_coordinates`, `relate_spatial_entities`, and
   `find_related_spatial_entities` for explicit spatial operations.
4. Use `extract_spatial_subset` to create bounded artifacts for QGIS.
5. Legacy tools remain available only for compatibility.

Important context:
- Boundary geometry is based on the Dukcapil 2024 Semester 1 snapshot.
- Region codes are reconciled with the Kepmendagri 2025-derived dataset.
- The hierarchy is Provinsi (2 digits), Kabupaten/Kota (4), Kecamatan (6), and Desa/Kelurahan (10).
- The configured database role is read-only; do not attempt data modification.
"""


if __name__ == "__main__":
    transport = _transport()
    run_configured_transport(mcp, transport)
