"""`ScreenerService.sync_screener_data` must not write blind rows.

The scheduled sync maps provider fields onto a Screener Snapshot row. Three
things went wrong there:

1. Optional fields were guarded with ``hasattr``, which is true whenever the
   field is *declared*. A provider model that declares ``price`` but leaves it
   unset still passed the guard and wrote a NULL, which is indistinguishable
   downstream from a symbol that genuinely has no quote.
2. Its upsert overwrote every column on conflict, so a sync carrying a sparse
   payload could blank a column another writer had already populated. That is
   the same ownership rule the request path follows.
3. Unknown-unit enrichment must not supersede a certified fallback (stored
   price or prior snapshot); with no certified fallback it still stands.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace

import pandas as pd
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from vnibb.models.company import Company
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.trading import FinancialRatio
from vnibb.providers.vnstock import runtime
from vnibb.services import data_pipeline as data_pipeline_module
from vnibb.services import screener_service as screener_service_module
from vnibb.services.data_pipeline import DataPipeline
from vnibb.services.screener_service import ScreenerService

TODAY = datetime.utcnow().date()


class _Fetcher:
    """Stands in for VnstockScreenerFetcher, returning one canned item per exchange."""

    def __init__(self, rows):
        self._rows = rows

    async def fetch(self, params):  # noqa: ARG002 - signature parity
        return list(self._rows)


async def _run_sync(test_db, monkeypatch, rows):
    """Drive sync_screener_data against the test session."""
    fetcher = _Fetcher(rows)
    monkeypatch.setattr(screener_service_module, "VnstockScreenerFetcher", fetcher)

    class _SessionCtx:
        async def __aenter__(self):
            return test_db

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setattr(
        screener_service_module, "async_session_maker", lambda *a, **k: _SessionCtx()
    )
    return await ScreenerService().sync_screener_data(exchanges=["HOSE"], limit=10)


def _item(**overrides):
    base = {
        "symbol": "VNM",
        "organ_name": "Vietnam Dairy Products",
        "exchange": "HOSE",
        "industry_name": "Thực phẩm",
        "market_cap": 1.26e14,
        "pe": 14.2,
        "pb": 2.9,
        "roe": 0.31,
        "price": 60.3,
        "volume": 2522300,
        "trade_date": TODAY,
        "roa": 0.12,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.mark.asyncio
async def test_declared_but_unset_price_is_not_written_as_null(test_db: AsyncSession, monkeypatch):
    """A declared-but-unset price must be omitted, not written as NULL."""
    await _run_sync(test_db, monkeypatch, [_item(symbol="VNM", price=None)])

    row = (
        await test_db.execute(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "VNM"))
    ).scalar_one()

    # The column was simply not part of the payload, so it kept its default
    # rather than being explicitly nulled.
    assert row.price is None
    assert row.trade_date is None
    # The rest of the row still landed, proving the sync ran.
    assert row.market_cap == 1.26e14
    assert row.exchange == "HOSE"


@pytest.mark.asyncio
async def test_repeated_sync_does_not_blank_a_populated_column(test_db: AsyncSession, monkeypatch):
    """A sparse second sync must not erase what the first one wrote."""
    test_db.add(
        ScreenerSnapshot(
            symbol="VNM",
            snapshot_date=TODAY,
            source="KBS",
            price=60.3,
            pe=14.2,
            market_cap=1.26e14,
            trade_date=TODAY - timedelta(days=1),
        )
    )
    await test_db.commit()

    # Second sync arrives with price/pe missing entirely.
    await _run_sync(test_db, monkeypatch, [_item(symbol="VNM", price=None, pe=None)])

    row = (
        await test_db.execute(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "VNM"))
    ).scalar_one()

    assert row.price == 60.3
    assert row.pe == 14.2
    assert row.trade_date == TODAY - timedelta(days=1)
    # Provenance stays with the first writer.
    assert row.source == "KBS"


@pytest.mark.asyncio
async def test_sync_stamps_utc_snapshot_date(test_db: AsyncSession, monkeypatch):
    """The sync keys rows to the same clock the rest of the pipeline uses."""
    await _run_sync(test_db, monkeypatch, [_item(symbol="FPT")])

    row = (
        await test_db.execute(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "FPT"))
    ).scalar_one()

    assert row.snapshot_date == TODAY
    assert row.trade_date == TODAY


@pytest.mark.asyncio
async def test_screener_sync_persists_provider_unit_without_double_scaling(test_db, monkeypatch):
    await _run_sync(test_db, monkeypatch, [_item(price=60300, price_unit="VND", price_source="vnstock_history:VCI")])
    row = (await test_db.execute(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "VNM"))).scalar_one()
    assert row.price == 60300
    assert row.extended_metrics["price_unit"] == "VND"
    assert row.extended_metrics["price_source"] == "vnstock_history:VCI"


@pytest.mark.asyncio
async def test_quoteless_sync_updates_ratio_cells_and_evidence_atomically(test_db, monkeypatch):
    test_db.add(ScreenerSnapshot(
        symbol="VNM", snapshot_date=TODAY, price=60300, roe=10, roa=5,
        extended_metrics={"price_unit": "VND", "price_source": "stored_quote",
                          "ratio_units": {"roe": "percent", "roa": "percent"},
                          "provider_evidence": [{"roe_pct": 10}]},
    ))
    await test_db.commit()
    evidence = [{"roe_pct": 0.25}, {"roa": 0.5}]
    assert await _run_sync(test_db, monkeypatch, [_item(
        price=None, roe=0.25, roa=None,
        ratio_units={"roe": "percent", "roa": "unknown", "debt_assets": "percent"},
        provider_evidence=evidence, debt_to_asset=0.25,
    )]) == 1
    row = (await test_db.execute(select(ScreenerSnapshot))).scalar_one()
    await test_db.refresh(row)
    assert row.price == 60300
    assert row.roe == 0.25
    assert row.roa is None
    assert row.extended_metrics["price_unit"] == "VND"
    assert row.extended_metrics["price_source"] == "stored_quote"
    assert row.extended_metrics["ratio_units"]["roe"] == "percent"
    assert row.extended_metrics["ratio_units"]["roa"] == "unknown"
    assert row.extended_metrics["provider_evidence"] == evidence
    assert row.extended_metrics["debt_to_asset"] == 0.25


@pytest.mark.asyncio
async def test_screener_sync_persists_nonempty_payload_with_ratio_only_metadata(test_db, monkeypatch):
    evidence = [{"payoutRatio": 6.3257, "unit": "percent"}]
    count = await _run_sync(test_db, monkeypatch, [_item(
        symbol="FPT", price=60300, price_unit="VND", price_source="vnstock_history:VCI",
        roe=0, roa=None, payout_ratio=6.3257,
        ratio_units={"roe": "percent", "payout_ratio": "percent"}, provider_evidence=evidence,
    )])

    assert count == 1
    rows = (await test_db.execute(select(ScreenerSnapshot))).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert (row.symbol, row.price, row.pe, row.market_cap, row.roe) == ("FPT", 60300, 14.2, 1.26e14, 0)
    assert row.roa is None
    assert row.net_margin is None
    assert row.revenue_growth is None
    assert row.extended_metrics["ratio_units"] == {"roe": "percent", "payout_ratio": "percent"}
    assert row.extended_metrics["provider_evidence"] == evidence


@pytest.mark.parametrize("unit,source,price,expected,expected_unit", [
    (None, "vnstock_history:KBS", 60.3, 60300, "VND"),
    ("VND", "vnstock_history:VCI", 60300, 60300, "VND"),
    (None, "vnstock_history:MSN", 60.3, 60.3, "unknown"),
])
def test_screener_provider_uses_actual_history_contract(unit, source, price, expected, expected_unit):
    from vnibb.providers.vnstock.equity_screener import StockScreenerParams, VnstockScreenerFetcher

    raw = {"ticker": "VNM", "price": price, "price_source": source}
    if unit:
        raw["price_unit"] = unit
    result = VnstockScreenerFetcher.transform_data(StockScreenerParams(), [raw])[0]
    assert result.price == expected
    assert result.price_unit == expected_unit
    assert result.price_source == source


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider_module,frame_source,unit,close,expected_price,expected_unit,expected_source",
    [
        ("vnstock.explorer.kbs.quote", "KBS", None, 60.3, 60300, "VND", "vnstock_history:KBS"),
        ("vnstock.explorer.kbs.quote", "VCI", None, 60.3, 60300, "VND", "vnstock_history:VCI"),
        ("vnstock.explorer.kbs.quote", "KBS", None, 0.5, 500, "VND", "vnstock_history:KBS"),
        ("vnstock.explorer.kbs.quote", "KBS", None, 100000, 100000000, "VND", "vnstock_history:KBS"),
        ("vnstock.explorer.kbs.quote", "KBS", "VND", 60300, 60300, "VND", "vnstock_history:KBS"),
        ("vnstock_data.explorer.kbs.quote", "KBS", "VND", 60300, 60300, "VND", "vnstock_data_history:KBS"),
        ("vnstock_data.explorer.kbs.quote", "KBS", None, 60300, 60300, "unknown", "vnstock_data_history:KBS"),
        ("vnstock.explorer.kbs.quote", "MSN", None, 60300, 60300, "unknown", "vnstock_history:MSN"),
        ("vnstock.explorer.kbs.quote", "MSN", None, 0.5, 0.5, "unknown", "vnstock_history:MSN"),
    ],
    ids=[
        "free-history",
        "actual-frame-source",
        "low-known-price",
        "high-known-price",
        "already-canonical",
        "sponsor-explicit-unit",
        "sponsor-unknown-unit",
        "unknown-source-high-price",
        "unknown-source-low-price",
    ],
)
@pytest.mark.parametrize(
    "fallback",
    [None, "stock_price", "previous_snapshot"],
    ids=["no-fallback", "stored-price", "previous-snapshot"],
)
async def test_pipeline_screener_history_enrichment_retains_actual_price_lineage(
    test_engine,
    monkeypatch,
    provider_module,
    frame_source,
    unit,
    close,
    expected_price,
    expected_unit,
    expected_source,
    fallback,
):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(data_pipeline_module, "async_session_maker", sessions)
    monkeypatch.setattr(data_pipeline_module.settings, "vnstock_source", "VCI")
    shares = 2_000_000
    dps = 300
    trade_date = TODAY - timedelta(days=1)
    expected_trade_date = trade_date
    expected_volume = 456
    if fallback and expected_unit == "unknown":
        if fallback == "stock_price":
            expected_price, expected_volume, offset = 61500, 789, 1
        else:
            expected_price, expected_volume, offset = 62000, 321, 2
        expected_unit = "VND"
        expected_source = "vnstock_vnd:VCI"
        expected_trade_date = trade_date - timedelta(days=offset)
    quote_calls = []
    cache = []

    class Listing:
        def __init__(self, **kwargs):
            pass

        def all_symbols(self):
            return pd.DataFrame()

        symbols_by_exchange = all_symbols
        symbols_by_industries = all_symbols

    class Finance:
        def __init__(self, **kwargs):
            pass

        def ratio(self, **kwargs):
            return pd.DataFrame([{"item_id": "pe", "2025": 12}])

    class Quote:
        def __init__(self, symbol, source):
            quote_calls.append((symbol, source))
            self.source = source

        def history(self, **kwargs):
            frame = pd.DataFrame([
                {"time": trade_date - timedelta(days=1), "close": 1, "volume": 10},
                {"time": trade_date, "close": close, "volume": 456},
            ])
            if frame_source:
                frame.attrs["source"] = frame_source
            if unit:
                frame.attrs["price_unit"] = unit
            return frame

    Quote.__module__ = provider_module

    async def pace(bucket):
        return None

    async def cached(key, value, ttl, **kwargs):
        cache.append(value)

    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_finance_class", lambda: Finance)
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", pace)
    monkeypatch.setattr(pipeline, "_cache_set_json", cached)
    async with sessions.begin() as session:
        session.add(Company(symbol="VNM", outstanding_shares=shares))
        session.add(FinancialRatio(id=1, symbol="VNM", period="2025", fiscal_year=2025, dps=dps))
        if fallback == "stock_price":
            stock = Stock(symbol="VNM")
            session.add(stock)
            await session.flush()
            session.add(StockPrice(
                id=1,
                stock_id=stock.id,
                symbol="VNM",
                time=trade_date - timedelta(days=1),
                open=61000,
                high=62000,
                low=60000,
                close=61500,
                volume=789,
                interval="1D",
                source="vnstock_vnd:VCI",
            ))
        elif fallback == "previous_snapshot":
            session.add(ScreenerSnapshot(
                symbol="VNM",
                snapshot_date=TODAY - timedelta(days=1),
                price=62000,
                volume=321,
                trade_date=TODAY - timedelta(days=3),
                extended_metrics={"price_unit": "VND", "price_source": "vnstock_vnd:VCI"},
            ))

    count = await pipeline.sync_screener_data(symbols=["VNM"])

    assert count == 1
    assert quote_calls == [("VNM", "VCI")]
    async with sessions() as session:
        row = (
            await session.scalars(
                select(ScreenerSnapshot).where(
                    ScreenerSnapshot.symbol == "VNM",
                    ScreenerSnapshot.snapshot_date == TODAY,
                )
            )
        ).one()
        assert row.price == pytest.approx(expected_price)
        assert row.trade_date == expected_trade_date
        assert row.volume == expected_volume
        assert row.pe == 12
        assert row.extended_metrics["price_unit"] == expected_unit
        assert row.extended_metrics["price_source"] == expected_source
        if expected_unit == "VND":
            assert row.market_cap == pytest.approx(shares * expected_price)
            expected_yield = dps / expected_price * 100
            assert row.dividend_yield == pytest.approx(expected_yield)
        else:
            assert row.market_cap is None
            assert row.dividend_yield is None

    assert len(cache) == 1
    assert cache[0]["price"] == pytest.approx(expected_price)
    assert cache[0]["price_unit"] == expected_unit
    assert cache[0]["price_source"] == expected_source
    assert cache[0]["trade_date"] == expected_trade_date.isoformat()
    assert cache[0]["volume"] == expected_volume
    if expected_unit == "unknown":
        assert cache[0]["market_cap"] is None
        assert cache[0]["dividend_yield"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_unit,expected_roe,expected_debt,marker", [
    ("fraction", 25.0, 42.0, "percent"),
    (None, None, None, "unknown"),
])
async def test_pipeline_quote_less_refresh_pairs_stored_ratios_and_evidence(
    test_engine, monkeypatch, provider_unit, expected_roe, expected_debt, marker,
):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(data_pipeline_module, "async_session_maker", sessions)
    monkeypatch.setattr(data_pipeline_module.settings, "vnstock_source", "VCI")
    evidence = [
        {"item_id": "roe", "unit": provider_unit, "2025": 0.25},
        {"item_id": "debt_assets", "unit": provider_unit, "2025": 0.42},
    ]

    class Listing:
        def __init__(self, **kwargs):
            pass

        def all_symbols(self):
            return pd.DataFrame()

        symbols_by_exchange = all_symbols
        symbols_by_industries = all_symbols

    class Finance:
        def __init__(self, **kwargs):
            pass

        def ratio(self, **kwargs):
            return pd.DataFrame(evidence)

    class Quote:
        def __init__(self, **kwargs):
            pass

        def history(self, **kwargs):
            return pd.DataFrame()

    async def pace(bucket):
        return None

    async def cached(*args, **kwargs):
        return None

    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_finance_class", lambda: Finance)
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", pace)
    monkeypatch.setattr(pipeline, "_cache_set_json", cached)
    async with sessions.begin() as session:
        session.add(ScreenerSnapshot(
            symbol="VNM", snapshot_date=TODAY, trade_date=TODAY - timedelta(days=1),
            price=60300, volume=100, roe=20,
            extended_metrics={
                "price_unit": "VND", "price_source": "vnstock_history:VCI",
                "ratio_units": {"roe": "percent", "debt_assets": "percent"},
                "provider_evidence": [{"item_id": "roe", "2024": 20}],
                "debt_to_asset": 30, "days_payable": 12,
            },
        ))

    assert await pipeline.sync_screener_data(symbols=["VNM"]) == 1

    async with sessions() as session:
        row = (await session.scalars(select(ScreenerSnapshot).where(
            ScreenerSnapshot.symbol == "VNM", ScreenerSnapshot.snapshot_date == TODAY,
        ))).one()
        assert row.roe == expected_roe
        assert row.extended_metrics.get("debt_to_asset") == expected_debt
        assert row.extended_metrics["ratio_units"]["roe"] == marker
        assert row.extended_metrics["ratio_units"]["debt_assets"] == marker
        assert row.extended_metrics["provider_evidence"] == evidence
        assert row.extended_metrics["days_payable"] == 12
        assert (row.price, row.volume, row.trade_date) == (60300, 100, TODAY - timedelta(days=1))
        assert row.extended_metrics["price_unit"] == "VND"
        assert row.extended_metrics["price_source"] == "vnstock_history:VCI"


@pytest.mark.parametrize("provider_payload,expected", [
    ({"netProfitGrowth": 0.25}, None),
    ({"netProfitGrowth": 0.25, "unit": "fraction"}, 25),
    ({"netProfitGrowth": 0.25, "unit": "percent"}, 0.25),
    ({"netProfitGrowth": 0.25, "earnings_growth": 25,
      "ratio_units": {"earnings_growth": "percent"}}, 25),
    ({"netProfitGrowth": 0.25, "earnings_growth": 25,
      "ratio_units": {"earnings_growth": "unknown"}}, None),
    ({"netProfitGrowth": 0.25, "ratio_units": {"roe": "percent"}}, None),
])
def test_net_profit_growth_uses_only_admitted_earnings_growth(provider_payload, expected):
    from vnibb.providers.vnstock.equity_screener import StockScreenerParams, VnstockScreenerFetcher

    row = VnstockScreenerFetcher.transform_data(
        StockScreenerParams(), [{"symbol": "VNM", **provider_payload}],
    )[0]
    assert row.net_profit_growth == expected
    if "earnings_growth" in row.ratio_units:
        assert row.earnings_growth == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("unit,initial_unit,from_payload", [
    (None, "percent", False),
    ("unknown", "percent", False),
    ("percent", "unknown", False),
    ("percent", "unknown", True),
])
async def test_scheduled_ratio_backfill_pairs_admitted_values_with_evidence(
    test_engine, monkeypatch, unit, initial_unit, from_payload,
):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(data_pipeline_module, "async_session_maker", sessions)
    monkeypatch.setattr(data_pipeline_module.settings, "vnstock_source", "VCI")

    class Listing:
        def __init__(self, **kwargs):
            pass

        def all_symbols(self):
            return pd.DataFrame()

        symbols_by_exchange = all_symbols
        symbols_by_industries = all_symbols

    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    values = {"revenue_growth": 0, "earnings_growth": -2, "operating_margin": 15,
              "debt_assets": 40}
    prior_evidence = [{"item_id": "roe", "unit": "percent", "2024": 20}]
    evidence = [{"item_id": key, "unit": unit, "2025": value}
                for key, value in values.items()]
    raw_data = {}
    if unit is not None:
        raw_data = {"ratio_units": dict.fromkeys(values, unit), "provider_evidence": evidence}
    if from_payload:
        raw_data.update(revenueGrowth=0, earningsGrowth=-2, operatingMargin=15, debt_to_asset=40)

    async with sessions.begin() as session:
        session.add(ScreenerSnapshot(
            symbol="VNM", snapshot_date=TODAY, roe=20, price=60300,
            extended_metrics={
                "ratio_units": {"roe": "percent", **dict.fromkeys(values, initial_unit)},
                "provider_evidence": prior_evidence, "price_unit": "VND",
                "price_source": "stored_quote", "days_payable": 12,
            },
        ))
        session.add(FinancialRatio(
            id=1, symbol="VNM", period="2025", fiscal_year=2025, source="vnstock",
            revenue_growth=None if from_payload else 0,
            earnings_growth=None if from_payload else -2,
            operating_margin=None if from_payload else 15,
            debt_to_assets=None if from_payload else 40, raw_data=raw_data,
        ))

    # Resume after the provider pass to exercise the scheduled backfill alone.
    assert await DataPipeline().sync_screener_data(
        symbols=["VNM"], progress={"stage": "screener", "last_index": 0},
    ) == 0

    async with sessions() as session:
        row = (await session.scalars(select(ScreenerSnapshot))).one()
        expected = values if unit == "percent" else dict.fromkeys(values)
        assert row.revenue_growth == expected["revenue_growth"]
        assert row.earnings_growth == expected["earnings_growth"]
        assert row.operating_margin == expected["operating_margin"]
        assert row.extended_metrics.get("debt_to_asset") == expected["debt_assets"]
        assert row.extended_metrics["ratio_units"] == {
            "roe": "percent", **dict.fromkeys(values, "percent" if unit == "percent" else initial_unit),
        }
        assert row.extended_metrics["provider_evidence"] == (
            prior_evidence + evidence if unit == "percent" else prior_evidence
        )
        assert (row.roe, row.price) == (20, 60300)
        assert row.extended_metrics["days_payable"] == 12
        assert row.extended_metrics["price_source"] == "stored_quote"


@pytest.mark.asyncio
async def test_pipeline_session_acquisition_is_opt_in_and_clears_unqualified_quotes(test_engine, monkeypatch):
    from copy import deepcopy
    from datetime import UTC, date

    from vnibb.models.sync_status import SyncStatus
    from vnibb.services.cache_manager import snapshot_session_coverage
    from vnibb.services.vietcap_client import VietcapClient

    session_date = date(2026, 10, 26)
    observed = datetime(2026, 10, 26, 9, tzinfo=UTC)
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    cache = []
    calls = []

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return observed.astimezone(tz)

        @classmethod
        def utcnow(cls):
            return observed.replace(tzinfo=None)

    def board(self, symbols, **kwargs):
        calls.append(symbols)
        return [{
            "listingInfo": {
                "symbol": symbol, "ticker": symbol, "stockType": "STOCK", "type": "STOCK",
                "isDelisted": 0, "tradingDate": session_date.isoformat(),
                "receivedTime": "2026-10-26T01:44:00Z", "tradingStatus": "TRADING_ACTIVATED",
                "tradingStatusCode": "20", "securityStatus": "N",
            },
            "bidAsk": {"symbol": symbol, "session": "ENDED", "time": "2026-10-26T08:00:00Z", "receivedTime": "2026-10-26T08:00:03Z"},
            "matchPrice": {"symbol": symbol, "session": "ENDED", "time": "2026-10-26T08:00:00Z", "receivedTime": "2026-10-26T08:00:03Z", "openPrice": None, "highest": 0, "lowest": 0, "matchPrice": 0, "accumulatedVolume": 0},
        } for symbol in symbols]

    async def cached(key, value, ttl):
        cache.append(deepcopy(value))

    monkeypatch.setattr(data_pipeline_module, "async_session_maker", sessions)
    monkeypatch.setattr(data_pipeline_module, "datetime", FrozenDateTime)
    monkeypatch.setattr(VietcapClient, "get_price_board", board)
    retained = SimpleNamespace(
        retain_price_board_envelope=lambda *args: None,
        retain_market_sessions=lambda records: {record["symbol"]: record for record in records},
    )
    monkeypatch.setattr("vnibb.services.mongo_market_data_service.get_mongo_market_data_service", lambda: retained)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_cache_set_json", cached)
    async with sessions.begin() as session:
        session.add_all([Stock(symbol="AAA", is_active=1), Stock(symbol="BBB", is_active=1)])
        session.add_all([
            ScreenerSnapshot(symbol="AAA", snapshot_date=session_date, trade_date=session_date, price=10000, volume=5, pe=12, extended_metrics={"price_unit": "VND", "price_source": "unverified", "ratio_units": {"roe": "percent"}, "market_session": {"raw": {"obsolete": True}}}),
            ScreenerSnapshot(symbol="BBB", snapshot_date=session_date, trade_date=session_date - timedelta(days=3), price=20000, volume=5, extended_metrics={"price_unit": "VND", "price_source": "vietcap_vnd"}),
        ])

    assert await pipeline.sync_screener_data(enrich_ratios=False) == 2
    assert calls == []
    assert await pipeline.sync_screener_data(enrich_ratios=False, acquire_sessions=True) == 2
    assert calls == [["AAA", "BBB"]]
    async with sessions() as session:
        rows = {row.symbol: row for row in (await session.scalars(select(ScreenerSnapshot))).all()}
        assert (rows["AAA"].price, rows["AAA"].trade_date, rows["AAA"].volume, rows["AAA"].pe) == (None, None, 0, 12)
        assert (rows["BBB"].price, rows["BBB"].trade_date, rows["BBB"].volume) == (20000, session_date - timedelta(days=3), 0)
        assert all(snapshot_session_coverage(row, session_date, observed) == "no_trade" for row in rows.values())
        assert "obsolete" not in rows["AAA"].extended_metrics["market_session"]["raw"]
        assert rows["AAA"].extended_metrics["ratio_units"] == {"roe": "percent"}
        receipts = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()
        typed = [row.additional_data for row in receipts if "market_session_date" in row.additional_data]
        assert len(typed) == 1
        assert typed[0]["market_session_date"] == session_date.isoformat()
        assert typed[0]["expected_symbols"] == ["AAA", "BBB"]

    def unavailable(self, symbols, **kwargs):
        raise RuntimeError("source unavailable")

    monkeypatch.setattr(VietcapClient, "get_price_board", unavailable)
    progress = {}
    assert await pipeline.sync_screener_data(enrich_ratios=False, acquire_sessions=True, progress=progress) == 0
    assert progress["base_count"] == 0
    assert progress["error_count"] == 2
    async with sessions() as session:
        receipts = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()
        assert sum("market_session_date" in row.additional_data for row in receipts) == 1
