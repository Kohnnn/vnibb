from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from vnibb.core.config import settings

logger = logging.getLogger(__name__)


class VniBBMCPClientService:
    @property
    def endpoint_url(self) -> str | None:
        value = str(settings.vnibb_mcp_url or "").strip()
        return value.rstrip("/") if value else None

    @property
    def is_enabled(self) -> bool:
        return bool(self.endpoint_url)

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        token = str(settings.vnibb_mcp_shared_bearer_token or "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    async def _call_tool(
        self, tool_name: str, arguments: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        endpoint_url = self.endpoint_url
        if not endpoint_url:
            raise RuntimeError("VNIBB MCP URL is not configured")

        timeout = httpx.Timeout(settings.vnibb_mcp_timeout_seconds)
        async with httpx.AsyncClient(
            headers=self._headers(),
            timeout=timeout,
            follow_redirects=True,
        ) as http_client:
            async with streamable_http_client(endpoint_url, http_client=http_client) as streams:
                async with ClientSession(*streams[:2]) as session:
                    await session.initialize()
                    result = await session.call_tool(tool_name, arguments=arguments or {})

        if result.isError:
            raise RuntimeError(self._extract_error_message(result))

        if isinstance(result.structuredContent, dict):
            return result.structuredContent

        fallback = self._extract_text_payload(result)
        if fallback is not None:
            return fallback

        return {
            "tool": tool_name,
            "content": [block.model_dump(mode="json") for block in result.content],
        }

    def _extract_error_message(self, result: Any) -> str:
        payload = self._extract_text_payload(result)
        if isinstance(payload, dict) and payload.get("message"):
            return str(payload["message"])
        return "VNIBB MCP tool call failed"

    def _extract_text_payload(self, result: Any) -> dict[str, Any] | None:
        blocks = getattr(result, "content", None)
        if not isinstance(blocks, list):
            return None

        text_chunks = [
            getattr(block, "text", None)
            for block in blocks
            if getattr(block, "type", None) == "text"
        ]
        text = "\n".join(chunk for chunk in text_chunks if isinstance(chunk, str) and chunk.strip())
        if not text:
            return None

        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return {"message": text}
        return payload if isinstance(payload, dict) else {"result": payload}

    async def get_symbol_snapshot(self, symbol: str) -> dict[str, Any]:
        return await self._call_tool("get_symbol_snapshot", {"symbol": symbol})

    async def get_market_snapshot(self) -> dict[str, Any]:
        return await self._call_tool("get_market_snapshot", {})


vnibb_mcp_client_service = VniBBMCPClientService()
