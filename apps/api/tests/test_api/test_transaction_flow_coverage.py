from datetime import date

import pytest

from vnibb.models.trading import OrderFlowDaily


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "scope,completed,expected_scope",
    [("sampled", False, "sampled"), ("unknown", False, "unknown"),
     ("full_session", False, "unknown"), ("full_session", True, "full_session")],
)
async def test_transaction_flow_separates_observed_sample_from_session_totals(
    client, test_db, scope, completed, expected_scope
):
    coverage = {
        "scope": scope,
        "status": "complete_session" if completed else scope,
        "completed_session": completed,
        "observed_trade_count": 2,
        "session_fraction": None,
        "denominator_trade_count": None,
        "sql_flows": "persisted",
        "sql_ticks": "disabled",
        "mongo_ticks": "failed",
        "current_depth": "unknown",
    }
    test_db.add(OrderFlowDaily(
        id=950,
        symbol="SAMPLE", trade_date=date(2026, 10, 12),
        buy_volume=100, sell_volume=80, buy_value=1000, sell_value=800,
        foreign_net_volume=1000, proprietary_net_volume=0,
        block_trade_count=0, coverage=coverage,
    ))
    await test_db.commit()

    response = await client.get("/api/v1/equity/SAMPLE/transaction-flow?days=5")

    assert response.status_code == 200
    point = response.json()["data"]["data"][0]
    assert point["coverage"] == coverage
    assert point["flow_scope"] == expected_scope
    assert point["observed_buy_volume"] == 100
    assert point["observed_sell_volume"] == 80
    assert point["observed_volume"] == 180
    assert point["observed_net_volume"] == 20
    assert point["observed_net_value"] == 200
    assert point["total_volume"] == (180 if completed else None)
    assert point["total_net_volume"] == (20 if completed else None)
    assert point["total_net_value"] == (200 if completed else None)
    assert point["domestic_net_volume"] == (-980 if completed else None)
    assert point["proprietary_net_volume"] == 0
    assert point["block_trade_count"] == 0


@pytest.mark.asyncio
async def test_transaction_flow_legacy_coverage_and_unavailable_buckets_are_not_zero(client, test_db):
    test_db.add(OrderFlowDaily(
        id=951,
        symbol="LEGACY", trade_date=date(2026, 10, 12),
        buy_volume=100, sell_volume=80, proprietary_net_volume=None,
        block_trade_count=None,
    ))
    await test_db.commit()

    response = await client.get("/api/v1/equity/LEGACY/transaction-flow?days=5")

    point = response.json()["data"]["data"][0]
    assert point["coverage"] is None
    assert point["flow_scope"] == "unknown"
    assert point["observed_net_volume"] == 20
    assert point["total_net_volume"] is None
    assert point["domestic_net_volume"] is None
    assert point["proprietary_net_volume"] is None
    assert point["block_trade_count"] is None


@pytest.mark.asyncio
async def test_market_flow_coverage_rejects_sampled_buckets(client, test_db):
    test_db.add_all([
        OrderFlowDaily(id=952, symbol="SAMPLE", trade_date=date.today(), net_volume=20,
                       foreign_net_volume=10, proprietary_net_volume=0,
                       coverage={"scope": "sampled", "completed_session": False}),
        OrderFlowDaily(id=953, symbol="SESSION", trade_date=date.today(), net_volume=20,
                       foreign_net_volume=10, proprietary_net_volume=0,
                       coverage={"scope": "full_session", "completed_session": True}),
    ])
    await test_db.commit()

    response = await client.get("/api/v1/market/flow-coverage?days=7")

    assert response.json()["data"] == [{"symbol": "SESSION", "days_with_buckets": 1}]
    assert response.json()["symbols_unavailable"] == 1


@pytest.mark.asyncio
async def test_transaction_flow_one_sided_sample_has_no_gross_total(client, test_db):
    test_db.add(OrderFlowDaily(
        id=954, symbol="ONESIDE", trade_date=date(2026, 10, 12),
        buy_volume=0, buy_value=0, coverage={"scope": "sampled", "completed_session": False},
    ))
    await test_db.commit()

    response = await client.get("/api/v1/equity/ONESIDE/transaction-flow?days=5")

    point = response.json()["data"]["data"][0]
    assert point["observed_buy_volume"] == 0
    assert point["observed_sell_volume"] is None
    assert point["observed_volume"] is None
    assert point["observed_gross_value"] is None
    assert point["total_volume"] is None
