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


class TestRateLimitSettings:
    def test_defaults_to_off(self, settings_factory):
        settings = settings_factory()
        assert settings.rate_limit_mode == "off"
        assert settings.rate_limit_window_seconds == 60

    def test_accepts_shadow_and_enforce(self, settings_factory):
        assert settings_factory(rate_limit_mode="shadow").rate_limit_mode == "shadow"
        assert settings_factory(rate_limit_mode="enforce").rate_limit_mode == "enforce"


class TestWebSocketReliabilitySettings:
    def test_default_values(self, settings_factory):
        settings = settings_factory()
        assert settings.websocket_max_connections == 100
        assert settings.websocket_max_symbols_per_connection == 10
        assert settings.websocket_max_active_symbols == 20
        assert settings.websocket_fetch_concurrency == 4
        assert settings.websocket_broadcast_concurrency == 20
        assert settings.websocket_cycle_timeout_seconds == 4.5
        assert settings.websocket_send_timeout_seconds == 2

    def test_rejects_cycle_deadline_above_target(self, settings_factory):
        with pytest.raises(ValueError):
            settings_factory(websocket_cycle_timeout_seconds=5.1)


class TestRequestDeadlineSettings:
    def test_defaults_are_below_api_deadline(self, settings_factory):
        settings = settings_factory()
        assert settings.vnstock_timeout < settings.api_request_timeout_seconds
        assert settings.db_statement_timeout_ms < settings.api_request_timeout_seconds * 1000
        assert settings.mongodb_timeout_ms < settings.api_request_timeout_seconds * 1000

    @pytest.mark.parametrize(
        ("overrides", "message"),
        [
            ({"vnstock_timeout": 30}, "VNSTOCK_TIMEOUT"),
            ({"db_statement_timeout_ms": 30_000}, "DB_STATEMENT_TIMEOUT_MS"),
            ({"mongodb_timeout_ms": 30_000}, "MONGODB_TIMEOUT_MS"),
        ],
    )
    def test_rejects_deadline_at_or_above_api_timeout(self, settings_factory, overrides, message):
        with pytest.raises(ValueError, match=message):
            settings_factory(**overrides)


class TestDbTimeoutSettings:
    """The three timeout settings must exist with safe defaults."""

    def test_default_values(self, settings_factory):
        s = settings_factory()
        assert s.db_statement_timeout_ms == 25000
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
