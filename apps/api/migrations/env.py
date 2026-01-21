"""
Alembic Environment Configuration

Handles both sync and async migrations for VNIBB database.
Uses SQLAlchemy 2.0 patterns with automatic model discovery.
"""

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Import our models and Base
from vnibb.core.database import Base
from vnibb.core.config import settings

# Import all models to ensure they're registered with Base.metadata
from vnibb.models import (
    Stock, StockPrice, StockIndex,
    IncomeStatement, BalanceSheet, CashFlow,
    ScreenerSnapshot,
    Company, Shareholder, Officer,
    UserDashboard, DashboardWidget,
)

# Alembic Config object
config = context.config

# Override sqlalchemy.url with our settings
# Escape % for ConfigParser (% needs to be doubled to %%)
config.set_main_option("sqlalchemy.url", settings.sync_database_url.replace("%", "%%"))

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Target metadata for 'autogenerate' support
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """
    Run migrations in 'offline' mode.

    Generates SQL scripts without connecting to the database.
    Useful for reviewing migration SQL before applying.
    
    Commands:
        alembic upgrade head --sql
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """Execute migrations within a connection context."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,  # Detect column type changes
        compare_server_default=True,  # Detect default value changes
        render_as_batch=True,  # Critical for SQLite support
    )

    with context.begin_transaction():
        context.run_migrations()



async def run_async_migrations() -> None:
    """
    Run migrations in 'online' mode using async engine.
    
    Creates an async Engine and associates a connection with the context.
    """
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """
    Run migrations in 'online' mode.

    Creates a sync Engine for migration execution.
    For async operations, use run_async_migrations().
    """
    from sqlalchemy import create_engine
    
    connectable = create_engine(
        settings.sync_database_url,
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        do_run_migrations(connection)

    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
