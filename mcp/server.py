"""Thin FastMCP compatibility adapter for Wilayah-ID."""

from __future__ import annotations

import json
import logging
import os
from time import perf_counter
from typing import Any, Callable
from uuid import uuid4

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from wilayah_mcp.errors import SpatialServiceError
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


@mcp.prompt()
def indonesian_region_assistant() -> str:
    """Prompt for assisting users with Indonesian administrative boundaries."""

    return """You are a geospatial data assistant specializing in Indonesian administrative boundaries.

When helping users:
1. Use `search_regions` to resolve region names to administrative codes.
2. Use `get_region_details` for attributes and hierarchy.
3. Use `get_top_populated_regions` for population rankings.
4. Use `get_demographic_summary` for a concise statistical overview.
5. Use `reverse_geocode` for coordinates.

Important context:
- Boundary geometry is based on the Dukcapil 2024 Semester 1 snapshot.
- Region codes are reconciled with the Kepmendagri 2025-derived dataset.
- The hierarchy is Provinsi (2 digits), Kabupaten/Kota (4), Kecamatan (6), and Desa/Kelurahan (10).
- The configured database role is read-only; do not attempt data modification.
"""


if __name__ == "__main__":
    mcp.run(transport=_transport())
