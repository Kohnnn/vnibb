import asyncio
from datetime import date, datetime
from types import SimpleNamespace

import pytest

from vnibb.models.trading import FinancialRatio, ForeignTrading, OrderFlowDaily
from vnibb.models.financials import IncomeStatement, BalanceSheet, CashFlow
from vnibb.models.company import Company, Shareholder
from vnibb.models.news import Dividend
from vnibb.models.comparison import StockComparison
from vnibb.models.stock import Stock, StockIndex, StockPrice
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.sync_status import SyncStatus
from vnibb.providers.vnstock.equity_historical import EquityHistoricalData
from vnibb.providers.vnstock.equity_profile import EquityProfileData
from vnibb.providers.vnstock.equity_screener import ScreenerData
from vnibb.providers.vnstock.financial_ratios import FinancialRatioData
from vnibb.providers.vnstock.financials import FinancialStatementData
from vnibb.providers.vnstock.foreign_trading import ForeignTradingData
from vnibb.providers.vnstock.intraday import IntradayTradeData
from vnibb.providers.vnstock.price_depth import OrderLevel, PriceDepthData
from vnibb.providers.vnstock.stock_quote import StockQuoteData
from vnibb.services.sector_service import SectorPerformance, StockBrief


@pytest.mark.asyncio
async def test_live_health_endpoint_returns_200(client):
    response = await client.get("/live")
    assert response.status_code == 200
    payload = response.json()
    assert payload["alive"] is True
    assert response.headers["X-API-Version"]
    assert response.headers["X-Data-Source"] in {"postgres", "appwrite"}


@pytest.mark.asyncio
async def test_ready_health_endpoint_returns_200(client):
    response = await client.get("/ready")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ready"] is True


@pytest.mark.asyncio
async def test_admin_sync_status_alias_returns_freshness_payload(client):
    response = await client.get("/api/v1/admin/sync-status")

    assert response.status_code == 200
    payload = response.json()
    assert "data_freshness" in payload


@pytest.mark.asyncio
async def test_admin_sync_status_returns_recent_sync_jobs(client, test_db):
    test_db.add(
        SyncStatus(
            sync_type="full_market",
            started_at=datetime(2026, 3, 20, 10, 0, 0),
            completed_at=datetime(2026, 3, 20, 10, 30, 0),
            success_count=25,
            error_count=1,
            status="completed",
            additional_data={"job_id": "full-market-1"},
        )
    )
    await test_db.commit()

    response = await client.get("/api/v1/admin/sync-status")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["sync_jobs"]) == 1
    assert payload["sync_jobs"][0]["sync_type"] == "full_market"
    assert payload["last_successful_sync"] == "2026-03-20T10:30:00"


@pytest.mark.asyncio
async def test_income_statement_endpoint_orders_oldest_first_and_enrichs_missing_fields(
    client, test_db, monkeypatch
):
    test_db.add_all(
        [
            IncomeStatement(
                id=100,
                symbol="VNM",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                revenue=1000.0,
                operating_income=200.0,
                net_income=150.0,
                raw_data={
                    "Selling Expenses": -40.0,
                    "General & Admin Expenses": -60.0,
                },
            ),
            IncomeStatement(
                id=101,
                symbol="VNM",
                period="2023",
                period_type="year",
                fiscal_year=2023,
                revenue=900.0,
                operating_income=180.0,
                net_income=130.0,
                raw_data={
                    "Selling Expenses": -30.0,
                    "General & Admin Expenses": -50.0,
                },
            ),
            CashFlow(
                id=100,
                symbol="VNM",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                depreciation=30.0,
                operating_cash_flow=150.0,
                capital_expenditure=-40.0,
            ),
            CashFlow(
                id=101,
                symbol="VNM",
                period="2023",
                period_type="year",
                fiscal_year=2023,
                depreciation=25.0,
                operating_cash_flow=120.0,
                capital_expenditure=-35.0,
            ),
        ]
    )
    await test_db.commit()

    async def fake_get_financials_with_ttm(*args, **kwargs):
        return []

    monkeypatch.setattr("vnibb.api.v1.equity.get_financials_with_ttm", fake_get_financials_with_ttm)

    response = await client.get("/api/v1/equity/VNM/income-statement?period=FY&limit=5")

    assert response.status_code == 200
    payload = response.json()
    periods = [row["period"] for row in payload["data"]]
    assert periods == ["2023", "2024"]
    latest = payload["data"][-1]
    assert latest["selling_general_admin"] == -100.0
    assert latest["depreciation"] == 30.0
    assert latest["ebitda"] == 230.0


@pytest.mark.asyncio
async def test_balance_and_cash_flow_endpoints_enrich_fields_and_order_oldest_first(
    client, test_db, monkeypatch
):
    test_db.add_all(
        [
            BalanceSheet(
                id=200,
                symbol="VNM",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                total_assets=2000.0,
                total_liabilities=900.0,
                total_equity=1100.0,
                raw_data={
                    "n_1.short_term_trade_accounts_payable": 85.0,
                    "Good will (Bn. VND)": 12.0,
                    "n_3.intangible_fixed_assets": 18.0,
                },
            ),
            BalanceSheet(
                id=201,
                symbol="VNM",
                period="2023",
                period_type="year",
                fiscal_year=2023,
                total_assets=1800.0,
                total_liabilities=800.0,
                total_equity=1000.0,
                raw_data={
                    "n_1.short_term_trade_accounts_payable": 80.0,
                },
            ),
            CashFlow(
                id=200,
                symbol="VNM",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                operating_cash_flow=200.0,
                capital_expenditure=-50.0,
                free_cash_flow=None,
            ),
            CashFlow(
                id=201,
                symbol="VNM",
                period="2023",
                period_type="year",
                fiscal_year=2023,
                operating_cash_flow=170.0,
                capital_expenditure=-40.0,
                free_cash_flow=None,
            ),
        ]
    )
    await test_db.commit()

    async def fake_get_financials_with_ttm(*args, **kwargs):
        return []

    monkeypatch.setattr("vnibb.api.v1.equity.get_financials_with_ttm", fake_get_financials_with_ttm)

    balance_response = await client.get("/api/v1/equity/VNM/balance-sheet?period=FY&limit=5")
    cash_response = await client.get("/api/v1/equity/VNM/cash-flow?period=FY&limit=5")

    assert balance_response.status_code == 200
    assert cash_response.status_code == 200

    balance_payload = balance_response.json()
    cash_payload = cash_response.json()

    assert [row["period"] for row in balance_payload["data"]] == ["2023", "2024"]
    assert [row["period"] for row in cash_payload["data"]] == ["2023", "2024"]
    assert balance_payload["data"][-1]["accounts_payable"] == 85.0
    assert balance_payload["data"][-1]["goodwill"] == 12.0
    assert balance_payload["data"][-1]["intangible_assets"] == 18.0
    assert cash_payload["data"][-1]["free_cash_flow"] == 150.0


@pytest.mark.asyncio
async def test_profile_sync_succeeds_when_appwrite_mirror_fails(client, monkeypatch):
    async def fake_sync_company_profiles(*, symbols=None):
        assert symbols == ["VCI"]
        return 1

    async def fail_populate(*args, **kwargs):
        raise RuntimeError("mirror failed")

    monkeypatch.setattr(
        "vnibb.services.data_pipeline.data_pipeline.sync_company_profiles",
        fake_sync_company_profiles,
        raising=False,
    )
    monkeypatch.setattr(
        "vnibb.services.appwrite_population.populate_appwrite_tables",
        fail_populate,
        raising=False,
    )

    response = await client.post("/api/v1/data/sync/profiles?async_mode=false&symbols=VCI")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "success"
    assert payload["count"] == 1


