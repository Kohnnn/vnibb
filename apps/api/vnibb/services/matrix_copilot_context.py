"""Frozen, authorized Matrix context for the existing VniAgent provider path."""

import json
from typing import Any

from fastapi import HTTPException

MAX_MATRIX_CONTEXT_BYTES = 524288


def serialize_matrix_context(context: dict[str, Any]) -> str:
    serialized = json.dumps(context, ensure_ascii=False, separators=(",", ":"))
    if len(serialized.encode("utf-8")) > MAX_MATRIX_CONTEXT_BYTES:
        raise HTTPException(413, "Matrix selection is too large for model context")
    return serialized


def build_matrix_copilot_context(packet: dict[str, Any]) -> dict[str, Any]:
    catalog = [
        {
            "id": f"MATRIX-{index}",
            "evidence_id": item["evidence_id"],
            "scope": "matrix",
            "kind": item["provenance"],
            "label": f"{item['entity_id']} · {item['field']} · {item['period']}",
            "source": item["source"],
            "as_of": item.get("as_of"),
            "symbol": item["entity_id"],
        }
        for index, item in enumerate(packet["evidence"], start=1)
    ]
    context = {
        "matrix_selection": packet,
        "source_catalog": catalog,
        "prefer_database_data": True,
        "client_context": {"widgetType": "Matrix", "widgetTypeKey": "research_matrix"},
    }
    serialize_matrix_context(context)
    return context
