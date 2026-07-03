"""Tests for vnibb.core.config — sync_database_url property and timeout settings."""

import pytest

from vnibb.core.config import Settings


@pytest.fixture
def settings_factory(monkeypatch):
    """Factory that yields Settings with sensible defaults overridable per test."""

    def _make(**overrides):
        defaults = {
            "environment": "development",
            "admin_api_key": None,
            "appwrite_endpoint": None,
            "appwrite_project_id": None,
            "appwrite_api_key": None,
            "appwrite_database_id": None,
        }
        defaults.update(overrides)
        # Wipe env-driven defaults that could leak in.
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("DATABASE_URL_SYNC", raising=False)
        # Disable dotenv file loading: pydantic-settings reads the developer's
        # local .env directly (bypassing os.environ), which would otherwise leak
        # DATABASE_URL_SYNC into these isolation-sensitive unit tests.
        return Settings(_env_file=None, **defaults)

    return _make


class TestSyncDatabaseUrl:
    """The sync_database_url property must:
    1. Replace the URL *scheme* ``postgresql+asyncpg://`` → ``postgresql://``.
    2. NOT mangle passwords containing the literal ``+asyncpg`` substring.
    3. Pass through an already-sync URL unchanged.
    4. Honor an explicit ``database_url_sync`` override.
    """

    def test_replaces_asyncpg_scheme_prefix(self, settings_factory):
        s = settings_factory(database_url="postgresql+asyncpg://user:pw@host:5432/db")
        assert s.sync_database_url == "postgresql://user:pw@host:5432/db"

    def test_password_containing_plus_asyncpg_is_not_corrupted(self, settings_factory):
        # Regression: previous str.replace() implementation corrupted this.
        s = settings_factory(
            database_url="postgresql+asyncpg://user:secret+asyncpg+chars@host:5432/db"
        )
        assert s.sync_database_url == "postgresql://user:secret+asyncpg+chars@host:5432/db"

    def test_already_sync_url_passes_through(self, settings_factory):
        s = settings_factory(database_url="postgresql://user:pw@host:5432/db")
        assert s.sync_database_url == "postgresql://user:pw@host:5432/db"

    def test_explicit_database_url_sync_overrides_derived(self, settings_factory):
        s = settings_factory(
            database_url="postgresql+asyncpg://app_user:app_pw@app_host:5432/app",
            database_url_sync="postgresql+psycopg2://alembic_user:alembic_pw@alembic_host:5432/alembic",
        )
        assert (
            s.sync_database_url
            == "postgresql+psycopg2://alembic_user:alembic_pw@alembic_host:5432/alembic"
        )

    def test_sqlite_url_passes_through(self, settings_factory):
        s = settings_factory(database_url="sqlite+aiosqlite:///./local.db")
        assert s.sync_database_url == "sqlite+aiosqlite:///./local.db"


class TestDbTimeoutSettings:
    """The three timeout settings must exist with safe defaults."""

    def test_default_values(self, settings_factory):
        s = settings_factory()
        assert s.db_statement_timeout_ms == 30000
        assert s.db_lock_timeout_ms == 5000
        assert s.db_idle_in_tx_timeout_ms == 60000

    def test_overrides_take_effect(self, settings_factory):
        s = settings_factory(
            db_statement_timeout_ms=10_000,
            db_lock_timeout_ms=1_000,
            db_idle_in_tx_timeout_ms=30_000,
        )
        assert s.db_statement_timeout_ms == 10_000
        assert s.db_lock_timeout_ms == 1_000
        assert s.db_idle_in_tx_timeout_ms == 30_000