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
from vnibb.services.ai_model_catalog_service import ai_model_catalog_service
from vnibb.services.ai_prompt_library_service import ai_prompt_library_service
from vnibb.services.ai_runtime_config_service import ai_runtime_config_service
from vnibb.services.ai_telemetry_service import ai_telemetry_service
from vnibb.services.copilot_service import copilot_service
from vnibb.services.llm_service import llm_service

router = APIRouter()
SUPPORTED_COPILOT_PROVIDERS = {"openrouter", "openai_compatible"}


def _normalize_copilot_provider(provider: str | None) -> str:
    normalized = str(provider or "openrouter").strip().lower()
    return normalized if normalized in SUPPORTED_COPILOT_PROVIDERS else "openrouter"


# ============ Models ============


class Message(BaseModel):
    role: str
    content: str


class WidgetContext(BaseModel):
    """Context from a widget for AI analysis."""

    widgetType: str = "General"
    widgetTypeKey: str | None = None
    symbol: str = ""
    activeTab: str | None = None
    dataSnapshot: dict[str, Any] | None = None
    widgetPayload: dict[str, Any] | None = None


class CopilotRequestSettings(BaseModel):
    mode: Literal["app_default", "browser_key"] = "app_default"
    provider: Literal["openrouter", "openai_compatible"] = "openrouter"
    model: str | None = None
    apiKey: str | None = None
    baseUrl: str | None = None
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
    category: str | None = None
    recommendedWidgetKeys: list[str] | None = None
    isDefault: bool | None = None
    source: str | None = None


class PromptsResponse(BaseModel):
    prompts: list[PromptTemplate]


class ModelOption(BaseModel):
    id: str
    name: str
    provider: str
    description: str | None = None
    recommended: bool = False
    tier: str | None = None
    context_length: int | None = None


class ModelCatalogResponse(BaseModel):
    models: list[ModelOption]


class SharedPromptRequest(BaseModel):
    prompts: list[PromptTemplate]


class FeedbackRequest(BaseModel):
    responseId: str
    vote: Literal["up", "down"]
    surface: Literal["sidebar", "widget", "analysis"]
    notes: str | None = None


class FeedbackResponse(BaseModel):
    accepted: bool
    matched: bool


class OutcomeRequest(BaseModel):
    responseId: str
    kind: Literal["artifact", "action"]
    itemId: str
    status: Literal["shown", "executed", "failed"]
    surface: Literal["sidebar", "widget", "analysis"]
    notes: str | None = None


class OutcomeResponse(BaseModel):
    accepted: bool
    matched: bool


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
            request_settings["provider"] = _normalize_copilot_provider(
                request_settings.get("provider")
            )
            if str(request_settings.get("mode") or "app_default") != "browser_key":
                runtime_config = await ai_runtime_config_service.get_runtime_config()
                request_settings["provider"] = _normalize_copilot_provider(
                    runtime_config.get("provider")
                )
                request_settings["model"] = str(runtime_config.get("model") or "").strip()
            yield f"data: {json.dumps({'reasoning': {'eventType': 'INFO', 'message': 'Building Appwrite-first runtime context'}})}\n\n"

            context_dict = {}
            if request.context:
                context_dict = {
                    "widgetType": request.context.widgetType,
                    "widgetTypeKey": request.context.widgetTypeKey,
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
            yield f"data: {json.dumps({'reasoning': {'eventType': 'SUCCESS', 'message': 'Runtime context ready', 'details': {'symbolCount': len(runtime_context.get('market_context') or []), 'sourceCount': len(runtime_context.get('source_catalog') or [])}}})}\n\n"

            # Stream from LLM
            async for event in llm_service.generate_response_stream_events(
                messages,
                runtime_context,
                request_settings=request_settings,
            ):
                yield f"data: {json.dumps(event)}\n\n"

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


@router.post("/feedback", response_model=FeedbackResponse, summary="Record copilot feedback")
async def submit_feedback(request: FeedbackRequest):
    payload = await ai_telemetry_service.record_feedback(
        response_id=request.responseId,
        vote=request.vote,
        surface=request.surface,
        notes=request.notes,
    )
    return FeedbackResponse(accepted=True, matched=bool(payload.get("matched")))


@router.post(
    "/outcome", response_model=OutcomeResponse, summary="Record copilot artifact/action outcome"
)
async def submit_outcome(request: OutcomeRequest):
    payload = await ai_telemetry_service.record_outcome(
        response_id=request.responseId,
        kind=request.kind,
        item_id=request.itemId,
        status=request.status,
        surface=request.surface,
        notes=request.notes,
    )
    return OutcomeResponse(accepted=True, matched=bool(payload.get("matched")))


@router.get("/prompts", response_model=PromptsResponse)
async def get_prompts():
    """Get available VniAgent prompt templates."""
    prompts = [
        PromptTemplate(**prompt) for prompt in await ai_prompt_library_service.get_public_prompts()
    ]
    return PromptsResponse(prompts=prompts)


@router.get("/models", response_model=ModelCatalogResponse)
async def get_models(provider: Literal["openrouter"] = "openrouter"):
    if provider != "openrouter":
        return ModelCatalogResponse(models=[])
    models = [
        ModelOption(**model) for model in await ai_model_catalog_service.get_openrouter_models()
    ]
    return ModelCatalogResponse(models=models)


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
