from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

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
        "source": "system",
    },
    {
        "id": "peer-comparison",
        "label": "Peer Comparison",
        "template": "From the current comparison context for {symbol}, compare valuation multiples, profitability, and momentum. Identify the most attractive and least attractive name and explain why.",
        "category": "comparison",
        "recommendedWidgetKeys": ["comparison"],
        "isDefault": True,
        "source": "system",
    },
    {
        "id": "financial-summary",
        "label": "Financial Summary",
        "template": "Summarize the key financial signals for {symbol} from {widget_or_symbol}. Focus on revenue growth, margins, leverage, cash generation, and the single biggest balance-sheet risk.",
        "category": "fundamentals",
        "recommendedWidgetKeys": ["financials"],
        "isDefault": True,
        "source": "system",
    },
    {
        "id": "earnings-forecast",
        "label": "Earnings Forecast",
        "template": "Based on the historical earnings data in {widget_or_symbol} and current market conditions, provide an outlook for the next quarter for {symbol}. Include key drivers, key risks, and what would invalidate the forecast.",
        "category": "analysis",
        "recommendedWidgetKeys": ["financials"],
        "isDefault": True,
        "source": "system",
    },
    {
        "id": "technical-analysis",
        "label": "Technical Outlook",
        "template": "Read the current chart context for {symbol}. Provide support, resistance, trend direction, invalidation levels, and the clearest trade setup from this widget.",
        "category": "technical",
        "recommendedWidgetKeys": ["price_chart"],
        "isDefault": True,
        "source": "system",
    },
    {
        "id": "ownership-analysis",
        "label": "Ownership Structure",
        "template": "Analyze the ownership and control context for {symbol}. Identify major holders, alignment risks, and anything that could materially affect governance or float.",
        "category": "fundamentals",
        "isDefault": True,
        "source": "system",
    },
    {
        "id": "foreign-flow-read",
        "label": "Foreign Flow Read",
        "template": "Use {widget_or_symbol} to explain whether foreign participation in {symbol} is persistent accumulation, noisy rotation, or distribution. State what that implies for conviction.",
        "category": "analysis",
        "recommendedWidgetKeys": ["foreign_trading"],
        "isDefault": True,
        "source": "system",
    },
    {
        "id": "breadth-regime",
        "label": "Breadth Regime",
        "template": "Using the current market breadth context on {tab}, explain whether the market is risk-on, risk-off, or mixed. Call out sector leadership and what it means for positioning.",
        "category": "analysis",
        "recommendedWidgetKeys": ["market_breadth"],
        "isDefault": True,
        "source": "system",
    },
    {
        "id": "news-impact",
        "label": "News Impact",
        "template": "Summarize the most important recent news and event risk for {symbol}. Explain what matters immediately versus what matters over the next quarter.",
        "category": "news",
        "isDefault": True,
        "source": "system",
    },
]

VALID_PROMPT_CATEGORIES = {"analysis", "comparison", "fundamentals", "technical", "news", "custom"}


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
