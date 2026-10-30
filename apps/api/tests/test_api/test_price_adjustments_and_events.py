import asyncio
from datetime import date
from unittest.mock import AsyncMock

import pytest

from vnibb.api.v1 import equity
from vnibb.api.v1.equity import (
    _apply_adjustment_mode_to_historical_row,
    _apply_adjustment_mode_to_ohlc,
    _apply_corporate_action_adjustments,
    _historical_adjustment_meta,
    _ratio_factor_for_action,
)
from vnibb.models.news import CompanyEvent, Dividend
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.trading import FinancialRatio
from vnibb.providers.vnstock.company_events import (
    _normalize_company_action_category,
    _parse_company_action_value,
)
from vnibb.providers.vnstock.equity_historical import EquityHistoricalData
from vnibb.providers.vnstock.financial_ratios import FinancialRatioData


def test_apply_adjustment_mode_to_ohlc_uses_adjusted_close_factor():
    adjusted_open, adjusted_high, adjusted_low, adjusted_close, factor, applied = (
        _apply_adjustment_mode_to_ohlc(
            open_value=100.0,
            high_value=120.0,
            low_value=90.0,
            close_value=110.0,
            adjusted_close=55.0,
            adjustment_mode="adjusted",
        )
    )

    assert applied is True
    assert factor == 0.5
    assert adjusted_open == 50.0
    assert adjusted_high == 60.0
    assert adjusted_low == 45.0
    assert adjusted_close == 55.0


def test_apply_adjustment_mode_to_ohlc_falls_back_to_raw_when_adjustment_missing():
    adjusted_open, adjusted_high, adjusted_low, adjusted_close, factor, applied = (
        _apply_adjustment_mode_to_ohlc(
            open_value=100.0,
            high_value=120.0,
            low_value=90.0,
            close_value=110.0,
            adjusted_close=None,
            adjustment_mode="adjusted",
        )
    )

    assert applied is False
    assert factor is None
    assert adjusted_open == 100.0
    assert adjusted_high == 120.0
    assert adjusted_low == 90.0
    assert adjusted_close == 110.0


def test_apply_adjustment_mode_to_historical_row_scales_provider_ohlc():
    row = EquityHistoricalData(
        symbol="VNM",
        price_unit="VND",
        time=date(2024, 1, 1),
        open=100,
        high=120,
        low=90,
        close=110,
        volume=1000,
        raw_close=110,
        adjusted_close=55,
    )

    adjusted = _apply_adjustment_mode_to_historical_row(row, "adjusted")
    raw = _apply_adjustment_mode_to_historical_row(row, "raw")

    assert (adjusted.open, adjusted.high, adjusted.low, adjusted.close) == (50, 60, 45, 55)
    assert adjusted.volume == 1000
    assert adjusted.adjustment_factor == 0.5
    assert adjusted.adjustment_applied is True
    assert (raw.open, raw.high, raw.low, raw.close) == (100, 120, 90, 110)
    assert raw.adjustment_applied is False
    assert adjusted.price_unit == raw.price_unit == "VND"


def test_historical_adjustment_meta_reports_partial_coverage():
    rows = [
        EquityHistoricalData(
            symbol="VNM",
            price_unit="VND",
            time=date(2024, 1, day),
            open=100,
            high=110,
            low=90,
            close=100,
            volume=1000,
            adjustment_applied=applied,
        )
        for day, applied in ((1, True), (2, False))
    ]

    meta = _historical_adjustment_meta(rows, "adjusted")

    assert meta.adjustment_requested_count == 2
    assert meta.adjustment_applied_count == 1
    assert meta.adjustment_coverage_pct == 50.0
    assert "1 raw row" in meta.adjustment_warning


def test_normalize_company_action_category_identifies_rights_issue():
    category, subtype = _normalize_company_action_category(
        "PHAT HANH THEM",
        "Issue rights to existing shareholders",
        "Quyen mua co phieu",
    )

    assert category == "issuance"
    assert subtype == "rights_issue"


def test_parse_company_action_value_handles_cash_and_ratio_formats():
    cash_amount, share_ratio = _parse_company_action_value("1,500 VND/share", None)
    assert cash_amount == 1500.0
    assert share_ratio is None

    cash_amount, share_ratio = _parse_company_action_value("2:1", None)
    assert cash_amount is None
    assert share_ratio == "2:1"


