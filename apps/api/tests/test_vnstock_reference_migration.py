from types import SimpleNamespace

import pandas as pd
import pytest
from vnibb.core.exceptions import ProviderError
from vnibb.providers.vnstock import runtime
from vnibb.providers.vnstock.company_events import VnstockCompanyEventsFetcher
from vnibb.providers.vnstock.company_news import VnstockCompanyNewsFetcher
from vnibb.providers.vnstock.dividends import VnstockDividendsFetcher
from vnibb.providers.vnstock.equity_profile import VnstockEquityProfileFetcher
from vnibb.providers.vnstock.general_rating import VnstockGeneralRatingFetcher
from vnibb.providers.vnstock.listing import VnstockListingFetcher
from vnibb.providers.vnstock.ownership import VnstockOwnershipFetcher
from vnibb.providers.vnstock.trading_stats import VnstockTradingStatsFetcher


@pytest.mark.asyncio
async def test_profile_uses_vci_company_adapter_and_listing(monkeypatch):
    calls = []

    class Company:
        def __init__(self, *, symbol, source):
            calls.append(("company", symbol, source))

        def overview(self):
            return pd.DataFrame([{"company_profile": "Issuer profile"}])

    class Listing:
        def __init__(self, *, source):
            calls.append(("listing", source))

        def all_symbols(self):
            return pd.DataFrame([{"symbol": "VNM", "organ_name": "Issuer"}])

    monkeypatch.setattr(runtime, "get_company_class", lambda: Company)
    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    rows = await VnstockEquityProfileFetcher.extract_data({"symbol": "VNM"})
    assert rows == [{"company_profile": "Issuer profile", "organ_name": "Issuer"}]
    assert calls == [("company", "VNM", "VCI"), ("listing", "VCI")]


@pytest.mark.asyncio
async def test_profile_provider_failure_is_not_empty(monkeypatch):
    class Company:
        def __init__(self, **kwargs):
            pass

        def overview(self):
            raise RuntimeError("overview unavailable")

    monkeypatch.setattr(runtime, "get_company_class", lambda: Company)
    monkeypatch.setattr(runtime, "get_listing_class", lambda: object)
    with pytest.raises(ProviderError, match="overview unavailable"):
        await VnstockEquityProfileFetcher.extract_data({"symbol": "VNM"})


@pytest.mark.asyncio
async def test_listing_all_symbols_uses_sdk5_signature(monkeypatch):
    calls = []

    class Listing:
        def __init__(self, *, source):
            calls.append(source)

        def all_symbols(self):
            return pd.DataFrame([{"symbol": "VNM", "organ_name": "Issuer"}])

    monkeypatch.setattr("vnibb.providers.vnstock.listing.get_listing_class", lambda: Listing)
    rows = await VnstockListingFetcher.fetch_all_symbols()
    assert [(row.symbol, row.organ_name) for row in rows] == [("VNM", "Issuer")]
    assert calls == ["VCI"]


@pytest.mark.asyncio
async def test_listing_group_accepts_sdk5_series(monkeypatch):
    calls = []

    class Listing:
        def __init__(self, *, source):
            calls.append(source)

        def symbols_by_group(self, *, group):
            calls.append(group)
            return pd.Series(["VNM", "FPT"], name="symbol")

    monkeypatch.setattr("vnibb.providers.vnstock.listing.get_listing_class", lambda: Listing)
    rows = await VnstockListingFetcher.fetch_symbols_by_group(group="VN30")
    assert [(row.symbol, row.group) for row in rows] == [("VNM", "VN30"), ("FPT", "VN30")]
    assert calls == ["VCI", "VN30"]


@pytest.mark.asyncio
async def test_ownership_does_not_switch_to_kbs(monkeypatch):
    calls = []

    class Company:
        def __init__(self, *, symbol, source):
            calls.append((symbol, source))

        def ownership(self):
            raise NotImplementedError("VCI ownership unavailable")

    monkeypatch.setattr(runtime, "get_company_class", lambda: Company)
    with pytest.raises(ProviderError, match="VCI ownership unavailable"):
        await VnstockOwnershipFetcher.fetch("vnm")
    assert calls == [("VNM", "VCI")]


@pytest.mark.asyncio
async def test_dividends_select_native_event_codes(monkeypatch):
    calls = []

    class Company:
        def __init__(self, *, symbol, source):
            calls.append((symbol, source))

        def events(self):
            return pd.DataFrame([
                {"event_code": "DIV", "exright_date": "2026-10-15"},
                {"event_code": "DDINS", "exright_date": "2026-10-16"},
            ])

    monkeypatch.setattr(runtime, "get_company_class", lambda: Company)
    rows = await VnstockDividendsFetcher.fetch("vnm")
    assert [row.ex_date for row in rows] == ["2026-10-15"]
    assert calls == [("VNM", "VCI")]


@pytest.mark.asyncio
async def test_event_provider_failure_is_not_empty(monkeypatch):
    def events():
        raise RuntimeError("events unavailable")

    monkeypatch.setattr(runtime, "create_reference_company", lambda symbol, source: SimpleNamespace(events=events))
    with pytest.raises(ProviderError, match="events unavailable"):
        await VnstockCompanyEventsFetcher.extract_data({"symbol": "VNM", "limit": 20})


@pytest.mark.asyncio
async def test_removed_news_reports_provider_error(monkeypatch):
    def news():
        raise NotImplementedError("VNSTOCK_FEATURE_REMOVED")

    monkeypatch.setattr(runtime, "create_reference_company", lambda symbol, source: SimpleNamespace(news=news))
    with pytest.raises(ProviderError, match="VNSTOCK_FEATURE_REMOVED"):
        await VnstockCompanyNewsFetcher.extract_data({"symbol": "VNM", "limit": 20})


@pytest.mark.asyncio
@pytest.mark.parametrize("fetcher", [VnstockGeneralRatingFetcher, VnstockTradingStatsFetcher])
async def test_removed_aggregate_routes_report_unavailable(fetcher):
    with pytest.raises(ProviderError, match="unavailable in vnstock 5"):
        await fetcher.fetch("VNM")
