"""
AI Copilot API - Chat with context-aware LLM for stock analysis

Provides:
- SSE streaming chat endpoint
- Widget context integration
- Pre-built prompt templates
"""

import json
from typing import Any, Literal

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, model_validator
from fastapi.responses import StreamingResponse

from vnibb.core.auth import get_current_user
from vnibb.core.database import async_session_maker
from vnibb.schemas.matrix import MatrixSelection
from vnibb.services.matrix_copilot_context import build_matrix_copilot_context
from vnibb.services.matrix_service import resolve_matrix_selection, require_matrix_export_rights
from vnibb.services.ai_context_service import ai_context_service
from vnibb.services.ai_document_service import ai_document_service
from vnibb.services.ai_model_catalog_service import ai_model_catalog_service
from vnibb.services.ai_prompt_library_service import (
    CuratedWorkflowSelection,
    ai_prompt_library_service,
    apply_curated_workflow,
    resolve_curated_workflow,
)
from vnibb.services.ai_runtime_config_service import ai_runtime_config_service
from vnibb.services.ai_telemetry_service import ai_telemetry_service
from vnibb.services.copilot_service import copilot_service
from vnibb.services.llm_service import llm_service
from vnibb.services.vnibb_mcp_client_service import vnibb_mcp_client_service

router = APIRouter()
SUPPORTED_COPILOT_PROVIDERS = {"openrouter", "openai_compatible"}


def _normalize_copilot_provider(provider: str | None) -> str:
    normalized = str(provider or "openrouter").strip().lower()
    return normalized if normalized in SUPPORTED_COPILOT_PROVIDERS else "openrouter"


def _resolve_prefer_database_data(settings: "CopilotRequestSettings | None") -> bool:
    """Resolve the database-first flag from the request.

    Absent an explicit value, database-first is on.
    """
    if settings is None:
        return True
    if settings.preferDatabaseData is not None:
        return bool(settings.preferDatabaseData)
    return True


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
    preferDatabaseData: bool | None = None
    enableWorkflowOutputs: bool = True


class ChatStreamRequest(BaseModel):
    """Request for streaming chat."""

    message: str
    context: WidgetContext | None = None
    history: list[Message] = []
    settings: CopilotRequestSettings | None = None
    matrix_selection: MatrixSelection | None = None
    workflow: CuratedWorkflowSelection | None = None


RESERVED_SERVER_CONTEXT_KEYS = ("matrix_selection", "source_catalog", "curated_workflow")


def _reject_reserved_client_context(context: dict[str, Any] | None) -> None:
    reserved = [key for key in RESERVED_SERVER_CONTEXT_KEYS if key in (context or {})]
    if reserved:
        raise ValueError(
            f"Server-owned context keys cannot be supplied by clients: {', '.join(reserved)}"
        )


def _validate_curated_workflow_scope(
    selection: CuratedWorkflowSelection,
    scope: str,
    context: "WidgetContext | None",
    matrix_context: dict[str, Any] | None,
) -> None:
    """Reject contradicted workflow/symbol scope before the SSE stream opens.

    The authoritative evidence check lives in ``apply_curated_workflow`` after the
    runtime context exists. This gate only catches identity conflicts that are
    already decidable from the request plus authorized server state, so a matching
    workflow never opens a stream it cannot satisfy.
    """

    def _reject(detail: str) -> None:
        raise HTTPException(
            status_code=422, detail=detail, headers={"Cache-Control": "no-store"}
        )

    context_symbol = str((context.symbol if context else "") or "").strip().upper()
    selection_symbol = str(selection.symbol or "").strip().upper()

    if scope == "matrix":
        if selection_symbol:
            entity_ids = {
                str(item).strip().upper()
                for item in (matrix_context or {})
                .get("matrix_selection", {})
                .get("entity_ids", [])
            }
            if selection_symbol not in entity_ids:
                _reject("Curated workflow symbol is outside the frozen Matrix selection")
        return

    if scope in {"symbol", "symbol_market"}:
        if selection_symbol and context_symbol and selection_symbol != context_symbol:
            _reject("Curated workflow symbol does not match the current context")
        requested = selection_symbol or context_symbol
        # Repo symbol contract: 2-4 ASCII uppercase letters, e.g. VNM/FPT (SYMBOL_RE).
        if not requested or len(requested) < 2 or len(requested) > 4 or not requested.isascii() or not requested.isalpha():
            _reject("Select a current symbol for this curated workflow")
        return
    # Market scope intentionally ignores the active symbol; only scoped market
    # evidence is consumed, so there is nothing to conflict with here.


