"""Authenticated HTTP transport runtime for the Wilayah-ID MCP server."""

from __future__ import annotations

import os
from typing import Any

import uvicorn

from wilayah_mcp.auth import ApiKeyAuthMiddleware, ApiKeyVerifier


def build_authenticated_http_app(
    mcp: Any,
    transport: str,
    encoded_hashes: str,
) -> ApiKeyAuthMiddleware:
    """Return the selected FastMCP HTTP app protected by API-key middleware."""

    verifier = ApiKeyVerifier.from_encoded_hashes(encoded_hashes)
    if transport == "streamable-http":
        app = mcp.streamable_http_app()
    elif transport == "sse":
        app = mcp.sse_app()
    else:
        raise ValueError("HTTP transport must be streamable-http or sse")
    return ApiKeyAuthMiddleware(app, verifier, public_paths=frozenset({"/health"}))


def run_configured_transport(mcp: Any, transport: str) -> None:
    """Run stdio directly or start an authenticated FastMCP HTTP transport."""

    if transport == "stdio":
        mcp.run(transport="stdio")
        return

    app = build_authenticated_http_app(
        mcp,
        transport,
        os.getenv("MCP_API_KEYS_SHA256", ""),
    )
    uvicorn.run(app, host=mcp.settings.host, port=mcp.settings.port)
