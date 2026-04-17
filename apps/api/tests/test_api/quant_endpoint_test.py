from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pandas as pd
import pytest

from vnibb.api.v1 import quant
from vnibb.api.v1.schemas import MetaData, StandardResponse
from vnibb.models.stock import Stock, StockPrice
from vnibb.providers.vnstock.equity_historical import EquityHistoricalData


def _build_price_frame(rows: int = 120) -> pd.DataFrame:
    dates = pd.date_range(end=pd.Timestamp.now(tz=None).normalize(), periods=rows, freq="B")
    payload = []
    base = 100.0

    for index, timestamp in enumerate(dates):
        close = base + (index * 0.35) + ((index % 9) - 4) * 0.15
        payload.append(
            {
                "time": timestamp,
                "open": close - 0.4,
                "high": close + 1.1,
                "low": close - 1.0,
                "close": close,
                "volume": 1_000_000 + ((index % 17) * 12_500),
            }
        )

    return pd.DataFrame(payload)


@pytest.mark.asyncio
async def test_quant_endpoint_rejects_invalid_metrics(client):
    response = await client.get("/api/v1/quant/VNM", params={"metrics": "bad_metric"})

    assert response.status_code == 400
    payload = response.json()
    detail = payload.get("detail", payload)
    assert detail["invalid_metrics"] == ["bad_metric"]
    assert "volume_delta" in detail["supported_metrics"]


@pytest.mark.asyncio
async def test_quant_endpoint_rejects_10y_period(client):
    response = await client.get(
        "/api/v1/quant/VNM",
        params={"metrics": "volume_delta", "period": "10Y"},
    )

    assert response.status_code == 400
    payload = response.json()
    detail = payload.get("detail", payload)
    assert detail["code"] == "INVALID_PERIOD"
    assert detail["requested_period"] == "10Y"
    assert detail["allowed_periods"] == ["1M", "6M", "1Y", "3Y", "5Y", "ALL"]