class ChatRequest(BaseModel):
    """Legacy chat request with full history."""

    messages: list[Message]
    context: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_client_context(self):
        _reject_reserved_client_context(self.context)
        return self


class AskRequest(BaseModel):
    query: str
    context: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_client_context(self):
        _reject_reserved_client_context(self.context)
        return self


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
    revision: int | None = None
    scope: str | None = None
    requiredEvidenceKinds: list[str] | None = None
    limits: list[str] | None = None


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


class RuntimeConfigResponse(BaseModel):
    provider: str
    model: str
    available: bool = True


class DocumentContextResponse(BaseModel):
    document: dict[str, Any]


class SharedPromptRequest(BaseModel):
    prompts: list[PromptTemplate]


class FeedbackRequest(BaseModel):
    responseId: str
    vote: Literal["up", "down"]
    surface: Literal["sidebar", "widget", "analysis"]
    notes: str | None = None
    reasons: list[str] | None = None


class FeedbackResponse(BaseModel):
    accepted: bool
    matched: bool


class OutcomeRequest(BaseModel):
    responseId: str
    kind: Literal["artifact", "action"]
    itemId: str
    status: Literal["shown", "executed", "failed", "liked", "disliked"]
    surface: Literal["sidebar", "widget", "analysis"]
    notes: str | None = None


class OutcomeResponse(BaseModel):
    accepted: bool
    matched: bool


# ============ Endpoints ============


