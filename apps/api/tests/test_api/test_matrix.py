import copy
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from vnibb.api.v1.matrix import router
from vnibb.core.config import settings
from vnibb.core.database import get_db
from vnibb.models.app_kv import AppKeyValue
from vnibb.services import matrix_service as service
from vnibb.services.matrix_playbooks import PLAYBOOKS

OWNER = "matrix-owner"
SECRET = "matrix-contract-test-only-secret"


@pytest.fixture
async def stored(test_db):
    snapshot_id, revision = str(uuid4()), str(uuid4())
    dimension = copy.deepcopy(PLAYBOOKS[0]["dimensions"][0])
    cells, evidence = [], []
    for symbol, amount in [("FPT", "123456789.125"), ("CMG", "987654321.75")]:
        evidence_id = f"{symbol}-revenue"
        cells.append({
            "result_id": str(uuid4()), "result_revision": revision, "entity_id": symbol,
            "dimension_id": dimension["dimension_id"], "state": "supported",
            "payload": {"kind": "number", "metrics": [{
                "key": "revenue", "label": "Revenue", "value": amount, "display": amount + " VND",
                "unit": "VND", "period": "2025", "as_of": "2025-12-31", "basis": "consolidated",
                "evidence_ids": [evidence_id],
            }]},
            "evidence_ids": [evidence_id], "basis": "consolidated", "limitations": [],
            "review_state": "unreviewed",
        })
        evidence.append({
            "evidence_id": evidence_id, "entity_id": symbol, "source": "stored.sql.income_statements",
            "locator": f"income:{symbol}:2025", "field": "revenue", "value": amount,
            "unit": "VND", "period": "2025", "as_of": "2025-12-31",
            "captured_at": "2026-01-01T00:00:00Z", "provenance": "stored_observation",
            "formula": None, "input_evidence_ids": [], "limitations": [],
        })
    snapshot = {
        "schema_version": "matrix-v1", "matrix_id": str(uuid4()), "snapshot_id": snapshot_id,
        "revision": revision, "created_at": "2026-01-01T00:00:00Z", "synthetic": False,
        "anchor_symbol": "FPT", "playbook_id": "nonfinancial", "definition_revision": "matrix-playbooks-1",
        "period": "2025", "period_type": "year", "entities": [
            {"entity_id": symbol, "symbol": symbol, "name": symbol, "sector": "Technology"}
            for symbol in ["FPT", "CMG"]
        ], "dimensions": [dimension], "cells": cells, "limitations": [],
    }
    record = {"owner_id": OWNER, "snapshot": snapshot, "evidence": evidence}
    test_db.add(AppKeyValue(key=f"matrix:snapshot:{snapshot_id}", value=copy.deepcopy(record)))
    await test_db.commit()
    return record


@pytest.mark.asyncio
async def test_selection_preserves_exact_values_and_scopes_evidence(test_db, stored):
    original = stored["snapshot"]
    cell = original["cells"][1]
    packet = await service.resolve_matrix_selection(test_db, OWNER, {
        "snapshot_id": original["snapshot_id"], "result_ids": [cell["result_id"]],
    })
    assert packet["entity_ids"] == ["CMG"]
    assert packet["snapshot"]["cells"][0]["payload"]["metrics"][0]["display"] == "987654321.75 VND"
    assert packet["snapshot"]["cells"][0]["result_revision"] == original["revision"]
    assert [item["entity_id"] for item in packet["evidence"]] == ["CMG"]
    assert "987654321" not in packet["request_text"]
    assert cell["result_id"] in packet["request_text"]
    assert packet["snapshot"]["cells"][0]["review_state"] == "unreviewed"


@pytest.mark.asyncio
async def test_owner_and_revocation_apply_to_every_reference(test_db, stored):
    snapshot = stored["snapshot"]
    sid, rid = snapshot["snapshot_id"], snapshot["cells"][0]["result_id"]
    for operation in [
        lambda user: service.get_matrix_snapshot(test_db, user, sid),
        lambda user: service.get_matrix_evidence(test_db, user, sid, rid),
        lambda user: service.resolve_matrix_selection(test_db, user, {"snapshot_id": sid, "result_ids": [rid]}),
        lambda user: service.review_matrix_snapshot(test_db, user, sid, {"result_ids": [rid], "state": "reviewed"}),
        lambda user: service.revoke_matrix_snapshot(test_db, user, sid),
    ]:
        with pytest.raises(HTTPException) as error:
            await operation("other-owner")
        assert (error.value.status_code, error.value.detail) == (404, "Matrix reference not found")
    assert await service.list_matrix_snapshots(test_db, "other-owner") == []
    await service.revoke_matrix_snapshot(test_db, OWNER, sid)
    assert await service.list_matrix_snapshots(test_db, OWNER) == []
    with pytest.raises(HTTPException) as error:
        await service.get_matrix_evidence(test_db, OWNER, sid, rid)
    assert error.value.status_code == 404
    record = await test_db.get(AppKeyValue, f"matrix:snapshot:{sid}")
    assert record.value == stored


