#!/usr/bin/env python3
"""Check the authenticated public MCP edge without exposing credentials."""

from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Iterable

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


GENERIC_TOOLS = frozenset(
    {
        "describe_spatial_service",
        "resolve_spatial_entity",
        "get_spatial_entity",
        "locate_coordinates",
        "relate_spatial_entities",
        "find_related_spatial_entities",
        "extract_spatial_subset",
    }
)
COMPATIBILITY_TOOLS = frozenset(
    {
        "search_regions",
        "get_region_details",
        "reverse_geocode",
        "get_top_populated_regions",
        "get_demographic_summary",
    }
)
REQUIRED_TOOLS = GENERIC_TOOLS | COMPATIBILITY_TOOLS


class CheckFailure(RuntimeError):
    """A bounded acceptance failure that never includes a secret."""


class AuthenticatedResponseRecorder:
    """Record only cache directives from authenticated HTTP responses."""

    def __init__(self) -> None:
        self.cache_controls: list[str] = []

    async def record(self, response: httpx.Response) -> None:
        self.cache_controls.append(response.headers.get("cache-control", ""))

    def require_mcp_private(self, response_start: int) -> None:
        mcp_cache_controls = self.cache_controls[response_start:]
        if not mcp_cache_controls:
            raise CheckFailure("authenticated MCP exchange returned no HTTP response")
        if any("no-store" not in value.lower() for value in mcp_cache_controls):
            raise CheckFailure("authenticated MCP exchange omitted Cache-Control no-store")


def required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise CheckFailure(f"missing required environment variable: {name}")
    return value


def require_no_store(response: httpx.Response) -> None:
    if "no-store" not in response.headers.get("cache-control", "").lower():
        raise CheckFailure("response omitted Cache-Control no-store")


def require_status(response: httpx.Response, expected: int) -> None:
    if response.status_code != expected:
        raise CheckFailure(f"unexpected HTTP status: expected {expected}")


def require_authentication_error(response: httpx.Response) -> None:
    require_status(response, 401)
    require_no_store(response)
    try:
        error_code = response.json()["error"]["code"]
    except (KeyError, TypeError, ValueError) as exc:
        raise CheckFailure("authentication response did not provide an error code") from exc
    if error_code != "authentication_required":
        raise CheckFailure("authentication response used an unexpected error code")


def require_tools(tool_names: Iterable[str]) -> None:
    actual = frozenset(tool_names)
    if actual != REQUIRED_TOOLS:
        missing = len(REQUIRED_TOOLS - actual)
        unexpected = len(actual - REQUIRED_TOOLS)
        raise CheckFailure(
            f"tool inventory mismatch: missing={missing} unexpected={unexpected}"
        )


async def check_edge(base_url: str, api_key: str) -> None:
    timeout = httpx.Timeout(20.0)
    health_url = f"{base_url}/health"
    artifact_url = f"{base_url}/artifacts/invalid/file.geojson"

    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=False,
    ) as anonymous_client:
        health = await anonymous_client.get(health_url)
        require_status(health, 200)
        require_no_store(health)
        if health.json() != {"status": "ok"}:
            raise CheckFailure("health response did not report status ok")
        print("PASS anonymous health")

        missing_key = await anonymous_client.get(f"{base_url}/mcp")
        require_authentication_error(missing_key)
        print("PASS missing key rejected")

        invalid_artifact = await anonymous_client.get(artifact_url)
        require_authentication_error(invalid_artifact)
        print("PASS unauthenticated artifact rejected")

        async with httpx.AsyncClient(
            headers={"X-API-Key": "invalid-edge-check-key"},
            timeout=timeout,
            follow_redirects=False,
        ) as wrong_key_client:
            wrong_key = await wrong_key_client.get(f"{base_url}/mcp")
            require_authentication_error(wrong_key)
        print("PASS wrong key rejected")

    recorder = AuthenticatedResponseRecorder()
    async with httpx.AsyncClient(
        headers={"X-API-Key": api_key},
        timeout=httpx.Timeout(20.0),
        follow_redirects=False,
        event_hooks={"response": [recorder.record]},
    ) as http_client:
        missing_artifact = await http_client.get(artifact_url)
        require_status(missing_artifact, 404)
        require_no_store(missing_artifact)
        print("PASS authenticated artifact contract")

        mcp_response_start = len(recorder.cache_controls)
        async with streamable_http_client(
            f"{base_url}/mcp",
            http_client=http_client,
        ) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                tools = await session.list_tools()

        recorder.require_mcp_private(mcp_response_start)
        require_tools(tool.name for tool in tools.tools)
        print(f"PASS authenticated MCP tools={len(tools.tools)}")


def main() -> int:
    try:
        base_url = required_environment("MCP_BASE_URL").rstrip("/")
        api_key = required_environment("MCP_API_KEY")
        asyncio.run(check_edge(base_url, api_key))
    except CheckFailure as exc:
        print(f"FAIL {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    except (httpx.HTTPError, OSError, ValueError) as exc:
        print(f"FAIL {type(exc).__name__}", file=sys.stderr)
        return 1
    except Exception as exc:  # Keep unexpected library failures bounded too.
        print(f"FAIL unexpected {type(exc).__name__}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
