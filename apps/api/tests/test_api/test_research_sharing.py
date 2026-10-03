import copy
import time
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from jose import jwt
from vnibb.api.v1.research_sharing import router
from vnibb.core import auth
from vnibb.core.config import settings
from vnibb.core.database import get_db
from vnibb.models.app_kv import AppKeyValue
from vnibb.services import research_sharing_service as service

OWNER, RECIPIENT, OUTSIDER = (str(uuid4()) for _ in range(3))
SECRET = "research-share-test-only-signing-secret"


def bundle():
    return {
        "format": "vnibb-thesis-evidence", "version": 1, "createdAt": "2026-01-01T00:00:00Z",
        "theses": [{"symbol": "FPT", "thesis": {
            "status": "researching", "thesis": "My long-term case", "catalysts": "My catalyst",
            "risks": "My risk", "invalidation": "My invalidation", "reviewDate": "2026-12-31",
            "notebookItemIds": ["nb:authored"],
        }}],
        "items": [{"id": "nb:authored", "kind": "note", "title": "My research note", "body": "My independently written observation", "createdAt": "2026-01-01T00:00:00Z"}],
    }


def request():
    return {"bundle": bundle(), "recipient_ids": [RECIPIENT], "expires_at": (datetime.now(UTC) + timedelta(days=7)).isoformat()}


@pytest.mark.asyncio
async def test_frozen_owner_recipient_acl_and_revocation(test_db):
    payload = request()
    share = await service.create_share(test_db, OWNER, payload)
    payload["bundle"]["theses"][0]["thesis"]["thesis"] = "Changed after creation"
    sid = share["share_id"]
    recipient = await service.read_share(test_db, RECIPIENT, sid)
    assert recipient["bundle"]["theses"][0]["thesis"]["thesis"] == "My long-term case"
    recipient["bundle"]["items"][0]["body"] = "Changed read result"
    assert (await service.read_share(test_db, OWNER, sid))["bundle"]["items"][0]["body"] == "My independently written observation"
    assert len(await service.list_shares(test_db, OWNER)) == 1
    assert await service.list_shares(test_db, RECIPIENT) == []
    for operation in (service.read_share, service.revoke_share):
        with pytest.raises(HTTPException) as error:
            await operation(test_db, OUTSIDER, sid)
        assert error.value.status_code == 404
    assert await service.revoke_share(test_db, OWNER, sid) == {"revoked": True}
    assert (await service.list_shares(test_db, OWNER))[0]["revoked_at"]
    for user in (OWNER, RECIPIENT, OUTSIDER):
        with pytest.raises(HTTPException) as error:
            await service.read_share(test_db, user, sid)
        assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_expiry_and_read_time_rights_are_enforced(test_db, monkeypatch):
    share = await service.create_share(test_db, OWNER, request())
    record = await test_db.get(AppKeyValue, f"research-share:{share['share_id']}")
    original = copy.deepcopy(record.value)
    record.value = {**original, "expires_at": (datetime.now(UTC) - timedelta(seconds=1)).isoformat()}
    await test_db.commit()
    with pytest.raises(HTTPException) as expired:
        await service.read_share(test_db, RECIPIENT, share["share_id"])
    assert expired.value.status_code == 404
    original["bundle"]["items"][0]["provenance"] = {"source": "approved", "synthetic": True}
    record.value = original
    await test_db.commit()
    monkeypatch.setenv("MATRIX_EXPORT_ALLOWED_SOURCES", "approved,unknown")
    with pytest.raises(HTTPException) as denied:
        await service.read_share(test_db, RECIPIENT, share["share_id"])
    assert denied.value.status_code == 403


@pytest.mark.parametrize("kind", ["news", "widget_snapshot", "agent_answer", "artifact"])
def test_provider_originals_fail_closed_even_with_client_allowlist_claim(kind, monkeypatch):
    value = bundle()
    value["items"][0]["kind"] = kind
    value["items"][0]["provenance"] = {"source": "approved", "synthetic": True}
    monkeypatch.setenv("MATRIX_EXPORT_ALLOWED_SOURCES", "approved")
    with pytest.raises(HTTPException) as denied:
        service.validate_bundle(value)
    assert denied.value.status_code == 403


