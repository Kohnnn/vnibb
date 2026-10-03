from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from vnibb.services.matrix_playbooks import PLAYBOOKS

from sqlalchemy.exc import SQLAlchemyError

from vnibb.core.database import async_session_maker
from vnibb.models.app_kv import AppKeyValue

logger = logging.getLogger(__name__)

AI_PROMPT_LIBRARY_KEY = "ai_prompt_library"
PROMPT_LIBRARY_HISTORY_LIMIT = 10

DEFAULT_PROMPTS: list[dict[str, Any]] = [
    {
        "id": "dividend-analysis",
        "label": "Dividend Analysis",
        "template": "Using {widget_or_symbol} as the primary context, analyze the trend in dividend payouts for {symbol} over the past 5 years. Include dividend yield, payout ratio, and sustainability assessment.",
        "category": "analysis",
        "recommendedWidgetKeys": ["financials"],
        "isDefault": True,
        "revision": 1,
        "scope": "symbol",
        "requiredEvidenceKinds": ["dividends", "income_statement", "cash_flow"],
        "limits": ["Historical payouts are not a promise of future dividends.", "Unknown dates and missing payout history remain explicit limitations."],
        "source": "system",
    },
    {
        "id": "peer-comparison",
        "label": "Peer Comparison",
        "template": "Review the authorized frozen Matrix selection using its existing sector Research Playbook. Preserve exact selected evidence, accounting basis, result states and limitations; do not infer unselected data or rank incomparable companies.",
        "category": "comparison",
        "recommendedWidgetKeys": ["comparison", "research_matrix"],
        "isDefault": True,
        "revision": 1,
        "scope": "matrix",
        "requiredEvidenceKinds": ["matrix_evidence"],
        "limits": ["Requires an authorized frozen Matrix selection and its existing sector Research Playbook.", "Selected cells do not establish whole-market coverage or comparability."],
        "source": "system",
    },
    {
        "id": "financial-summary",
        "label": "Financial Summary",
        "template": "Summarize the key financial signals for {symbol} from {widget_or_symbol}. Focus on revenue growth, margins, leverage, cash generation, and the single biggest balance-sheet risk.",
        "category": "fundamentals",
        "recommendedWidgetKeys": ["financials"],
        "isDefault": True,
        "revision": 1,
        "scope": "symbol",
        "requiredEvidenceKinds": ["income_statement", "balance_sheet", "cash_flow", "financial_ratios"],
        "limits": ["Missing statements or ratios prevent a complete fundamental review.", "Preserve reporting periods, units and unknown source dates; no investment advice."],
        "source": "system",
    },
    {
        "id": "earnings-forecast",
        "label": "Earnings Forecast",
        "template": "Based on the historical earnings data in {widget_or_symbol} and current market conditions, provide an outlook for the next quarter for {symbol}. Include key drivers, key risks, and what would invalidate the forecast.",
        "category": "analysis",
        "recommendedWidgetKeys": ["financials"],
        "isDefault": True,
        "revision": 1,
        "scope": "symbol",
        "requiredEvidenceKinds": ["income_statement", "company_events"],
        "limits": ["An outlook is a conditional scenario, not a verified forecast.", "Do not invent earnings dates, consensus estimates or unreported results."],
        "source": "system",
    },
    {
        "id": "technical-analysis",
        "label": "Technical Outlook",
        "template": "Read the current chart context for {symbol}. Provide support, resistance, trend direction, invalidation levels, and the clearest trade setup from this widget.",
        "category": "technical",
        "recommendedWidgetKeys": ["price_chart"],
        "isDefault": True,
        "revision": 1,
        "scope": "symbol",
        "requiredEvidenceKinds": ["price_history"],
        "limits": ["Stored prices may lag the market; no execution or live-price guarantee.", "Levels are conditional observations, not advice."],
        "source": "system",
    },
    {
        "id": "ownership-analysis",
        "label": "Ownership Structure",
        "template": "Analyze the ownership and control context for {symbol}. Identify major holders, alignment risks, and anything that could materially affect governance or float.",
        "category": "fundamentals",
        "isDefault": True,
        "revision": 1,
        "scope": "symbol",
        "requiredEvidenceKinds": ["company_profile", "insider_deals"],
        "limits": ["Profile and insider records do not establish a complete beneficial-owner register."],
        "source": "system",
    },
    {
        "id": "foreign-flow-read",
        "label": "Foreign Flow Read",
        "template": "Use {widget_or_symbol} to explain whether foreign participation in {symbol} is persistent accumulation, noisy rotation, or distribution. State what that implies for conviction.",
        "category": "analysis",
        "recommendedWidgetKeys": ["foreign_trading"],
        "isDefault": True,
        "revision": 1,
        "scope": "symbol",
        "requiredEvidenceKinds": ["foreign_trading", "price_history"],
        "limits": ["Stored flow observations do not prove investor intent or future flows."],
        "source": "system",
    },
    {
        "id": "breadth-regime",
        "label": "Breadth Regime",
        "template": "Using the current market breadth context on {tab}, explain whether the market is risk-on, risk-off, or mixed. Call out sector leadership and what it means for positioning.",
        "category": "analysis",
        "recommendedWidgetKeys": ["market_breadth"],
        "isDefault": True,
        "revision": 1,
        "scope": "market",
        "requiredEvidenceKinds": ["market_indices", "sector_breadth"],
        "limits": ["Broad market context is independent of the active symbol and may have unknown dates."],
        "source": "system",
    },
    {
        "id": "news-impact",
        "label": "News Impact",
        "template": "Summarize the most important recent news and event risk for {symbol}. Explain what matters immediately versus what matters over the next quarter.",
        "category": "news",
        "isDefault": True,
        "revision": 1,
        "scope": "symbol",
        "requiredEvidenceKinds": ["company_news", "company_events"],
        "limits": ["News summaries may be incomplete; do not imply real-time or exhaustive event coverage."],
        "source": "system",
    },
    {
        "id": "global-context",
        "label": "Global Context",
        "template": "Place the stored price context for {symbol} against the available market indices and sector breadth. Separate observed domestic market context from unavailable global evidence, and state what would invalidate the setup.",
        "category": "technical",
        "recommendedWidgetKeys": ["price_chart", "market_breadth"],
        "isDefault": True,
        "source": "system",
        "revision": 1,
        "scope": "symbol_market",
        "requiredEvidenceKinds": ["price_history", "market_indices", "sector_breadth"],
        "limits": ["Domestic index and sector evidence does not establish global-market coverage.", "No live-price or execution guarantee."],
    },
]

