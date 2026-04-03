from __future__ import annotations

import json
import logging
from collections import OrderedDict
from datetime import UTC, datetime
from threading import Lock
from typing import Any

logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


class AITelemetryService:
    def __init__(self, max_records: int = 500):
        self.max_records = max(1, int(max_records))
        self._records: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._lock = Lock()

    def record_response(
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

        logger.info("AI response telemetry %s", json.dumps(record, ensure_ascii=True, default=str))
        return record

    def record_feedback(
        self,
        *,
        response_id: str,
        vote: str,
        surface: str,
        notes: str | None = None,
    ) -> dict[str, Any]:
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

        payload = {
            "response_id": response_id,
            "matched": matched,
            "feedback": feedback,
            "provider": response_record.get("provider") if response_record else None,
            "model": response_record.get("model") if response_record else None,
        }
        logger.info("AI feedback telemetry %s", json.dumps(payload, ensure_ascii=True, default=str))
        return payload

    def record_outcome(
        self,
        *,
        response_id: str,
        kind: str,
        item_id: str,
        status: str,
        surface: str,
        notes: str | None = None,
    ) -> dict[str, Any]:
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

        payload = {
            "response_id": response_id,
            "matched": matched,
            "outcome": outcome,
            "provider": response_record.get("provider") if response_record else None,
            "model": response_record.get("model") if response_record else None,
        }
        logger.info("AI outcome telemetry %s", json.dumps(payload, ensure_ascii=True, default=str))
        return payload

    def get_recent_records(self, limit: int = 50) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit), self.max_records))
        with self._lock:
            return [dict(record) for record in list(self._records.values())[-safe_limit:]][::-1]


ai_telemetry_service = AITelemetryService()
