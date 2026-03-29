"""User API endpoints."""


from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.auth import User, get_current_user
from vnibb.core.database import get_db

router = APIRouter()


class UserProfile(BaseModel):
    """User profile response model."""

    id: str
    email: str
    display_name: str | None = None
    avatar_url: str | None = None
    role: str | None = None
    created_at: str | None = None
    last_login_at: str | None = None


class UpdateProfileRequest(BaseModel):
    """Update user profile request."""

    display_name: str | None = None
    avatar_url: str | None = None


@router.get("/me", response_model=UserProfile)
async def get_current_user_profile(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> UserProfile:
    """
    Get current user's profile.

    Returns user information extracted from JWT token.
    In a full implementation, this would fetch additional data from the database.
    """
    # For now, return data from JWT token
    # In production, you'd query a users table for additional profile data
    return UserProfile(
        id=current_user.id,
        email=current_user.email,
        display_name=current_user.email.split("@")[0] if current_user.email else None,
        role=current_user.role,
    )


@router.put("/me", response_model=UserProfile)
async def update_user_profile(
    profile_update: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserProfile:
    """
    Update current user's profile.

    In a full implementation, this would update a users table.
    For now, it returns the updated profile data.
    """
    # In production, you'd update the database here
    # For now, just return the updated profile
    return UserProfile(
        id=current_user.id,
        email=current_user.email,
        display_name=profile_update.display_name or current_user.email.split("@")[0],
        avatar_url=profile_update.avatar_url,
        role=current_user.role,
    )


@router.get("/dashboards")
async def get_user_dashboards(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """
    Get all dashboards for the current user.
    """
    from vnibb.api.v1.dashboard import list_dashboards

    return await list_dashboards(db=db, current_user=current_user)
