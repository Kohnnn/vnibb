"""
User API Endpoints

Provides user profile and preferences management.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.auth import User, get_current_user
from vnibb.core.database import get_db


router = APIRouter()


class UserProfile(BaseModel):
    """User profile response model."""
    id: str
    email: str
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    role: Optional[str] = None
    created_at: Optional[str] = None
    last_login_at: Optional[str] = None


class UpdateProfileRequest(BaseModel):
    """Update user profile request."""
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None


@router.get("/me", response_model=UserProfile)
async def get_current_user_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
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
    db: AsyncSession = Depends(get_db)
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
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all dashboards for the current user.
    
    This endpoint is a placeholder that delegates to the dashboard API.
    The dashboard API should be updated to filter by user_id.
    """
    from vnibb.api.v1.dashboard import get_dashboards
    
    # The dashboard endpoint should be updated to use current_user.id
    # For now, this is a placeholder
    return await get_dashboards(db=db)