def test_ratio_factor_for_action_handles_split_and_stock_dividend():
    assert (
        _ratio_factor_for_action(action_category="split", action_subtype="split", share_ratio="2:1")
        == 0.5
    )
    assert (
        _ratio_factor_for_action(
            action_category="dividend", action_subtype="stock_dividend", share_ratio="10:3"
        )
        == 10 / 13
    )


def test_apply_corporate_action_adjustments_applies_split_factor_backward():
    rows = [
        EquityHistoricalData(
            symbol="VNM",
            price_unit="VND",
            time=date(2024, 1, 1),
            open=100,
            high=110,
            low=90,
            close=100,
            volume=1000,
            raw_close=100,
        ),
        EquityHistoricalData(
            symbol="VNM",
            price_unit="VND",
            time=date(2024, 1, 5),
            open=102,
            high=112,
            low=92,
            close=102,
            volume=1100,
            raw_close=102,
        ),
        EquityHistoricalData(
            symbol="VNM",
            price_unit="VND",
            time=date(2024, 1, 10),
            open=52,
            high=56,
            low=48,
            close=50,
            volume=2000,
            raw_close=50,
        ),
    ]
    actions = [
        {
            "effective_date": date(2024, 1, 10),
            "action_category": "split",
            "action_subtype": "split",
            "share_ratio": "2:1",
            "cash_amount_per_share": None,
            "percent_ratio": None,
        }
    ]

    adjusted = _apply_corporate_action_adjustments(rows, actions, "adjusted")

    assert adjusted[0].close == 50
    assert adjusted[1].close == 51
    assert adjusted[2].close == 50
    assert all(row.price_unit == "VND" for row in adjusted)


def test_apply_corporate_action_adjustments_applies_cash_dividend_backward():
    rows = [
        EquityHistoricalData(
            symbol="VNM",
            price_unit="VND",
            time=date(2024, 1, 1),
            open=120,
            high=125,
            low=115,
            close=120,
            volume=1000,
            raw_close=120,
        ),
        EquityHistoricalData(
            symbol="VNM",
            price_unit="VND",
            time=date(2024, 1, 2),
            open=98,
            high=103,
            low=96,
            close=100,
            volume=1200,
            raw_close=100,
        ),
        EquityHistoricalData(
            symbol="VNM",
            price_unit="VND",
            time=date(2024, 1, 3),
            open=97,
            high=101,
            low=95,
            close=98,
            volume=1500,
            raw_close=98,
        ),
    ]
    actions = [
        {
            "effective_date": date(2024, 1, 3),
            "action_category": "dividend",
            "action_subtype": "cash_dividend",
            "share_ratio": None,
            "cash_amount_per_share": 2.0,
            "percent_ratio": None,
        }
    ]

    adjusted = _apply_corporate_action_adjustments(rows, actions, "adjusted")

    assert adjusted[0].close == 117.6
    assert adjusted[1].close == 98.0
    assert adjusted[2].close == 98.0
    assert all(row.price_unit == "VND" for row in adjusted)


@pytest.mark.asyncio
async def test_events_serve_persisted_dates_without_stalled_provider(client, test_db, monkeypatch):
    test_db.add(CompanyEvent(
        id=1, symbol="VNM", event_type="dividend", event_date=date(2026, 9, 14),
        ex_date=date(2026, 9, 15), record_date=date(2026, 9, 16),
        payment_date=date(2026, 10, 5), value=1500,
    ))
    await test_db.commit()
    provider = AsyncMock(side_effect=AssertionError("stored event must bypass provider"))
    monkeypatch.setattr(equity.VnstockCompanyEventsFetcher, "fetch", provider)

    response = await client.get("/api/v1/equity/VNM/events?limit=5")

    assert response.status_code == 200
    row = response.json()["data"][0]
    assert row["event_date"] == "2026-09-14"
    assert row["ex_date"] == "2026-09-15"
    assert row["record_date"] == "2026-09-16"
    assert row["payment_date"] == "2026-10-05"
    provider.assert_not_awaited()
    assert not test_db.in_transaction()