VALID_PROMPT_CATEGORIES = {"analysis", "comparison", "fundamentals", "technical", "news", "custom"}


class CuratedWorkflowSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=80)
    revision: int = Field(strict=True, ge=1)
    symbol: str | None = Field(default=None, max_length=16)


def resolve_curated_workflow(selection: CuratedWorkflowSelection) -> dict[str, Any]:
    workflow = next((item for item in DEFAULT_PROMPTS if item["id"] == selection.id), None)
    if workflow is None:
        raise HTTPException(404, "Unknown curated workflow")
    if workflow["revision"] != selection.revision:
        raise HTTPException(409, "Curated workflow revision changed; refresh the prompt library")
    return workflow


def apply_curated_workflow(
    selection: CuratedWorkflowSelection, context: dict[str, Any]
) -> dict[str, Any]:
    workflow = resolve_curated_workflow(selection)
    scope = workflow["scope"]
    if "matrix_selection" in context and scope != "matrix":
        raise HTTPException(422, "Choose the Matrix peer workflow for a frozen Matrix selection")
    active_symbol = str((context.get("client_context") or {}).get("symbol") or "").strip().upper()
    symbol = str(selection.symbol or active_symbol).strip().upper() or None
    if scope in {"symbol", "symbol_market"}:
        if not symbol or not symbol.isascii() or not symbol.isalnum():
            raise HTTPException(422, "Select a current symbol for this curated workflow")
        if active_symbol and symbol != active_symbol:
            raise HTTPException(422, "Curated workflow symbol does not match the current context")

    sources = [
        source for source in (context.get("source_catalog") or [])
        if isinstance(source, dict) and str(source.get("id") or "").strip()
        and (
            (scope in {"market", "symbol_market"} and source.get("scope") == "market")
            or (scope in {"symbol", "symbol_market"} and source.get("scope") == "symbol"
                and str(source.get("symbol") or "").strip().upper() == symbol)
        )
    ]
    available_kinds = {str(source.get("kind") or "") for source in sources}
    playbook = None
    if scope == "matrix":
        packet = context.get("matrix_selection") or {}
        snapshot = packet.get("snapshot") or {}
        playbook = next((item for item in PLAYBOOKS if item["playbook_id"] == snapshot.get("playbook_id")), None)
        if playbook is None or playbook["definition_revision"] != snapshot.get("definition_revision"):
            raise HTTPException(422, "Use an authorized Matrix selection with a current Research Playbook")
        if symbol and symbol not in packet.get("entity_ids", []):
            raise HTTPException(422, "Curated workflow symbol is outside the Matrix selection")
        sources = [source for source in (context.get("source_catalog") or [])
                   if isinstance(source, dict) and str(source.get("id") or "").strip()
                   and source.get("scope") == "matrix" and source.get("evidence_id")]
        available_kinds = {"matrix_evidence"} if sources else set()

    missing = [kind for kind in workflow["requiredEvidenceKinds"] if kind not in available_kinds]
    limitations = list(workflow["limits"])
    limitations.extend(f"Missing required evidence: {kind}. Do not infer its availability or values." for kind in missing)
    if any(not source.get("as_of") for source in sources):
        limitations.append("Some evidence has an unknown as-of date; do not claim it is current.")
    return {
        **context,
        "source_catalog": sources,
        "curated_workflow": {
            "id": workflow["id"], "revision": workflow["revision"], "symbol": symbol,
            "scope": scope, "required_evidence_kinds": list(workflow["requiredEvidenceKinds"]),
            "missing_evidence_kinds": missing, "limitations": limitations,
            "source_ids": [source["id"] for source in sources],
            "playbook_id": playbook["playbook_id"] if playbook else None,
        },
    }


