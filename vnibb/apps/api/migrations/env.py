"""
Alembic Environment Configuration

Handles sync migrations for VNIBB database.
Uses SQLAlchemy 2.0 patterns with automatic model discovery.

NOTE: Sets ALEMBIC_RUNNING=true to prevent async engine creation in database.py
"""

import os

# CRITICAL: Set this BEFORE any app imports to prevent async engine creation
os.environ["ALEMBIC_RUNNING"] = "true"

from logging.config import fileConfig

from sqlalchemy import pool, create_engine
from dotenv import load_dotenv

from alembic import context

# Load .env file
load_dotenv()


def get_sync_database_url() -> str:
    """Get sync database URL for migrations."""
    db_url = os.environ.get("DATABASE_URL_SYNC") or os.environ.get("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL or DATABASE_URL_SYNC must be set")
    
    # Remove asyncpg if present (use sync driver)
    db_url = db_url.replace("+asyncpg", "")
    
    return db_url


# Now safe to import app modules (ALEMBIC_RUNNING is already set)
from vnibb.core.database import Base

# Import all models to ensure they're registered with Base.metadata
from vnibb.models import (
    Stock, StockPrice, StockIndex,
    IncomeStatement, BalanceSheet, CashFlow,
    ScreenerSnapshot,
    Company, Shareholder, Officer,
    UserDashboard, DashboardWidget,
    CompanyNews, CompanyEvent, Dividend, InsiderDeal,
    IntradayTrade, OrderbookSnapshot, ForeignTrading, FinancialRatio,
    MarketSector, SectorPerformance, Subsidiary,
    TechnicalIndicator, MarketNews,
    BlockTrade, InsiderAlert, AlertSettings,
    AppKeyValue,
    SyncStatus,
)

# Alembic Config object
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Target metadata
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """
    Run migrations in 'offline' mode.

    Generates SQL scripts without connecting to the database.
    """
    url = get_sync_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """
    Run migrations in 'online' mode.

    Creates a sync Engine for migration execution.
    """
    connectable = create_engine(
        get_sync_database_url(),
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            render_as_batch=True,
        )

        with context.begin_transaction():
            context.run_migrations()

    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
