from __future__ import annotations

import os
import subprocess
import sys
import types
from pathlib import Path

import pytest
from pydantic import ValidationError

from vnibb.core.config import Settings

ROOT = Path(__file__).resolve().parents[4]
ENTRYPOINT = ROOT / "apps/api/entrypoint.sh"


def test_runtime_tier_defaults_to_free(monkeypatch):
    monkeypatch.delenv("VNSTOCK_RUNTIME_TIER", raising=False)
    assert Settings().vnstock_runtime_tier == "free"


@pytest.mark.parametrize("tier", ["premium", " PREMIUM "])
def test_runtime_tier_rejects_premium(monkeypatch, tier):
    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", tier)
    with pytest.raises(ValidationError, match="VNSTOCK_RUNTIME_TIER"):
        Settings()


@pytest.mark.parametrize("tier", ["golden", " GOLDEN "])
def test_runtime_tier_accepts_golden(monkeypatch, tier):
    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", tier)
    assert Settings().vnstock_runtime_tier == "golden"


def test_runtime_tier_rejects_unknown_value(monkeypatch):
    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "unknown")
    with pytest.raises(ValidationError, match="VNSTOCK_RUNTIME_TIER"):
        Settings()


def test_settings_do_not_expose_api_key():
    settings = Settings(vnstock_api_key="synthetic-secret")
    assert "synthetic-secret" not in repr(settings)
    assert "vnstock_api_key" not in settings.model_dump()


@pytest.mark.parametrize("source", ["KBS", "TCBS", "MSN", " kbs "])
def test_settings_rejects_banned_sources(source):
    with pytest.raises(ValidationError, match="VNSTOCK_SOURCE"):
        Settings(vnstock_runtime_tier="free", vnstock_source=source)


def test_settings_defaults_to_guest_vci_budget(monkeypatch):
    for name in (
        "VNSTOCK_SOURCE",
        "VNSTOCK_RATE_LIMIT_RPS",
        "VNSTOCK_REINFORCEMENT_RPS",
        "VNSTOCK_CALLS_PER_MINUTE",
    ):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(vnstock_runtime_tier="free", _env_file=None)
    assert settings.vnstock_source == "VCI"
    assert settings.vnstock_rate_limit_rps == pytest.approx(18 / 60)
    assert settings.vnstock_reinforcement_rps == pytest.approx(2 / 60)
    assert settings.vnstock_calls_per_minute == 20


@pytest.mark.parametrize("source", ["KBS", "TCBS", "MSN", " kbs "])
def test_runtime_rejects_banned_sources(source):
    from vnibb.providers.vnstock.runtime import validate_source

    with pytest.raises(ValueError, match="only free VCI"):
        validate_source(source)


@pytest.mark.parametrize("source", [None, "VCI", " vci "])
def test_runtime_accepts_only_vci(source):
    from vnibb.providers.vnstock.runtime import validate_source

    assert validate_source(source) == "VCI"


@pytest.mark.parametrize(
    "paid_module", ["vnstock_data", "vnstock_ta", "vnstock_pipeline", "vnstock_news", "vnii"]
)
def test_free_runtime_guard_rejects_each_paid_package(monkeypatch, paid_module):
    from vnibb.providers.vnstock import runtime

    probed = []

    def fake_find_spec(name):
        probed.append(name)
        return object() if name == paid_module else None

    monkeypatch.setattr(runtime, "find_spec", fake_find_spec)

    with pytest.raises(RuntimeError, match=f"forbidden paid modules: {paid_module}") as raised:
        runtime.validate_free_runtime()
    assert "clean community environment" in str(raised.value)
    assert "rebuild the credential-free image" in str(raised.value)
    assert "without historical premium runtime mounts" in str(raised.value)
    assert probed == ["vnstock_data", "vnstock_ta", "vnstock_pipeline", "vnstock_news", "vnii"]


def test_free_runtime_guard_accepts_clean_community_environment(monkeypatch):
    from vnibb.providers.vnstock import runtime

    community = types.ModuleType("vnstock")
    community.status = lambda: {"authenticated": False, "tier": "guest"}
    monkeypatch.setitem(sys.modules, "vnstock", community)
    monkeypatch.setattr(runtime, "find_spec", lambda name: None)

    assert runtime.validate_free_runtime() is None


