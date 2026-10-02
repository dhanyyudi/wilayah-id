"""Authenticated HTTP transport runtime for the Wilayah-ID MCP server."""

from __future__ import annotations

import os
from typing import Any

import uvicorn

from wilayah_mcp.access import FixedWindowLimiter, McpLimits, SignedKeyVerifier
from wilayah_mcp.auth import ApiKeyAuthMiddleware, ApiKeyVerifier


def build_authenticated_http_app(
    mcp: Any,
    transport: str,
    encoded_hashes: str,
    signing_secret: str = "",
    revoked_key_ids: str = "",
    limits: McpLimits | None = None,
) -> ApiKeyAuthMiddleware:
    """Return the selected FastMCP HTTP app protected by API-key middleware.

    Hash-configured keys are the owner tier. Issued keys are accepted only
    when a signing secret is configured; every caller is rate limited.
    """

    verifier = ApiKeyVerifier.from_encoded_hashes(encoded_hashes)
    signed_verifier = None
    if signing_secret:
        signed_verifier = SignedKeyVerifier(
            signing_secret,
            frozenset(
                item.strip() for item in revoked_key_ids.split(",") if item.strip()
            ),
        )
    if transport == "streamable-http":
        app = mcp.streamable_http_app()
    elif transport == "sse":
        app = mcp.sse_app()
    else:
        raise ValueError("HTTP transport must be streamable-http or sse")
    return ApiKeyAuthMiddleware(
        app,
        verifier,
        public_paths=frozenset({"/health"}),
        signed_verifier=signed_verifier,
        limiter=FixedWindowLimiter(),
        limits=limits or McpLimits(),
    )


def run_configured_transport(mcp: Any, transport: str) -> None:
    """Run stdio directly or start an authenticated FastMCP HTTP transport."""

    if transport == "stdio":
        mcp.run(transport="stdio")
        return

    app = build_authenticated_http_app(
        mcp,
        transport,
        os.getenv("MCP_API_KEYS_SHA256", ""),
        signing_secret=os.getenv("WILAYAH_KEY_SIGNING_SECRET", ""),
        revoked_key_ids=os.getenv("WILAYAH_REVOKED_KEY_IDS", ""),
        limits=McpLimits.from_env(),
    )
    uvicorn.run(app, host=mcp.settings.host, port=mcp.settings.port)
