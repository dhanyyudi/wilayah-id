"""Static contracts for the authenticated MCP deployment override."""

from __future__ import annotations

from pathlib import Path
import unittest


class DeploymentContractTests(unittest.TestCase):
    def test_homeserver_override_fails_closed_without_host_ports(self):
        """Catch removal of edge-secret requirements or host-port exposure."""
        override = (
            Path(__file__).resolve().parents[2]
            / "deploy/docker-compose.homeserver.mcp.yml"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "MCP_API_KEYS_SHA256: ${MCP_API_KEYS_SHA256:?set MCP_API_KEYS_SHA256}",
            override,
        )
        self.assertIn(
            "MCP_PUBLIC_BASE_URL: ${MCP_PUBLIC_BASE_URL:?set MCP_PUBLIC_BASE_URL}",
            override,
        )
        self.assertIn("wilayah-id-mcp-staging.dhanypedia.it.com", override)
        self.assertNotRegex(override, r"(?m)^  ports:\s*$")


if __name__ == "__main__":
    unittest.main()