@pytest.mark.parametrize("symbol", ["Listing", "Trading", "Quote", "Finance", "Company"])
def test_runtime_imports_community_in_clean_free_environment(monkeypatch, symbol):
    from vnibb.providers.vnstock import runtime

    community = types.ModuleType("vnstock")
    community_symbol = type(symbol, (), {})
    setattr(community, symbol, community_symbol)
    community.status = lambda: {"authenticated": False, "tier": "guest"}
    monkeypatch.setitem(sys.modules, "vnstock", community)
    monkeypatch.setattr(runtime, "find_spec", lambda name: None)

    assert runtime.import_vnstock_symbol(symbol) == (community_symbol, "vnstock")
    assert getattr(runtime, f"get_{symbol.lower()}_class")() is community_symbol


def test_golden_imports_unified_sdk_even_with_paid_modules(monkeypatch):
    from vnibb.core.config import settings
    from vnibb.providers.vnstock import runtime

    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "golden")
    monkeypatch.setattr(settings, "vnstock_runtime_tier", "golden")
    monkeypatch.setattr(runtime, "find_spec", lambda name: object())
    sdk = types.ModuleType("vnstock")
    sdk.Fundamental = object()
    monkeypatch.setitem(sys.modules, "vnstock", sdk)
    assert runtime.import_vnstock_symbol("Fundamental") == (sdk.Fundamental, "vnstock")


def test_reference_company_passes_explicit_vci_before_import(monkeypatch):
    from vnibb.providers.vnstock import runtime

    calls = []
    monkeypatch.setattr(runtime, "get_company_class", lambda: lambda **kwargs: calls.append(kwargs))
    runtime.create_reference_company("VNM", " vci ")
    assert calls == [{"symbol": "VNM", "source": "VCI"}]
    with pytest.raises(ValueError):
        runtime.create_reference_company("VNM", "KBS")
    assert len(calls) == 1


@pytest.mark.parametrize(
    "paid_module", ["vnstock_data", "vnstock_ta", "vnstock_pipeline", "vnstock_news", "vnii"]
)
@pytest.mark.parametrize("indication", ["installed", "loaded_without_spec"])
def test_direct_importer_rejects_sponsor_before_provider_import_or_auth(
    monkeypatch, paid_module, indication
):
    from vnibb.providers.vnstock import runtime

    imports = []

    def importing_provider_would_authenticate(name, **kwargs):
        imports.append(name)
        raise AssertionError("provider import/authentication must never run")

    monkeypatch.setattr(runtime, "__import__", importing_provider_would_authenticate, raising=False)
    monkeypatch.setattr(
        runtime, "find_spec", lambda name: object() if name == paid_module and indication == "installed" else None
    )
    if indication == "loaded_without_spec":
        monkeypatch.setitem(sys.modules, paid_module, types.ModuleType(paid_module))

    with pytest.raises(RuntimeError, match=f"forbidden paid modules: {paid_module}"):
        runtime.import_vnstock_symbol("Quote")
    assert imports == []


@pytest.mark.parametrize(
    ("setting", "value", "message"),
    [
        ("VNSTOCK_RUNTIME_TIER", "premium", "VNSTOCK_RUNTIME_TIER"),
        ("VNSTOCK_SOURCE", "KBS", "only free VCI"),
        ("VNSTOCK_SOURCE", "TCBS", "only free VCI"),
    ],
)
def test_direct_importer_rejects_non_free_vci_policy_before_import(monkeypatch, setting, value, message):
    from vnibb.providers.vnstock import runtime

    def forbidden_import(name, **kwargs):
        raise AssertionError("provider import/authentication must never run")

    monkeypatch.setenv(setting, value)
    monkeypatch.setattr(runtime, "__import__", forbidden_import, raising=False)
    with pytest.raises(ValueError, match=message):
        runtime.import_vnstock_symbol("Quote")


def test_finance_does_not_supply_missing_community_symbols(monkeypatch):
    from vnibb.providers.vnstock import runtime

    community = types.ModuleType("vnstock")
    community.status = lambda: {"authenticated": False, "tier": "guest"}
    monkeypatch.setitem(sys.modules, "vnstock", community)
    monkeypatch.setattr(runtime, "find_spec", lambda name: None)
    with pytest.raises(AttributeError, match="Finance"):
        runtime.get_finance_class()


