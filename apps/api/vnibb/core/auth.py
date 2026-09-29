"""Authentication and authorization helpers for user-scoped endpoints."""

from __future__ import annotations

import logging
import re
from time import time
from uuid import UUID

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

    if settings.supabase_jwt_secret:
        raise AuthError("Invalid or expired token")

    raise AuthError("Authentication is not configured")


async def _get_active_admin_user_id(token: str) -> str:
    """Ask the issuing Auth service to reject signed-out/revoked sessions."""
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/user"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(
                url,
                headers={"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {token}"},
            )
        if response.status_code in (401, 403):
            raise AuthError("Admin session is no longer active")
        if response.status_code != 200:
            raise HTTPException(status_code=503, detail="Admin session authority is unavailable")
        return str(UUID(response.json()["id"]))
    except (httpx.RequestError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=503, detail="Admin session authority is unavailable") from exc


async def require_admin_access(authorization: str | None = Header(None)) -> User:
    """Authorize bounded Supabase sessions against server-owned operator policy."""
    token = _extract_bearer_token(authorization)
    allowed_ids = {value.strip() for value in settings.admin_user_ids.split(",") if value.strip()}
    if not allowed_ids or not settings.supabase_jwt_secret or not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(status_code=503, detail="Admin session authorization is not configured")

    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            issuer=f"{settings.supabase_url.rstrip('/')}/auth/v1",
            options={"require_exp": True, "require_iat": True, "require_sub": True,
                     "require_aud": True, "require_iss": True},
        )
        user_id = str(UUID(payload["sub"]))
        session_id = str(UUID(payload["session_id"]))
        issued_at, expires_at = payload["iat"], payload["exp"]
        if (type(issued_at) is not int or type(expires_at) is not int
                or issued_at > time() or expires_at <= issued_at
                or expires_at - issued_at > settings.admin_session_max_ttl_seconds):
            raise ValueError("Invalid session lifetime")
    except (JWTError, KeyError, TypeError, ValueError, AttributeError) as exc:
        raise AuthError("Invalid or expired admin session") from exc

    revoked_ids = {value.strip() for value in settings.admin_revoked_session_ids.split(",") if value.strip()}
    if session_id in revoked_ids:
        raise AuthError("Admin session has been revoked")
    if user_id not in allowed_ids:
        raise HTTPException(status_code=403, detail="Admin access is not granted to this account")
    if await _get_active_admin_user_id(token) != user_id:
        raise AuthError("Admin session identity mismatch")
    return User(id=user_id, email="", role="admin", aud="authenticated", provider="supabase")


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
