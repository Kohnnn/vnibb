from time import time
from uuid import uuid4

import httpx
import pytest
from jose import jwt
from vnibb.core.config import settings

USER_ID = "8b11dc68-f065-4095-8826-81c857ff5f6c"
SECRET = "test-only-active-session-signing-secret"
ISSUER = "https://active-auth.example.test/auth/v1"


def token(**claims):
    now = int(time())
    payload = {"sub": USER_ID, "session_id": str(uuid4()), "iat": now,
               "exp": now + 1800, "aud": "authenticated", "iss": ISSUER}
    payload.update(claims)
    return jwt.encode(payload, SECRET, algorithm="HS256")


@pytest.fixture
def authority(monkeypatch):
    monkeypatch.setattr(settings, "supabase_jwt_secret", SECRET)
    monkeypatch.setattr(settings, "supabase_url", "https://active-auth.example.test")
    monkeypatch.setattr(settings, "supabase_anon_key", "publishable-test-key")
    monkeypatch.setattr(settings, "active_session_max_ttl_seconds", 3600)
    responses = [httpx.Response(200, json={"id": USER_ID})]
    original = httpx.AsyncClient

    def handle(request):
        assert request.headers["Authorization"].startswith("Bearer ")
        return responses.pop(0)

    monkeypatch.setattr("vnibb.core.auth.httpx.AsyncClient",
                        lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    return responses


@pytest.mark.asyncio
async def test_active_recipient_cannot_read_after_issuer_revokes_session(authority):
    from vnibb.core.auth import AuthError, require_active_user
    bearer = f"Bearer {token()}"
    assert (await require_active_user(bearer)).id == USER_ID
    authority.append(httpx.Response(401))
    with pytest.raises(AuthError):
        await require_active_user(bearer)


@pytest.mark.asyncio
@pytest.mark.parametrize("claim,value", [("iss", "https://other.test/auth/v1"),
                                         ("aud", "service_role"), ("session_id", None),
                                         ("sub", "anon:browser"), ("exp", 1)])
async def test_active_identity_rejects_wrong_claims(authority, claim, value):
    from vnibb.core.auth import AuthError, require_active_user
    with pytest.raises(AuthError):
        await require_active_user(f"Bearer {token(**{claim: value})}")


@pytest.mark.asyncio
async def test_active_identity_fails_closed_on_authority_outage(authority):
    from fastapi import HTTPException
    from vnibb.core.auth import require_active_user
    authority[:] = [httpx.Response(503)]
    with pytest.raises(HTTPException) as error:
        await require_active_user(f"Bearer {token()}")
    assert error.value.status_code == 503


@pytest.mark.asyncio
async def test_active_identity_rejects_issuer_subject_mismatch(authority):
    from vnibb.core.auth import AuthError, require_active_user
    authority[:] = [httpx.Response(200, json={"id": str(uuid4())})]
    with pytest.raises(AuthError):
        await require_active_user(f"Bearer {token()}")


@pytest.mark.asyncio
async def test_recipient_lifetime_is_independent_of_operator_policy(authority, monkeypatch):
    from vnibb.core.auth import AuthError, require_active_user

    monkeypatch.setattr(settings, "admin_session_max_ttl_seconds", 60)
    bearer = f"Bearer {token()}"
    assert (await require_active_user(bearer)).id == USER_ID
    monkeypatch.setattr(settings, "active_session_max_ttl_seconds", 60)
    with pytest.raises(AuthError):
        await require_active_user(bearer)


@pytest.mark.asyncio
@pytest.mark.parametrize("requirement", ["require_active_user", "require_admin_access"])
async def test_signed_anonymous_session_is_rejected_before_authority_lookup(
    authority, monkeypatch, requirement
):
    from vnibb.core import auth

    monkeypatch.setattr(settings, "admin_user_ids", USER_ID)
    monkeypatch.setattr(settings, "admin_session_max_ttl_seconds", 3600)
    with pytest.raises(auth.AuthError) as error:
        await getattr(auth, requirement)(f"Bearer {token(is_anonymous=True)}")
    assert error.value.status_code == 401
    assert len(authority) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("requirement", ["require_active_user", "require_admin_access"])
async def test_authority_anonymous_user_is_rejected(authority, monkeypatch, requirement):
    from vnibb.core import auth

    monkeypatch.setattr(settings, "admin_user_ids", USER_ID)
    monkeypatch.setattr(settings, "admin_session_max_ttl_seconds", 3600)
    authority[:] = [httpx.Response(200, json={"id": USER_ID, "is_anonymous": True})]
    with pytest.raises(auth.AuthError) as error:
        await getattr(auth, requirement)(f"Bearer {token(is_anonymous=False)}")
    assert error.value.status_code == 401
    assert not authority


@pytest.mark.asyncio
@pytest.mark.parametrize("is_anonymous", [None, False])
async def test_normal_session_accepts_missing_or_false_anonymous_flag(authority, is_anonymous):
    from vnibb.core.auth import require_active_user

    claims = {} if is_anonymous is None else {"is_anonymous": is_anonymous}
    authority[:] = [httpx.Response(200, json={"id": USER_ID, **claims})]
    assert (await require_active_user(f"Bearer {token(**claims)}")).id == USER_ID