@pytest.mark.asyncio
async def test_screener_smoke_returns_data(client, monkeypatch):
    async def fake_screener_fetch(_params):
        return [
            ScreenerData(
                symbol="VNM",
                organ_name="Vinamilk",
                exchange="HOSE",
                industry_name="Food",
                price=75000,
                market_cap=150000000000,
                updated_at=datetime(2026, 3, 14, 15, 0, 0),
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.screener.VnstockScreenerFetcher.fetch",
        fake_screener_fetch,
    )

    response = await client.get("/api/v1/screener/?limit=1&use_cache=false")
    assert response.status_code == 200
    payload = response.json()
    assert "data" in payload
    assert len(payload["data"]) == 1
    assert payload["data"][0]["symbol"] == "VNM"
    assert payload["meta"]["last_data_date"].startswith("2026-03-14T15:00:00")


@pytest.mark.asyncio
async def test_screener_smoke_without_trailing_slash_returns_data(client, monkeypatch):
    async def fake_screener_fetch(_params):
        return [
            ScreenerData(
                symbol="VNM",
                organ_name="Vinamilk",
                exchange="HOSE",
                industry_name="Food",
                price=75000,
                market_cap=150000000000,
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.screener.VnstockScreenerFetcher.fetch",
        fake_screener_fetch,
    )

    response = await client.get("/api/v1/screener?limit=1&use_cache=false")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["data"]) == 1
    assert payload["data"][0]["symbol"] == "VNM"


@pytest.mark.asyncio
async def test_comparison_path_alias_returns_data(client, monkeypatch):
    async def fake_get_comparison_data(symbol_list, period):
        assert symbol_list == ["VNM", "FPT", "VCB"]
        assert period == "FY"
        return [
            StockComparison(
                symbol="VNM",
                company_name="Vinamilk",
                metrics={"pe_ratio": 12.3},
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.comparison.get_comparison_data",
        fake_get_comparison_data,
    )

    response = await client.get("/api/v1/comparison/VNM,FPT,VCB?period=FY")
    assert response.status_code == 200
    payload = response.json()
    assert payload["period"] == "FY"
    assert payload["stocks"][0]["symbol"] == "VNM"


@pytest.mark.asyncio
async def test_profile_smoke_returns_data(client, monkeypatch):
    async def fake_profile_fetch(_params):
        return [
            EquityProfileData(
                symbol="VNM",
                company_name="Vinamilk",
                short_name="VNM",
                exchange="HOSE",
                industry="Food",
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.equity.VnstockEquityProfileFetcher.fetch",
        fake_profile_fetch,
    )

    response = await client.get("/api/v1/equity/VNM/profile?refresh=true")
    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["symbol"] == "VNM"
    assert payload["data"]["exchange"] == "HOSE"


@pytest.mark.asyncio
async def test_profile_cache_backfills_sector_and_scales_market_cap(client, test_db):
    test_db.add(
        Stock(
            id=1,
            symbol="VCI",
            company_name="Vietcap",
            exchange="HOSE",
            industry="Chung khoan",
            listing_date=date(2017, 7, 7),
        )
    )
    test_db.add(
        Company(
            symbol="VCI",
            company_name="Vietcap",
            exchange="HOSE",
            industry="Chung khoan",
            sector=None,
            outstanding_shares=850.1,
            listed_shares=850.1,
            updated_at=datetime(2026, 3, 14, 9, 30, 0),
        )
    )
    test_db.add(
        StockPrice(
            id=1,
            stock_id=1,
            symbol="VCI",
            time=date(2026, 3, 14),
            open=36.0,
            high=36.8,
            low=35.7,
            close=36.5,
            volume=1_050_000,
            interval="1D",
            source="vnstock",
        )
    )
    await test_db.commit()

    response = await client.get("/api/v1/equity/VCI/profile")

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["sector"] == "Chung khoan"
    assert payload["data"]["outstanding_shares"] == pytest.approx(850_100_000.0)
    assert payload["data"]["listed_shares"] == pytest.approx(850_100_000.0)
    assert payload["data"]["market_cap"] == pytest.approx(31_028_650_000_000.0)
    assert payload["meta"]["last_data_date"].startswith("2026-03-14T09:30:00")


@pytest.mark.asyncio
async def test_dividends_endpoint_falls_back_to_cached_dividend_rows(client, test_db, monkeypatch):
    test_db.add(
        Stock(
            id=1,
            symbol="VNM",
            company_name="Vinamilk",
            exchange="HOSE",
        )
    )
    test_db.add(
        StockPrice(
            id=1,
            stock_id=1,
            symbol="VNM",
            time=date(2026, 3, 14),
            open=62.9,
            high=63.4,
            low=62.3,
            close=63.1,
            volume=2_050_000,
            interval="1D",
            source="vnstock",
        )
    )
    test_db.add(
        Dividend(
            id=1,
            symbol="VNM",
            exercise_date=date(2025, 9, 15),
            cash_year=2025,
            dividend_value=4300.0,
            dividend_rate=43.0,
            issue_method="cash",
            record_date=date(2025, 9, 16),
            payment_date=date(2025, 10, 5),
        )
    )
    await test_db.commit()

    async def fake_dividend_fetch(symbol):
        assert symbol == "VNM"
        return []

    monkeypatch.setattr("vnibb.api.v1.equity.VnstockDividendsFetcher.fetch", fake_dividend_fetch)

    response = await client.get("/api/v1/equity/VNM/dividends?limit=5")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 1
    assert payload["meta"]["last_data_date"] == "2025-10-05"
    assert payload["data"][0]["cash_dividend"] == 4300.0
    assert payload["data"][0]["dividend_ratio"] == 43.0
    assert payload["data"][0]["type"] == "cash"
    assert payload["data"][0]["annual_dps"] == 4300.0
    assert payload["data"][0]["dividend_yield"] == pytest.approx(6.8146, rel=1e-4)


@pytest.mark.asyncio
async def test_quote_smoke_returns_data(client, monkeypatch):
    async def fake_quote_fetch(*, symbol: str, source: str):
        quote = StockQuoteData(
            symbol=symbol,
            price=75000,
            open=74000,
            high=76000,
            low=73500,
            change=1000,
            change_pct=1.35,
            volume=1000000,
            updated_at=datetime.utcnow(),
        )
        return quote, {"source": source}

    monkeypatch.setattr(
        "vnibb.api.v1.equity.VnstockStockQuoteFetcher.fetch",
        fake_quote_fetch,
    )

    response = await client.get("/api/v1/equity/VNM/quote?refresh=true")
    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["symbol"] == "VNM"
    assert payload["data"]["price"] == 75000
    assert response.headers["X-API-Version"]
    assert response.headers["X-Data-Source"] in {"postgres", "appwrite"}


@pytest.mark.asyncio
async def test_quote_prefers_fresher_screener_snapshot_when_price_history_is_stale(client, test_db):
    test_db.add(Stock(id=1, symbol="FPT", exchange="HOSE", company_name="FPT"))
    test_db.add_all(
        [
            StockPrice(
                id=1,
                stock_id=1,
                symbol="FPT",
                time=date(2026, 2, 27),
                open=91.0,
                high=93.5,
                low=90.3,
                close=92.9,
                volume=1_200_000,
                interval="1D",
                source="vnstock",
            ),
            StockPrice(
                id=2,
                stock_id=1,
                symbol="FPT",
                time=date(2026, 2, 26),
                open=90.0,
                high=92.2,
                low=89.9,
                close=90.5,
                volume=1_100_000,
                interval="1D",
                source="vnstock",
            ),
            ScreenerSnapshot(
                id=1,
                symbol="FPT",
                snapshot_date=date(2026, 3, 14),
                price=77.0,
                volume=9_026_000,
                source="vnstock",
                extended_metrics={"updated_at": "2026-03-14T13:18:00"},
            ),
        ]
    )
    await test_db.commit()

    response = await client.get("/api/v1/equity/FPT/quote")
    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["symbol"] == "FPT"
    assert payload["data"]["price"] == 77.0
    assert payload["data"]["volume"] == 9026000
    assert payload["data"]["updated_at"].startswith("2026-03-14T13:18:00")


@pytest.mark.asyncio
async def test_ratios_smoke_returns_data(client, monkeypatch):
    async def fake_ratio_fetch(_params):
        return [
            FinancialRatioData(
                symbol="AAA",
                period="2024",
                pe=15.2,
                pb=2.7,
                roe=18.4,
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.equity.VnstockFinancialRatiosFetcher.fetch",
        fake_ratio_fetch,
    )

    response = await client.get("/api/v1/equity/AAA/ratios?period=quarter")
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("error") is None, payload
    assert payload["meta"]["count"] == 1
    assert payload["data"][0]["period"] == "2024"
    assert payload["data"][0]["pe"] == 15.2


@pytest.mark.asyncio
async def test_historical_smoke_returns_data(client, monkeypatch):
    async def fake_historical_fetch(_params):
        return [
            EquityHistoricalData(
                symbol="VNM",
                time=date(2025, 1, 1),
                open=73000,
                high=74000,
                low=72500,
                close=73500,
                volume=1250000,
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.equity.VnstockEquityHistoricalFetcher.fetch",
        fake_historical_fetch,
    )

    response = await client.get(
        "/api/v1/equity/historical?symbol=VNM&start_date=2025-01-01&end_date=2025-01-10"
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 1
    assert payload["data"][0]["symbol"] == "VNM"


@pytest.mark.asyncio
async def test_income_statement_smoke_returns_data(client, monkeypatch):
    async def fake_get_financials_with_ttm(
        *, symbol: str, statement_type: str, period: str, limit: int
    ):
        return [
            FinancialStatementData(
                symbol=symbol,
                period="2024",
                statement_type=statement_type,
                revenue=1000,
                cost_of_revenue=600,
                pre_tax_profit=300,
                profit_before_tax=300,
                tax_expense=50,
                net_income=250,
            )
        ][:limit]

    monkeypatch.setattr(
        "vnibb.api.v1.equity.get_financials_with_ttm",
        fake_get_financials_with_ttm,
    )

    response = await client.get("/api/v1/equity/VNM/income-statement?period=year&limit=1")
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 1
    assert payload["data"][0]["revenue"] == 1000
    assert payload["data"][0]["cost_of_revenue"] == 600
    assert payload["data"][0]["pre_tax_profit"] == 300
    assert payload["data"][0]["profit_before_tax"] == 300


@pytest.mark.asyncio
async def test_income_statement_enriches_missing_eps_from_ratio_db(client, test_db, monkeypatch):
    test_db.add(
        FinancialRatio(
            id=1,
            symbol="VNM",
            period="2024",
            period_type="year",
            fiscal_year=2024,
            fiscal_quarter=None,
            eps=4200.0,
            source="vnstock",
        )
    )
    await test_db.commit()

    async def fake_get_financials_with_ttm(
        *, symbol: str, statement_type: str, period: str, limit: int
    ):
        return [
            FinancialStatementData(
                symbol=symbol,
                period="2024",
                statement_type=statement_type,
                revenue=1000,
                eps=None,
            )
        ][:limit]

    monkeypatch.setattr(
        "vnibb.api.v1.equity.get_financials_with_ttm",
        fake_get_financials_with_ttm,
    )

    response = await client.get("/api/v1/equity/VNM/income-statement?period=year&limit=1")
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 1
    assert payload["data"][0]["eps"] == 4200.0


@pytest.mark.asyncio
async def test_income_statement_falls_back_to_db_on_timeout(client, test_db, monkeypatch):
    test_db.add(
        IncomeStatement(
            id=1,
            symbol="VNM",
            period="2024",
            period_type="year",
            fiscal_year=2024,
            fiscal_quarter=None,
            revenue=1500,
            net_income=320,
            source="vnstock",
            updated_at=datetime(2026, 3, 12, 8, 15, 0),
        )
    )
    await test_db.commit()

    async def fake_get_financials_with_ttm(
        *, symbol: str, statement_type: str, period: str, limit: int
    ):
        raise asyncio.TimeoutError("provider timed out")

    monkeypatch.setattr(
        "vnibb.api.v1.equity.get_financials_with_ttm",
        fake_get_financials_with_ttm,
    )

    response = await client.get("/api/v1/equity/VNM/income-statement?period=year&limit=1")
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 1
    assert payload["meta"]["last_data_date"].startswith("2026-03-12T08:15:00")
    assert payload["data"][0]["revenue"] == 1500
    assert payload["data"][0]["net_income"] == 320


@pytest.mark.asyncio
async def test_shareholders_falls_back_to_db_on_timeout(client, test_db, monkeypatch):
    test_db.add(
        Company(
            id=1,
            symbol="VNM",
            company_name="Vinamilk",
            exchange="HOSE",
        )
    )
    test_db.add(
        Shareholder(
            id=1,
            company_id=1,
            symbol="VNM",
            name="SCIC",
            shareholder_type="State",
            shares_held=725_000_000,
            ownership_pct=36.0,
            as_of_date=date(2026, 3, 14),
        )
    )
    await test_db.commit()

    async def fake_shareholders_fetch(_params):
        raise asyncio.TimeoutError("provider timed out")

    monkeypatch.setattr(
        "vnibb.api.v1.equity.VnstockShareholdersFetcher.fetch",
        fake_shareholders_fetch,
    )

    response = await client.get("/api/v1/equity/VNM/shareholders")
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 1
    assert payload["data"][0]["shareholder_name"] == "SCIC"
    assert payload["data"][0]["ownership_pct"] == 36.0
    assert payload["error"] == "provider timed out"


@pytest.mark.asyncio
async def test_appwrite_quote_uses_source_document_timestamp(monkeypatch):
    from vnibb.api.v1.equity import _load_quote_from_appwrite

    async def fake_get_appwrite_stock_prices(
        symbol: str,
        *,
        interval: str = "1D",
        start_date=None,
        end_date=None,
        limit: int = 250,
        descending: bool = False,
    ):
        return [
            {
                "symbol": symbol,
                "close": 92.9,
                "open": 91.0,
                "high": 93.5,
                "low": 90.3,
                "volume": 18_705_600,
                "time": "2026-03-14",
            },
            {
                "symbol": symbol,
                "close": 90.5,
                "time": "2026-03-13",
            },
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.equity.get_appwrite_stock_prices",
        fake_get_appwrite_stock_prices,
    )

    quote = await _load_quote_from_appwrite("FPT")
    assert quote is not None
    assert quote.updated_at is not None
    assert quote.updated_at.isoformat().startswith("2026-03-14T00:00:00")


@pytest.mark.asyncio
async def test_appwrite_profile_enriches_db_sector_and_share_counts(test_db, monkeypatch):
    from vnibb.api.v1.equity import _load_profile_from_appwrite

    test_db.add(
        Company(
            symbol="VCI",
            company_name="Vietcap",
            exchange="HOSE",
            industry="Chung khoan",
            sector="Chung khoan",
            outstanding_shares=850.1,
            listed_shares=850.1,
        )
    )
    await test_db.commit()

    async def fake_get_appwrite_stock(symbol: str):
        return {
            "symbol": symbol,
            "company_name": "Vietcap",
            "exchange": "HOSE",
        }

    monkeypatch.setattr("vnibb.api.v1.equity.get_appwrite_stock", fake_get_appwrite_stock)

    profile = await _load_profile_from_appwrite("VCI", test_db)

    assert profile is not None
    assert profile.sector == "Chung khoan"
    assert profile.outstanding_shares == pytest.approx(850_100_000.0)
    assert profile.listed_shares == pytest.approx(850_100_000.0)


@pytest.mark.asyncio
async def test_profile_endpoint_prefers_scaled_listed_shares_from_cached_company_row(
    client, test_db
):
    test_db.add(
        Company(
            symbol="VCI",
            company_name="Vietcap",
            exchange="HOSE",
            industry="Chung khoan",
            sector="Chung khoan",
            outstanding_shares=850.1,
            listed_shares=850.0,
            updated_at=datetime(2026, 3, 18, 8, 0, 0),
        )
    )
    test_db.add(
        Stock(
            symbol="VCI",
            company_name="Vietcap",
            exchange="HOSE",
            industry="Chung khoan",
            sector="Chung khoan",
        )
    )
    await test_db.commit()

    response = await client.get("/api/v1/equity/VCI/profile")
    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["listed_shares"] == pytest.approx(850_100_000.0)


@pytest.mark.asyncio
async def test_historical_endpoint_uses_recent_price_cache(client, monkeypatch):
    async def fake_cache_lookup(*args, **kwargs):
        return SimpleNamespace(hit=False, data=None)

    async def fake_get_json(key):
        if key.endswith(":price:recent:VNM"):
            return [
                {
                    "time": "2026-03-10T00:00:00",
                    "open": 100.0,
                    "high": 101.0,
                    "low": 99.5,
                    "close": 100.8,
                    "volume": 1200,
                },
                {
                    "time": "2026-03-11T00:00:00",
                    "open": 101.0,
                    "high": 102.0,
                    "low": 100.0,
                    "close": 101.5,
                    "volume": 1500,
                },
            ]
        return None

    async def fail_appwrite_fetch(*args, **kwargs):
        raise AssertionError("recent price cache should be used before Appwrite fetch")

    monkeypatch.setattr(
        "vnibb.api.v1.equity.CacheManager.get_historical_prices",
        fake_cache_lookup,
    )
    monkeypatch.setattr("vnibb.api.v1.equity.redis_client.get_json", fake_get_json)
    monkeypatch.setattr("vnibb.api.v1.equity.get_appwrite_stock_prices", fail_appwrite_fetch)

    response = await client.get(
        "/api/v1/equity/historical?symbol=VNM&start_date=2026-03-10&end_date=2026-03-11"
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 2
    assert payload["data"][0]["time"] == "2026-03-10"
    assert payload["data"][1]["close"] == 101.5


@pytest.mark.asyncio
async def test_income_statement_merges_db_values_when_provider_payload_missing(
    client, test_db, monkeypatch
):
    test_db.add(
        IncomeStatement(
            id=101,
            symbol="VCI",
            period="2025",
            period_type="year",
            fiscal_year=2025,
            revenue=1500,
            cost_of_revenue=-600,
            operating_income=500,
            income_before_tax=520,
            income_tax=-100,
            net_income=420,
            source="vnstock",
        )
    )
    await test_db.commit()

    async def fake_get_financials_with_ttm(
        *, symbol: str, statement_type: str, period: str, limit: int
    ):
        return [
            FinancialStatementData(
                symbol=symbol,
                period="2025",
                statement_type=statement_type,
                fiscal_year=2025,
                revenue=1500,
                cost_of_revenue=None,
                operating_income=None,
                pre_tax_profit=None,
                tax_expense=None,
                net_income=420,
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.equity.get_financials_with_ttm",
        fake_get_financials_with_ttm,
    )

    response = await client.get("/api/v1/equity/VCI/income-statement?period=year&limit=1")
    assert response.status_code == 200
    payload = response.json()
    row = payload["data"][0]
    assert row["operating_income"] == 500
    assert row["cost_of_revenue"] == -600
    assert row["pre_tax_profit"] == 520
    assert row["tax_expense"] == -100


@pytest.mark.asyncio
async def test_cash_flow_merges_db_values_when_provider_payload_missing(
    client, test_db, monkeypatch
):
    test_db.add(
        CashFlow(
            id=201,
            symbol="VCI",
            period="2025",
            period_type="year",
            fiscal_year=2025,
            operating_cash_flow=-3550,
            capital_expenditure=-238,
            dividends_paid=0,
            depreciation=38,
            investing_cash_flow=-215,
            source="vnstock",
        )
    )
    await test_db.commit()

    async def fake_get_financials_with_ttm(
        *, symbol: str, statement_type: str, period: str, limit: int
    ):
        return [
            FinancialStatementData(
                symbol=symbol,
                period="2025",
                statement_type=statement_type,
                fiscal_year=2025,
                operating_cash_flow=None,
                capital_expenditure=None,
                dividends_paid=None,
                depreciation=None,
                investing_cash_flow=-215,
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.equity.get_financials_with_ttm",
        fake_get_financials_with_ttm,
    )

    response = await client.get("/api/v1/equity/VCI/cash-flow?period=year&limit=1")
    assert response.status_code == 200
    payload = response.json()
    row = payload["data"][0]
    assert row["operating_cash_flow"] == -3550
    assert row["capex"] == -238
    assert row["dividends_paid"] == 0
    assert row["depreciation"] == 38


@pytest.mark.asyncio
async def test_equity_peers_endpoint_returns_data(client, monkeypatch):
    class _Peers:
        def model_dump(self, mode: str = "json"):
            return {
                "symbol": "VNM",
                "industry": "Food",
                "count": 2,
                "peers": [
                    {"symbol": "MSN", "name": "Masan", "market_cap": 1_000_000_000},
                    {"symbol": "SAB", "name": "Sabeco", "market_cap": 900_000_000},
                ],
            }

    async def fake_get_peers(symbol: str, limit: int):
        assert symbol == "VNM"
        assert limit == 10
        return _Peers()

    monkeypatch.setattr(
        "vnibb.api.v1.equity.comparison_service.get_peers",
        fake_get_peers,
    )

    response = await client.get("/api/v1/equity/VNM/peers")
    assert response.status_code == 200
    payload = response.json()
    assert payload["symbol"] == "VNM"
    assert payload["count"] == 2
    assert payload["peers"][0]["symbol"] == "MSN"


@pytest.mark.asyncio
async def test_ttm_endpoint_returns_statement_bundle(client, monkeypatch):
    async def fake_get_financials_with_ttm(
        *, symbol: str, statement_type: str, period: str, limit: int
    ):
        assert period == "TTM"
        return [
            FinancialStatementData(
                symbol=symbol,
                period="TTM",
                statement_type=statement_type,
                revenue=1234,
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.equity.get_financials_with_ttm",
        fake_get_financials_with_ttm,
    )

    response = await client.get("/api/v1/equity/VNM/ttm")
    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["symbol"] == "VNM"
    assert payload["data"]["income"]["period"] == "TTM"
    assert payload["data"]["balance"]["period"] == "TTM"
    assert payload["data"]["cash_flow"]["period"] == "TTM"


@pytest.mark.asyncio
async def test_growth_endpoint_returns_yoy_metrics(client, test_db):
    test_db.add_all(
        [
            IncomeStatement(
                id=1,
                symbol="VNM",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                revenue=1000,
                net_income=200,
                eps=2.0,
                ebitda=300,
            ),
            IncomeStatement(
                id=2,
                symbol="VNM",
                period="2023",
                period_type="year",
                fiscal_year=2023,
                revenue=800,
                net_income=160,
                eps=1.6,
                ebitda=240,
            ),
            BalanceSheet(
                id=1,
                symbol="VNM",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                total_assets=5000,
            ),
            BalanceSheet(
                id=2,
                symbol="VNM",
                period="2023",
                period_type="year",
                fiscal_year=2023,
                total_assets=4000,
            ),
        ]
    )
    await test_db.commit()

    response = await client.get("/api/v1/equity/VNM/growth")
    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["symbol"] == "VNM"
    assert payload["data"]["yoy"]["revenue_growth"] == pytest.approx(25.0)
    assert payload["data"]["yoy"]["asset_growth"] == pytest.approx(25.0)


@pytest.mark.asyncio
async def test_intraday_smoke_returns_data(client, monkeypatch):
    async def fake_intraday_fetch(_params):
        return [
            IntradayTradeData(
                symbol="VNM",
                time="14:30:15",
                price=75800,
                volume=1000,
                match_type="BU",
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.equity.VnstockIntradayFetcher.fetch",
        fake_intraday_fetch,
    )

    response = await client.get("/api/v1/equity/VNM/intraday?limit=1")
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 1
    assert payload["data"][0]["match_type"] == "BU"


@pytest.mark.asyncio
async def test_foreign_trading_smoke_returns_data(client, monkeypatch):
    async def fake_foreign_trading_fetch(_params):
        return [
            ForeignTradingData(
                symbol="VNM",
                date="2026-02-15",
                buy_volume=120000,
                sell_volume=80000,
                net_volume=40000,
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.equity.VnstockForeignTradingFetcher.fetch",
        fake_foreign_trading_fetch,
    )

    response = await client.get("/api/v1/equity/VNM/foreign-trading?limit=1")
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 1
    assert payload["data"][0]["net_volume"] == 40000


@pytest.mark.asyncio
async def test_transaction_flow_endpoint_returns_derived_domestic_flow(client, test_db):
    test_db.add(Stock(id=1, symbol="VCI", exchange="HOSE"))
    test_db.add(
        StockPrice(
            id=900,
            stock_id=1,
            symbol="VCI",
            time=date(2026, 3, 20),
            open=35.0,
            high=36.0,
            low=34.8,
            close=35.7,
            volume=1_000_000,
            interval="1D",
        )
    )
    test_db.add(
        OrderFlowDaily(
            id=900,
            symbol="VCI",
            trade_date=date(2026, 3, 20),
            buy_volume=1_200_000,
            sell_volume=900_000,
            buy_value=42_840_000.0,
            sell_value=32_130_000.0,
            net_volume=300_000,
            net_value=10_710_000.0,
            foreign_net_volume=100_000,
            proprietary_net_volume=50_000,
            big_order_count=3,
            block_trade_count=1,
        )
    )
    test_db.add(
        ForeignTrading(
            id=900,
            symbol="VCI",
            trade_date=date(2026, 3, 20),
            buy_volume=220_000,
            sell_volume=120_000,
            net_volume=100_000,
            net_value=3_570_000.0,
        )
    )
    await test_db.commit()

    response = await client.get("/api/v1/equity/VCI/transaction-flow?days=30")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 1
    assert payload["data"]["symbol"] == "VCI"
    assert payload["data"]["scopes"] == ["total", "domestic", "foreign", "proprietary"]
    row = payload["data"]["data"][0]
    assert row["price"] == 35.7
    assert row["foreign_net_value"] == 3_570_000.0
    assert row["proprietary_net_value"] == pytest.approx(50_000 * 35.7)
    assert row["domestic_net_volume"] == 150_000
    assert row["domestic_net_value"] == pytest.approx(10_710_000.0 - 3_570_000.0 - (50_000 * 35.7))


@pytest.mark.asyncio
async def test_price_depth_smoke_returns_entries(client, monkeypatch):
    async def fake_price_depth_fetch(*, symbol: str, source: str):
        return PriceDepthData(
            symbol=symbol,
            bid_1=OrderLevel(price=75000, volume=12000),
            ask_1=OrderLevel(price=75100, volume=9000),
        )

    monkeypatch.setattr(
        "vnibb.api.v1.equity.VnstockPriceDepthFetcher.fetch",
        fake_price_depth_fetch,
    )

    response = await client.get("/api/v1/equity/VNM/price-depth")
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 1
    assert payload["data"]["entries"][0]["bid_vol"] == 12000


@pytest.mark.asyncio
async def test_orderbook_endpoint_uses_cached_payload_before_provider(client, monkeypatch):
    async def fake_get_json(key):
        if key.endswith(":orderbook:latest:VNM"):
            return {
                "symbol": "VNM",
                "snapshot_time": "2026-03-17T14:45:00",
                "entries": [
                    {
                        "level": 1,
                        "price": 75000,
                        "bid_vol": 12000,
                        "ask_vol": 9000,
                    }
                ],
                "total_bid_volume": 12000,
                "total_ask_volume": 9000,
                "last_price": 75050,
            }
        return None

    async def fail_price_depth_fetch(*args, **kwargs):
        raise AssertionError("provider fetch should not run when orderbook cache is warm")

    monkeypatch.setattr("vnibb.api.v1.equity.redis_client.get_json", fake_get_json)
    monkeypatch.setattr(
        "vnibb.api.v1.equity.VnstockPriceDepthFetcher.fetch",
        fail_price_depth_fetch,
    )

    response = await client.get("/api/v1/equity/VNM/orderbook")
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 1
    assert payload["meta"]["last_data_date"] == "2026-03-17T14:45:00"
    assert payload["data"]["entries"][0]["bid_vol"] == 12000


@pytest.mark.asyncio
async def test_market_indices_smoke_returns_data(client, monkeypatch):
    async def fake_market_overview_fetch(_params):
        return [
            {
                "index_name": "VN-INDEX",
                "current_value": 1250.5,
                "change_pct": 0.8,
                "time": "2026-03-14T15:05:00",
            }
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.market.VnstockMarketOverviewFetcher.fetch",
        fake_market_overview_fetch,
    )

    response = await client.get("/api/v1/market/indices?limit=1")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["index_name"] == "VNINDEX"
    assert payload["updated_at"].startswith("2026-03-14T15:05:00")


@pytest.mark.asyncio
async def test_market_indices_prefer_db_rows_over_scaled_provider_payload(
    client, test_db, monkeypatch
):
    test_db.add_all(
        [
            StockIndex(
                id=1,
                index_code="VNINDEX",
                time=date(2026, 1, 30),
                open=1820.0,
                high=1835.0,
                low=1810.0,
                close=1829.04,
                volume=1_000_000,
                change=12.04,
                change_pct=0.66,
            ),
            StockIndex(
                id=2,
                index_code="VNINDEX",
                time=date(2026, 1, 29),
                open=1810.0,
                high=1825.0,
                low=1802.0,
                close=1817.0,
                volume=900_000,
                change=5.0,
                change_pct=0.28,
            ),
            StockIndex(
                id=3,
                index_code="VN30",
                time=date(2026, 1, 30),
                open=2020.0,
                high=2035.0,
                low=2010.0,
                close=2029.81,
                volume=800_000,
                change=9.81,
                change_pct=0.49,
            ),
            StockIndex(
                id=4,
                index_code="VN30",
                time=date(2026, 1, 29),
                open=2015.0,
                high=2022.0,
                low=2005.0,
                close=2020.0,
                volume=750_000,
                change=4.0,
                change_pct=0.2,
            ),
        ]
    )
    await test_db.commit()

    async def fake_market_overview_fetch(_params):
        return [
            {"index_name": "VNINDEX", "current_value": 1.7, "change": -0.01, "change_pct": -0.58},
            {"index_name": "VN30", "current_value": 1.85, "change": -0.01, "change_pct": -0.54},
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.market.VnstockMarketOverviewFetcher.fetch",
        fake_market_overview_fetch,
    )

    response = await client.get("/api/v1/market/indices?limit=2")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    assert payload["data"][0]["index_name"] == "VNINDEX"
    assert payload["data"][0]["current_value"] == pytest.approx(1829.04)
    assert payload["data"][1]["index_name"] == "VN30"
    assert payload["data"][1]["current_value"] == pytest.approx(2029.81)


def test_market_overview_rejects_compact_index_payloads():
    from vnibb.providers.vnstock.market_overview import (
        MarketOverviewQueryParams,
        VnstockMarketOverviewFetcher,
    )

    rows = VnstockMarketOverviewFetcher.transform_data(
        MarketOverviewQueryParams(),
        [
            {"index_name": "VNINDEX", "close": 1.7, "change": -0.01, "time": "2026-03-15T07:00:00"},
            {
                "index_name": "VN30",
                "close": 1853.6,
                "change": -6.2,
                "change_pct": -0.33,
                "time": "2026-03-15T00:00:00",
            },
        ],
    )

    assert len(rows) == 1
    assert rows[0].index_name == "VN30"
    assert rows[0].current_value == pytest.approx(1853.6)


@pytest.mark.asyncio
async def test_industry_bubble_returns_sector_points(client, test_db, monkeypatch):
    async def fake_get_screener_data(*args, **kwargs):
        return SimpleNamespace(
            data=[
                {
                    "symbol": "VCI",
                    "organ_name": "Vietcap",
                    "exchange": "HOSE",
                    "industry_name": "Chung khoan",
                    "price": 35.7,
                    "volume": 1_000_000,
                    "market_cap": 30_000_000_000.0,
                    "pe": 18.0,
                    "pb": 1.5,
                    "price_change_1d_pct": 1.5,
                    "snapshot_date": "2026-03-21",
                },
                {
                    "symbol": "SSI",
                    "organ_name": "SSI Securities",
                    "exchange": "HOSE",
                    "industry_name": "Chung khoan",
                    "price": 28.5,
                    "volume": 900_000,
                    "market_cap": 25_000_000_000.0,
                    "pe": 16.0,
                    "pb": 1.3,
                    "price_change_1d_pct": 0.8,
                    "snapshot_date": "2026-03-21",
                },
                {
                    "symbol": "FPT",
                    "organ_name": "FPT",
                    "exchange": "HOSE",
                    "industry_name": "Cong nghe va thong tin",
                    "price": 120.0,
                    "volume": 800_000,
                    "market_cap": 100_000_000_000.0,
                    "pe": 20.0,
                    "pb": 4.0,
                    "price_change_1d_pct": 1.0,
                    "snapshot_date": "2026-03-21",
                },
            ],
            is_fresh=True,
        )

    monkeypatch.setattr(
        "vnibb.api.v1.market.CacheManager.get_screener_data",
        fake_get_screener_data,
    )

    async def fake_load_stock_metadata(_symbols):
        return {
            "VCI": {"exchange": "HOSE", "industry": "chung khoan", "sector": "securities"},
            "SSI": {"exchange": "HOSE", "industry": "chung khoan", "sector": "securities"},
            "FPT": {
                "exchange": "HOSE",
                "industry": "cong nghe va thong tin",
                "sector": "technology",
            },
        }

    async def fake_change_pct_map(_symbols):
        return {}

    async def fake_ratio_metrics(_symbols):
        return {
            "VCI": {"pe_ratio": 18.0, "pb_ratio": 1.5, "roe": 12.0},
            "SSI": {"pe_ratio": 16.0, "pb_ratio": 1.3, "roe": 11.0},
        }

    async def fake_income_revenue(_symbols):
        return {"VCI": 5_000_000_000.0, "SSI": 4_000_000_000.0}

    monkeypatch.setattr(
        "vnibb.api.v1.market._load_stock_metadata",
        fake_load_stock_metadata,
    )
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", fake_change_pct_map)
    monkeypatch.setattr("vnibb.api.v1.market._load_latest_ratio_metrics", fake_ratio_metrics)
    monkeypatch.setattr("vnibb.api.v1.market._load_latest_income_revenue", fake_income_revenue)

    test_db.add_all(
        [
            Stock(
                id=601, symbol="VCI", exchange="HOSE", industry="Chung khoan", sector="securities"
            ),
            Stock(
                id=602, symbol="SSI", exchange="HOSE", industry="Chung khoan", sector="securities"
            ),
            FinancialRatio(
                id=601,
                symbol="VCI",
                period="2025",
                period_type="year",
                fiscal_year=2025,
                pe_ratio=18.0,
                pb_ratio=1.5,
                roe=12.0,
                updated_at=datetime.utcnow(),
            ),
            FinancialRatio(
                id=602,
                symbol="SSI",
                period="2025",
                period_type="year",
                fiscal_year=2025,
                pe_ratio=16.0,
                pb_ratio=1.3,
                roe=11.0,
                updated_at=datetime.utcnow(),
            ),
        ]
    )
    await test_db.commit()

    response = await client.get(
        "/api/v1/market/industry-bubble?symbol=VCI&x_metric=pb_ratio&y_metric=pe_ratio&top_n=5"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["reference_symbol"] == "VCI"
    assert len(payload["data"]) == 2
    assert any(point["is_reference"] for point in payload["data"])
    assert payload["sector_average"]["x"] == pytest.approx((1.5 + 1.3) / 2)


@pytest.mark.asyncio
async def test_sector_board_returns_grouped_sector_columns(client, monkeypatch):
    async def fake_get_screener_data(*args, **kwargs):
        return SimpleNamespace(
            data=[
                {
                    "symbol": "VCI",
                    "organ_name": "Vietcap",
                    "exchange": "HOSE",
                    "industry_name": "Chung khoan",
                    "price": 35.7,
                    "volume": 1_000_000,
                    "market_cap": 30_000_000_000.0,
                    "price_change_1d_pct": 1.5,
                },
                {
                    "symbol": "SSI",
                    "organ_name": "SSI Securities",
                    "exchange": "HOSE",
                    "industry_name": "Chung khoan",
                    "price": 28.5,
                    "volume": 900_000,
                    "market_cap": 25_000_000_000.0,
                    "price_change_1d_pct": 0.8,
                },
                {
                    "symbol": "FPT",
                    "organ_name": "FPT",
                    "exchange": "HOSE",
                    "industry_name": "Cong nghe va thong tin",
                    "price": 120.0,
                    "volume": 800_000,
                    "market_cap": 100_000_000_000.0,
                    "price_change_1d_pct": -0.5,
                },
            ],
            is_fresh=True,
        )

    async def fake_load_stock_metadata(_symbols):
        return {
            "VCI": {"exchange": "HOSE", "industry": "chung khoan", "sector": "securities"},
            "SSI": {"exchange": "HOSE", "industry": "chung khoan", "sector": "securities"},
            "FPT": {
                "exchange": "HOSE",
                "industry": "cong nghe va thong tin",
                "sector": "technology",
            },
        }

    async def fake_change_pct_map(_symbols):
        return {}

    async def fake_load_market_indices_from_db(_db):
        return [
            {
                "index_name": "VNINDEX",
                "current_value": 1647.81,
                "change_pct": -3.02,
                "time": date(2026, 3, 20),
            },
            {
                "index_name": "VN30",
                "current_value": 1797.99,
                "change_pct": -3.03,
                "time": date(2026, 3, 20),
            },
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.market.CacheManager.get_screener_data", fake_get_screener_data
    )
    monkeypatch.setattr("vnibb.api.v1.market._load_stock_metadata", fake_load_stock_metadata)
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", fake_change_pct_map)
    monkeypatch.setattr(
        "vnibb.api.v1.market._load_latest_market_indices_from_db",
        fake_load_market_indices_from_db,
    )

    response = await client.get("/api/v1/market/sector-board?limit_per_sector=5")

    assert response.status_code == 200
    payload = response.json()
    assert payload["limit_per_sector"] == 5
    assert payload["market_summary"]["VNINDEX"]["value"] == pytest.approx(1647.81)
    assert len(payload["sectors"]) == 2
    assert payload["sectors"][0]["name"] in {"Công nghệ", "Công nghệ - Truyền thông", "Chứng khoán"}
    first_stock = payload["sectors"][0]["stocks"][0]
    assert first_stock["color"] in {"green", "red", "yellow", "blue", "purple"}


@pytest.mark.asyncio
async def test_market_top_movers_smoke_returns_data(client, monkeypatch):
    async def fake_top_movers_fetch(*, type: str, index: str, limit: int):
        return [
            {
                "symbol": "VNM",
                "index": index,
                "last_price": 75000,
                "price_change_pct": 1.5,
                "updated_at": "2026-03-14T15:10:00",
            }
        ][:limit]

    async def fake_change_pct_map(_symbols):
        return {}

    async def fake_snapshot_metrics(_symbols):
        return {}

    monkeypatch.setattr(
        "vnibb.api.v1.market.VnstockTopMoversFetcher.fetch",
        fake_top_movers_fetch,
    )
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", fake_change_pct_map)
    monkeypatch.setattr("vnibb.api.v1.market._load_latest_snapshot_metrics", fake_snapshot_metrics)

    response = await client.get("/api/v1/market/top-movers?type=gainer&index=VNINDEX&limit=1")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["symbol"] == "VNM"
    assert payload["updated_at"].startswith("2026-03-14T15:10:00")


@pytest.mark.asyncio
async def test_market_top_movers_mode_alias_overrides_type(client, monkeypatch):
    async def fake_top_movers_fetch(*, type: str, index: str, limit: int):
        if type == "loser":
            return [
                {
                    "symbol": "VNM",
                    "index": index,
                    "last_price": 70000,
                    "price_change": -1000,
                    "price_change_pct": -1.4,
                }
            ][:limit]
        return []

    async def fake_change_pct_map(_symbols):
        return {}

    async def fake_snapshot_metrics(_symbols):
        return {}

    monkeypatch.setattr(
        "vnibb.api.v1.market.VnstockTopMoversFetcher.fetch",
        fake_top_movers_fetch,
    )
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", fake_change_pct_map)
    monkeypatch.setattr("vnibb.api.v1.market._load_latest_snapshot_metrics", fake_snapshot_metrics)

    response = await client.get(
        "/api/v1/market/top-movers?type=gainer&mode=losers&index=VNINDEX&limit=1"
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["type"] == "loser"
    assert payload["count"] == 1
    assert payload["data"][0]["symbol"] == "VNM"


@pytest.mark.asyncio
async def test_market_top_movers_uses_snapshot_fallback_when_provider_has_no_signal(
    client, monkeypatch
):
    async def fake_top_movers_fetch(*, type: str, index: str, limit: int):
        if type == "volume":
            return [
                {
                    "symbol": "AAA",
                    "index": index,
                    "last_price": 0,
                    "price_change": 0,
                    "price_change_pct": 0,
                    "volume": 0,
                    "value": 0,
                }
            ][:limit]
        return []

    async def fake_change_pct_map(_symbols):
        return {}

    async def fake_snapshot_metrics(_symbols):
        return {}

    async def fake_snapshot_top_movers(index: str, mover_type: str, limit: int):
        return [
            {
                "symbol": "VNM",
                "index": index,
                "last_price": 70500,
                "price_change": 1000,
                "price_change_pct": 1.44,
                "volume": 1200000,
                "value": 84600000000,
                "avg_volume_20d": None,
                "volume_spike_pct": None,
            }
        ][:limit]

    monkeypatch.setattr(
        "vnibb.api.v1.market.VnstockTopMoversFetcher.fetch",
        fake_top_movers_fetch,
    )
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", fake_change_pct_map)
    monkeypatch.setattr("vnibb.api.v1.market._load_latest_snapshot_metrics", fake_snapshot_metrics)
    monkeypatch.setattr("vnibb.api.v1.market._build_snapshot_top_movers", fake_snapshot_top_movers)

    response = await client.get("/api/v1/market/top-movers?type=gainer&index=VNINDEX&limit=1")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["symbol"] == "VNM"
    assert "snapshot-derived fallback" in (payload.get("error") or "")


@pytest.mark.asyncio
async def test_market_sector_performance_smoke_returns_data(client, monkeypatch):
    async def fake_screener_fetch(_params):
        return [{"symbol": "VNM", "price": 75000, "change_pct": 1.2}]

    async def fake_sector_performance(_rows):
        brief = StockBrief(symbol="VNM", price=75000, change_pct=1.2)
        return [
            SectorPerformance(
                sector_id="consumer_staples",
                sector_name="Consumer Staples",
                sector_name_en="Consumer Staples",
                change_pct=1.2,
                top_gainer=brief,
                top_loser=brief,
                total_stocks=1,
                stocks=[brief],
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.market.VnstockScreenerFetcher.fetch",
        fake_screener_fetch,
    )
    monkeypatch.setattr(
        "vnibb.api.v1.market.SectorService.calculate_sector_performance",
        fake_sector_performance,
    )

    response = await client.get("/api/v1/market/sector-performance")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["sectorId"] == "consumer_staples"


@pytest.mark.asyncio
async def test_market_sector_performance_filters_empty_by_default(client, monkeypatch):
    async def fake_screener_fetch(_params):
        return [{"symbol": "VNM", "price": 75000, "change_pct": 1.2}]

    async def fake_sector_performance(_rows):
        brief = StockBrief(symbol="VNM", price=75000, change_pct=1.2)
        empty = SectorPerformance(
            sector_id="utilities",
            sector_name="Utilities",
            sector_name_en="Utilities",
            change_pct=0.0,
            top_gainer=None,
            top_loser=None,
            total_stocks=0,
            stocks=[],
        )
        non_empty = SectorPerformance(
            sector_id="consumer_staples",
            sector_name="Consumer Staples",
            sector_name_en="Consumer Staples",
            change_pct=1.2,
            top_gainer=brief,
            top_loser=brief,
            total_stocks=1,
            stocks=[brief],
        )
        return [empty, non_empty]

    monkeypatch.setattr(
        "vnibb.api.v1.market.VnstockScreenerFetcher.fetch",
        fake_screener_fetch,
    )
    monkeypatch.setattr(
        "vnibb.api.v1.market.SectorService.calculate_sector_performance",
        fake_sector_performance,
    )

    response = await client.get("/api/v1/market/sector-performance")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["sectorId"] == "consumer_staples"

    include_empty_response = await client.get(
        "/api/v1/market/sector-performance?include_empty=true"
    )
    assert include_empty_response.status_code == 200
    include_empty_payload = include_empty_response.json()
    assert include_empty_payload["count"] == 2


@pytest.mark.asyncio
async def test_market_sector_performance_cached_rows_use_extended_metrics_and_metadata(
    client,
    monkeypatch,
):
    captured = {}

    async def fake_cache_fetch(self, symbol=None, source=None, allow_stale=True):
        snapshot = SimpleNamespace(
            symbol="VCB",
            price=87500,
            exchange="HOSE",
            industry=None,
            extended_metrics={"change_1d": 1.25},
        )
        return SimpleNamespace(data=[snapshot], hit=True, is_stale=False, cached_at=None)

    async def fake_stock_metadata(_symbols):
        return {
            "VCB": {
                "exchange": "HOSE",
                "industry": "Ngân hàng",
                "sector": "Ngân hàng",
            }
        }

    async def fake_change_pct_map(_symbols):
        return {}

    async def fake_sector_performance(rows):
        captured["rows"] = rows
        brief = StockBrief(symbol="VCB", price=87500, change_pct=1.25)
        return [
            SectorPerformance(
                sector_id="banking",
                sector_name="Ngân hàng",
                sector_name_en="Banking",
                change_pct=1.25,
                top_gainer=brief,
                top_loser=brief,
                total_stocks=1,
                stocks=[brief],
            )
        ]

    monkeypatch.setattr("vnibb.api.v1.market.CacheManager.get_screener_data", fake_cache_fetch)
    monkeypatch.setattr("vnibb.api.v1.market._load_stock_metadata", fake_stock_metadata)
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", fake_change_pct_map)
    monkeypatch.setattr(
        "vnibb.api.v1.market.SectorService.calculate_sector_performance",
        fake_sector_performance,
    )

    response = await client.get("/api/v1/market/sector-performance")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["sectorId"] == "banking"
    assert captured["rows"][0]["change_pct"] == 1.25
    assert captured["rows"][0]["industry_name"] == "Ngân hàng"


@pytest.mark.asyncio
async def test_market_world_indices_smoke_returns_data(client, monkeypatch):
    async def fake_world_index_point(symbol: str, name: str):
        return {
            "symbol": symbol,
            "name": name,
            "value": 1234.5,
            "change": 10.0,
            "change_pct": 0.8,
            "updated_at": "2026-02-15",
        }

    monkeypatch.setattr(
        "vnibb.api.v1.market._fetch_world_index_point",
        fake_world_index_point,
    )

    response = await client.get("/api/v1/market/world-indices?limit=2")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    assert payload["data"][0]["value"] == 1234.5


@pytest.mark.asyncio
async def test_market_forex_rates_smoke_returns_data(client, monkeypatch):
    class FakeFrame:
        def __init__(self, rows):
            self._rows = rows
            self.index = [0]

        def to_dict(self, orient: str):
            assert orient == "records"
            return self._rows

    def fake_vcb_exchange_rate():
        return FakeFrame(
            [
                {
                    "currency_code": "USD",
                    "currency_name": "US DOLLAR",
                    "buy _cash": "24,500",
                    "buy _transfer": "24,520",
                    "sell": "24,860",
                    "date": "2026-02-15",
                }
            ]
        )

    monkeypatch.setattr("vnibb.api.v1.market.vcb_exchange_rate", fake_vcb_exchange_rate)

    response = await client.get("/api/v1/market/forex-rates?limit=1")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["currency_code"] == "USD"
    assert payload["data"][0]["buy_transfer"] == 24520.0


@pytest.mark.asyncio
async def test_market_commodities_smoke_returns_data(client, monkeypatch):
    class FakeFrame:
        def __init__(self, rows):
            self._rows = rows
            self.index = [0]

        def to_dict(self, orient: str):
            assert orient == "records"
            return self._rows

    def fake_btmc_goldprice():
        return FakeFrame(
            [
                {
                    "name": "Gold 9999",
                    "karat": "9999",
                    "buy_price": "88,500,000",
                    "sell_price": "90,200,000",
                    "world_price": "2,900",
                    "time": "2026-02-15 10:15",
                }
            ]
        )

    def fake_sjc_gold_price():
        return FakeFrame([])

    monkeypatch.setattr("vnibb.api.v1.market.btmc_goldprice", fake_btmc_goldprice)
    monkeypatch.setattr("vnibb.api.v1.market.sjc_gold_price", fake_sjc_gold_price)

    response = await client.get("/api/v1/market/commodities?limit=1")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["source"] == "BTMC"
    assert payload["data"][0]["buy_price"] == 88500000.0


@pytest.mark.asyncio
async def test_request_timeout_middleware_returns_504(client, monkeypatch):
    monkeypatch.setattr("vnibb.api.v1.market.WORLD_INDEX_POINT_TIMEOUT_SECONDS", 2)
    monkeypatch.setattr("vnibb.core.config.settings.api_request_timeout_seconds", 0.01)

    async def fake_world_index_point(symbol: str, name: str):
        await asyncio.sleep(0.05)
        return {
            "symbol": symbol,
            "name": name,
            "value": 1234.5,
            "change": 10.0,
            "change_pct": 0.8,
            "updated_at": "2026-02-15",
        }

    monkeypatch.setattr("vnibb.api.v1.market._fetch_world_index_point", fake_world_index_point)

    response = await client.get("/api/v1/market/world-indices?limit=1")
    assert response.status_code == 504
    payload = response.json()
    assert payload["error"] is True
    assert payload["code"] == "REQUEST_TIMEOUT"