def curated_workflow_instructions(context: dict[str, Any]) -> str:
    metadata = context.get("curated_workflow")
    if not isinstance(metadata, dict):
        return ""
    selection = CuratedWorkflowSelection.model_validate({
        key: metadata.get(key) for key in ("id", "revision", "symbol")
    })
    resolved = apply_curated_workflow(selection, context)["curated_workflow"]
    workflow = resolve_curated_workflow(selection)
    instruction = workflow["template"].replace("{symbol}", resolved["symbol"] or "the selected companies")
    instruction = instruction.replace("{widget_or_symbol}", "the scoped server evidence").replace("{tab}", "the current workspace")
    if resolved["playbook_id"]:
        playbook = next(item for item in PLAYBOOKS if item["playbook_id"] == resolved["playbook_id"])
        instruction = "Review the selected companies using the existing Research Playbook. " + playbook["description"]
        instruction += " Questions: " + " ".join(item["question"] for item in playbook["dimensions"])
    return (
        f"\nReviewed curated workflow {selection.id}@{selection.revision}. Scope: {resolved['scope']}; symbol: {resolved['symbol'] or 'selected scope'}.\n"
        + instruction + "\nMandatory evidence: " + ", ".join(resolved["required_evidence_kinds"])
        + ".\nLimitations: " + " ".join(resolved["limitations"])
        + "\nUse only matching scoped server evidence. Cite its source IDs. When required evidence is missing, begin with an explicit limited-evidence assessment rather than a complete workflow conclusion."
    )