@pytest.mark.asyncio
async def test_events_release_owned_read_before_bounded_provider(test_db, monkeypatch):
    async def stalled_provider(*args, **kwargs):
        assert not test_db.in_transaction()
        await asyncio.Event().wait()

    monkeypatch.setattr(equity.VnstockCompanyEventsFetcher, "fetch", stalled_provider)
    monkeypatch.setattr(equity, "_provider_timeout_budget", lambda: 0.01)

    response = await equity.get_company_events.__wrapped__("VNM", limit=5, db=test_db)

    assert response.data == []
    assert response.error == "Company events provider deadline exceeded"


@pytest.mark.asyncio
async def test_events_do_not_rollback_caller_writes(test_db, monkeypatch):
    pending = CompanyEvent(id=1, symbol="VNM", event_type="meeting", event_date=date(2026, 9, 14))
    test_db.add(pending)
    monkeypatch.setattr(equity.VnstockCompanyEventsFetcher, "fetch", AsyncMock())

    response = await equity.get_company_events.__wrapped__("VNM", limit=5, db=test_db)

    assert response.data[0]["event_type"] == "meeting"
    assert pending in test_db
    assert test_db.in_transaction()


@pytest.mark.asyncio
async def test_ratio_history_reads_certified_fiscal_quarters(client, test_db, monkeypatch):
    test_db.add_all([
        FinancialRatio(
            id=quarter, symbol="VNM", period=str(quarter), period_type="quarter", fiscal_year=2025,
            fiscal_quarter=quarter, pe_ratio=10 + quarter, roe=0.25,
            raw_data={"ratio_units": {"roe": unit}},
        )
        for quarter, unit in [(1, "percent"), (2, "unknown")]
    ])
    await test_db.commit()
    provider = AsyncMock(side_effect=AssertionError("stored fiscal history must bypass provider"))
    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(return_value=[]))
    monkeypatch.setattr(equity.VnstockFinancialRatiosFetcher, "fetch", provider)

    response = await client.get("/api/v1/equity/VNM/ratios/history?period=quarter&ratios=roe,pe")

    assert response.status_code == 200
    assert response.json()["data"] == [
        {"period": "Q1-2025", "roe": 0.25, "pe": 11.0},
        {"period": "Q2-2025", "roe": None, "pe": 12.0},
    ]
    provider.assert_not_awaited()



@pytest.mark.asyncio
async def test_ratio_history_admits_fraction_metrics_from_stored_mongo_rows(client, monkeypatch):
    """History publishes stored rows directly, so it must admit units itself.

    A declared fraction is scaled once; an undeclared provider value is withheld
    rather than published as a raw magnitude.
    """
    from vnibb.providers.vnstock.financial_ratios import FinancialRatioData

    stored = [
        FinancialRatioData(
            symbol="VNM", period="2024", ocf_sales=0.175, fcf_yield=0.052,
            ratio_units={"ocf_sales": "fraction", "fcf_yield": "fraction"},
        ),
        FinancialRatioData(symbol="VNM", period="2023", ocf_sales=0.175, fcf_yield=0.052),
        FinancialRatioData(
            symbol="VNM", period="2022", ocf_sales=17.5, fcf_yield=5.2,
            ratio_units={"ocf_sales": "percent", "fcf_yield": "percent"},
        ),
    ]
    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(return_value=stored))
    monkeypatch.setattr(
        equity.VnstockFinancialRatiosFetcher, "fetch",
        AsyncMock(side_effect=AssertionError("stored history must bypass provider")),
    )

    response = await client.get(
        "/api/v1/equity/VNM/ratios/history?period=year&ratios=ocf_sales,fcf_yield"
    )

    assert response.status_code == 200
    rows = {row["period"]: row for row in response.json()["data"]}
    assert rows["2024"]["ocf_sales"] == pytest.approx(17.5)
    assert rows["2024"]["fcf_yield"] == pytest.approx(5.2)
    assert rows["2023"]["ocf_sales"] is None
    assert rows["2023"]["fcf_yield"] is None
    assert rows["2022"]["ocf_sales"] == pytest.approx(17.5)
    assert rows["2022"]["fcf_yield"] == pytest.approx(5.2)

