"""Static contracts for the authenticated MCP deployment override."""

from __future__ import annotations

from pathlib import Path
import unittest


class DeploymentContractTests(unittest.TestCase):
    PORTS_RESET_PATTERN = r"(?m)^ {4}ports: !reset \[\]\s*$"

    def assertHasPortsReset(self, text: str) -> None:
        """Require explicit ports: !reset [] to prevent inherited host ports."""
        self.assertRegex(text, self.PORTS_RESET_PATTERN)

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
        self.assertRegex(override, r"(?m)^  mcp-server:\s*$")
        self.assertNotRegex(override, r"(?m)^  wilayah-id-mcp:\s*$")
        self.assertHasPortsReset(override)

    def test_override_without_ports_reset_is_rejected(self):
        """A no-reset fixture must fail the assertHasPortsReset helper."""
        fixture = (
            "services:\n  mcp-server:\n    environment:\n"
            '      MCP_API_KEYS_SHA256: ${MCP_API_KEYS_SHA256:?set MCP_API_KEYS_SHA256}\n'
        )

        with self.assertRaises(AssertionError):
            self.assertHasPortsReset(fixture)

    def test_acceptance_client_requires_no_store_for_mcp_exchange(self):
        """Catch removal of no-store validation for authenticated MCP traffic."""
        client = (
            Path(__file__).resolve().parents[2] / "scripts/check-mcp-edge.py"
        ).read_text(encoding="utf-8")

        self.assertIn("AuthenticatedResponseRecorder", client)
        self.assertIn('event_hooks={"response": [recorder.record]}', client)
        self.assertIn("mcp_response_start = len(recorder.cache_controls)", client)
        self.assertIn("recorder.require_mcp_private(mcp_response_start)", client)


if __name__ == "__main__":
    unittest.main()
