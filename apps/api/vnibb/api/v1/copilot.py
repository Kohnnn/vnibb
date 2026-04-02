"""
AI Copilot API - Chat with context-aware LLM for stock analysis

Provides:
- SSE streaming chat endpoint
- Widget context integration
- Pre-built prompt templates
"""

import json
from typing import Any, Literal

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from vnibb.services.ai_context_service import ai_context_service
from vnibb.services.copilot_service import PROMPT_TEMPLATES, copilot_service
from vnibb.services.llm_service import llm_service

router = APIRouter()


# ============ Models ============


class Message(BaseModel):
    role: str
    content: str


class WidgetContext(BaseModel):
    """Context from a widget for AI analysis."""

    widgetType: str = "General"
    symbol: str = ""
    activeTab: str | None = None
    dataSnapshot: dict[str, Any] | None = None
    widgetPayload: dict[str, Any] | None = None


class CopilotRequestSettings(BaseModel):
    mode: Literal["app_default", "browser_key"] = "app_default"
    provider: Literal["openrouter"] = "openrouter"
    model: str | None = None
    apiKey: str | None = None
    webSearch: bool = False
    preferAppwriteData: bool = True


class ChatStreamRequest(BaseModel):
    """Request for streaming chat."""

    message: str
    context: WidgetContext | None = None
    history: list[Message] = []
    settings: CopilotRequestSettings | None = None


class ChatRequest(BaseModel):
    """Legacy chat request with full history."""

    messages: list[Message]
    context: dict[str, Any] | None = None


class AskRequest(BaseModel):
    query: str
    context: dict[str, Any] | None = None


class CopilotSuggestionResponse(BaseModel):
    suggestions: list[str]


class PromptTemplate(BaseModel):
    id: str
    label: str
    template: str


class PromptsResponse(BaseModel):
    prompts: list[PromptTemplate]


# ============ Endpoints ============


@router.post("/chat/stream", summary="Stream chat response via SSE")
async def chat_stream(request: ChatStreamRequest):
    """
    Stream a chat response using Server-Sent Events (SSE).

    Returns chunks in format: data: {"chunk": "text"}\n\n
    Final message: data: {"done": true}\n\n
    """

    async def generate():
        try:
            request_settings = (
                request.settings.model_dump(exclude_none=True) if request.settings else {}
            )

            context_dict = {}
            if request.context:
                context_dict = {
                    "widgetType": request.context.widgetType,
                    "symbol": request.context.symbol,
                    "activeTab": request.context.activeTab,
                    "data": request.context.dataSnapshot or {},
                }
                if request.context.widgetPayload:
                    context_dict["widget_payload"] = request.context.widgetPayload

            # Convert history to dict format
            messages = [{"role": m.role, "content": m.content} for m in request.history]
            messages.append({"role": "user", "content": request.message})

            runtime_context = await ai_context_service.build_runtime_context(
                message=request.message,
                history=messages,
                client_context=context_dict,
                prefer_appwrite_data=bool(request_settings.get("preferAppwriteData", True)),
            )

            # Stream from LLM
            async for chunk in llm_service.generate_response_stream(
                messages,
                runtime_context,
                request_settings=request_settings,
            ):
                if chunk:
                    yield f"data: {json.dumps({'chunk': chunk})}\n\n"

            yield f"data: {json.dumps({'done': True})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/chat", summary="Chat with AI Copilot (legacy)")
async def chat_endpoint(request: ChatRequest):
    """
    Stream a chat response from the AI Copilot using history.
    Legacy endpoint - use /chat/stream for SSE format.
    """
    messages_dict = [m.model_dump() for m in request.messages]
    context = request.context or {}

    return StreamingResponse(
        llm_service.generate_response_stream(messages_dict, context), media_type="text/plain"
    )


@router.post("/ask", summary="Ask Copilot a single question")
async def ask_endpoint(request: AskRequest):
    """
    Simple question-answer endpoint for quick queries.
    Uses pattern matching first, then LLM fallback.
    """
    from vnibb.services.copilot_service import CopilotQuery

    result = await copilot_service.process(
        CopilotQuery(query=request.query, context=request.context)
    )
    return result


@router.get("/prompts", response_model=PromptsResponse)
async def get_prompts():
    """Get available pre-built prompt templates."""
    prompts = [
        PromptTemplate(
            id="analyze", label="📊 Analyze", template=PROMPT_TEMPLATES.get("analyze", "")
        ),
        PromptTemplate(
            id="compare", label="⚖️ Compare", template=PROMPT_TEMPLATES.get("compare", "")
        ),
        PromptTemplate(
            id="financials", label="💰 Financials", template=PROMPT_TEMPLATES.get("financials", "")
        ),
        PromptTemplate(
            id="technical", label="📈 Technical", template=PROMPT_TEMPLATES.get("technical", "")
        ),
        PromptTemplate(id="news", label="📰 News", template=PROMPT_TEMPLATES.get("news", "")),
    ]
    return PromptsResponse(prompts=prompts)


@router.get("/suggestions", response_model=CopilotSuggestionResponse)
async def get_suggestions():
    """Get active copilot suggestions based on current market."""
    return CopilotSuggestionResponse(
        suggestions=[
            "Analyze VNM for investment",
            "Compare FPT and MWG",
            "Technical outlook for VCB",
            "Summarize HPG financials",
        ]
    )
