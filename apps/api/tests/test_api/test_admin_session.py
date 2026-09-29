from time import time
from uuid import uuid4

import pytest
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from vnibb.core.config import settings


OPERATOR_ID = "8b11dc68-f065-4095-8826-81c857ff5f6c"
SESSION_ID = "61c8d6f8-5820-45f2-a5da-e6cf0e56f3dc"
SECRET = "test-only-admin-session-signing-secret"
ISSUER = "https://admin-auth.example.test/auth/v1"


def session_token(**claims):
    issued = int(time())
    payload = {
        "sub": OPERATOR_ID,
        "session_id": SESSION_ID,
        "iat": issued,
        "exp": issued + 1800,
        "aud": "authenticated",
        "iss": ISSUER,
    }
    payload.update(claims)
    return jwt.encode(payload, SECRET, algorithm="HS256")


@pytest.fixture(autouse=True)
def admin_policy(monkeypatch):
    monkeypatch.setattr(settings, "supabase_jwt_secret", SECRET)
    monkeypatch.setattr(settings, "supabase_url", "https://admin-auth.example.test")
    monkeypatch.setattr(settings, "admin_user_ids", OPERATOR_ID)
    monkeypatch.setattr(settings, "admin_revoked_session_ids", "")
    monkeypatch.setattr(settings, "admin_session_max_ttl_seconds", 3600)


@pytest.mark.asyncio
@pytest.mark.parametrize("authorization", ["", "Bearer dev-admin", "Bearer invalid.jwt.token"])
async def test_admin_rejects_unauthenticated_dev_and_invalid_identity(client, authorization):
    response = await client.get("/api/v1/admin/session", headers={"Authorization": authorization})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_admin_key_cannot_authorize_interactive_session(client):
    response = await client.get("/api/v1/admin/session")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_ordinary_identity_cannot_self_assign_admin_metadata(client):
    token = session_token(sub=str(uuid4()), role="admin", user_metadata={"role": "admin"})
    response = await client.get("/api/v1/admin/session", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("claim,value", [
    ("exp", 1), ("iss", "https://untrusted.example/auth/v1"),
    ("aud", "service_role"), ("session_id", None), ("sub", "dev-admin"),
    ("iat", 1), ("exp", None), ("iat", None),
])
async def test_admin_rejects_invalid_session_claims(client, claim, value):
    token = session_token(**{claim: value})
    response = await client.get("/api/v1/admin/session", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("claim", ["exp", "iat", "iss", "aud", "sub", "session_id"])
async def test_admin_requires_security_claims(client, claim):
    payload = jwt.get_unverified_claims(session_token())
    del payload[claim]
    token = jwt.encode(payload, SECRET, algorithm="HS256")
    response = await client.get("/api/v1/admin/session", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("setting", ["admin_user_ids", "supabase_url", "supabase_jwt_secret"])
async def test_admin_fails_closed_without_policy(client, monkeypatch, setting):
    monkeypatch.setattr(settings, setting, "")
    response = await client.get("/api/v1/admin/session", headers={"Authorization": f"Bearer {session_token()}"})
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_admin_session_is_rechecked_after_policy_revocation(client, monkeypatch):
    headers = {"Authorization": f"Bearer {session_token()}"}
    before = await client.get("/api/v1/admin/session", headers=headers)
    assert before.status_code == 200
    assert before.json() == {"id": OPERATOR_ID, "role": "admin"}
    monkeypatch.setattr(settings, "admin_revoked_session_ids", SESSION_ID)
    after = await client.get("/api/v1/admin/session", headers=headers)
    assert after.status_code == 401


@pytest.mark.asyncio
async def test_admin_allowlist_removal_denies_existing_token(client, monkeypatch):
    headers = {"Authorization": f"Bearer {session_token()}"}
    before = await client.get("/api/v1/admin/session", headers=headers)
    assert before.status_code == 200
    monkeypatch.setattr(settings, "admin_user_ids", str(uuid4()))
    after = await client.get("/api/v1/admin/session", headers=headers)
    assert after.status_code == 403


INTERACTIVE_ROUTES = [
    ("GET", "/session"), ("GET", "/system-layouts"),
    ("GET", "/system-layouts/default-fundamental"),
    ("PUT", "/system-layouts/default-fundamental"),
    ("GET", "/ai-telemetry"), ("GET", "/ai-runtime"), ("PUT", "/ai-runtime"),
    ("GET", "/unit-runtime"), ("PUT", "/unit-runtime"),
    ("GET", "/ai-prompts"), ("PUT", "/ai-prompts"), ("GET", "/providers/status"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", INTERACTIVE_ROUTES)
async def test_every_interactive_operation_rejects_platform_key(client, method, path):
    response = await client.request(method, f"/api/v1/admin{path}", json={})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_layout_publish_binds_actor_to_verified_operator(client, test_engine, monkeypatch):
    factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr("vnibb.services.system_layout_template_service.async_session_maker", factory)
    response = await client.put(
        "/api/v1/admin/system-layouts/default-fundamental",
        headers={"Authorization": f"Bearer {session_token()}", "X-Admin-Actor": "forged-actor"},
        json={"dashboard": {"id": "default-fundamental", "name": "Authorized layout"}, "publish": True},
    )
    assert response.status_code == 200
    assert response.json()["published"]["updated_by"] == OPERATOR_ID
    assert response.json()["published"]["dashboard"]["name"] == "Authorized layout"


@pytest.mark.asyncio
async def test_automation_can_publish_only_through_separate_guard(client, test_engine, monkeypatch):
    factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr("vnibb.services.system_layout_template_service.async_session_maker", factory)
    response = await client.put(
        "/api/v1/admin/automation/system-layouts/default-fundamental",
        json={"dashboard": {"id": "default-fundamental", "name": "Automated layout"}, "publish": True},
    )
    assert response.status_code == 200
    assert response.json()["published"]["updated_by"] == "automation:layout-publisher"
    denied = await client.put(
        "/api/v1/admin/automation/system-layouts/default-fundamental",
        headers={"X-Admin-Key": "", "Authorization": f"Bearer {session_token()}"},
        json={"dashboard": {}, "publish": True},
    )
    assert denied.status_code == 401


@pytest.mark.asyncio
async def test_automation_rejects_browser_origin_even_with_valid_key(client):
    response = await client.get(
        "/api/v1/admin/automation/system-layouts/default-fundamental",
        headers={"Origin": "https://vnibb.example"},
    )
    assert response.status_code == 403
