"""Authentication and authorization helpers for user-scoped endpoints."""

from __future__ import annotations

import logging
import re

import httpx
from fastapi import Header, HTTPException, status
from jose import JWTError, jwt
from pydantic import BaseModel

from vnibb.core.config import settings

logger = logging.getLogger(__name__)
ANONYMOUS_DASHBOARD_CLIENT_RE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")


class User(BaseModel):
    """User model extracted from JWT token."""

    id: str
    email: str
    role: str | None = None
    aud: str | None = None
    provider: str | None = None

    class Config:
        from_attributes = True


class AuthError(HTTPException):
    """Custom authentication error."""

    def __init__(self, detail: str = "Not authenticated"):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise AuthError("Missing authorization header")

    if not authorization.startswith("Bearer "):
        raise AuthError("Invalid authorization header format")

    token = authorization.replace("Bearer ", "", 1).strip()
    if not token:
        raise AuthError("Missing bearer token")

    return token


def _decode_supabase_user(token: str) -> User | None:
    if not settings.supabase_jwt_secret:
        return None

    payload = jwt.decode(
        token,
        settings.supabase_jwt_secret,
        algorithms=["HS256"],
        options={"verify_aud": False},
    )

    user_id = payload.get("sub")
    email = payload.get("email")
    role = payload.get("role")

    if not user_id:
        raise AuthError("Invalid token: missing user ID")

    return User(
        id=user_id,
        email=email or "",
        role=role,
        aud=payload.get("aud"),
        provider="supabase",
    )


async def _fetch_appwrite_user(token: str) -> User | None:
    endpoint = (settings.appwrite_endpoint or "").rstrip("/")
    project_id = settings.resolved_appwrite_project_id

    if not endpoint or not project_id:
        return None

    headers = {
        "X-Appwrite-Project": project_id,
        "X-Appwrite-JWT": token,
    }

    url = f"{endpoint}/account"
    try:
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)
    except Exception as exc:
        logger.warning("Appwrite auth validation failed: %s", exc)
        raise AuthError("Unable to validate Appwrite session") from exc

    if response.status_code in {401, 403}:
        return None

    if response.status_code >= 400:
        logger.warning(
            "Appwrite auth validation returned status=%s body=%s",
            response.status_code,
            response.text[:300],
        )
        raise AuthError("Unable to validate Appwrite session")

    payload = response.json()
    user_id = str(payload.get("$id") or "").strip()
    if not user_id:
        raise AuthError("Invalid Appwrite session: missing user ID")

    email = str(payload.get("email") or "").strip()
    labels = payload.get("labels")
    role: str | None = None
    if isinstance(labels, list) and labels:
        role = str(labels[0])

    return User(
        id=user_id,
        email=email,
        role=role or "authenticated",
        aud="appwrite",
        provider="appwrite",
    )


async def get_current_user(authorization: str | None = Header(None)) -> User:
    """
    Extract and validate user from JWT token.

    Args:
        authorization: Bearer token from Authorization header

    Returns:
        User object with id, email, and role

    Raises:
        AuthError: If token is missing or invalid
    """
    token = _extract_bearer_token(authorization)

    try:
        supabase_user = _decode_supabase_user(token)
        if supabase_user is not None:
            return supabase_user
    except JWTError:
        logger.debug("Bearer token was not a valid Supabase JWT")

    appwrite_user = await _fetch_appwrite_user(token)
    if appwrite_user is not None:
        return appwrite_user

    if settings.supabase_jwt_secret or settings.is_appwrite_configured:
        raise AuthError("Invalid or expired token")

    raise AuthError("Authentication is not configured")


def _normalize_dashboard_client_id(client_id: str | None) -> str | None:
    normalized = str(client_id or "").strip()
    if not normalized:
        return None
    if not settings.allow_anonymous_dashboard_writes:
        return None
    if not ANONYMOUS_DASHBOARD_CLIENT_RE.fullmatch(normalized):
        return None
    return normalized


async def get_dashboard_user(
    authorization: str | None = Header(None),
    x_vnibb_client_id: str | None = Header(default=None, alias="X-VNIBB-Client-ID"),
) -> User:
    """Resolve a dashboard owner from auth when present, or from a browser-local client ID."""
    if authorization:
        return await get_current_user(authorization)

    client_id = _normalize_dashboard_client_id(x_vnibb_client_id)
    if client_id:
        return User(
            id=f"anon:{client_id}",
            email="",
            role="anonymous",
            aud="anonymous",
            provider="anonymous",
        )

    raise AuthError("Authentication required")


async def get_optional_user(authorization: str | None = Header(None)) -> User | None:
    """
    Extract user from JWT token if present, otherwise return None.

    Useful for endpoints that work for both authenticated and anonymous users.

    Args:
        authorization: Bearer token from Authorization header

    Returns:
        User object if authenticated, None otherwise
    """
    if not authorization:
        return None

    try:
        return await get_current_user(authorization)
    except AuthError:
        return None
