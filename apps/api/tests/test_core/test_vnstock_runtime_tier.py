from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError
from vnibb.core.config import Settings

ROOT = Path(__file__).resolve().parents[4]
ENTRYPOINT = ROOT / "apps/api/entrypoint.sh"


def test_runtime_tier_defaults_to_free(monkeypatch):
    monkeypatch.delenv("VNSTOCK_RUNTIME_TIER", raising=False)
    assert Settings().vnstock_runtime_tier == "free"


def test_runtime_tier_normalizes_premium(monkeypatch):
    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", " PREMIUM ")
    assert Settings().vnstock_runtime_tier == "premium"


def test_runtime_tier_rejects_unknown_value(monkeypatch):
    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "golden")
    with pytest.raises(ValidationError, match="VNSTOCK_RUNTIME_TIER"):
        Settings()


def _run_entrypoint(
    tmp_path: Path, *, tier: str, required_modules: str
) -> subprocess.CompletedProcess:
    fake_python = tmp_path / "python"
    fake_python.write_text(
        "#!/bin/sh\n"
        "if [ \"$1\" = \"-\" ]; then shift; exec python3 - \"$@\"; fi\n"
        "exit 0\n",
        encoding="utf-8",
    )
    fake_python.chmod(0o755)
    (tmp_path / "uvicorn.py").write_text("", encoding="utf-8")
    (tmp_path / "vnstock.py").write_text("", encoding="utf-8")
    return subprocess.run(
        ["sh", str(ENTRYPOINT), "sh", "-c", "exit 0"],
        cwd=ROOT,
        env=os.environ
        | {
            "PATH": f"{tmp_path}:{os.environ['PATH']}",
            "PYTHONPATH": str(tmp_path),
            "VNSTOCK_RUNTIME_TIER": tier,
            "VNSTOCK_PREMIUM_REQUIRED_MODULES": required_modules,
        },
        capture_output=True,
        text=True,
    )


def test_free_tier_ignores_unavailable_premium_modules(tmp_path):
    result = _run_entrypoint(
        tmp_path,
        tier="free",
        required_modules="module_that_does_not_exist",
    )
    assert result.returncode == 0, result.stderr


def test_premium_tier_still_fails_when_required_module_is_missing(tmp_path):
    result = _run_entrypoint(
        tmp_path,
        tier="premium",
        required_modules="module_that_does_not_exist",
    )
    assert result.returncode != 0
    assert "module_that_does_not_exist" in result.stderr


@pytest.mark.asyncio
async def test_health_discloses_free_tier_capabilities(client, monkeypatch):
    from vnibb.api.v1 import health
    from vnibb.core.config import settings

    monkeypatch.setattr(settings, "vnstock_runtime_tier", "free")
    health._BASIC_HEALTH_CACHE.clear()

    response = await client.get("/api/v1/health")
    providers = response.json()["providers"]
    assert providers["vnstock_runtime_tier"] == "free"
    assert providers["vietcap_primary_eod"] is True
    assert providers["premium_realtime_streaming"] is False
    assert providers["premium_news_crawler"] is False
