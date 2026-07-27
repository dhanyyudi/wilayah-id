from __future__ import annotations

import asyncio
import os
from pathlib import Path
import sys
import unittest

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


MCP_ROOT = Path(__file__).resolve().parents[1]
EXPECTED_TOOLS = {
    "search_regions",
    "get_region_details",
    "reverse_geocode",
    "get_top_populated_regions",
    "get_demographic_summary",
}


class McpProtocolTests(unittest.TestCase):
    def test_initialize_and_list_tools_over_stdio(self) -> None:
        async def exercise_server() -> None:
            environment = dict(os.environ)
            environment["MCP_TRANSPORT"] = "stdio"
            parameters = StdioServerParameters(
                command=sys.executable,
                args=["server.py"],
                cwd=str(MCP_ROOT),
                env=environment,
            )

            async with stdio_client(parameters) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    response = await session.list_tools()

            self.assertEqual(
                {tool.name for tool in response.tools},
                EXPECTED_TOOLS,
            )
            for tool in response.tools:
                self.assertEqual(tool.inputSchema.get("type"), "object")

        asyncio.run(exercise_server())


if __name__ == "__main__":
    unittest.main()
