import asyncio
from datetime import date, datetime
from types import SimpleNamespace

import pytest

from vnibb.models.trading import FinancialRatio
from vnibb.models.financials import IncomeStatement, BalanceSheet
from vnibb.models.company import Company, Shareholder
from vnibb.models.news import Dividend
from vnibb.models.comparison import StockComparison
from vnibb.models.stock import Stock, StockIndex, StockPrice
from vnibb.models.screener import ScreenerSnapshot
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
