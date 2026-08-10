"""Static contracts for the authenticated MCP deployment override."""

from __future__ import annotations

from pathlib import Path
import unittest


SERVICE_LEVEL_PORTS_PATTERN = r"(?m)^ {4}ports:\s*$"


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
        self.assertRegex(override, r"(?m)^  mcp-server:\s*$")
        self.assertNotRegex(override, r"(?m)^  wilayah-id-mcp:\s*$")
        self.assertNotRegex(override, SERVICE_LEVEL_PORTS_PATTERN)

    def test_no_host_port_contract_rejects_service_level_fixture(self):
        """Reject a ports key at the valid four-space service indentation."""
        fixture = "services:\n  mcp-server:\n    ports:\n      - 8000:8000\n"

        self.assertRegex(fixture, SERVICE_LEVEL_PORTS_PATTERN)

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
