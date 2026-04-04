from __future__ import annotations

import json
import logging
from collections import OrderedDict
from datetime import UTC, datetime
from threading import Lock
from typing import Any

from sqlalchemy.exc import SQLAlchemyError

from vnibb.core.database import async_session_maker
from vnibb.models.app_kv import AppKeyValue

logger = logging.getLogger(__name__)

AI_TELEMETRY_KEY = "ai_telemetry_log"


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


class AITelemetryService:
    def __init__(self, max_records: int = 500):
        self.max_records = max(1, int(max_records))
        self._records: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._lock = Lock()
        self._loaded = False

    async def _ensure_loaded(self) -> None:
        if self._loaded:
            return

        try:
            async with async_session_maker() as session:
                record = await session.get(AppKeyValue, AI_TELEMETRY_KEY)
                if record and isinstance(record.value, dict):
                    raw_records = record.value.get("records") or []
                    if isinstance(raw_records, list):
                        with self._lock:
                            self._records.clear()
                            for item in raw_records:
                                if not isinstance(item, dict):
                                    continue
                                response_id = str(item.get("response_id") or "").strip()
                                if not response_id:
                                    continue
                                self._records[response_id] = item
                            while len(self._records) > self.max_records:
                                self._records.popitem(last=False)
        except SQLAlchemyError as exc:
            logger.warning("AI telemetry load failed: %s", exc)
        finally:
            self._loaded = True

    async def _persist(self) -> None:
        payload = {
            "records": [dict(record) for record in self._records.values()],
            "updated_at": _utc_now_iso(),
        }
        try:
            async with async_session_maker() as session:
                record = await session.get(AppKeyValue, AI_TELEMETRY_KEY)
                if record:
                    record.value = payload
                    record.updated_at = datetime.now(UTC).replace(tzinfo=None)
                else:
                    session.add(
                        AppKeyValue(
                            key=AI_TELEMETRY_KEY,
                            value=payload,
                            updated_at=datetime.now(UTC).replace(tzinfo=None),
                        )
                    )
                await session.commit()
        except SQLAlchemyError as exc:
            logger.warning("AI telemetry persist failed: %s", exc)

    async def record_response(
        self,
        *,
        response_id: str,
        provider: str,
        model: str,
        mode: str,
        latency_ms: int,
        used_source_ids: list[str],
        artifact_ids: list[str],
        action_ids: list[str],
        reasoning_events: list[dict[str, Any]],
        current_symbol: str | None,
        prompt_preview: str,
    ) -> dict[str, Any]:
        await self._ensure_loaded()
        record = {
            "response_id": response_id,
            "provider": provider,
            "model": model,
            "mode": mode,
            "latency_ms": int(latency_ms),
            "used_source_ids": used_source_ids,
            "artifact_ids": artifact_ids,
            "action_ids": action_ids,
            "reasoning_events": reasoning_events,
            "current_symbol": current_symbol,
            "prompt_preview": prompt_preview,
            "created_at": _utc_now_iso(),
            "feedback": None,
            "outcomes": [],
        }

        with self._lock:
            self._records[response_id] = record
            self._records.move_to_end(response_id)
            while len(self._records) > self.max_records:
                self._records.popitem(last=False)

        await self._persist()
        logger.info("AI response telemetry %s", json.dumps(record, ensure_ascii=True, default=str))
        return record

    async def record_feedback(
        self,
        *,
        response_id: str,
        vote: str,
        surface: str,
        notes: str | None = None,
        reasons: list[str] | None = None,
    ) -> dict[str, Any]:
        await self._ensure_loaded()
        feedback = {
            "vote": str(vote or "").strip().lower(),
            "surface": str(surface or "unknown").strip().lower(),
            "notes": str(notes or "").strip()[:500] or None,
            "reasons": [
                str(reason).strip().lower() for reason in (reasons or []) if str(reason).strip()
            ],
            "received_at": _utc_now_iso(),
        }

        matched = False
        response_record: dict[str, Any] | None = None
        with self._lock:
            existing = self._records.get(response_id)
            if existing is not None:
                existing["feedback"] = feedback
                self._records.move_to_end(response_id)
                matched = True
                response_record = dict(existing)

        if matched:
            await self._persist()

        payload = {
            "response_id": response_id,
            "matched": matched,
            "feedback": feedback,
            "provider": response_record.get("provider") if response_record else None,
            "model": response_record.get("model") if response_record else None,
        }
        logger.info("AI feedback telemetry %s", json.dumps(payload, ensure_ascii=True, default=str))
        return payload

    async def record_outcome(
        self,
        *,
        response_id: str,
        kind: str,
        item_id: str,
        status: str,
        surface: str,
        notes: str | None = None,
    ) -> dict[str, Any]:
        await self._ensure_loaded()
        outcome = {
            "kind": str(kind or "").strip().lower(),
            "item_id": str(item_id or "").strip(),
            "status": str(status or "").strip().lower(),
            "surface": str(surface or "unknown").strip().lower(),
            "notes": str(notes or "").strip()[:500] or None,
            "recorded_at": _utc_now_iso(),
        }

        matched = False
        response_record: dict[str, Any] | None = None
        with self._lock:
            existing = self._records.get(response_id)
            if existing is not None:
                outcomes = existing.setdefault("outcomes", [])
                outcomes.append(outcome)
                self._records.move_to_end(response_id)
                matched = True
                response_record = dict(existing)

        if matched:
            await self._persist()

        payload = {
            "response_id": response_id,
            "matched": matched,
            "outcome": outcome,
            "provider": response_record.get("provider") if response_record else None,
            "model": response_record.get("model") if response_record else None,
        }
        logger.info("AI outcome telemetry %s", json.dumps(payload, ensure_ascii=True, default=str))
        return payload

    async def get_recent_records(self, limit: int = 50) -> list[dict[str, Any]]:
        await self._ensure_loaded()
        safe_limit = max(1, min(int(limit), self.max_records))
        with self._lock:
            return [dict(record) for record in list(self._records.values())[-safe_limit:]][::-1]

    async def get_review_payload(
        self,
        *,
        limit: int = 50,
        provider: str | None = None,
        model: str | None = None,
        symbol: str | None = None,
        vote: str | None = None,
        surface: str | None = None,
        search: str | None = None,
    ) -> dict[str, Any]:
        records = await self.get_recent_records(limit=self.max_records)

        provider_filter = str(provider or "").strip().lower()
        model_filter = str(model or "").strip().lower()
        symbol_filter = str(symbol or "").strip().upper()
        vote_filter = str(vote or "").strip().lower()
        surface_filter = str(surface or "").strip().lower()
        search_filter = str(search or "").strip().lower()

        filtered: list[dict[str, Any]] = []
        for record in records:
            if (
                provider_filter
                and str(record.get("provider") or "").strip().lower() != provider_filter
            ):
                continue
            if model_filter and model_filter not in str(record.get("model") or "").strip().lower():
                continue
            if (
                symbol_filter
                and str(record.get("current_symbol") or "").strip().upper() != symbol_filter
            ):
                continue
            feedback = record.get("feedback") or {}
            if vote_filter and str(feedback.get("vote") or "").strip().lower() != vote_filter:
                continue
            if surface_filter:
                outcome_surfaces = {
                    str(outcome.get("surface") or "").strip().lower()
                    for outcome in (record.get("outcomes") or [])
                    if isinstance(outcome, dict)
                }
                feedback_surface = str(feedback.get("surface") or "").strip().lower()
                if feedback_surface != surface_filter and surface_filter not in outcome_surfaces:
                    continue
            if search_filter:
                haystack = " ".join(
                    [
                        str(record.get("prompt_preview") or ""),
                        str(record.get("current_symbol") or ""),
                        str(record.get("model") or ""),
                        str(feedback.get("notes") or ""),
                        " ".join(str(reason) for reason in (feedback.get("reasons") or [])),
                    ]
                ).lower()
                if search_filter not in haystack:
                    continue
            filtered.append(record)

        limited = filtered[: max(1, min(int(limit), self.max_records))]
        feedback_records = [record for record in filtered if record.get("feedback")]
        positive = sum(
            1 for record in feedback_records if (record.get("feedback") or {}).get("vote") == "up"
        )
        negative = sum(
            1 for record in feedback_records if (record.get("feedback") or {}).get("vote") == "down"
        )
        latencies = [
            int(record.get("latency_ms") or 0)
            for record in filtered
            if int(record.get("latency_ms") or 0) > 0
        ]
        outcomes = [
            outcome
            for record in filtered
            for outcome in (record.get("outcomes") or [])
            if isinstance(outcome, dict)
        ]
        liked_artifacts = sum(
            1
            for outcome in outcomes
            if outcome.get("kind") == "artifact" and outcome.get("status") == "liked"
        )
        disliked_artifacts = sum(
            1
            for outcome in outcomes
            if outcome.get("kind") == "artifact" and outcome.get("status") == "disliked"
        )

        summary = {
            "total": len(filtered),
            "feedback_total": len(feedback_records),
            "positive_feedback": positive,
            "negative_feedback": negative,
            "acceptance_rate": round((positive / len(feedback_records)) * 100, 1)
            if feedback_records
            else None,
            "average_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else None,
            "artifact_ratings": {
                "liked": liked_artifacts,
                "disliked": disliked_artifacts,
            },
            "providers": sorted(
                {
                    str(record.get("provider") or "")
                    for record in filtered
                    if str(record.get("provider") or "").strip()
                }
            ),
            "models": sorted(
                {
                    str(record.get("model") or "")
                    for record in filtered
                    if str(record.get("model") or "").strip()
                }
            ),
            "symbols": sorted(
                {
                    str(record.get("current_symbol") or "")
                    for record in filtered
                    if str(record.get("current_symbol") or "").strip()
                }
            ),
        }

        return {
            "count": len(limited),
            "data": limited,
            "summary": summary,
        }


ai_telemetry_service = AITelemetryService()
