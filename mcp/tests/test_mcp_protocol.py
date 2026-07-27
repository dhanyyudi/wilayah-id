from __future__ import annotations

import asyncio
import os
import sys
import unittest
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

MCP_ROOT = Path(__file__).resolve().parents[1]
EXPECTED_TOOLS = {
    "search_regions",
    "get_region_details",
    "reverse_geocode",
    "get_top_populated_regions",
    "get_demographic_summary",
    "describe_spatial_service",
    "resolve_spatial_entity",
    "get_spatial_entity",
    "locate_coordinates",
    "relate_spatial_entities",
    "find_related_spatial_entities",
    "extract_spatial_subset",
}
REQUIRED_ARGUMENTS = {
    "describe_spatial_service": set(),
    "resolve_spatial_entity": {"query"},
    "get_spatial_entity": {"feature_ref"},
    "locate_coordinates": {"latitude", "longitude"},
    "relate_spatial_entities": {"subject_ref", "object_ref"},
    "find_related_spatial_entities": {"reference_ref", "relation"},
    "extract_spatial_subset": {"layer", "aoi"},
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

            async with (
                stdio_client(parameters) as (read_stream, write_stream),
                ClientSession(read_stream, write_stream) as session,
            ):
                await session.initialize()
                response = await session.list_tools()

            self.assertEqual(
                {tool.name for tool in response.tools},
                EXPECTED_TOOLS,
            )
            for tool in response.tools:
                self.assertEqual(tool.inputSchema.get("type"), "object")
                if tool.name in REQUIRED_ARGUMENTS:
                    self.assertEqual(
                        set(tool.inputSchema.get("required", [])),
                        REQUIRED_ARGUMENTS[tool.name],
                    )
            schemas = {tool.name: tool.inputSchema for tool in response.tools}
            self.assertEqual(
                schemas["get_spatial_entity"]["$defs"]["FeatureRef"]["required"],
                ["dataset_id", "layer", "feature_id"],
            )
            self.assertEqual(
                schemas["extract_spatial_subset"]["properties"]["limit"]["default"],
                1000,
            )

        asyncio.run(exercise_server())


if __name__ == "__main__":
    unittest.main()