@pytest.mark.asyncio
async def test_review_is_append_only_overlay_without_changing_evidence(test_db, stored):
    snapshot = stored["snapshot"]
    sid, rid = snapshot["snapshot_id"], snapshot["cells"][0]["result_id"]
    for state in ["reviewed", "unreviewed"]:
        result = await service.review_matrix_snapshot(test_db, OWNER, sid, {"result_ids": [rid], "state": state})
        assert result["cells"][0]["review_state"] == state
        assert result["revision"] == snapshot["revision"]
    record = await test_db.get(AppKeyValue, f"matrix:snapshot:{sid}")
    assert record.value == stored
    events = (await test_db.execute(select(AppKeyValue).where(AppKeyValue.key.startswith(f"matrix:review:{sid}:")))).scalars().all()
    assert [event.value["state"] for event in sorted(events, key=lambda event: event.updated_at)] == ["reviewed", "unreviewed"]


@pytest.mark.asyncio
@pytest.mark.parametrize("ids,code", [("duplicate", 422), ("foreign", 404), ("empty", 422), ("overflow", 422)])
async def test_selection_rejects_partial_or_invalid_scope(test_db, stored, ids, code):
    cell_id = stored["snapshot"]["cells"][0]["result_id"]
    values = {"duplicate": [cell_id, cell_id], "foreign": [cell_id, str(uuid4())], "empty": [], "overflow": [str(uuid4()) for _ in range(121)]}
    with pytest.raises(HTTPException) as error:
        await service.resolve_matrix_selection(test_db, OWNER, {"snapshot_id": stored["snapshot"]["snapshot_id"], "result_ids": values[ids]})
    assert error.value.status_code == code


@pytest.mark.asyncio
async def test_create_seals_new_identity_and_retains_historical_values(test_db, stored, monkeypatch):
    observations = {key: copy.deepcopy(stored["snapshot"][key]) for key in ["entities", "dimensions", "cells", "limitations"]}
    observations["evidence"] = copy.deepcopy(stored["evidence"])

    async def build(*args):
        return observations

    monkeypatch.setattr(service, "build_matrix_observations", build)
    request = {"anchor_symbol": "FPT", "symbols": ["FPT", "CMG"], "playbook_id": "nonfinancial", "period": "2025", "period_type": "year"}
    first = await service.create_matrix_snapshot(test_db, OWNER, request)
    observations["cells"][0]["payload"]["metrics"][0]["value"] = "999"
    observations["evidence"][0]["value"] = "999"
    second = await service.create_matrix_snapshot(test_db, OWNER, {**request, "matrix_id": first["matrix_id"]})
    assert first["matrix_id"] == second["matrix_id"]
    assert first["revision"] != second["revision"]
    assert first["cells"][0]["result_id"] != second["cells"][0]["result_id"]
    evidence = await service.get_matrix_evidence(test_db, OWNER, first["snapshot_id"], first["cells"][0]["result_id"])
    assert evidence[0]["value"] == "123456789.125"
    with pytest.raises(HTTPException) as error:
        await service.create_matrix_snapshot(test_db, "other", {**request, "matrix_id": first["matrix_id"]})
    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_persistence_failure_is_not_reported_as_success(test_db, stored, monkeypatch):
    async def fail():
        raise SQLAlchemyError("write unavailable")

    monkeypatch.setattr(test_db, "commit", fail)
    with pytest.raises(SQLAlchemyError):
        await service.revoke_matrix_snapshot(test_db, OWNER, stored["snapshot"]["snapshot_id"])
    await test_db.rollback()
    retained = await service.get_matrix_snapshot(test_db, OWNER, stored["snapshot"]["snapshot_id"])
    assert retained["revision"] == stored["snapshot"]["revision"]


