import copy
import json
import os
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import exists, select
from sqlalchemy.orm import aliased

from vnibb.models.app_kv import AppKeyValue
from vnibb.schemas.matrix import (
    MatrixCreate,
    MatrixEvidence,
    MatrixResearchRequest,
    MatrixReview,
    MatrixSelection,
    MatrixSnapshot,
)
from vnibb.services.matrix_observations import (
    build_matrix_fixture,
    build_matrix_observations,
)
from vnibb.services.matrix_playbooks import PLAYBOOKS

MAX_MATRIX_BYTES = 524288
MAX_REVIEW_EVENTS = 1000


def _not_found():
    return HTTPException(status_code=404, detail="Matrix reference not found")


def _validate(model, value):
    try:
        return model.model_validate(value).model_dump(mode="json")
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="Invalid Matrix request") from exc


def _check_size(value):
    if len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > MAX_MATRIX_BYTES:
        raise HTTPException(status_code=413, detail="Matrix payload exceeds size limit")


def _require_user(user_id):
    if not user_id or user_id.startswith("anon:"):
        raise HTTPException(status_code=401, detail="Sign in to access Matrix snapshots")


def _snapshot_key(snapshot_id):
    try:
        if str(UUID(snapshot_id)) != snapshot_id:
            raise ValueError("Noncanonical snapshot ID")
        return f"matrix:snapshot:{snapshot_id}"
    except (ValueError, TypeError, AttributeError) as exc:
        raise _not_found() from exc


async def _owned_record(db, user_id, snapshot_id, *, lock=False):
    _require_user(user_id)
    query = select(AppKeyValue).where(AppKeyValue.key == _snapshot_key(snapshot_id))
    if lock:
        query = query.with_for_update()
    record = (await db.execute(query)).scalar_one_or_none()
    if not record or not record.value or record.value.get("owner_id") != user_id:
        raise _not_found()
    if await db.get(AppKeyValue, f"matrix:revoked:{snapshot_id}"):
        raise _not_found()
    return record


def _review_query(snapshot_id):
    return (
        select(AppKeyValue)
        .where(AppKeyValue.key.startswith(f"matrix:review:{snapshot_id}:"))
        .order_by(AppKeyValue.updated_at, AppKeyValue.key)
        .limit(MAX_REVIEW_EVENTS + 1)
    )


async def _presentation(db, record):
    snapshot = copy.deepcopy(record.value["snapshot"])
    events = (await db.execute(_review_query(snapshot["snapshot_id"]))).scalars().all()
    if len(events) > MAX_REVIEW_EVENTS:
        raise HTTPException(status_code=409, detail="Matrix review history limit exceeded")
    states = {}
    for event in events:
        for result_id in event.value["result_ids"]:
            states[result_id] = event.value["state"]
    for cell in snapshot["cells"]:
        cell["review_state"] = states.get(cell["result_id"], "unreviewed")
    return snapshot


def _selected_cells(snapshot, result_ids):
    cells = {cell["result_id"]: cell for cell in snapshot["cells"]}
    if not result_ids or len(result_ids) != len(set(result_ids)):
        raise HTTPException(status_code=422, detail="Select unique Matrix results")
    if any(result_id not in cells for result_id in result_ids):
        raise _not_found()
    return [cells[result_id] for result_id in result_ids]


def _evidence_for_cells(evidence, cells):
    by_id = {item["evidence_id"]: item for item in evidence}
    if len(by_id) != len(evidence):
        raise HTTPException(status_code=409, detail="Matrix evidence identity is ambiguous")
    requested = []
    for cell in cells:
        requested.extend(cell["evidence_ids"])
        for metric in cell["payload"].get("metrics", []):
            if metric.get("value") is not None and not metric["evidence_ids"]:
                raise HTTPException(status_code=409, detail="Matrix evidence is incomplete")
            requested.extend(metric["evidence_ids"])
    visited = set()
    while requested:
        evidence_id = requested.pop()
        if evidence_id in visited:
            continue
        if evidence_id not in by_id:
            raise HTTPException(status_code=409, detail="Matrix evidence is incomplete")
        visited.add(evidence_id)
        requested.extend(by_id[evidence_id]["input_evidence_ids"])
    return [copy.deepcopy(item) for item in evidence if item["evidence_id"] in visited]


def get_matrix_fixture():
    fixture = build_matrix_fixture()
    return _validate(MatrixSnapshot, fixture["snapshot"])