@router.post("/chat/stream", summary="Stream chat response via SSE")
async def chat_stream(
    request: ChatStreamRequest, authorization: str | None = Header(default=None)
):
    """
    Stream a chat response using Server-Sent Events (SSE).

    Returns chunks in format: data: {"chunk": "text"}\n\n
    Final message: data: {"done": true}\n\n
    """
    matrix_context = None
    if request.matrix_selection is not None:
        try:
            user = await get_current_user(authorization)
            async with async_session_maker() as db:
                packet = await resolve_matrix_selection(
                    db, user.id, request.matrix_selection.model_dump(mode="json")
                )
            require_matrix_export_rights(packet)
            matrix_context = build_matrix_copilot_context(packet)
        except HTTPException as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.detail,
                headers={**(exc.headers or {}), "Cache-Control": "no-store"},
            ) from exc

    workflow_scope = None
    if request.workflow is not None:
        # Resolve the code-owned identity before the SSE stream opens so unknown
        # workflows fail 404 and stale revisions fail 409 instead of surfacing as
        # an in-stream error. Only id/revision/symbol ever arrive from the client;
        # instruction bodies and evidence limits are always server-owned.
        workflow_scope = resolve_curated_workflow(request.workflow)["scope"]
        if matrix_context is not None and workflow_scope != "matrix":
            raise HTTPException(
                status_code=422,
                detail=(
                    "This curated workflow does not describe the frozen Matrix selection; "
                    "use the peer-comparison workflow for Matrix selections"
                ),
                headers={"Cache-Control": "no-store"},
            )
        if matrix_context is None and workflow_scope == "matrix":
            raise HTTPException(
                status_code=422,
                detail="This curated workflow requires an authorized frozen Matrix selection",
                headers={"Cache-Control": "no-store"},
            )
        _validate_curated_workflow_scope(
            request.workflow, workflow_scope, request.context, matrix_context
        )

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
            if matrix_context is not None:
                request_settings["webSearch"] = False
                request_settings["enableWorkflowOutputs"] = False
            context_message = (
                "Using authorized frozen Matrix selection"
                if matrix_context is not None
                else (
                    "Building VNIBB MCP runtime context"
                    if vnibb_mcp_client_service.is_enabled
                    else "Building VNIBB database runtime context"
                )
            )
            yield f"data: {json.dumps({'reasoning': {'eventType': 'INFO', 'message': context_message}})}\n\n"

            context_dict = {}
            if request.context and matrix_context is None:
                context_dict = {
                    "widgetType": request.context.widgetType,
                    "widgetTypeKey": request.context.widgetTypeKey,
                    "symbol": request.context.symbol,
                    "activeTab": request.context.activeTab,
                    "data": request.context.dataSnapshot or {},
                }
                if request.context.widgetPayload:
                    context_dict["widget_payload"] = request.context.widgetPayload
            if request.workflow is not None and workflow_scope in {"symbol", "symbol_market"}:
                # The workflow symbol is verified by _validate_curated_workflow_scope
                # before the stream opens. Seed it into the pre-build context so
                # server evidence retrieval targets the workflow's symbol even when
                # the browser context carries no ticker or the message is generic.
                workflow_symbol = str(request.workflow.symbol or "").strip().upper()
                if workflow_symbol:
                    context_dict["symbol"] = workflow_symbol
            # Convert history to dict format
            messages = [{"role": m.role, "content": m.content} for m in request.history]
            messages.append({"role": "user", "content": request.message})

            if matrix_context is not None:
                runtime_context = matrix_context
            else:
                runtime_context = await ai_context_service.build_runtime_context(
                    message=request.message,
                    history=messages,
                    client_context=context_dict,
                    prefer_database_data=_resolve_prefer_database_data(request.settings),
                )
            curated_context = None
            if request.workflow is not None:
                # Apply on the server-sanitized runtime context (never the raw
                # browser payload): sanitize_context_value has already dropped
                # secrets and bounded depth, and the curated resolver re-derives
                # evidence limits from the code-owned identity.
                runtime_context = apply_curated_workflow(request.workflow, runtime_context)
                curated_context = runtime_context["curated_workflow"]
            ready_details: dict[str, Any] = {
                "symbolCount": len(runtime_context.get("market_context") or []),
                "sourceCount": len(runtime_context.get("source_catalog") or []),
            }
            if curated_context is not None:
                ready_details["workflow"] = {
                    "id": curated_context["id"],
                    "revision": curated_context["revision"],
                    "scope": curated_context["scope"],
                    "symbol": curated_context["symbol"],
                    "sourceIds": curated_context["source_ids"],
                    "missingEvidenceKinds": curated_context["missing_evidence_kinds"],
                }
            yield f"data: {json.dumps({'reasoning': {'eventType': 'SUCCESS', 'message': 'Runtime context ready', 'details': ready_details}})}\n\n"

            # Stream from LLM
            async for event in llm_service.generate_response_stream_events(
                messages,
                runtime_context,
                request_settings=request_settings,
            ):
                yield f"data: {json.dumps(event)}\n\n"

        except Exception as e:
            error = "Matrix response unavailable" if matrix_context is not None else str(e)
            yield f"data: {json.dumps({'error': error})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store" if matrix_context is not None else "no-cache",
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
        reasons=request.reasons,
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


@router.get("/runtime", response_model=RuntimeConfigResponse)
async def get_runtime_config():
    config = await ai_runtime_config_service.get_runtime_config()
    return RuntimeConfigResponse(
        provider=str(config.get("provider") or "openrouter"),
        model=str(config.get("model") or "openrouter/free"),
        available=llm_service.is_available,
    )


@router.post("/document-context", response_model=DocumentContextResponse)
async def create_document_context(file: UploadFile = File(...)):
    content = await file.read()
    document = await ai_document_service.ingest_document(
        filename=file.filename or "document",
        content_type=file.content_type,
        content=content,
    )
    return DocumentContextResponse(document=document)


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
