"""Exactly one authorized daily owner may start APScheduler in production (#172).

Two producers would race for the same session cohort, so the configuration must
refuse a non-scheduler role asking to start the scheduler rather than relying on
an operator remembering to keep it disabled.

The guard follows the consumer's rule, not a list of false spellings:
`vnibb/api/main.py:_env_flag` starts the scheduler whenever
`SKIP_SCHEDULER_STARTUP` is present and *not* one of 1/true/yes/on, so `''` and
`no` both start a producer and must be refused here too.
"""

import pytest
from pydantic import ValidationError

from vnibb.core.config import Settings

PRODUCTION = {
    "environment": "production",
    "database_url": "postgresql+asyncpg://vnibb:placeholder@db.internal:5432/vnibb",
    "redis_url": "redis://cache.internal:6379/0",
    "admin_api_key": "synthetic-admin-value",
}


def _settings(monkeypatch, **overrides):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL_SYNC", raising=False)
    return Settings(_env_file=None, **{**PRODUCTION, **overrides})


def test_scheduler_role_is_accepted_with_required_coordination(monkeypatch):
    settings = _settings(monkeypatch, scheduler_role="scheduler", scheduler_lock_mode="required")
    assert settings.scheduler_role == "scheduler"


def test_scheduler_role_without_required_coordination_is_refused(monkeypatch):
    with pytest.raises(ValidationError, match="SCHEDULER_LOCK_MODE=required"):
        _settings(monkeypatch, scheduler_role="scheduler", scheduler_lock_mode="best_effort")


@pytest.mark.parametrize(
    "flag",
    # Every present non-truthy value starts the consumer's scheduler, '' included.
    ["0", "False", "no", "off", "", "   ", "disabled", "2"],
)
def test_any_present_nontruthy_skip_flag_is_refused_for_api_role(monkeypatch, flag):
    """The regression: a value the consumer reads as 'start' must be refused."""
    monkeypatch.setenv("SKIP_SCHEDULER_STARTUP", flag)
    with pytest.raises(ValidationError, match="exactly one producer"):
        _settings(monkeypatch, scheduler_role="api")


@pytest.mark.parametrize("flag", ["1", "true", "TRUE", "yes", "on", " On "])
def test_every_truthy_spelling_of_the_skip_flag_is_accepted(monkeypatch, flag):
    monkeypatch.setenv("SKIP_SCHEDULER_STARTUP", flag)
    assert _settings(monkeypatch, scheduler_role="api").scheduler_role == "api"


def test_unset_skip_flag_keeps_the_api_default(monkeypatch):
    """Absent means 'skip' for a non-scheduler role, which stays the safe default."""
    monkeypatch.delenv("SKIP_SCHEDULER_STARTUP", raising=False)
    assert _settings(monkeypatch, scheduler_role="api").scheduler_role == "api"


def test_development_api_role_may_still_run_the_scheduler(monkeypatch):
    monkeypatch.setenv("SKIP_SCHEDULER_STARTUP", "false")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL_SYNC", raising=False)
    settings = Settings(
        _env_file=None,
        environment="development",
        database_url="sqlite+aiosqlite:///:memory:",
        admin_api_key=None,
        scheduler_role="api",
    )
    assert settings.scheduler_role == "api"
