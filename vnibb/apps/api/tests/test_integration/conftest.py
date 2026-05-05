"""
Integration Test Fixtures

Provides shared fixtures for integration tests with minimal mocking.
"""
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from datetime import date, datetime

from vnibb.api.main import app
from vnibb.core.database import get_db
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models import Stock, Company


@pytest.fixture
async def seed_market_data(test_db: AsyncSession):
    """
    Seed comprehensive market data for integration tests.
    
    Creates a realistic dataset with multiple stocks, prices, and screener data.
    """
    today = date.today()
    
    # Create stocks
    stocks = [
        Stock(
            symbol="VNM",
            short_name="Vinamilk",
            company_name="Vietnam Dairy Products JSC",
            exchange="HOSE",
            industry="Food & Beverage",
            sector="Consumer Staples"
        ),
        Stock(
            symbol="FPT",
            short_name="FPT Corp",
            company_name="FPT Corporation",
            exchange="HOSE",
            industry="Technology",
            sector="Technology"
        ),
        Stock(
            symbol="HPG",
            short_name="Hoa Phat",
            company_name="Hoa Phat Group JSC",
            exchange="HOSE",
            industry="Steel",
            sector="Materials"
        )
    ]
    
    # Create company profiles
    companies = [
        Company(
            symbol="VNM",
            company_name="Vietnam Dairy Products JSC",
            short_name="Vinamilk",
            exchange="HOSE",
            industry="Food & Beverage",
            sector="Consumer Staples",
            business_description="Leading dairy company in Vietnam"
        ),
        Company(
            symbol="FPT",
            company_name="FPT Corporation",
            short_name="FPT Corp",
            exchange="HOSE",
            industry="Technology",
            sector="Technology",
            business_description="Leading technology corporation"
        ),
        Company(
            symbol="HPG",
            company_name="Hoa Phat Group JSC",
            short_name="Hoa Phat",
            exchange="HOSE",
            industry="Steel",
            sector="Materials",
            business_description="Leading steel manufacturer"
        )
    ]
    
    # Create screener snapshots
    screener_data = [
        ScreenerSnapshot(
            symbol="VNM",
            snapshot_date=today,
            company_name="Vinamilk",
            exchange="HOSE",
            industry="Food & Beverage",
            price=75000.0,
            volume=1000000.0,
            market_cap=150000000000.0,
            pe=15.0,
            pb=3.0,
            roe=20.0,
            roa=15.0,
            revenue_growth=10.0,
            earnings_growth=12.0,
            source="vnstock",
            created_at=datetime.utcnow()
        ),
        ScreenerSnapshot(
            symbol="FPT",
            snapshot_date=today,
            company_name="FPT Corp",
            exchange="HOSE",
            industry="Technology",
            price=95000.0,
            volume=500000.0,
            market_cap=100000000000.0,
            pe=20.0,
            pb=4.0,
            roe=25.0,
            roa=10.0,
            revenue_growth=20.0,
            earnings_growth=25.0,
            source="vnstock",
            created_at=datetime.utcnow()
        ),
        ScreenerSnapshot(
            symbol="HPG",
            snapshot_date=today,
            company_name="Hoa Phat Group",
            exchange="HOSE",
            industry="Steel",
            price=28000.0,
            volume=2000000.0,
            market_cap=160000000000.0,
            pe=8.0,
            pb=1.5,
            roe=15.0,
            roa=8.0,
            revenue_growth=5.0,
            earnings_growth=0.0,
            source="vnstock",
            created_at=datetime.utcnow()
        )
    ]
    
    # Add all to database
    test_db.add_all(stocks + companies + screener_data)
    await test_db.commit()
    
    return {
        "stocks": stocks,
        "companies": companies,
        "screener_data": screener_data
    }