@pytest.mark.asyncio
async def test_ratio_history_deadline_is_unavailable_not_empty_success(test_db, monkeypatch):
    async def stalled_provider(*args, **kwargs):
        assert not test_db.in_transaction()
        await asyncio.Event().wait()

    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(return_value=[]))
    monkeypatch.setattr(equity.VnstockFinancialRatiosFetcher, "fetch", stalled_provider)
    monkeypatch.setattr(equity, "_provider_timeout_budget", lambda: 0.01)

    response = await equity.get_ratio_history.__wrapped__(
        "VNM", ratios="roe,pe", period="quarter", limit=20, db=test_db,
    )

    assert response.data == []
    assert response.error == "Financial ratio history provider deadline exceeded"


@pytest.mark.asyncio
@pytest.mark.parametrize("failed_store", ["mongo", "sql", "both"])
async def test_ratio_history_http_store_failure_with_empty_provider_is_unavailable(
    client, test_db, monkeypatch, failed_store,
):
    mongo = AsyncMock(return_value=[])
    if failed_store in {"mongo", "both"}:
        mongo.side_effect = TimeoutError("Mongo read deadline")
    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", mongo)
    if failed_store in {"sql", "both"}:
        monkeypatch.setattr(test_db, "execute", AsyncMock(side_effect=TimeoutError("SQL read deadline")))
    provider = AsyncMock(return_value=[])
    monkeypatch.setattr(equity.VnstockFinancialRatiosFetcher, "fetch", provider)

    response = await client.get("/api/v1/equity/VNM/ratios/history?period=year")

    assert response.status_code == 200
    assert response.json()["data"] == []
    assert "stored source unavailable" in response.json()["error"].lower()
    if failed_store in {"mongo", "both"}:
        assert "Mongo read deadline" in response.json()["error"]
    if failed_store in {"sql", "both"}:
        assert "SQL read deadline" in response.json()["error"]
    provider.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["ratios", "financial-ratios", "ratios/history"])
