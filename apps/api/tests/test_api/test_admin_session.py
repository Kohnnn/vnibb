from time import time
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
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
    monkeypatch.setattr(settings, "supabase_anon_key", "test-publishable-key")
    monkeypatch.setattr(settings, "admin_user_ids", OPERATOR_ID)
    monkeypatch.setattr(settings, "admin_revoked_session_ids", "")
    monkeypatch.setattr(settings, "admin_session_max_ttl_seconds", 3600)
    session_response = AsyncMock(return_value=httpx.Response(200, json={"id": OPERATOR_ID}))
    original_client = httpx.AsyncClient

    def auth_client(*args, **kwargs):
        return original_client(*args, transport=httpx.MockTransport(session_response), **kwargs)

    monkeypatch.setattr("vnibb.core.auth.httpx.AsyncClient", auth_client)
    return session_response


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
@pytest.mark.parametrize("setting", ["admin_user_ids", "supabase_url", "supabase_jwt_secret", "supabase_anon_key"])
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


@pytest.mark.asyncio
async def test_signed_out_session_is_rejected_by_online_authority(client, admin_policy):
    admin_policy.return_value = httpx.Response(401, json={"message": "session not found"})
    response = await client.get("/api/v1/admin/session", headers={"Authorization": f"Bearer {session_token()}"})
    assert response.status_code == 401
    assert admin_policy.await_count == 1


@pytest.mark.asyncio
async def test_mismatched_online_identity_is_rejected(client, admin_policy):
    admin_policy.return_value = httpx.Response(200, json={"id": str(uuid4())})
    response = await client.get("/api/v1/admin/session", headers={"Authorization": f"Bearer {session_token()}"})
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [500, 503])
async def test_online_authority_outage_fails_closed(client, admin_policy, status):
    admin_policy.return_value = httpx.Response(status)
    response = await client.get("/api/v1/admin/session", headers={"Authorization": f"Bearer {session_token()}"})
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_online_authority_timeout_fails_closed(client, admin_policy):
    admin_policy.side_effect = httpx.ReadTimeout("Auth service unavailable")
    response = await client.get("/api/v1/admin/session", headers={"Authorization": f"Bearer {session_token()}"})
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_online_authority_checks_every_admin_request(client, admin_policy):
    headers = {"Authorization": f"Bearer {session_token()}"}
    first = await client.get("/api/v1/admin/session", headers=headers)
    second = await client.get("/api/v1/admin/session", headers=headers)
    assert first.status_code == second.status_code == 200
    assert admin_policy.await_count == 2

@pytest.mark.asyncio
async def test_admin_accepts_issuer_lifetime_above_one_hour_when_bound_is_raised(client, monkeypatch):
    """GoTrue's GOTRUE_JWT_EXP is operator-configurable; the bound must be raisable to meet it."""
    monkeypatch.setattr(settings, "admin_session_max_ttl_seconds", 7200)
    response = await client.get(
        "/api/v1/admin/session",
        headers={"Authorization": f"Bearer {session_token(exp=int(time()) + 7200)}"},
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_admin_bound_can_cover_the_documented_issuer_ceiling(client):
    """A ceiling below the issuer lifetime is an unconfigurable denial of service."""
    schema_fields = settings.model_fields["admin_session_max_ttl_seconds"].metadata
    assert schema_fields, "admin_session_max_ttl_seconds must declare a validated bound"
    bounds = [constraint.le for constraint in schema_fields if isinstance(getattr(constraint, "le", None), int)]
    assert bounds and max(bounds) >= 86400


@pytest.mark.asyncio
async def test_admin_rejects_lifetime_above_configured_bound(client):
    response = await client.get(
        "/api/v1/admin/session",
        headers={"Authorization": f"Bearer {session_token(exp=int(time()) + 90000)}"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_online_authority_gets_caller_bearer_and_publishable_key(client, admin_policy):
    token = session_token()
    response = await client.get("/api/v1/admin/session", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    request = admin_policy.await_args.args[0]
    assert str(request.url) == "https://admin-auth.example.test/auth/v1/user"
    assert request.headers["Authorization"] == f"Bearer {token}"
    assert request.headers["apikey"] == "test-publishable-key"


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
