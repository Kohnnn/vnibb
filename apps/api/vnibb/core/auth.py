"""
Authentication and Authorization Module

Provides JWT validation and user context extraction for Supabase Auth.
"""

from typing import Optional
from fastapi import Depends, HTTPException, Header, status
from jose import JWTError, jwt
from pydantic import BaseModel

from vnibb.core.config import settings


class User(BaseModel):
    """User model extracted from JWT token."""
    id: str
    email: str
    role: Optional[str] = None
    aud: Optional[str] = None
    
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


async def get_current_user(authorization: Optional[str] = Header(None)) -> User:
    """
    Extract and validate user from JWT token.
    
    Args:
        authorization: Bearer token from Authorization header
        
    Returns:
        User object with id, email, and role
        
    Raises:
        AuthError: If token is missing or invalid
    """
    if not authorization:
        raise AuthError("Missing authorization header")
    
    if not authorization.startswith("Bearer "):
        raise AuthError("Invalid authorization header format")
    
    token = authorization.replace("Bearer ", "")
    
    # If no JWT secret is configured, allow anonymous access
    if not settings.supabase_jwt_secret:
        return User(id="anonymous", email="anonymous@local", role="anonymous")
    
    try:
        # Decode JWT token
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            options={"verify_aud": False}  # Supabase tokens may have different audiences
        )
        
        # Extract user information
        user_id = payload.get("sub")
        email = payload.get("email")
        role = payload.get("role")
        
        if not user_id:
            raise AuthError("Invalid token: missing user ID")
        
        return User(
            id=user_id,
            email=email or "",
            role=role,
            aud=payload.get("aud")
        )
        
    except JWTError as e:
        raise AuthError(f"Invalid token: {str(e)}")


async def get_optional_user(authorization: Optional[str] = Header(None)) -> Optional[User]:
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
