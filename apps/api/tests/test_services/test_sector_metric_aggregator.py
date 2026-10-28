from datetime import date

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from vnibb.core.market_cap import reconcile_market_caps, resolve_market_cap
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock
from vnibb.models.trading import FinancialRatio
from vnibb.services import sector_metric_aggregator


def certified_cap(value, day):
    return {
        "market_cap": value,
        "market_cap_source": "issuer:cap",
        "market_cap_unit": "VND",
        "market_cap_currency": "VND",
        "market_cap_as_of": day.isoformat(),
        "outstanding_shares": 100,
        "shares_unit": "shares",
        "shares_as_of": day.isoformat(),
        "shares_source": "issuer:shares",
        "share_basis": "outstanding",
    }


@pytest.mark.asyncio
async def test_aggregation_uses_latest_eligible_snapshots_and_cap_specific_coverage(test_db, test_engine, monkeypatch):
    target = date(2026, 2, 22)
    earlier = date(2026, 2, 21)
    future = date(2026, 2, 23)
    conflict = reconcile_market_caps(
        resolve_market_cap(certified_cap(900, target), source="one"),
        resolve_market_cap(certified_cap(1000, target), source="two"),
    )
    stocks = [("A1", "Mixed"), ("A2", "Mixed"), ("A3", "Mixed"), ("A4", "Mixed"),
              ("B1", "Sparse"), ("B2", "Sparse"), ("B3", "Sparse")]
    for index, (symbol, industry) in enumerate(stocks, start=1):
        test_db.add(Stock(symbol=symbol, company_name=symbol, exchange="HOSE", industry=industry))
        test_db.add(FinancialRatio(id=index, symbol=symbol, period="2025", period_type="year",
                                   fiscal_year=2025, pe_ratio=index * 10))
    test_db.add_all([
        ScreenerSnapshot(symbol="A1", snapshot_date=target, market_cap=100,
                         dividend_yield=1, extended_metrics=certified_cap(100, target)),
        ScreenerSnapshot(symbol="A1", snapshot_date=earlier, market_cap=5000,
                         dividend_yield=99, extended_metrics=certified_cap(5000, earlier)),
        ScreenerSnapshot(symbol="A1", snapshot_date=future, market_cap=9000,
                         dividend_yield=99, extended_metrics=certified_cap(9000, future)),
        ScreenerSnapshot(symbol="A2", snapshot_date=earlier, market_cap=200,
                         dividend_yield=2, extended_metrics=certified_cap(200, earlier)),
        ScreenerSnapshot(symbol="A3", snapshot_date=target, market_cap=300,
                         dividend_yield=3, extended_metrics=certified_cap(300, target)),
        ScreenerSnapshot(symbol="A4", snapshot_date=target, market_cap=900,
                         dividend_yield=4, extended_metrics={"market_cap_provenance": conflict}),
        ScreenerSnapshot(symbol="B1", snapshot_date=target, market_cap=100,
                         extended_metrics=certified_cap(100, target)),
        ScreenerSnapshot(symbol="B2", snapshot_date=target, market_cap=200,
                         extended_metrics=certified_cap(200, target)),
        ScreenerSnapshot(symbol="B3", snapshot_date=target, market_cap=10000),
    ])
    await test_db.commit()
    monkeypatch.setattr(sector_metric_aggregator, "async_session_maker",
                        async_sessionmaker(test_engine, expire_on_commit=False))

    results = {item.industry_name: item for item in
               await sector_metric_aggregator.aggregate_sector_metrics(target)}
    mixed = results["Mixed"]
    assert mixed.sample_size == 4
    assert mixed.avg_pe == 25
    assert mixed.avg_dividend_yield == 2.5
    assert mixed.market_cap_sample_size == 3
    assert mixed.avg_market_cap == 200
    assert mixed.market_cap_provenance["A1"]["snapshot_date"] == "2026-02-22"
    assert mixed.market_cap_provenance["A2"]["as_of"] == "2026-02-21"
    assert mixed.market_cap_provenance["A4"]["status"] == "conflict"
    assert len(mixed.market_cap_provenance["A4"]["observations"]) == 2
    sparse = results["Sparse"]
    assert sparse.sample_size == 3 and sparse.avg_pe == 60
    assert sparse.market_cap_sample_size == 2 and sparse.avg_market_cap is None
    assert sparse.market_cap_provenance["B3"]["status"] == "unavailable"
    assert sparse.market_cap_provenance["B3"]["observations"][0]["value"] == 10000
    assert sparse.to_db_dict()["avg_market_cap"] is None
