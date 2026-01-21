"""
Database configuration and session management.

Uses SQLAlchemy 2.0 async engine with asyncpg driver for PostgreSQL/Supabase.
Provides both async session factory and sync session for Alembic migrations.

Production features:
- Connection pooling with configurable size and overflow
- Pool pre-ping for connection health checks
- Configurable timeouts and connection recycling
- SSL support for secure connections
"""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

from sqlalchemy import create_engine, MetaData, event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import QueuePool, NullPool

from vnibb.core.config import settings

logger = logging.getLogger(__name__)


# Naming convention for constraints (Alembic auto-generation)
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy ORM models."""
    
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def _build_connect_args() -> dict:
    """
    Build connection arguments for asyncpg.
    
    Handles SSL configuration for production environments.
    SQLite databases don't need special connect_args.
    """
    # SQLite doesn't need special connect_args - early return
    if settings.database_url.startswith("sqlite"):
        return {}
    
    connect_args = {}
    
    # SSL configuration for production (PostgreSQL only)
    if settings.is_production or settings.database_ssl_mode in ("require", "verify-ca", "verify-full"):
        # asyncpg uses 'ssl' parameter
        if settings.database_ssl_mode == "disable":
            connect_args["ssl"] = False
        elif settings.database_ssl_mode in ("require", "prefer"):
            connect_args["ssl"] = "require"
        elif settings.database_ssl_mode in ("verify-ca", "verify-full"):
            connect_args["ssl"] = "require"
    
    # PgBouncer compatibility: disable prepared statement cache
    if settings.database_url.startswith("postgresql"):
        connect_args["statement_cache_size"] = 0
    
    return connect_args


# Async engine for FastAPI application
engine = create_async_engine(
    settings.database_url,
    echo=settings.should_echo_sql,
    pool_pre_ping=True,  # Verify connections before use
    poolclass=NullPool,  # Use NullPool for PgBouncer compatibility
    connect_args=_build_connect_args(),
)


# Async session factory
async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# Alias for backward compatibility
async_session_maker = async_session_factory


def _build_sync_connect_args() -> dict:
    """Build connection arguments for psycopg2 (sync driver)."""
    connect_args = {}
    
    if settings.is_production or settings.database_ssl_mode in ("require", "verify-ca", "verify-full"):
        if settings.database_ssl_mode != "disable":
            connect_args["sslmode"] = settings.database_ssl_mode
    
    return connect_args


# Sync engine for Alembic migrations
sync_engine_kwargs = {
    "echo": settings.should_echo_sql,
    "pool_pre_ping": True,
    "connect_args": _build_sync_connect_args(),
}

# SQLite does not support pool_size and max_overflow
if not settings.sync_database_url.startswith("sqlite"):
    sync_engine_kwargs["pool_size"] = settings.database_pool_size
    sync_engine_kwargs["max_overflow"] = settings.database_max_overflow

sync_engine = create_engine(
    settings.sync_database_url,
    **sync_engine_kwargs,
)

# Sync session factory (for migrations and scripts)
sync_session_factory = sessionmaker(
    sync_engine,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency that yields an async database session.
    
    Usage:
        @router.get("/items")
        async def get_items(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


@asynccontextmanager
async def get_db_context() -> AsyncGenerator[AsyncSession, None]:
    """
    Context manager for database sessions outside of request scope.
    
    Usage:
        async with get_db_context() as db:
            result = await db.execute(select(Model))
    """
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def check_database_connection(max_retries: int = 3) -> bool:
    """
    Check if database connection is healthy with retries.
    
    Returns:
        True if connection is successful, False otherwise.
    """
    import asyncio
    
    for attempt in range(max_retries):
        try:
            async with async_session_factory() as session:
                await session.execute(text("SELECT 1"))
                return True
        except Exception as e:
            logger.warning(f"Database connection attempt {attempt + 1} failed: {e}")
            if attempt < max_retries - 1:
                await asyncio.sleep(1 * (attempt + 1)) # Linear backoff
            else:
                logger.error("All database connection attempts failed.")
    return False



async def get_pool_status() -> dict:
    """
    Get current connection pool status.
    
    Returns:
        Dictionary with pool statistics.
    """
    pool = engine.pool
    return {
        "pool_size": pool.size(),
        "checked_in": pool.checkedin(),
        "checked_out": pool.checkedout(),
        "overflow": pool.overflow(),
        "invalid": pool.invalidatedcount() if hasattr(pool, "invalidatedcount") else 0,
    }