@pytest.mark.asyncio
async def test_export_rights_require_all_derived_inputs(test_db, stored, monkeypatch):
    packet = await service.resolve_matrix_selection(test_db, OWNER, {
        "snapshot_id": stored["snapshot"]["snapshot_id"], "result_ids": [stored["snapshot"]["cells"][0]["result_id"]],
    })
    monkeypatch.delenv("MATRIX_EXPORT_ALLOWED_SOURCES", raising=False)
    with pytest.raises(HTTPException) as error:
        service.require_matrix_export_rights(packet)
    assert error.value.status_code == 403
    monkeypatch.setenv("MATRIX_EXPORT_ALLOWED_SOURCES", "stored.sql.income_statements")
    service.require_matrix_export_rights(packet)
    derived = {**packet["evidence"][0], "evidence_id": "derived", "provenance": "derived", "source": "derived.matrix", "input_evidence_ids": [packet["evidence"][0]["evidence_id"]]}
    packet["evidence"].append(derived)
    service.require_matrix_export_rights(packet)
    derived["input_evidence_ids"] = ["derived"]
    with pytest.raises(HTTPException) as error:
        service.require_matrix_export_rights(packet)
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_export_rights_deny_unknown_supplier_and_partial_derived(test_db, stored, monkeypatch):
    packet = await service.resolve_matrix_selection(test_db, OWNER, {
        "snapshot_id": stored["snapshot"]["snapshot_id"], "result_ids": [stored["snapshot"]["cells"][0]["result_id"]],
    })
    monkeypatch.setenv("MATRIX_EXPORT_ALLOWED_SOURCES", "stored.sql.income_statements:unknown, stored.sql.income_statements:matrix_seed")
    packet["evidence"][0]["source"] = "stored.sql.income_statements:unknown"
    with pytest.raises(HTTPException) as error:
        service.require_matrix_export_rights(packet)
    assert error.value.status_code == 403
    packet["evidence"][0]["source"] = "stored.sql.income_statements:matrix_seed"
    service.require_matrix_export_rights(packet)
    packet["evidence"].append({**packet["evidence"][0], "evidence_id": "mixed-derived", "value": None, "provenance": "derived", "source": "derived.matrix", "input_evidence_ids": ["mixed-unknown-input"]})
    with pytest.raises(HTTPException) as error:
        service.require_matrix_export_rights(packet)
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_http_auth_bounds_and_untrusted_overrides(test_db, stored, monkeypatch):
    app = FastAPI()
    app.include_router(router, prefix="/matrix")

    async def database():
        yield test_db

    app.dependency_overrides[get_db] = database
    monkeypatch.setattr(settings, "supabase_jwt_secret", SECRET)
    token = jwt.encode({"sub": OWNER, "exp": datetime.now(UTC) + timedelta(minutes=5)}, SECRET, algorithm="HS256")
    sid = stored["snapshot"]["snapshot_id"]
    rid = stored["snapshot"]["cells"][0]["result_id"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://matrix.test") as client:
        unauthorized = await client.get(f"/matrix/snapshots/{sid}", headers={"X-VNIBB-Client-ID": "anonymous-browser-id"})
        assert unauthorized.status_code == 401
        client.headers["Authorization"] = f"Bearer {token}"
        response = await client.get(f"/matrix/snapshots/{sid}")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        response = await client.post("/matrix/selection", json={"snapshot_id": sid, "result_ids": [rid], "evidence": [], "synthetic": True})
        assert response.status_code == 422
        response = await client.post("/matrix/snapshots", json={"anchor_symbol": "FPT", "symbols": ["FPT", "CMG"], "period": "2025", "playbook_id": "nonfinancial", "source": "allowlisted"})
        assert response.status_code == 422
        assert (await client.get("/matrix/snapshots?limit=51")).status_code == 422
        assert (await client.get(f"/matrix/snapshots/{sid}/evidence", params={"result_id": str(uuid4())})).status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("mutation", ["duplicate", "unknown_entity", "wrong_revision", "definition", "denied_payload", "nonfinite"])
async def test_snapshot_rejects_ambiguous_or_unsafe_values(stored, mutation):
    from pydantic import ValidationError
    from vnibb.schemas.matrix import MatrixSnapshot

    snapshot = copy.deepcopy(stored["snapshot"])
    if mutation == "duplicate":
        snapshot["cells"][1]["result_id"] = snapshot["cells"][0]["result_id"]
    elif mutation == "unknown_entity":
        snapshot["cells"][0]["entity_id"] = "UNKNOWN"
    elif mutation == "wrong_revision":
        snapshot["cells"][0]["result_revision"] = "other-revision"
    elif mutation == "definition":
        snapshot["dimensions"][0]["definition_revision"] = "other-definition"
    elif mutation == "denied_payload":
        snapshot["cells"][0]["state"] = "denied"
    else:
        snapshot["cells"][0]["payload"]["metrics"][0]["value"] = "NaN"
    with pytest.raises(ValidationError):
        MatrixSnapshot.model_validate(snapshot)


@pytest.mark.asyncio
async def test_non_null_metric_without_evidence_fails_closed(test_db, stored):
    record = await test_db.get(AppKeyValue, f'matrix:snapshot:{stored["snapshot"]["snapshot_id"]}')
    corrupt = copy.deepcopy(record.value)
    corrupt["snapshot"]["cells"][0]["payload"]["metrics"][0]["evidence_ids"] = []
    record.value = corrupt
    await test_db.commit()
    with pytest.raises(HTTPException) as error:
        await service.resolve_matrix_selection(test_db, OWNER, {
            "snapshot_id": stored["snapshot"]["snapshot_id"],
            "result_ids": [stored["snapshot"]["cells"][0]["result_id"]],
        })
    assert error.value.status_code == 409
