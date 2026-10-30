
import pandas as pd
import pytest

from scripts import run_trading_hours_intraday, seed_stocks, test_simple, verify_database
from scripts import verify_vnstock_integration
from vnibb.providers.vnstock import runtime


@pytest.mark.asyncio
async def test_intraday_focus_uses_vci_listing(monkeypatch):
    calls = []

    class Listing:
        def __init__(self, *, source):
            calls.append(source)

        def symbols_by_group(self, *, group):
            assert group == "VN30"
            return pd.Series(["VCB", "VNM"])

    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    assert await run_trading_hours_intraday._get_focus_symbols(limit=1) == ["VCB"]
    assert calls == ["VCI"]


@pytest.mark.asyncio
async def test_connectivity_and_database_check_use_vci(monkeypatch):
    calls = []

    class Listing:
        def __init__(self, *, source):
            calls.append(source)

        def all_symbols(self):
            return pd.DataFrame([{"symbol": "VCB"}])

    monkeypatch.setenv("VNSTOCK_SOURCE", "KBS")
    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    assert await test_simple.test_vnstock_api() == {"source": "VCI", "count": 1}
    assert verify_database.check_vnstock() is True
    assert calls == ["VCI", "VCI"]


@pytest.mark.asyncio
async def test_stock_seeder_uses_exchange_metadata_without_inventing_exchange(monkeypatch):
    calls = []
    statements = []

    class Listing:
        def __init__(self, *, source):
            calls.append(source)

        def symbols_by_exchange(self):
            return pd.DataFrame([
                {"symbol": "VCB", "exchange": "HSX", "type": "STOCK", "organ_name": "Issuer"},
                {"symbol": "ETF1", "exchange": "HNX", "type": "ETF"},
                {"symbol": "BAD", "exchange": None, "type": "STOCK"},
            ])

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def execute(self, statement):
            statements.append(statement)

        async def commit(self):
            pass

    monkeypatch.setattr(seed_stocks, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(seed_stocks, "async_session_maker", Session)
    await seed_stocks.seed_all_stocks()
    assert calls == ["VCI"]
    assert len(statements) == 1
    sql = str(statements[0])
    params = statements[0].compile().params
    assert params["symbol"] == "VCB"
    assert params["exchange"] == "HOSE"
    assert "industry" not in sql


def test_verifier_uses_independent_vci_adapters(monkeypatch):
    calls = []

    class Listing:
        def __init__(self, *, source):
            calls.append(("listing", source))

        def all_symbols(self):
            return pd.DataFrame([{"symbol": "VCB"}])

    class Quote:
        def __init__(self, *, symbol, source):
            calls.append(("quote", symbol, source))

        def history(self, *, start, end):
            raise RuntimeError("quote unavailable")

    class Company:
        def __init__(self, *, symbol, source):
            calls.append(("company", symbol, source))

        def overview(self):
            return pd.DataFrame([{"symbol": "VCB"}])

    class Finance:
        def __init__(self, *, symbol, source):
            calls.append(("finance", symbol, source))

        def balance_sheet(self, *, period, lang):
            assert (period, lang) == ("year", "en")
            return pd.DataFrame([{"symbol": "VCB"}])

    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    monkeypatch.setattr(runtime, "get_company_class", lambda: Company)
    monkeypatch.setattr(runtime, "get_finance_class", lambda: Finance)
    assert verify_vnstock_integration.test_vnstock_apis() == {
        "listing_all_symbols": 1,
        "quote_history": 0,
        "company_overview": 1,
        "finance_balance_sheet": 1,
    }
    assert calls == [
        ("listing", "VCI"), ("quote", "VCB", "VCI"),
        ("company", "VCB", "VCI"), ("finance", "VCB", "VCI"),
    ]


@pytest.mark.asyncio
async def test_connectivity_rejects_forbidden_runtime_before_import(monkeypatch):
    def reject_runtime():
        raise RuntimeError("forbidden runtime")

    monkeypatch.setattr(runtime, "validate_runtime", reject_runtime)
    with pytest.raises(RuntimeError, match="forbidden runtime"):
        await test_simple.test_vnstock_api()
    assert verify_database.check_vnstock() is False
    result = verify_vnstock_integration.check_vnstock_library()
    assert result["installed"] is False
