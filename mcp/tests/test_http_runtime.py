from __future__ import annotations

import asyncio
import hashlib
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.applications import Starlette

from wilayah_mcp.auth import ApiKeyAuthMiddleware, ApiKeyConfigurationError
from wilayah_mcp.http_runtime import (
    build_authenticated_http_app,
    run_configured_transport,
)


async def _ok(_request):
    return JSONResponse({"status": "ok"})


class HttpRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key = "fixture-runtime-key"
        self.encoded_hashes = hashlib.sha256(self.key.encode()).hexdigest()

    def _mcp_with_app(self) -> Mock:
        app = Starlette(
            routes=[
                Route("/health", _ok),
                Route("/mcp", _ok),
                Route("/artifacts/example.geojson", _ok),
            ]
        )
        mcp = Mock()
        mcp.streamable_http_app.return_value = app
        mcp.sse_app.return_value = app
        return mcp

    def _request(self, app, path: str, headers=None):
        messages = []
        request_messages = iter([{"type": "http.request", "body": b"", "more_body": False}])

        async def receive():
            return next(request_messages)

        async def send(message):
            messages.append(message)

        asyncio.run(
            app(
                {"type": "http", "method": "GET", "path": path, "headers": headers or []},
                receive,
                send,
            )
        )
        return messages

    def test_stdio_does_not_require_api_key_configuration(self):
        mcp = Mock()

        run_configured_transport(mcp, "stdio")

        mcp.run.assert_called_once_with(transport="stdio")

    def test_streamable_http_fails_closed_without_hashes(self):
        mcp = self._mcp_with_app()

        with self.assertRaises(ApiKeyConfigurationError):
            build_authenticated_http_app(mcp, "streamable-http", "")

        mcp.streamable_http_app.assert_not_called()

    def test_sse_fails_closed_without_hashes(self):
        mcp = self._mcp_with_app()

        with self.assertRaises(ApiKeyConfigurationError):
            build_authenticated_http_app(mcp, "sse", "")

        mcp.sse_app.assert_not_called()

    def test_streamable_http_wraps_the_fastmcp_app(self):
        mcp = self._mcp_with_app()

        app = build_authenticated_http_app(mcp, "streamable-http", self.encoded_hashes)

        self.assertIsInstance(app, ApiKeyAuthMiddleware)
        self.assertIs(app.app, mcp.streamable_http_app.return_value)
        mcp.streamable_http_app.assert_called_once_with()
        mcp.sse_app.assert_not_called()

    def test_sse_wraps_the_fastmcp_app(self):
        mcp = self._mcp_with_app()

        app = build_authenticated_http_app(mcp, "sse", self.encoded_hashes)

        self.assertIsInstance(app, ApiKeyAuthMiddleware)
        self.assertIs(app.app, mcp.sse_app.return_value)
        mcp.sse_app.assert_called_once_with()
        mcp.streamable_http_app.assert_not_called()

    def test_health_is_anonymous_but_mcp_and_artifacts_are_protected(self):
        app = build_authenticated_http_app(
            self._mcp_with_app(), "streamable-http", self.encoded_hashes
        )

        health = self._request(app, "/health")
        mcp = self._request(app, "/mcp")
        artifacts = self._request(app, "/artifacts/example.geojson")
        authenticated_mcp = self._request(
            app, "/mcp", [(b"x-api-key", self.key.encode())]
        )

        self.assertEqual(health[0]["status"], 200)
        self.assertEqual(mcp[0]["status"], 401)
        self.assertEqual(artifacts[0]["status"], 401)
        self.assertEqual(authenticated_mcp[0]["status"], 200)

    def test_http_transports_use_the_configured_listener(self):
        for transport in ("streamable-http", "sse"):
            with self.subTest(transport=transport):
                mcp = self._mcp_with_app()
                mcp.settings = SimpleNamespace(host="127.0.0.1", port=8123)
                with (
                    patch.dict(
                        "os.environ",
                        {"MCP_API_KEYS_SHA256": self.encoded_hashes},
                        clear=True,
                    ),
                    patch("wilayah_mcp.http_runtime.uvicorn.run") as run,
                ):
                    run_configured_transport(mcp, transport)

                run.assert_called_once_with(
                    unittest.mock.ANY,
                    host="127.0.0.1",
                    port=8123,
                )


if __name__ == "__main__":
    unittest.main()