@pytest.mark.parametrize("retained", [False, True])
@pytest.mark.parametrize("outcome", ["slow", "busy", "provider_error", "provider_timeout", "quota", "invalid_period", "empty"])
async def test_ratio_http_provider_failure_preserves_stored_evidence(
    client, test_db, monkeypatch, endpoint, retained, outcome,
):
    from types import SimpleNamespace

    from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
    from vnibb.providers.vnstock import runtime

    class QuotaFinance:
        def ratio(self, **kwargs):
            raise SystemExit("API usage quota exceeded")

    monkeypatch.setattr(runtime, "import_vnstock_symbol", lambda name: (lambda: SimpleNamespace(equity=lambda symbol: QuotaFinance()), "vnstock"))

    if retained:
        test_db.add(FinancialRatio(
            id=1, symbol="VNM", period="2025", period_type="year", fiscal_year=2025,
            pe_ratio=12,
        ))
        await test_db.commit()

    provider_cancelled = asyncio.Event()

    async def provider_operation(*args, **kwargs):
        if outcome == "slow":
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                provider_cancelled.set()
                raise
        if outcome == "busy":
            raise RuntimeError("Previous financial provider call is still running")
        if outcome == "provider_error":
            raise ProviderError(message="Supplier unavailable", provider="vnstock")
        if outcome == "provider_timeout":
            raise ProviderTimeoutError(provider="vnstock", timeout_seconds=30)
        if outcome == "quota":
            return args[0]()
        if outcome == "invalid_period":
            return [{"yearReport": 2025, "fiscalYear": 2024, "pe": 12}]
        return []

    async def unchanged_ratios(**kwargs):
        return kwargs["rows"]

    provider = AsyncMock(side_effect=provider_operation)
    monkeypatch.setattr(runtime, "run_financial_provider", provider)
    monkeypatch.setattr(equity, "_provider_timeout_budget", lambda: 0.01)
    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(return_value=[]))
    monkeypatch.setattr(equity, "_get_latest_statement_period_key", AsyncMock(return_value=20260))
    monkeypatch.setattr(equity, "_load_ratio_statement_support", AsyncMock(return_value={}))
    monkeypatch.setattr(equity, "_enrich_missing_ratio_metrics", unchanged_ratios)
    monkeypatch.setattr(equity, "_schedule_critical_reinforcement", AsyncMock())

    response = await asyncio.wait_for(
        client.get(f"/api/v1/equity/VNM/{endpoint}?period=year"), timeout=30,
    )

    assert response.status_code == 200
    payload = response.json()
    stored_history = retained and endpoint == "ratios/history"
    if outcome == "empty" or stored_history:
        assert payload["error"] is None
    else:
        assert payload["error"]
        assert "unavailable" in payload["error"].lower() or "deadline" in payload["error"].lower()
    if retained:
        assert payload["data"][0]["period"] == "2025"
        assert payload["data"][0]["pe"] == 12
        assert payload["meta"].get("last_data_date") is None
    else:
        assert payload["data"] == []
    if stored_history:
        provider.assert_not_awaited()
    else:
        provider.assert_awaited_once()
        if outcome == "slow":
            assert provider_cancelled.is_set()
            assert "deadline exceeded" in payload["error"].lower()

    if retained and not stored_history:
        stored = await client.get("/api/v1/equity/VNM/ratios/history?ratios=pe&period=year")
        assert stored.json()["data"] == [{"period": "2025", "pe": 12.0}]
        assert stored.json()["error"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("period", ["year", "quarter"])
async def test_ratio_http_statement_support_shares_provider_deadline(
    client, test_db, monkeypatch, period,
):
    test_db.add(FinancialRatio(
        id=1, symbol="VNM", period="2025" if period == "year" else "2025-Q1",
        period_type=period, fiscal_year=2025,
        fiscal_quarter=1 if period == "quarter" else None, pe_ratio=12,
    ))
    await test_db.commit()

    async def stalled_statement(*args, **kwargs):
        await asyncio.Event().wait()

    async def unchanged_ratios(**kwargs):
        return kwargs["rows"]

    provider = AsyncMock()
    monkeypatch.setattr(equity, "get_financials_with_ttm", stalled_statement)
    monkeypatch.setattr(equity, "_provider_timeout_budget", lambda: 0.01)
    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(return_value=[]))
    monkeypatch.setattr(equity, "_get_latest_statement_period_key", AsyncMock(return_value=20260))
    monkeypatch.setattr(equity, "_enrich_missing_ratio_metrics", unchanged_ratios)
    monkeypatch.setattr(equity.VnstockFinancialRatiosFetcher, "fetch", provider)

    response = await asyncio.wait_for(
        client.get(f"/api/v1/equity/VNM/ratios?period={period}"), timeout=1,
    )

    assert response.status_code == 200
    assert response.json()["data"][0]["pe"] == 12
    assert response.json()["error"] == "Financial ratio provider deadline exceeded"
    provider.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("borrowed", [False, True])