def get_matrix_fixture_evidence(result_id):
    fixture = build_matrix_fixture()
    cells = _selected_cells(fixture["snapshot"], [result_id])
    return _evidence_for_cells(fixture["evidence"], cells)


async def create_matrix_snapshot(db, user_id: str, request: dict) -> dict:
    _require_user(user_id)
    request = _validate(MatrixCreate, request)
    playbook = next((p for p in PLAYBOOKS if p["playbook_id"] == request["playbook_id"]), None)
    if playbook is None:
        raise HTTPException(status_code=422, detail="Unknown Matrix playbook")
    matrix_id = request.get("matrix_id")
    if matrix_id:
        owner = await db.get(AppKeyValue, f"matrix:owner:{matrix_id}")
        if not owner or owner.value.get("owner_id") != user_id:
            raise _not_found()
        await _owned_record(db, user_id, owner.value["origin_snapshot_id"])
    else:
        matrix_id = str(uuid4())
    try:
        observations = await build_matrix_observations(
            db, request["symbols"], request["playbook_id"], request["period"], request["period_type"]
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    snapshot_id, revision = str(uuid4()), str(uuid4())
    cells = copy.deepcopy(observations["cells"])
    for cell in cells:
        cell["result_id"] = str(uuid5(NAMESPACE_URL, f'{revision}/{cell["entity_id"]}/{cell["dimension_id"]}'))
        cell["result_revision"] = revision
        cell["review_state"] = "unreviewed"
    snapshot = MatrixSnapshot.model_validate({
        "schema_version": "matrix-v1", "matrix_id": matrix_id,
        "snapshot_id": snapshot_id, "revision": revision,
        "created_at": datetime.now(UTC).isoformat(), "synthetic": False,
        "anchor_symbol": request["anchor_symbol"], "playbook_id": request["playbook_id"],
        "definition_revision": playbook["definition_revision"], "period": request["period"],
        "period_type": request["period_type"], "entities": observations["entities"],
        "dimensions": observations["dimensions"], "cells": cells,
        "limitations": observations["limitations"],
    }).model_dump(mode="json")
    evidence = [MatrixEvidence.model_validate(item).model_dump(mode="json") for item in observations["evidence"]]
    _evidence_for_cells(evidence, snapshot["cells"])
    record = {"owner_id": user_id, "snapshot": snapshot, "evidence": evidence}
    _check_size(record)
    db.add(AppKeyValue(key=_snapshot_key(snapshot_id), value=record))
    if not request.get("matrix_id"):
        db.add(AppKeyValue(key=f"matrix:owner:{matrix_id}", value={
            "owner_id": user_id, "origin_snapshot_id": snapshot_id,
        }))
    await db.commit()
    return snapshot


async def get_matrix_snapshot(db, user_id: str, snapshot_id: str) -> dict:
    return await _presentation(db, await _owned_record(db, user_id, snapshot_id))


async def list_matrix_snapshots(db, user_id: str, limit: int = 20) -> list[dict]:
    _require_user(user_id)
    if not 1 <= limit <= 50:
        raise HTTPException(status_code=422, detail="Matrix history limit must be 1..50")
    tombstone = aliased(AppKeyValue)
    snapshot_id = AppKeyValue.value["snapshot"]["snapshot_id"].as_string()
    query = (
        select(AppKeyValue)
        .where(
            AppKeyValue.key.startswith("matrix:snapshot:"),
            AppKeyValue.value["owner_id"].as_string() == user_id,
            ~exists(select(tombstone.key).where(tombstone.key == "matrix:revoked:" + snapshot_id)),
        )
        .order_by(AppKeyValue.updated_at.desc(), AppKeyValue.key.desc())
        .limit(limit)
    )
    records = (await db.execute(query)).scalars().all()
    snapshots = [await _presentation(db, record) for record in records]
    _check_size(snapshots)
    return snapshots


async def get_matrix_evidence(db, user_id: str, snapshot_id: str, result_id: str) -> list[dict]:
    record = await _owned_record(db, user_id, snapshot_id)
    cells = _selected_cells(record.value["snapshot"], [result_id])
    return _evidence_for_cells(record.value["evidence"], cells)


async def review_matrix_snapshot(db, user_id: str, snapshot_id: str, request: dict) -> dict:
    request = _validate(MatrixReview, request)
    record = await _owned_record(db, user_id, snapshot_id, lock=True)
    _selected_cells(record.value["snapshot"], request["result_ids"])
    events = (await db.execute(_review_query(snapshot_id))).scalars().all()
    if len(events) >= MAX_REVIEW_EVENTS:
        raise HTTPException(status_code=409, detail="Matrix review history limit reached")
    db.add(AppKeyValue(key=f"matrix:review:{snapshot_id}:{uuid4()}", value={
        "owner_id": user_id, **request, "created_at": datetime.now(UTC).isoformat(),
    }))
    await db.commit()
    return await get_matrix_snapshot(db, user_id, snapshot_id)


async def revoke_matrix_snapshot(db, user_id: str, snapshot_id: str) -> dict:
    await _owned_record(db, user_id, snapshot_id, lock=True)
    db.add(AppKeyValue(key=f"matrix:revoked:{snapshot_id}", value={
        "owner_id": user_id, "revoked_at": datetime.now(UTC).isoformat(),
    }))
    await db.commit()
    return {"revoked": True}


def _request_text(snapshot, cells):
    dimensions = {dimension["dimension_id"]: dimension for dimension in snapshot["dimensions"]}
    lines = [
        f'Research frozen Matrix snapshot {snapshot["snapshot_id"]}, revision {snapshot["revision"]}, period {snapshot["period"]}.',
        "References only; resolve with owner authorization. No trading or execution is authorized.",
    ]
    for cell in cells:
        dimension = dimensions[cell["dimension_id"]]
        lines.append(json.dumps({
            "company": cell["entity_id"], "entity_id": cell["entity_id"],
            "question": dimension["label"], "dimension_id": cell["dimension_id"],
            "result_id": cell["result_id"], "result_revision": cell["result_revision"],
            "state": cell["state"], "source_scope": dimension["source_scope"],
            "as_of": sorted({metric["as_of"] for metric in cell["payload"].get("metrics", []) if metric["as_of"]}),
        }, ensure_ascii=False))
    lines.append("Limitations: retained serving observations are not original issuer evidence; missing or non-comparable results must not be inferred.")
    return "\n".join(lines)


async def resolve_matrix_selection(db, user_id: str, selection: dict) -> dict:
    selection = _validate(MatrixSelection, selection)
    record = await _owned_record(db, user_id, selection["snapshot_id"])
    snapshot = await _presentation(db, record)
    cells = _selected_cells(snapshot, selection["result_ids"])
    entity_ids = list(dict.fromkeys(cell["entity_id"] for cell in cells))
    dimension_ids = list(dict.fromkeys(cell["dimension_id"] for cell in cells))
    snapshot["cells"] = cells
    snapshot["entities"] = [e for e in snapshot["entities"] if e["entity_id"] in entity_ids]
    snapshot["dimensions"] = [d for d in snapshot["dimensions"] if d["dimension_id"] in dimension_ids]
    packet = MatrixResearchRequest.model_validate({
        "snapshot_id": snapshot["snapshot_id"], "revision": snapshot["revision"],
        "entity_ids": entity_ids, "dimension_ids": dimension_ids,
        "result_ids": selection["result_ids"], "period": snapshot["period"],
        "source_scope": list(dict.fromkeys(d["source_scope"] for d in snapshot["dimensions"])),
        "request_text": _request_text(snapshot, cells), "snapshot": snapshot,
        "evidence": _evidence_for_cells(record.value["evidence"], cells),
    }).model_dump(mode="json")
    _check_size(packet)
    return packet


DENIED_SUPPLIER = "unknown"


def _allowlisted_sources() -> set[str]:
    sources = {source.strip() for source in os.getenv("MATRIX_EXPORT_ALLOWED_SOURCES", "").split(",") if source.strip()}
    return {source for source in sources if not source.endswith(f":{DENIED_SUPPLIER}")}


def require_matrix_export_rights(packet: dict) -> None:
    if packet.get("snapshot", {}).get("synthetic") is True:
        return
    allowed = _allowlisted_sources()
    evidence = packet.get("evidence", [])
    by_id = {item["evidence_id"]: item for item in evidence}
    approved = {item["evidence_id"] for item in evidence
                if item.get("provenance") == "stored_observation" and item.get("source") in allowed}
    pending = set(by_id) - approved
    while pending:
        resolved = {evidence_id for evidence_id in pending
                    if by_id[evidence_id].get("provenance") == "derived"
                    and by_id[evidence_id].get("input_evidence_ids")
                    and set(by_id[evidence_id]["input_evidence_ids"]) <= approved}
        if not resolved:
            raise HTTPException(status_code=403, detail="External Matrix export is not permitted by the source-rights policy")
        approved.update(resolved)
        pending.difference_update(resolved)
