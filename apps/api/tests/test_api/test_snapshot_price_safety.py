import json
from datetime import date, timedelta
from unittest.mock import AsyncMock

import httpx
import pytest

from vnibb.core.config import settings
from vnibb.mcp import server
from vnibb.services.ai_context_service import (
    AIContextService,
    _build_flow_context,
    _build_price_context,
)


def sessions(count, end=date(2026, 10, 13), holidays=()):
    days = []
    while len(days) < count:
        if end.weekday() < 5 and end.isoformat() not in holidays:
            days.append(end)
        end -= timedelta(days=1)
    return list(reversed(days))


def prices(count=7, holidays=()):
    return [{"time": day.isoformat(), "close": 100 + index, "volume": 100,
             "source": "vnstock_vnd:VCI"} for index, day in enumerate(sessions(count, holidays=holidays))]


@pytest.mark.parametrize("value", [None, float("nan"), float("inf"), -float("inf")])
@pytest.mark.parametrize("index", [3, -1])
def test_missing_or_nonfinite_close_never_compresses_sessions_or_promotes_latest(value, index):
    rows = prices()
    rows[index]["close"] = value
    context = _build_price_context(list(reversed(rows)))
    assert context["latest"]["time"] == rows[-1]["time"]
    assert context["summary"]["change_5d_pct"] is None
    assert context["summary"]["return_windows"]["5d"]["start_date"] == rows[1]["time"]
    assert context["summary"]["return_windows"]["5d"]["end_date"] == rows[-1]["time"]
    assert context["summary"]["return_windows"]["5d"]["status"] == "unavailable"
    assert context["limitations"]
    if index == -1:
        assert context["latest"]["close"] is None
    json.dumps(context, allow_nan=False)


def test_missing_session_cannot_rename_horizon():
    rows = prices()
    del rows[3]
    context = _build_price_context(rows)
    assert context["summary"]["change_5d_pct"] is None
    assert context["summary"]["return_windows"]["5d"]["reason"] == "missing_exchange_sessions"


def test_configured_closures_are_not_missing_observations(monkeypatch):
    holidays = ["2026-10-09"]
    monkeypatch.setattr(settings, "market_holiday_dates", holidays)
    rows = prices(6, holidays)
    context = _build_price_context(rows)
    assert context["summary"]["change_5d_pct"] == 5.0
    window = context["summary"]["return_windows"]["5d"]
    assert window["status"] == "available"
    assert window["expected_dates"] == [row["time"] for row in rows]
    assert window["start_date"] == rows[0]["time"] and window["end_date"] == rows[-1]["time"]
    assert window["expected_observations"] == 6 and window["observed_observations"] == 6


@pytest.mark.parametrize("end,configured,verified", [
    (date(2026, 4, 28), [], True),
    (date(2026, 4, 29), ["2026-04-28"], True),
    (date(2026, 1, 5), [], False),
    (date(2027, 1, 4), ["2027-01-01"], False),
])
def test_official_closures_preserve_price_windows_without_certifying_unverified_years(
    monkeypatch, end, configured, verified
):
    monkeypatch.setattr(settings, "market_holiday_dates", configured)
    days = sessions(21, end=end, holidays=["2026-01-01", "2026-01-02", "2026-04-27", *configured])
    rows = [{"time": day.isoformat(), "close": 100 + index, "volume": 100,
             "source": "vnstock_vnd:VCI"} for index, day in enumerate(days)]

    context = _build_price_context(rows)

    assert context["summary"]["change_20d_pct"] == 20.0
    assert context["summary"]["change_5d_pct"] == 4.35
    assert context["summary"]["average_volume_20d"] == 100
    assert context["summary"]["return_windows"]["20d"]["expected_dates"] == [row["time"] for row in rows]
    assert context["summary"]["range_window_20d"]["status"] == "available"
    assert context["calendar"]["exchange_calendar_verified"] is verified
    assert "HOSE/HNX 2026" in context["calendar"]["holiday_source"]

    context = _build_price_context(rows[:10] + rows[11:])
    assert context["summary"]["change_20d_pct"] is None
    assert context["summary"]["return_windows"]["20d"]["reason"] == "missing_exchange_sessions"


def test_unknown_and_conflicting_observations_are_unavailable_without_move_clamping():
    rows = prices(6)
    rows[-1]["close"] = 100000
    assert _build_price_context(rows)["summary"]["change_5d_pct"] == 99900.0
    rows[2]["source"] = "unknown-provider"
    context = _build_price_context(rows)
    assert context["summary"]["change_5d_pct"] is None
    assert context["excluded_unknown_unit_rows"] == 1
    rows[2]["source"] = "vnstock_vnd:VCI"
    rows.append({**rows[2], "close": 200})
    assert _build_price_context(rows)["summary"]["change_5d_pct"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["symbol", "market"])