def test_direct_vci_backfill_rejects_sponsor_before_provider_import(monkeypatch):
    from datetime import date

    from scripts import backfill_ohlcv_full
    from vnibb.providers.vnstock import runtime

    imports = []

    def importing_provider_would_authenticate(name, **kwargs):
        imports.append(name)
        raise AssertionError("provider import/authentication must never run")

    monkeypatch.setitem(sys.modules, "vnstock_data", types.ModuleType("vnstock_data"))
    monkeypatch.setattr(runtime, "find_spec", lambda name: None)
    monkeypatch.setattr(runtime, "__import__", importing_provider_would_authenticate, raising=False)

    assert backfill_ohlcv_full._fetch_vci("VNM", date(2026, 1, 1), date(2026, 1, 2)) is None
    assert imports == []


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["depth", "insider"])
@pytest.mark.parametrize("unsupported", ["missing", "not_implemented"])
async def test_unsupported_free_capabilities_raise_provider_error(monkeypatch, kind, unsupported):
    from vnibb.core.config import settings
    from vnibb.core.exceptions import ProviderError
    from vnibb.providers.vnstock.insider_deals import VnstockInsiderDealsFetcher
    from vnibb.providers.vnstock.price_depth import VnstockPriceDepthFetcher

    calls = []

    class CommunityClient:
        def __init__(self, symbol, source):
            calls.append((symbol, source))

    class Market:
        def equity(self, symbol):
            calls.append((symbol, "VCI"))
            return self

    if unsupported == "not_implemented":
        def unavailable(self, **kwargs):
            raise NotImplementedError("Unavailable in free VCI")

        setattr(Market if kind == "depth" else CommunityClient,
                "order_book" if kind == "depth" else "events", unavailable)

    community = types.ModuleType("vnstock")
    community.Market = Market
    community.Company = CommunityClient
    community.status = lambda: {"authenticated": False, "tier": "guest"}
    monkeypatch.setitem(sys.modules, "vnstock", community)
    monkeypatch.setattr(settings, "vnstock_source", "VCI")

    fetcher = VnstockPriceDepthFetcher if kind == "depth" else VnstockInsiderDealsFetcher
    with pytest.raises(ProviderError, match="[Uu]navailable in free VCI|order_book"):
        await fetcher.fetch("vnm")
    assert calls == [("VNM", "VCI")]


def _run_entrypoint(
    tmp_path: Path, *, tier: str, required_modules: str, paid_module: str | None = None
) -> subprocess.CompletedProcess:
    fake_python = tmp_path / "python"
    fake_python.write_text(
        "#!/bin/sh\n"
        "if [ \"$1\" = \"-\" ]; then shift; exec python3 -S - \"$@\"; fi\n"
        "exit 0\n",
        encoding="utf-8",
    )
    fake_python.chmod(0o755)
    (tmp_path / "uvicorn.py").write_text("", encoding="utf-8")
    (tmp_path / "vnstock.py").write_text("", encoding="utf-8")
    if paid_module:
        sentinel = (
            "from pathlib import Path\n"
            f"Path({str(tmp_path / 'provider_imported')!r}).write_text('imported')\n"
            "raise AssertionError('provider import/authentication must never run')\n"
        )
        (tmp_path / f"{paid_module}.py").write_text(sentinel, encoding="utf-8")
        (tmp_path / "vnstock.py").write_text(sentinel, encoding="utf-8")
    return subprocess.run(
        ["sh", str(ENTRYPOINT), "sh", "-c", "exit 0"],
        cwd=ROOT,
        env=os.environ
        | {
            "PATH": f"{tmp_path}:{os.environ['PATH']}",
            "PYTHONPATH": str(tmp_path),
            "VNSTOCK_RUNTIME_TIER": tier,
            "VNSTOCK_SOURCE": "VCI",
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


def test_golden_tier_entrypoint_accepts_unified_sdk(tmp_path):
    result = _run_entrypoint(tmp_path, tier="golden", required_modules="")
    assert result.returncode == 0, result.stderr


def test_premium_tier_is_rejected_before_module_checks(tmp_path):
    result = _run_entrypoint(
        tmp_path,
        tier="premium",
        required_modules="module_that_does_not_exist",
    )
    assert result.returncode != 0
    assert "VNSTOCK_RUNTIME_TIER" in result.stderr
    assert "module_that_does_not_exist" not in result.stderr


@pytest.mark.parametrize(
    "paid_module", ["vnstock_data", "vnstock_ta", "vnstock_pipeline", "vnstock_news", "vnii"]
)
def test_free_startup_rejects_installed_paid_package_before_any_provider_import(tmp_path, paid_module):
    result = _run_entrypoint(
        tmp_path, tier="free", required_modules="", paid_module=paid_module
    )

    assert result.returncode != 0
    assert f"Free runtime contains forbidden paid modules: {paid_module}" in result.stderr
    assert "Rebuild the credential-free image" in result.stderr
    assert "remove historical premium runtime mounts" in result.stderr
    assert "provider import/authentication must never run" not in result.stderr
    assert not (tmp_path / "provider_imported").exists()


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
