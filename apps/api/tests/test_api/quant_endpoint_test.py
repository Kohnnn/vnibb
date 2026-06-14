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
async def test_quant_backtest_rejects_invalid_moving_average_windows(client, monkeypatch):
    async def fake_load_quant_frame_with_warning(**_kwargs):
        return _build_price_frame(180), None

    monkeypatch.setattr(
        "vnibb.api.v1.quant._load_quant_frame_with_warning", fake_load_quant_frame_with_warning
    )

    response = await client.post(
        "/api/v1/quant/VNM/backtest",
        json={
            "strategy": {
                "type": "moving_average_crossover",
                "fast_window": 50,
                "slow_window": 20,
            }
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert "INVALID_STRATEGY" in str(payload)


@pytest.mark.asyncio
async def test_quant_backtest_returns_metrics_summary_and_trades(client, monkeypatch):
    async def fake_load_quant_frame_with_warning(**_kwargs):
        frame = _build_price_frame(220)
        midpoint = len(frame) // 2
        frame.loc[:midpoint, "close"] = [120 - (index * 0.25) for index in range(midpoint + 1)]
        frame.loc[midpoint + 1 :, "close"] = [
            85 + (index * 0.8) for index in range(len(frame) - midpoint - 1)
        ]
        frame["open"] = frame["close"] - 0.2
        frame["high"] = frame["close"] + 0.8
        frame["low"] = frame["close"] - 0.8
        return frame, "test warning"

    monkeypatch.setattr(
        "vnibb.api.v1.quant._load_quant_frame_with_warning", fake_load_quant_frame_with_warning
    )

    response = await client.post(
        "/api/v1/quant/VNM/backtest",
        json={
            "period": "1Y",
            "initial_capital": 1000000,
            "fee_bps": 10,
            "strategy": {
                "type": "moving_average_crossover",
                "fast_window": 5,
                "slow_window": 20,
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    data = payload["data"]
    assert data["symbol"] == "VNM"
    assert data["strategy"]["type"] == "moving_average_crossover"
    assert data["metrics"]["final_equity"] is not None
    assert data["metrics"]["trade_count"] >= 0
    assert data["equity_curve_summary"]["data_points"] == 220
    assert len(data["equity_curve_summary"]["points"]) == 5
    assert isinstance(data["trades"], list)
    assert "test warning" in data["warnings"]
    assert payload["meta"]["data_points"] == 220


@pytest.mark.asyncio
async def test_quant_sweep_returns_cells_and_best_combo(client, monkeypatch):
    async def fake_load_quant_frame_with_warning(**_kwargs):
        frame = _build_price_frame(220)
        midpoint = len(frame) // 2
        frame.loc[:midpoint, "close"] = [120 - (index * 0.25) for index in range(midpoint + 1)]
        frame.loc[midpoint + 1 :, "close"] = [
            85 + (index * 0.8) for index in range(len(frame) - midpoint - 1)
        ]
        frame["open"] = frame["close"] - 0.2
        frame["high"] = frame["close"] + 0.8
        frame["low"] = frame["close"] - 0.8
        return frame, None

    monkeypatch.setattr(
        "vnibb.api.v1.quant._load_quant_frame_with_warning", fake_load_quant_frame_with_warning
    )

    response = await client.post(
        "/api/v1/quant/VNM/sweep",
        json={
            "period": "1Y",
            "initial_capital": 1000000,
            "fast_windows": [5, 10],
            "slow_windows": [20, 40],
            "objective": "total_return_pct",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    data = payload["data"]
    assert data["symbol"] == "VNM"
    assert data["objective"] == "total_return_pct"
    assert len(data["cells"]) == 4
    assert data["best"]["fast_window"] in {5, 10}
    assert data["best"]["slow_window"] in {20, 40}
    assert payload["meta"]["count"] == 4


@pytest.mark.asyncio
async def test_quant_sweep_rejects_invalid_grid(client, monkeypatch):
    async def fake_load_quant_frame_with_warning(**_kwargs):
        return _build_price_frame(180), None

    monkeypatch.setattr(
        "vnibb.api.v1.quant._load_quant_frame_with_warning", fake_load_quant_frame_with_warning
    )

    response = await client.post(
        "/api/v1/quant/VNM/sweep",
        json={"fast_windows": [50], "slow_windows": [20]},
    )

    assert response.status_code == 400
    assert "INVALID_SWEEP_GRID" in str(response.json())


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
        "/api/v1/quant/VNM/benchmark-risk",
    ]:
        response = await client.get(endpoint, params={"adjustment_mode": "adjusted"})
        assert response.status_code == 200
        assert calls[-1]["adjustment_mode"] == "adjusted"


@pytest.mark.asyncio
async def test_quant_endpoint_returns_benchmark_risk_metric(client, monkeypatch):
    async def fake_load_quant_frame_with_warning(**_kwargs):
        return _build_price_frame(220), None

    async def fake_load_benchmark_frame(**_kwargs):
        benchmark = _build_price_frame(220)
        benchmark["close"] = benchmark["close"] * 0.985
        return benchmark[["time", "close"]]

    monkeypatch.setattr(
        "vnibb.api.v1.quant._load_quant_frame_with_warning", fake_load_quant_frame_with_warning
    )
    monkeypatch.setattr("vnibb.api.v1.quant._load_benchmark_frame", fake_load_benchmark_frame)

    response = await client.get(
        "/api/v1/quant/VNM",
        params={"metrics": "benchmark_risk", "period": "1Y", "adjustment_mode": "adjusted"},
    )

    assert response.status_code == 200
    payload = response.json()
    metric = payload["data"]["metrics"]["benchmark_risk"]
    assert payload["data"]["adjustment_mode"] == "adjusted"
    assert metric["benchmark"] == "VNINDEX"
    assert "current_beta_63d" in metric
    assert "current_tracking_error_30d_pct" in metric
    assert "downside_deviation_30d_pct" in metric
    assert "var_95_1d_pct" in metric
    assert "cvar_95_1d_pct" in metric
    assert isinstance(metric["series"], list)


@pytest.mark.asyncio
async def test_quant_benchmark_risk_alias_resolves_dates_before_loading_benchmark(
    client, monkeypatch
):
    captured: dict[str, object] = {}

    async def fake_load_quant_frame_with_warning(**_kwargs):
        return _build_price_frame(220), None

    async def fake_load_benchmark_frame(**kwargs):
        captured.update(kwargs)
        benchmark = _build_price_frame(220)
        benchmark["close"] = benchmark["close"] * 0.985
        return benchmark[["time", "close"]]

    monkeypatch.setattr(
        "vnibb.api.v1.quant._load_quant_frame_with_warning", fake_load_quant_frame_with_warning
    )
    monkeypatch.setattr("vnibb.api.v1.quant._load_benchmark_frame", fake_load_benchmark_frame)

    response = await client.get(
        "/api/v1/quant/VNM/benchmark-risk",
        params={"period": "1Y", "adjustment_mode": "adjusted"},
    )

    assert response.status_code == 200
    assert captured["start_date"] < captured["end_date"]
    assert captured["source"]


def test_compute_benchmark_risk_returns_relative_and_tail_metrics():
    frame = _build_price_frame(260)
    benchmark = _build_price_frame(260)
    benchmark["close"] = benchmark["close"] * 0.992

    payload = quant._compute_benchmark_risk(frame, benchmark[["time", "close"]])

    assert payload["benchmark"] == "VNINDEX"
    assert payload["current_beta_63d"] is not None
    assert payload["current_tracking_error_30d_pct"] is not None
    assert payload["downside_deviation_30d_pct"] is not None
    assert payload["var_95_1d_pct"] is not None
    assert payload["cvar_95_1d_pct"] is not None


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


# ---------------------------------------------------------------------------
# Wave 3: market-structure tests + pair diagnostics
# ---------------------------------------------------------------------------

import numpy as np  # noqa: E402


def _rng(seed: int):
    state = {"s": seed & 0xFFFFFFFF or 1}

    def nxt():
        state["s"] = (state["s"] * 1664525 + 1013904223) & 0xFFFFFFFF
        return state["s"] / 4294967296.0

    return nxt


def _gauss(rng):
    u1 = max(rng(), 1e-12)
    u2 = rng()
    return (-2.0 * np.log(u1)) ** 0.5 * np.cos(2.0 * np.pi * u2)


def _frame_from_returns(returns: list[float]) -> pd.DataFrame:
    price = 100.0
    closes = [price]
    for r in returns:
        price *= 1.0 + r
        closes.append(price)
    dates = pd.date_range(end=pd.Timestamp.now(tz=None).normalize(), periods=len(closes), freq="B")
    return pd.DataFrame(
        {
            "time": dates,
            "open": closes,
            "high": [c * 1.01 for c in closes],
            "low": [c * 0.99 for c in closes],
            "close": closes,
            "volume": [1_000_000] * len(closes),
        }
    )


def test_market_structure_insufficient_data_returns_nulls():
    frame = _build_price_frame(rows=50)
    result = quant._compute_market_structure_tests(frame)
    assert result["hurst_rs"] is None
    assert result["squared_return_acf"] == []
    assert all(item["vr"] is None for item in result["variance_ratio"])
    assert "Not a forecast" in result["note"]


def test_market_structure_trend_series_has_vr_above_one():
    rng = _rng(7)
    r = [0.0]
    for _ in range(399):
        r.append(0.6 * r[-1] + 0.01 * _gauss(rng))
    result = quant._compute_market_structure_tests(_frame_from_returns(r))
    vr5 = next(item for item in result["variance_ratio"] if item["q"] == 5)
    assert vr5["vr"] is not None and vr5["vr"] > 1
    assert vr5["z"] is not None and vr5["z"] > 1.96
    assert result["sample_returns"] >= 120


def test_market_structure_mean_revert_series_has_vr_below_one():
    rng = _rng(11)
    r = [0.0]
    for _ in range(399):
        r.append(-0.6 * r[-1] + 0.01 * _gauss(rng))
    result = quant._compute_market_structure_tests(_frame_from_returns(r))
    vr2 = next(item for item in result["variance_ratio"] if item["q"] == 2)
    assert vr2["vr"] is not None and vr2["vr"] < 1
    assert vr2["z"] is not None and vr2["z"] < -1.96


def test_market_structure_acf_positive_for_volatility_clustering():
    rng = _rng(9)
    sig2 = 0.0004
    prev_shock = 0.0
    r = []
    for _ in range(1500):
        sig2 = 0.00002 + 0.85 * sig2 + 0.1 * prev_shock * prev_shock
        shock = (sig2**0.5) * _gauss(rng)
        r.append(shock)
        prev_shock = shock
    result = quant._compute_market_structure_tests(_frame_from_returns(r))
    acf = result["squared_return_acf"]
    assert len(acf) == 10
    assert acf[0] is not None and acf[0] > 0.05


def test_pair_diagnostics_cointegrated_pair_has_negative_adf():
    rng = _rng(21)
    log_x = [4.0]
    for _ in range(399):
        log_x.append(log_x[-1] + 0.01 * _gauss(rng))
    # y tracks x with stationary noise around it -> cointegrated.
    closes_a = [float(np.exp(v)) for v in log_x]
    closes_b = [float(np.exp(v + 0.02 * _gauss(rng))) for v in log_x]
    dates = pd.date_range(end=pd.Timestamp.now(tz=None).normalize(), periods=len(closes_a), freq="B")
    frame_a = pd.DataFrame({"time": dates, "close": closes_a, "open": closes_a, "high": closes_a, "low": closes_a, "volume": [1] * len(closes_a)})
    frame_b = pd.DataFrame({"time": dates, "close": closes_b, "open": closes_b, "high": closes_b, "low": closes_b, "volume": [1] * len(closes_b)})
    result = quant._compute_pair_diagnostics(frame_a, frame_b)
    assert result["aligned_days"] >= 60
    assert result["hedge_ratio_ols"] is not None
    assert result["adf_tstat"] is not None and result["adf_tstat"] < 0
    assert result["adf_critical_values"]["5%"] == -3.34


def test_pair_diagnostics_insufficient_overlap():
    dates = pd.date_range(end=pd.Timestamp.now(tz=None).normalize(), periods=10, freq="B")
    frame = pd.DataFrame({"time": dates, "close": [100.0] * 10, "open": [100.0] * 10, "high": [100.0] * 10, "low": [100.0] * 10, "volume": [1] * 10})
    result = quant._compute_pair_diagnostics(frame, frame.copy())
    assert result["aligned_days"] == 10
    assert result["hedge_ratio_ols"] is None


@pytest.mark.asyncio
async def test_market_structure_tests_endpoint(client, monkeypatch):
    rng = _rng(3)
    r = [0.0]
    for _ in range(399):
        r.append(0.5 * r[-1] + 0.01 * _gauss(rng))
    frame = _frame_from_returns(r)

    async def fake_load_price_frame(*_args, **_kwargs):
        return frame

    monkeypatch.setattr("vnibb.api.v1.quant._load_price_frame", fake_load_price_frame)

    response = await client.get("/api/v1/quant/VNM/market-structure-tests")
    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["metric"] == "market_structure_tests"
    assert len(payload["data"]["variance_ratio"]) == 3
    assert payload["data"]["sample_returns"] >= 120


@pytest.mark.asyncio
async def test_pair_endpoint_rejects_identical_symbols(client):
    response = await client.get("/api/v1/quant/VNM/pair/VNM")
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_pair_endpoint_returns_diagnostics(client, monkeypatch):
    rng = _rng(31)
    log_x = [4.0]
    for _ in range(399):
        log_x.append(log_x[-1] + 0.01 * _gauss(rng))
    closes_a = [float(np.exp(v)) for v in log_x]
    closes_b = [float(np.exp(v + 0.02 * _gauss(rng))) for v in log_x]
    dates = pd.date_range(end=pd.Timestamp.now(tz=None).normalize(), periods=len(closes_a), freq="B")

    async def fake_load_price_frame(db, symbol, start_date, end_date, source, adjustment_mode="raw"):
        closes = closes_a if symbol == "AAA" else closes_b
        return pd.DataFrame(
            {"time": dates, "open": closes, "high": closes, "low": closes, "close": closes, "volume": [1] * len(closes)}
        )

    monkeypatch.setattr("vnibb.api.v1.quant._load_price_frame", fake_load_price_frame)

    response = await client.get("/api/v1/quant/AAA/pair/BBB")
    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["metric"] == "pair_diagnostics"
    assert payload["data"]["symbol"] == "AAA"
    assert payload["data"]["pair_symbol"] == "BBB"
    assert payload["data"]["aligned_days"] >= 60
    assert payload["data"]["hedge_ratio_ols"] is not None

