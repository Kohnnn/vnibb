import json
import logging

import pytest

from vnibb.api.v1 import health
from vnibb.core import config
from vnibb.core.config import Settings, settings
from vnibb.core.logging_config import JSONFormatter
from vnibb.core.monitoring import sentry_release


def test_release_revision_defaults_and_normalizes() -> None:
    assert Settings(_env_file=None, release_revision=" ").release_revision == "unknown"
    assert Settings(_env_file=None, release_revision=" ABCDEF1 ").release_revision == "abcdef1"
    assert Settings(_env_file=None, release_revision="release-2026.07.16").release_revision == "release-2026.07.16"


def test_image_release_revision_overrides_stale_runtime_value(monkeypatch, tmp_path) -> None:
    revision_path = tmp_path / ".release-revision"
    revision_path.write_text("image-abc1234\n", encoding="utf-8")
    monkeypatch.setattr(config, "_IMAGE_RELEASE_REVISION_PATH", revision_path)
    monkeypatch.setenv("RELEASE_REVISION", "stale-abc1234")

    assert Settings(_env_file=None).release_revision == "image-abc1234"


def test_json_logs_include_release_revision(monkeypatch) -> None:
    monkeypatch.setattr(settings, "release_revision", "abc1234")
    record = logging.LogRecord("vnibb.test", logging.INFO, __file__, 1, "ready", (), None)

    assert json.loads(JSONFormatter().format(record))["revision"] == "abc1234"


def test_sentry_release_uses_release_revision(monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_name", "VNIBB")
    monkeypatch.setattr(settings, "release_revision", "abc1234")

    assert sentry_release() == "VNIBB@abc1234"


@pytest.mark.asyncio
async def test_health_exposes_release_revision(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "release_revision", "abc1234")
    health._BASIC_HEALTH_CACHE.clear()

    response = await client.get("/health/")
    detailed_response = await client.get("/health/detailed")

    assert response.status_code == 200
    assert response.json()["revision"] == "abc1234"
    assert detailed_response.status_code == 200
    assert detailed_response.json()["revision"] == "abc1234"
