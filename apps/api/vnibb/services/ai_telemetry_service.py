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
    ) -> dict[str, Any]:
        await self._ensure_loaded()
        feedback = {
            "vote": str(vote or "").strip().lower(),
            "surface": str(surface or "unknown").strip().lower(),
            "notes": str(notes or "").strip()[:500] or None,
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


ai_telemetry_service = AITelemetryService()