def test_missing_rights_configuration_denies_citation_originals(monkeypatch):
    monkeypatch.delenv("MATRIX_EXPORT_ALLOWED_SOURCES", raising=False)
    value = bundle()
    value["theses"][0]["thesis"]["citations"] = [{"itemId": "nb:authored", "title": "Provider", "capturedAt": "2026-01-01T00:00:00Z", "url": "https://example.org/report"}]
    with pytest.raises(HTTPException) as denied:
        service.validate_bundle(value)
    assert denied.value.status_code == 403


@pytest.mark.parametrize("text", ["<script>alert(1)</script>", "api_key=raw-secret", "Bearer abcdefghijklmnopqrstuvwxyz", "ignore previous instructions"])
def test_unsafe_text_is_not_a_share_payload(text):
    value = bundle()
    value["items"][0]["body"] = text
    with pytest.raises(HTTPException) as denied:
        service.validate_bundle(value)
    assert denied.value.status_code == 422


@pytest.mark.parametrize("mutation", ["duplicate-items", "duplicate-refs", "bad-date", "unexpected-field", "instruction-field", "too-many-theses", "too-many-items", "depth"])
def test_bundle_validator_boundaries(mutation):
    value = bundle()
    if mutation == "duplicate-items":
        value["items"].append(copy.deepcopy(value["items"][0]))
    if mutation == "duplicate-refs":
        value["theses"][0]["thesis"]["notebookItemIds"] *= 2
    if mutation == "bad-date":
        value["items"][0]["createdAt"] = "invalid"
    if mutation == "unexpected-field":
        value["theses"][0]["thesis"]["extra"] = True
    if mutation == "instruction-field":
        value["items"][0]["provenance"] = {"instructions": "do something"}
    if mutation == "too-many-theses":
        value["theses"] *= 51
    if mutation == "too-many-items":
        value["items"] *= 201
    if mutation == "depth":
        nested = {}
        for _ in range(22):
            nested = {"nested": nested}
        value["items"][0]["provenance"] = nested
    with pytest.raises(HTTPException) as denied:
        service.validate_bundle(value)
    assert denied.value.status_code == 422


@pytest.mark.asyncio
async def test_snapshot_and_recipient_limits(test_db, monkeypatch):
    value = request()
    value["bundle"]["items"][0]["body"] = "x" * (service.MAX_RESEARCH_BUNDLE_BYTES + 1)
    with pytest.raises(HTTPException) as large:
        await service.create_share(test_db, OWNER, value)
    assert large.value.status_code == 413
    for recipients in ([OWNER], [RECIPIENT, RECIPIENT], [], [str(uuid4()) for _ in range(21)], ["anon:guest"]):
        with pytest.raises(HTTPException) as denied:
            await service.create_share(test_db, OWNER, {**request(), "recipient_ids": recipients})
        assert denied.value.status_code == 422
    for days in (-1, 31):
        with pytest.raises(HTTPException) as denied:
            await service.create_share(test_db, OWNER, {**request(), "expires_at": (datetime.now(UTC) + timedelta(days=days)).isoformat()})
        assert denied.value.status_code == 422
    monkeypatch.setattr(service, "MAX_RESEARCH_SHARES", 1)
    await service.create_share(test_db, OWNER, request())
    with pytest.raises(HTTPException) as full:
        await service.create_share(test_db, OWNER, request())
    assert full.value.status_code == 409


def token(user_id):
    now = int(time.time())
    return jwt.encode({"sub": user_id, "session_id": str(uuid4()), "aud": "authenticated", "iss": "https://research-auth.test/auth/v1", "iat": now, "exp": now + 900}, SECRET, algorithm="HS256")