@pytest.mark.parametrize("bank", [False, True])
@pytest.mark.parametrize("endpoint", ["ratios", "fundamental-analysis"])
async def test_ratio_http_cancelled_support_sql_retains_rows_without_losing_caller_writes(
    client, test_db, monkeypatch, borrowed, bank, endpoint,
):
    from sqlalchemy.exc import PendingRollbackError

    from vnibb.models.financials import IncomeStatement

    symbol = "TCB" if bank else "VNM"
    test_db.add(Stock(symbol=symbol, exchange="HOSE", industry="Banking" if bank else "Food Producers"))
    unsupported = dict.fromkeys(equity.BANK_UNSUPPORTED_RATIO_FIELDS, 7.0)
    test_db.add(FinancialRatio(
        id=1, symbol=symbol, period="2025", period_type="year", fiscal_year=2025,
        pe_ratio=12, interest_coverage=9,
        raw_data={**unsupported, "interest_coverage": 9,
                  "ratio_units": {"roic": "percent", "gross_margin": "percent", "net_margin": "percent", "operating_margin": "percent", "fcf_yield": "percent"}},
    ))
    await test_db.commit()
    pending = CompanyEvent(id=1, symbol="VNM", event_type="meeting", event_date=date(2026, 9, 14))
    if borrowed:
        test_db.add(pending)

    execute = test_db.execute
    rollback = test_db.rollback
    invalidated = False
    support_cancelled = False

    async def cancelled_statement_query(statement, *args, **kwargs):
        nonlocal invalidated, support_cancelled
        if invalidated:
            raise PendingRollbackError("Cancelled support query requires rollback")
        if not support_cancelled and any(item.get("entity") is IncomeStatement for item in getattr(statement, "column_descriptions", [])):
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                invalidated = True
                support_cancelled = True
                raise
        return await execute(statement, *args, **kwargs)

    async def recover_read():
        nonlocal invalidated
        await rollback()
        invalidated = False

    recovery = AsyncMock(side_effect=recover_read)
    monkeypatch.setattr(test_db, "execute", cancelled_statement_query)
    monkeypatch.setattr(test_db, "rollback", recovery)
    monkeypatch.setattr(equity, "get_financials_with_ttm", AsyncMock(return_value=[]))
    monkeypatch.setattr(equity, "_provider_timeout_budget", lambda: 0.01)
    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(return_value=[]))
    monkeypatch.setattr(equity, "_get_latest_statement_period_key", AsyncMock(return_value=20260))
    if endpoint == "fundamental-analysis":
        from vnibb.api.v1.schemas import StandardResponse

        for name in ("get_profile", "get_officers", "get_subsidiaries", "get_company_news",
                     "get_financials", "get_shareholders", "get_company_events"):
            monkeypatch.setattr(equity, name, AsyncMock(return_value=StandardResponse(data=[])))
        monkeypatch.setattr(equity, "_load_latest_fundamental_snapshot", AsyncMock(return_value=None))
        monkeypatch.setattr(equity, "FUNDAMENTAL_SECTION_TIMEOUT_SECONDS", 30)

    response = await asyncio.wait_for(
        client.get(f"/api/v1/equity/{symbol}/{endpoint}?period=year"), timeout=30,
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    if endpoint == "fundamental-analysis":
        assert payload["section_errors"]["ratios"] == "Financial ratio provider deadline exceeded"
        item = payload["ratios"][0]
    else:
        assert response.json()["error"] == "Financial ratio provider deadline exceeded"
        item = payload[0]
    assert item["pe"] == 12
    assert item["interest_coverage"] is None
    assert item["debt_service_coverage"] is None
    if borrowed or bank:
        assert all(item[field] is None for field in equity.BANK_UNSUPPORTED_RATIO_FIELDS)
    else:
        assert item["current_ratio"] == 7
    if borrowed:
        recovery.assert_not_awaited()
        assert pending in test_db
        assert test_db.in_transaction()
    else:
        recovery.assert_awaited_once()
        assert not invalidated


@pytest.mark.asyncio
async def test_dividends_serve_persisted_payout_without_provider(client, test_db, monkeypatch):
    test_db.add(Dividend(
        id=1, symbol="VNM", exercise_date=date(2025, 9, 15), cash_year=2025,
        dividend_value=1500, dividend_rate=15, issue_method="cash",
        record_date=date(2025, 9, 16), payment_date=date(2025, 10, 5),
    ))
    await test_db.commit()
    provider = AsyncMock(side_effect=AssertionError("stored payout must bypass provider"))
    monkeypatch.setattr(equity.VnstockDividendsFetcher, "fetch", provider)

    response = await client.get("/api/v1/equity/VNM/dividends?limit=5")

    assert response.status_code == 200
    row = response.json()["data"][0]
    assert row["cash_dividend"] == 1500
    assert row["dividend_ratio"] == 15
    assert row["year"] == 2025
    assert row["payment_date"] == "2025-10-05"
    provider.assert_not_awaited()


@pytest.mark.asyncio
async def test_dividends_release_owned_read_before_provider_deadline(test_db, monkeypatch):
    async def stalled_provider(*args, **kwargs):
        assert not test_db.in_transaction()
        await asyncio.Event().wait()

    monkeypatch.setattr(equity.VnstockDividendsFetcher, "fetch", stalled_provider)
    monkeypatch.setattr(equity, "_provider_timeout_budget", lambda: 0.01)

    response = await equity.get_dividends.__wrapped__("VNM", limit=5, db=test_db)

    assert response.data == []
    assert response.error == "VCI dividends unavailable: provider deadline exceeded"


@pytest.mark.asyncio
@pytest.mark.parametrize("mode,expected_close", [("raw", 100000), ("adjusted", 50000)])
async def test_historical_sql_bypasses_provider_preserving_price_basis(
    client, test_db, monkeypatch, mode, expected_close,
):
    test_db.add(Stock(id=1, symbol="VNM", exchange="HOSE"))
    test_db.add(StockPrice(
        id=1, stock_id=1, symbol="VNM", time=date(2026, 9, 14), interval="1D",
        open=100000, high=110000, low=90000, close=100000, adj_close=50000,
        volume=1000, source="vnstock_vnd:VCI",
    ))
    await test_db.commit()
    provider = AsyncMock(side_effect=AssertionError("stored price must bypass provider"))
    monkeypatch.setattr(equity.VnstockEquityHistoricalFetcher, "fetch", provider)

    response = await client.get(
        "/api/v1/equity/historical?symbol=VNM&start_date=2026-09-14"
        f"&end_date=2026-09-14&adjustment_mode={mode}"
    )

    assert response.status_code == 200
    row = response.json()["data"][0]
    assert row["time"] == "2026-09-14"
    assert row["price_unit"] == "VND"
    assert row["close"] == expected_close
    assert row["raw_close"] == 100000
    assert row["adjusted_close"] == 50000
    assert row["adjustment_applied"] is (mode == "adjusted")
    provider.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["events", "ratios"])