@pytest.mark.parametrize("value,index", [(None, 3), (float("nan"), 3), (float("inf"), -1), (None, -1)])
async def test_public_snapshot_handlers_never_dispatch_to_configured_sidecar(monkeypatch, kind, value, index):
    monkeypatch.setattr(settings, "vnibb_mcp_url", "http://mcp:8001/mcp")
    client = server.AIContextService
    outbound = AsyncMock(side_effect=AssertionError("self-call attempted"))
    monkeypatch.setattr("vnibb.services.ai_context_service.vnibb_mcp_client_service._call_tool", outbound)
    monkeypatch.setattr(server, "_ensure_database_available", AsyncMock())
    rows = prices()
    rows[index]["close"] = value
    snapshot = {"symbol": "VNM", "source": "postgres", "price_context": _build_price_context(rows)}
    if kind == "symbol":
        monkeypatch.setattr(client, "_build_postgres_snapshot", AsyncMock(return_value=snapshot))
        response = await server.get_symbol_snapshot("VNM")
    else:
        snapshot = {"source": "postgres", "indices": [{"index_code": "VNINDEX", "close": 1000}]}
        monkeypatch.setattr(client, "_build_postgres_market_snapshot", AsyncMock(return_value=snapshot))
        response = await server.get_market_snapshot()
    json.dumps(response, allow_nan=False)
    assert response["snapshot"] == snapshot
    outbound.assert_not_awaited()


def test_sampled_order_flow_preserves_receipt_and_unknown_fields_without_claiming_totals():
    context = _build_flow_context([
        {"trade_date": "2026-10-12", "buy_volume": 10, "sell_volume": 2, "net_volume": 8,
         "coverage": {"scope": "full_session", "completed_session": True}},
        {"trade_date": "2026-10-13", "buy_volume": 4, "sell_volume": 1, "net_volume": 3,
         "proprietary_net_volume": None, "block_trade_count": None,
         "coverage": {"scope": "sampled", "completed_session": False, "session_fraction": None}},
    ], extra_fields=("proprietary_net_volume", "block_trade_count"), require_complete_session=True)
    latest = context["latest_session"]
    assert latest["observed_buy_volume"] == 4
    assert latest["buy_volume"] is None
    assert latest["coverage"]["scope"] == "sampled"
    assert latest["proprietary_net_volume"] is None
    assert latest["block_trade_count"] is None
    assert context["summary"]["net_volume_5d"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["symbol", "market"])
@pytest.mark.parametrize("enabled,error", [(False, None), (True, None), (True, RuntimeError("provider failed")),
                                          (True, httpx.ReadTimeout("remote timed out"))])
async def test_runtime_remote_fallback_is_nonrecursive_and_preserves_real_database_errors(monkeypatch, kind, enabled, error):
    monkeypatch.setattr(settings, "vnibb_mcp_url", "https://distinct-remote.invalid/mcp" if enabled else "")
    service = AIContextService()
    remote_snapshot = {"source": "remote", "company": {"symbol": "VNM"}}
    remote = AsyncMock(return_value={"snapshot": remote_snapshot}, side_effect=error)
    local = AsyncMock(return_value={"source": "postgres", "company": {"symbol": "VNM"}})
    if kind == "symbol":
        monkeypatch.setattr("vnibb.services.ai_context_service.vnibb_mcp_client_service.get_symbol_snapshot", remote)
        monkeypatch.setattr(service, "_build_postgres_snapshot", local)
        async def invoke():
            return await service._build_symbol_snapshot("VNM", prefer_database_data=True)
    else:
        monkeypatch.setattr("vnibb.services.ai_context_service.vnibb_mcp_client_service.get_market_snapshot", remote)
        monkeypatch.setattr(service, "_build_postgres_market_snapshot", local)
        async def invoke():
            return await service._build_market_snapshot(prefer_database_data=True)
    result = await invoke()
    assert result["source"] == ("remote" if enabled and error is None else "postgres")
    assert remote.await_count == int(enabled)
    local.side_effect = RuntimeError("database unavailable")
    with pytest.raises(RuntimeError, match="database unavailable"):
        await invoke()


@pytest.mark.parametrize("kind", ["missing", "nonfinite", "gap", "incoherent_unit"])
def test_price_trend_chart_is_unavailable_without_a_complete_certified_window(kind):
    from vnibb.services.ai_artifact_service import _price_trend_chart

    rows = prices(21)
    if kind == "missing":
        rows[10]["close"] = None
    elif kind == "nonfinite":
        rows[-1]["close"] = float("inf")
    elif kind == "gap":
        del rows[10]
    else:
        rows[10]["close"] = 999
        rows[10]["source"] = "vnstock"
    context = _build_price_context(rows)
    assert context["summary"]["range_window_20d"]["status"] == "unavailable"
    assert _price_trend_chart([{"symbol": "VNM", "price_context": context}]) == ([], [], [])


def test_price_trend_chart_uses_exact_certified_sessions_and_base_100():
    from vnibb.services.ai_artifact_service import _price_trend_chart

    context = _build_price_context(prices(21))
    window = context["summary"]["range_window_20d"]
    assert window["status"] == "available"
    chart_rows, series, source_ids = _price_trend_chart([{"symbol": "VNM", "price_context": context}])
    assert [row["date"] for row in chart_rows] == window["expected_dates"]
    assert chart_rows[0]["VNM"] == 100.0
    assert series[0]["key"] == "VNM" and series[0]["label"] == "VNM Base 100"
    assert source_ids == []
    json.dumps(chart_rows, allow_nan=False)

@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["symbol", "market"])
async def test_public_snapshot_database_failure_is_not_a_successful_empty_snapshot(monkeypatch, kind):
    monkeypatch.setattr(server, "_ensure_database_available", AsyncMock())
    method = "_build_postgres_snapshot" if kind == "symbol" else "_build_postgres_market_snapshot"
    monkeypatch.setattr(server.AIContextService, method, AsyncMock(side_effect=RuntimeError("database failed")))
    with pytest.raises(RuntimeError, match="database failed"):
        if kind == "symbol":
            await server.get_symbol_snapshot("VNM")
        else:
            await server.get_market_snapshot()