@pytest.mark.asyncio
async def test_quant_endpoint_returns_insufficient_data_error(client, monkeypatch):
    async def fake_load_price_frame(*_args, **_kwargs):
        return pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])

    monkeypatch.setattr("vnibb.api.v1.quant._load_price_frame", fake_load_price_frame)

    response = await client.get(
        "/api/v1/quant/VNM",
        params={"metrics": "volume_delta", "period": "3Y"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["error"] == "Insufficient Data: Expected at least 30 sessions, got 0."
    assert payload["data"]["metrics"] == {}
    assert payload["meta"]["count"] == 0


@pytest.mark.asyncio
async def test_quant_endpoint_returns_requested_metrics(client, monkeypatch):
    async def fake_load_price_frame(*_args, **_kwargs):
        return _build_price_frame(180)

    monkeypatch.setattr("vnibb.api.v1.quant._load_price_frame", fake_load_price_frame)

    response = await client.get(
        "/api/v1/quant/VNM",
        params={
            "metrics": "volume_delta,gap_stats,macd_crossovers",
            "period": "3Y",
        },
    )

    assert response.status_code == 200
    payload = response.json()

    assert payload["error"] is None
    assert payload["data"]["symbol"] == "VNM"
    assert payload["data"]["period"] == "3Y"

    metrics = payload["data"]["metrics"]
    assert set(metrics.keys()) == {"volume_delta", "gap_stats", "macd_crossovers"}
    assert len(metrics["volume_delta"]["monthly_avg"]) == 12
    assert "gap_fill_rate_pct" in metrics["gap_stats"]
    assert "current_state" in metrics["macd_crossovers"]
    assert payload["meta"]["count"] == 3


@pytest.mark.asyncio
async def test_quant_endpoint_passes_adjustment_mode_to_frame_loader(client, monkeypatch):
    captured: dict[str, object] = {}

    async def fake_load_quant_frame_with_warning(*, adjustment_mode, **_kwargs):
        captured["adjustment_mode"] = adjustment_mode
        return _build_price_frame(180), None

    monkeypatch.setattr(
        "vnibb.api.v1.quant._load_quant_frame_with_warning", fake_load_quant_frame_with_warning
    )

    response = await client.get(
        "/api/v1/quant/VNM",
        params={"metrics": "sortino", "period": "1Y", "adjustment_mode": "adjusted"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["adjustment_mode"] == "adjusted"
    assert captured["adjustment_mode"] == "adjusted"


@pytest.mark.asyncio
async def test_quant_alias_endpoints_forward_adjustment_mode(client, monkeypatch):
    calls: list[dict[str, object]] = []

    async def fake_alias_response(**kwargs):
        calls.append(kwargs)
        return StandardResponse(data={"ok": True}, meta=MetaData(count=1))

    monkeypatch.setattr("vnibb.api.v1.quant._get_quant_metric_alias_response", fake_alias_response)

    for endpoint in [
        "/api/v1/quant/VNM/seasonality",
        "/api/v1/quant/VNM/sortino-monthly",
        "/api/v1/quant/VNM/parkinson-volatility",
        "/api/v1/quant/VNM/drawdown-recovery",
    ]:
        response = await client.get(endpoint, params={"adjustment_mode": "adjusted"})
        assert response.status_code == 200
        assert calls[-1]["adjustment_mode"] == "adjusted"


@pytest.mark.asyncio
async def test_quant_endpoint_includes_backend_seasonality_metric(client, monkeypatch):
    async def fake_load_price_frame(*_args, **_kwargs):
        return _build_price_frame(260)

    monkeypatch.setattr("vnibb.api.v1.quant._load_price_frame", fake_load_price_frame)

    response = await client.get(
        "/api/v1/quant/VCI",
        params={
            "metrics": "seasonality",
            "period": "5Y",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    metric = payload["data"]["metrics"]["seasonality"]
    assert len(metric["monthly_returns"]) > 0
    assert "Mar" in metric["monthly_average_return_pct"]


@pytest.mark.asyncio
async def test_quant_endpoint_accepts_all_period(client, monkeypatch):
    async def fake_load_price_frame(*_args, **_kwargs):
        return _build_price_frame(320)

    monkeypatch.setattr("vnibb.api.v1.quant._load_price_frame", fake_load_price_frame)

    response = await client.get(
        "/api/v1/quant/VCI",
        params={
            "metrics": "seasonality,sortino",
            "period": "ALL",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["error"] is None
    assert payload["data"]["period"] == "ALL"
    assert "seasonality" in payload["data"]["metrics"]
    assert "sortino" in payload["data"]["metrics"]


@pytest.mark.asyncio
async def test_quant_endpoint_accepts_1y_period(client, monkeypatch):
    async def fake_load_price_frame(*_args, **_kwargs):
        return _build_price_frame(260)

    monkeypatch.setattr("vnibb.api.v1.quant._load_price_frame", fake_load_price_frame)

    response = await client.get(
        "/api/v1/quant/VCI",
        params={
            "metrics": "seasonality,sortino",
            "period": "1Y",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["error"] is None
    assert payload["data"]["period"] == "1Y"


def test_compute_sortino_handles_string_dates_and_zero_downside():
    frame = pd.DataFrame(
        {
            "time": pd.date_range(start="2026-01-02", periods=45, freq="B").strftime("%Y-%m-%d"),
            "close": [100 + index for index in range(45)],
        }
    )

    payload = quant._compute_sortino(frame)

    assert payload["monthly_sortino"]["Jan"] == 99.0
    assert payload["best_months"]


@pytest.mark.asyncio
async def test_smart_money_endpoint_recovers_from_legacy_block_trade_schema(
    client,
    test_db,
    monkeypatch,
):
    async def fake_load_price_frame(*_args, **_kwargs):
        return _build_price_frame(120)

    class DummyResult:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

    rollback_calls = 0

    async def fake_rollback():
        nonlocal rollback_calls
        rollback_calls += 1

    async def fake_execute(stmt, *_args, **_kwargs):
        sql = str(stmt).lower()

        if "from foreign_trading" in sql:
            return DummyResult([])

        if "block_trades.side" in sql:
            raise RuntimeError("column block_trades.side does not exist")

        if "from block_trades" in sql:
            return DummyResult([(pd.Timestamp("2026-03-12"), 250_000, 15_000_000_000)])

        raise AssertionError(f"Unexpected statement executed in test: {stmt}")

    monkeypatch.setattr("vnibb.api.v1.quant._load_price_frame", fake_load_price_frame)
    monkeypatch.setattr(test_db, "execute", fake_execute)
    monkeypatch.setattr(test_db, "rollback", fake_rollback)

    response = await client.get("/api/v1/quant/ANV/smart-money")

    assert response.status_code == 200
    payload = response.json()
    assert payload["error"] is None
    assert payload["data"]["symbol"] == "ANV"
    assert payload["data"]["block_trades"][0]["type"] == "unknown"
    assert payload["data"]["block_trades"][0]["source"] == "block_trade_table_legacy_schema"
    assert rollback_calls == 1


@pytest.mark.asyncio
async def test_load_price_frame_rolls_back_and_falls_back_to_provider_on_aborted_transaction(
    test_db,
    monkeypatch,
):
    provider_rows = [
        SimpleNamespace(
            time=date(2026, 3, 11),
            open=101.0,
            high=103.5,
            low=100.5,
            close=102.75,
            volume=1_250_000,
        ),
        SimpleNamespace(
            time=date(2026, 3, 12),
            open=102.5,
            high=104.0,
            low=101.75,
            close=103.25,
            volume=1_480_000,
        ),
    ]
    rollback_calls = 0
    fetch_calls = 0

    async def fake_execute(*_args, **_kwargs):
        raise RuntimeError(
            "current transaction is aborted, commands ignored until end of transaction block"
        )

    async def fake_rollback():
        nonlocal rollback_calls
        rollback_calls += 1

    async def fake_fetch(params):
        nonlocal fetch_calls
        fetch_calls += 1
        assert params.symbol == "VNM"
        assert params.interval == "1D"
        return provider_rows

    monkeypatch.setattr(test_db, "execute", fake_execute)
    monkeypatch.setattr(test_db, "rollback", fake_rollback)
    monkeypatch.setattr(quant.VnstockEquityHistoricalFetcher, "fetch", fake_fetch)

    frame = await quant._load_price_frame(
        db=test_db,
        symbol="VNM",
        start_date=date(2026, 3, 1),
        end_date=date(2026, 3, 12),
        source="KBS",
    )

    assert rollback_calls == 1
    assert fetch_calls == 1
    assert frame["close"].tolist() == [102.75, 103.25]
    assert frame["volume"].tolist() == [1_250_000, 1_480_000]


@pytest.mark.asyncio
async def test_load_price_frame_refreshes_stale_db_rows_with_provider_data(
    test_db,
    monkeypatch,
):
    test_db.add(
        Stock(
            id=1,
            symbol="VNM",
            exchange="HOSE",
            company_name="Vinamilk",
        )
    )
    test_db.add_all(
        [
            StockPrice(
                id=1,
                stock_id=1,
                symbol="VNM",
                time=date(2026, 2, 26),
                open=100.0,
                high=102.0,
                low=99.5,
                close=101.5,
                volume=1_150_000,
                interval="1D",
                source="vnstock",
            ),
            StockPrice(
                id=2,
                stock_id=1,
                symbol="VNM",
                time=date(2026, 2, 27),
                open=101.0,
                high=103.0,
                low=100.5,
                close=102.25,
                volume=1_240_000,
                interval="1D",
                source="vnstock",
            ),
        ]
    )
    await test_db.commit()

    provider_rows = [
        SimpleNamespace(
            time=date(2026, 3, 13),
            open=102.5,
            high=104.0,
            low=101.8,
            close=103.5,
            volume=1_320_000,
        ),
        SimpleNamespace(
            time=date(2026, 3, 14),
            open=103.6,
            high=105.1,
            low=103.0,
            close=104.25,
            volume=1_410_000,
        ),
    ]
    fetch_calls = 0

    async def fake_fetch(params):
        nonlocal fetch_calls
        fetch_calls += 1
        assert params.symbol == "VNM"
        assert params.interval == "1D"
        assert params.start_date <= date(2026, 2, 27)
        return provider_rows

    monkeypatch.setattr(quant.VnstockEquityHistoricalFetcher, "fetch", fake_fetch)

    frame = await quant._load_price_frame(
        db=test_db,
        symbol="VNM",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 3, 15),
        source="KBS",
    )

    observed_dates = set(frame["time"].dt.date.tolist())
    assert fetch_calls == 1
    assert date(2026, 2, 27) in observed_dates
    assert date(2026, 3, 14) in observed_dates
    assert frame["time"].dt.date.max() == date(2026, 3, 14)


@pytest.mark.asyncio
async def test_load_price_frame_applies_adjustments_for_quant_history(test_db, monkeypatch):
    async def fake_load_historical_from_db(*_args, **_kwargs):
        return [
            EquityHistoricalData(
                symbol="VNM",
                time=date(2026, 1, 2),
                open=100.0,
                high=101.0,
                low=99.0,
                close=100.0,
                volume=1_000_000,
                raw_close=100.0,
                adjustment_mode="raw",
                adjustment_applied=False,
            )
        ]

    async def fake_load_recent_cache(*_args, **_kwargs):
        return []

    async def fake_load_appwrite(*_args, **_kwargs):
        return []

    async def fake_load_actions(*_args, **_kwargs):
        return [
            {
                "effective_date": date(2026, 1, 6),
                "action_category": "dividend",
                "action_subtype": "cash_dividend",
                "cash_amount_per_share": 10.0,
                "share_ratio": None,
                "percent_ratio": None,
            }
        ]

    async def fake_fetch(_params):
        return []

    monkeypatch.setattr("vnibb.api.v1.quant._load_historical_from_db", fake_load_historical_from_db)
    monkeypatch.setattr(
        "vnibb.api.v1.quant._load_historical_from_recent_cache", fake_load_recent_cache
    )
    monkeypatch.setattr("vnibb.api.v1.quant._load_historical_from_appwrite", fake_load_appwrite)
    monkeypatch.setattr(
        "vnibb.api.v1.quant._load_corporate_actions_for_adjustment", fake_load_actions
    )
    monkeypatch.setattr(quant.VnstockEquityHistoricalFetcher, "fetch", fake_fetch)

    frame = await quant._load_price_frame(
        db=test_db,
        symbol="VNM",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 10),
        source="KBS",
        adjustment_mode="adjusted",
    )

    assert frame["close"].tolist() == [90.0]
    assert frame["open"].tolist() == [90.0]


@pytest.mark.asyncio
async def test_load_quant_frame_with_warning_merges_latest_quote_snapshot(test_db, monkeypatch):
    async def fake_load_price_frame(*_args, **_kwargs):
        return pd.DataFrame(
            [
                {
                    "time": pd.Timestamp("2026-03-20"),
                    "open": 100.0,
                    "high": 101.0,
                    "low": 99.5,
                    "close": 100.5,
                    "volume": 1_000_000,
                }
            ]
        )

    class DummyQuote:
        price = 103.2
        open = 101.2
        high = 104.0
        low = 100.8
        volume = 1_250_000
        updated_at = pd.Timestamp("2026-03-21 10:15:00")

    async def fake_fetch_quote(*_args, **_kwargs):
        return DummyQuote(), False

    monkeypatch.setattr(quant, "_load_price_frame", fake_load_price_frame)
    monkeypatch.setattr(quant.VnstockStockQuoteFetcher, "fetch", fake_fetch_quote)

    frame, warning = await quant._load_quant_frame_with_warning(
        db=test_db,
        symbol="VCI",
        start_date=date(2026, 3, 1),
        end_date=date(2026, 3, 21),
        source="KBS",
        period="1Y",
        adjustment_mode="raw",
    )

    assert frame["close"].tolist()[-1] == 103.2
    assert frame["time"].dt.date.tolist()[-1] == date(2026, 3, 21)
    assert warning is not None
    assert "latest quote" in warning.lower()


@pytest.mark.asyncio
async def test_smart_money_endpoint_survives_price_frame_loader_failure(
    client,
    test_db,
    monkeypatch,
):
    class DummyResult:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

    async def fake_execute(stmt, *_args, **_kwargs):
        sql = str(stmt).lower()
        if "from foreign_trading" in sql:
            return DummyResult([])
        raise AssertionError(f"Unexpected statement executed in test: {stmt}")

    async def fake_load_price_frame(*_args, **_kwargs):
        raise RuntimeError("forced price frame failure")

    async def fake_load_block_trade_rows(*_args, **_kwargs):
        return []

    monkeypatch.setattr(test_db, "execute", fake_execute)
    monkeypatch.setattr("vnibb.api.v1.quant._load_price_frame", fake_load_price_frame)
    monkeypatch.setattr("vnibb.api.v1.quant._load_block_trade_rows", fake_load_block_trade_rows)

    response = await client.get("/api/v1/quant/VNM/smart-money")

    assert response.status_code == 200
    payload = response.json()
    assert payload["error"] is None
    assert payload["data"]["symbol"] == "VNM"
    assert payload["data"]["net_institutional"] == "neutral"
    assert payload["data"]["block_trades"] == []