async def test_owned_stored_read_failure_recovers_with_provider(test_db, monkeypatch, endpoint):
    execute = test_db.execute

    async def failed_read(*args, **kwargs):
        await execute(*args, **kwargs)
        raise TimeoutError("stored read deadline")

    async def healthy_provider(*args, **kwargs):
        assert not test_db.in_transaction()
        if endpoint == "events":
            return [{"symbol": "VNM", "event_type": "meeting"}]
        return [FinancialRatioData(symbol="VNM", period="2025", pe=12)]

    monkeypatch.setattr(test_db, "execute", failed_read)
    if endpoint == "events":
        monkeypatch.setattr(equity.VnstockCompanyEventsFetcher, "fetch", healthy_provider)
        response = await equity.get_company_events.__wrapped__("VNM", limit=5, db=test_db)
        assert response.data[0]["event_type"] == "meeting"
    else:
        monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(side_effect=TimeoutError("Mongo deadline")))
        monkeypatch.setattr(equity.VnstockFinancialRatiosFetcher, "fetch", healthy_provider)
        response = await equity.get_ratio_history.__wrapped__(
            "VNM", ratios="pe", period="year", limit=5, db=test_db,
        )
        assert response.data == [{"period": "2025", "pe": 12}]
    assert response.error is None


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["events", "ratios"])
async def test_borrowed_stored_read_failure_propagates(test_db, monkeypatch, endpoint):
    await test_db.begin()
    rollback = AsyncMock()
    provider = AsyncMock()
    monkeypatch.setattr(test_db, "execute", AsyncMock(side_effect=TimeoutError("stored read deadline")))
    monkeypatch.setattr(test_db, "rollback", rollback)
    monkeypatch.setattr(equity.VnstockCompanyEventsFetcher, "fetch", provider)
    monkeypatch.setattr(equity.VnstockFinancialRatiosFetcher, "fetch", provider)
    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(return_value=[]))

    with pytest.raises(TimeoutError, match="stored read deadline"):
        if endpoint == "events":
            await equity.get_company_events.__wrapped__("VNM", limit=5, db=test_db)
        else:
            await equity.get_ratio_history.__wrapped__(
                "VNM", ratios="pe", period="year", limit=5, db=test_db,
            )

    rollback.assert_not_awaited()
    provider.assert_not_awaited()
    assert test_db.in_transaction()


@pytest.mark.asyncio
async def test_ratio_mongo_failure_retains_healthy_sql_source(test_db, monkeypatch):
    test_db.add(FinancialRatio(
        id=1, symbol="VNM", period="2025", period_type="year", fiscal_year=2025,
        pe_ratio=12,
    ))
    await test_db.commit()
    provider = AsyncMock()
    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(side_effect=TimeoutError("Mongo deadline")))
    monkeypatch.setattr(equity.VnstockFinancialRatiosFetcher, "fetch", provider)

    response = await equity.get_ratio_history.__wrapped__(
        "VNM", ratios="pe", period="year", limit=5, db=test_db,
    )

    assert response.data == [{"period": "2025", "pe": 12}]
    provider.assert_not_awaited()
