"""
Company Profile ORM Models

Models for:
- Company: Full company profile and metadata
- Shareholder: Major shareholders
- Officer: Management team and board
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional, List

from sqlalchemy import (
    Column, String, Integer, Float, Date, DateTime,
    ForeignKey, Index, UniqueConstraint, BigInteger, Text, JSON
)
from sqlalchemy.orm import relationship, Mapped, mapped_column

from vnibb.core.database import Base


class Company(Base):
    """
    Extended company profile information.
    
    Contains detailed company data beyond basic Stock info.
    """
    __tablename__ = "companies"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    
    # Stock reference
    symbol: Mapped[str] = mapped_column(String(10), unique=True, nullable=False, index=True)
    
    # Company identification
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    short_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    english_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    
    # Classification
    exchange: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    industry: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    sector: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    subsector: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    # Dates
    established_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    listing_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    
    # Share information
    outstanding_shares: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    listed_shares: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Contact
    website: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    fax: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Description
    business_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Extended data
    raw_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    shareholders: Mapped[List["Shareholder"]] = relationship("Shareholder", back_populates="company", cascade="all, delete-orphan")
    officers: Mapped[List["Officer"]] = relationship("Officer", back_populates="company", cascade="all, delete-orphan")
    
    def is_fresh(self, hours: int = 24) -> bool:
        """
        Check if the cached data is still fresh based on TTL.
        
        Args:
            hours: Maximum age in hours for data to be considered fresh.
        
        Returns:
            True if data was updated within the TTL window.
        """
        if not self.updated_at:
            return False
        # Handle both naive and aware datetimes
        now = datetime.utcnow()
        updated = self.updated_at
        if updated.tzinfo is not None:
            updated = updated.replace(tzinfo=None)
        return (now - updated) < timedelta(hours=hours)
    
    def to_dict(self) -> dict:
        """Convert model to dictionary for API responses."""
        return {
            "symbol": self.symbol,
            "company_name": self.company_name,
            "short_name": self.short_name,
            "english_name": self.english_name,
            "exchange": self.exchange,
            "industry": self.industry,
            "sector": self.sector,
            "subsector": self.subsector,
            "established_date": self.established_date.isoformat() if self.established_date else None,
            "listing_date": self.listing_date.isoformat() if self.listing_date else None,
            "outstanding_shares": self.outstanding_shares,
            "listed_shares": self.listed_shares,
            "website": self.website,
            "email": self.email,
            "phone": self.phone,
            "address": self.address,
            "business_description": self.business_description,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
    
    def __repr__(self) -> str:
        return f"<Company(symbol='{self.symbol}', name='{self.company_name}')>"


class Shareholder(Base):
    """
    Major shareholders data.
    
    Tracks ownership structure and significant shareholders.
    """
    __tablename__ = "shareholders"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Company reference
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    
    # Shareholder info
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    shareholder_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # institutional, individual, state, foreign
    
    # Holdings
    shares_held: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ownership_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Snapshot date
    as_of_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    company: Mapped["Company"] = relationship("Company", back_populates="shareholders")
    
    __table_args__ = (
        Index("ix_shareholder_symbol_type", "symbol", "shareholder_type"),
    )


class Officer(Base):
    """
    Management team and board members.
    """
    __tablename__ = "officers"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Company reference
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    
    # Officer info
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    position_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # board, executive, other
    
    # Holdings
    shares_held: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ownership_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Dates
    appointment_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    company: Mapped["Company"] = relationship("Company", back_populates="officers")
    
    __table_args__ = (
        Index("ix_officer_symbol", "symbol"),
    )