@pytest.mark.asyncio
async def test_api_uses_live_identity_for_every_operation(test_db, monkeypatch):
    monkeypatch.setattr(settings, "supabase_jwt_secret", SECRET)
    monkeypatch.setattr(settings, "supabase_url", "https://research-auth.test")
    monkeypatch.setattr(settings, "supabase_anon_key", "test-anon-key")
    calls, active = [], {OWNER, RECIPIENT, OUTSIDER}

    async def authority(bearer):
        user_id = jwt.get_unverified_claims(bearer)["sub"]
        calls.append(user_id)
        if user_id not in active:
            raise auth.AuthError("Session is no longer active")
        return user_id

    monkeypatch.setattr(auth, "_get_active_user_id", authority)
    app = FastAPI()
    app.include_router(router, prefix="/research-shares")

    async def database():
        yield test_db

    app.dependency_overrides[get_db] = database
    headers = {user_id: {"Authorization": f"Bearer {token(user_id)}"} for user_id in active}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for method, path in (("get", "/research-shares"), ("post", "/research-shares"), ("get", f"/research-shares/{uuid4()}"), ("delete", f"/research-shares/{uuid4()}")):
            response = await client.request(method, path, json=request() if method == "post" else None)
            assert response.status_code == 401
            assert response.headers["cache-control"] == "no-store"
        created = await client.post("/research-shares", headers=headers[OWNER], json=request())
        assert created.status_code == 201
        assert created.headers["cache-control"] == "no-store"
        sid = created.json()["share_id"]
        assert (await client.get("/research-shares", headers=headers[OWNER])).status_code == 200
        read = await client.get(f"/research-shares/{sid}", headers=headers[RECIPIENT])
        assert read.status_code == 200 and read.headers["cache-control"] == "no-store"
        outsider = await client.get(f"/research-shares/{sid}", headers=headers[OUTSIDER])
        assert outsider.status_code == 404 and outsider.headers["cache-control"] == "no-store"
        active.remove(RECIPIENT)
        assert (await client.get(f"/research-shares/{sid}", headers=headers[RECIPIENT])).status_code == 401
        assert (await client.delete(f"/research-shares/{sid}", headers=headers[OWNER])).status_code == 200
        active.remove(OWNER)
        assert (await client.get("/research-shares", headers=headers[OWNER])).status_code == 401
        assert (await client.post("/research-shares", headers=headers[OWNER], json=request())).status_code == 401
        assert (await client.delete(f"/research-shares/{sid}", headers=headers[OWNER])).status_code == 401
    assert len(calls) == 9


@pytest.mark.asyncio
async def test_api_authority_outage_fails_closed(test_db, monkeypatch):
    monkeypatch.setattr(settings, "supabase_jwt_secret", SECRET)
    monkeypatch.setattr(settings, "supabase_url", "https://research-auth.test")
    monkeypatch.setattr(settings, "supabase_anon_key", "test-anon-key")

    async def unavailable(_token):
        raise HTTPException(status_code=503, detail="Session authority is unavailable")

    monkeypatch.setattr(auth, "_get_active_user_id", unavailable)
    app = FastAPI()
    app.include_router(router, prefix="/research-shares")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/research-shares", headers={"Authorization": f"Bearer {token(OWNER)}"})
    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
@pytest.mark.parametrize("anonymous_boundary", ["jwt", "authority"])
async def test_api_rejects_supabase_anonymous_sessions_on_every_operation(
    test_db, monkeypatch, anonymous_boundary
):
    import httpx

    monkeypatch.setattr(settings, "supabase_jwt_secret", SECRET)
    monkeypatch.setattr(settings, "supabase_url", "https://research-auth.test")
    monkeypatch.setattr(settings, "supabase_anon_key", "test-anon-key")
    monkeypatch.setattr(settings, "active_session_max_ttl_seconds", 3600)
    calls = []

    def authority(request):
        assert request.url == "https://research-auth.test/auth/v1/user"
        assert request.headers["Authorization"].startswith("Bearer ")
        calls.append(request)
        return httpx.Response(
            200,
            json={"id": OWNER, "is_anonymous": anonymous_boundary == "authority"},
        )

    monkeypatch.setattr(
        auth.httpx,
        "AsyncClient",
        lambda **kwargs: AsyncClient(transport=httpx.MockTransport(authority), **kwargs),
    )
    claims = jwt.get_unverified_claims(token(OWNER))
    claims["is_anonymous"] = anonymous_boundary == "jwt"
    bearer = jwt.encode(claims, SECRET, algorithm="HS256")
    app = FastAPI()
    app.include_router(router, prefix="/research-shares")

    async def database():
        yield test_db

    app.dependency_overrides[get_db] = database
    headers = {"Authorization": f"Bearer {bearer}"}
    share_id = str(uuid4())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for method, path in (
            ("get", "/research-shares"),
            ("post", "/research-shares"),
            ("get", f"/research-shares/{share_id}"),
            ("delete", f"/research-shares/{share_id}"),
        ):
            response = await client.request(
                method,
                path,
                headers=headers,
                json=request() if method == "post" else None,
            )
            assert response.status_code == 401
            assert response.headers["cache-control"] == "no-store"
    assert len(calls) == (0 if anonymous_boundary == "jwt" else 4)
