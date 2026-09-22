from __future__ import annotations

import pytest
from jose import jwt

from vnibb.core.auth import AuthError, get_current_user, get_dashboard_user
from vnibb.core.config import settings


@pytest.mark.asyncio
async def test_get_current_user_fails_closed_when_auth_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "supabase_jwt_secret", None)

    with pytest.raises(AuthError, match="Authentication is not configured"):
        await get_current_user("Bearer some-token")


@pytest.mark.asyncio
async def test_get_current_user_accepts_supabase_jwt(monkeypatch):
    secret = "test-supabase-secret"
    token = jwt.encode(
        {
            "sub": "supabase-user-1",
            "email": "user@example.com",
            "role": "authenticated",
            "aud": "authenticated",
        },
        secret,
        algorithm="HS256",
    )

    monkeypatch.setattr(settings, "supabase_jwt_secret", secret)

    user = await get_current_user(f"Bearer {token}")

    assert user.id == "supabase-user-1"
    assert user.email == "user@example.com"
    assert user.provider == "supabase"


@pytest.mark.asyncio
async def test_get_current_user_rejects_invalid_token(monkeypatch):
    monkeypatch.setattr(settings, "supabase_jwt_secret", "test-supabase-secret")

    with pytest.raises(AuthError, match="Invalid or expired token"):
        await get_current_user("Bearer invalid-token")


@pytest.mark.asyncio
async def test_get_dashboard_user_accepts_anonymous_client_id(monkeypatch):
    monkeypatch.setattr(settings, "allow_anonymous_dashboard_writes", True)

    user = await get_dashboard_user(None, "browserlocalclient01")

    assert user.id == "anon:browserlocalclient01"
    assert user.provider == "anonymous"