class AIPromptLibraryService:
    def __init__(self) -> None:
        self._memory_shared_prompts: list[dict[str, Any]] | None = None
        self._memory_metadata: dict[str, Any] | None = None

    def _sanitize_prompt(
        self, prompt: dict[str, Any], *, source: str, is_default: bool
    ) -> dict[str, Any] | None:
        prompt_id = str(prompt.get("id") or "").strip()
        label = str(prompt.get("label") or prompt.get("name") or "").strip()
        template = str(prompt.get("template") or prompt.get("content") or "").strip()
        category = str(prompt.get("category") or "custom").strip().lower()
        if not prompt_id or not label or not template:
            return None
        if category not in VALID_PROMPT_CATEGORIES:
            category = "custom"
        recommended_widget_keys = (
            prompt.get("recommendedWidgetKeys") or prompt.get("recommended_widget_keys") or []
        )
        if not isinstance(recommended_widget_keys, list):
            recommended_widget_keys = []

        return {
            "id": prompt_id,
            "label": label,
            "template": template,
            "category": category,
            "recommendedWidgetKeys": [
                str(item).strip() for item in recommended_widget_keys if str(item).strip()
            ],
            "isDefault": is_default,
            "source": source,
        }

    async def get_library_state(self) -> dict[str, Any]:
        if self._memory_shared_prompts is not None and self._memory_metadata is not None:
            return {
                "prompts": [dict(prompt) for prompt in self._memory_shared_prompts],
                **self._memory_metadata,
            }

        try:
            async with async_session_maker() as session:
                record = await session.get(AppKeyValue, AI_PROMPT_LIBRARY_KEY)
                if record and isinstance(record.value, dict):
                    raw_prompts = record.value.get("prompts") or []
                    if isinstance(raw_prompts, list):
                        self._memory_shared_prompts = [
                            sanitized
                            for prompt in raw_prompts
                            if isinstance(prompt, dict)
                            for sanitized in [
                                self._sanitize_prompt(prompt, source="shared", is_default=False)
                            ]
                            if sanitized is not None
                        ]
                    self._memory_metadata = {
                        "version": int(record.value.get("version") or 0),
                        "updated_at": str(record.value.get("updated_at") or "") or None,
                        "history": [
                            {
                                "version": int(item.get("version") or 0),
                                "updated_at": str(item.get("updated_at") or "") or None,
                                "prompt_count": int(item.get("prompt_count") or 0),
                            }
                            for item in (record.value.get("history") or [])
                            if isinstance(item, dict)
                        ],
                    }
        except SQLAlchemyError as exc:
            logger.warning("AI prompt library read failed: %s", exc)

        if self._memory_metadata is None:
            self._memory_metadata = {"version": 0, "updated_at": None, "history": []}
        return {
            "prompts": [dict(prompt) for prompt in (self._memory_shared_prompts or [])],
            **self._memory_metadata,
        }

    async def get_shared_prompts(self) -> list[dict[str, Any]]:
        return (await self.get_library_state())["prompts"]

    async def get_public_prompts(self) -> list[dict[str, Any]]:
        defaults = [dict(prompt) for prompt in DEFAULT_PROMPTS]
        shared = await self.get_shared_prompts()
        return [*defaults, *shared]

    async def save_shared_prompts(self, prompts: list[dict[str, Any]]) -> list[dict[str, Any]]:
        state = await self.get_library_state()
        sanitized_prompts = [
            sanitized
            for prompt in prompts
            if isinstance(prompt, dict)
            for sanitized in [self._sanitize_prompt(prompt, source="shared", is_default=False)]
            if sanitized is not None
        ]
        next_version = int(state.get("version") or 0) + 1
        history = list(state.get("history") or [])
        history.append(
            {
                "version": next_version,
                "updated_at": datetime.now(UTC).isoformat(),
                "prompt_count": len(sanitized_prompts),
            }
        )
        payload = {
            "prompts": sanitized_prompts,
            "updated_at": datetime.now(UTC).isoformat(),
            "version": next_version,
            "history": history[-PROMPT_LIBRARY_HISTORY_LIMIT:],
        }
        self._memory_shared_prompts = sanitized_prompts
        self._memory_metadata = {
            "version": next_version,
            "updated_at": payload["updated_at"],
            "history": payload["history"],
        }

        try:
            async with async_session_maker() as session:
                record = await session.get(AppKeyValue, AI_PROMPT_LIBRARY_KEY)
                if record:
                    record.value = payload
                    record.updated_at = datetime.now(UTC).replace(tzinfo=None)
                else:
                    session.add(
                        AppKeyValue(
                            key=AI_PROMPT_LIBRARY_KEY,
                            value=payload,
                            updated_at=datetime.now(UTC).replace(tzinfo=None),
                        )
                    )
                await session.commit()
        except SQLAlchemyError as exc:
            logger.warning("AI prompt library write failed: %s", exc)

        return [dict(prompt) for prompt in sanitized_prompts]


ai_prompt_library_service = AIPromptLibraryService()
