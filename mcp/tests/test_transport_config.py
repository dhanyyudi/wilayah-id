from __future__ import annotations

import os
import unittest
from unittest.mock import patch

import server


class TransportConfigurationTests(unittest.TestCase):
    def test_stdio_is_the_safe_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(server._transport(), "stdio")

    def test_invalid_transport_is_rejected(self) -> None:
        with patch.dict(
            os.environ,
            {"MCP_TRANSPORT": "websocket"},
            clear=True,
        ):
            with self.assertRaisesRegex(ValueError, "MCP_TRANSPORT"):
                server._transport()

    def test_public_listener_requires_allowed_hosts(self) -> None:
        with patch.dict(
            os.environ,
            {
                "MCP_TRANSPORT": "streamable-http",
                "MCP_HOST": "0.0.0.0",
            },
            clear=True,
        ):
            with self.assertRaisesRegex(ValueError, "MCP_ALLOWED_HOSTS"):
                server._build_mcp()

    def test_http_runtime_uses_explicit_host_allowlist(self) -> None:
        with patch.dict(
            os.environ,
            {
                "MCP_TRANSPORT": "streamable-http",
                "MCP_HOST": "0.0.0.0",
                "MCP_PORT": "8123",
                "MCP_ALLOWED_HOSTS": "mcp-server:*,example.test",
            },
            clear=True,
        ):
            configured = server._build_mcp()

        self.assertEqual(configured.settings.host, "0.0.0.0")
        self.assertEqual(configured.settings.port, 8123)
        self.assertEqual(
            configured.settings.transport_security.allowed_hosts,
            ["mcp-server:*", "example.test"],
        )


if __name__ == "__main__":
    unittest.main()
