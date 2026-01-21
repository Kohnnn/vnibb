"""
Context7 MCP Server Integration for VNIBB.
This server provides context-aware documentation and tools for the vnstock library.
"""

import os
from mcp.server.fastapi import Context7MCP

# Initialize the Context7 MCP server
mcp = Context7MCP(
    api_key=os.getenv("ctx7sk-b564a4fc-48a3-4af6-aafc-c2fb9a9c9e4a"),
    name="VNIBB Context7 Server",
    version="1.0.0"
)

# You can add custom tools or resources here if needed
# For now, it mainly serves the purpose of providing vnstock context to AI agents.
