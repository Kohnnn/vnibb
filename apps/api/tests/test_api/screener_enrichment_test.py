from __future__ import annotations

from types import SimpleNamespace

import pytest

from vnibb.api.v1.screener import _enrich_screener_metrics
from vnibb.providers.vnstock.equity_screener import ScreenerData


class _FakeResult:
    def __init__(self, rows: list[object]):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _NoQueryDB:
    def __init__(self):
        self.calls = 0

    async def execute(self, *_args, **_kwargs):
        self.calls += 1
        raise AssertionError("DB should not be queried for this scenario")


class _RecordingDB:
    def __init__(self):
        self.queries: list[str] = []

    async def execute(self, statement):
        query = str(statement).lower()
        self.queries.append(query)

        if "stock_prices" in query:
            raise AssertionError(
                "Price query should not run when only fundamental enrichment is needed"
            )

        if "financial_ratios" in query:
            ratio = SimpleNamespace(
                symbol="VNM",
                raw_data={},
                roic=12.5,
                fiscal_year=2024,
                fiscal_quarter=4,
                updated_at=None,
                ev_ebitda=None,
                operating_margin=None,
                revenue_growth=None,
                earnings_growth=None,
                debt_to_assets=None,
                dps=None,
            )
            return _FakeResult([ratio])

        return _FakeResult([])


@pytest.mark.asyncio
async def test_enrich_skips_database_when_only_updated_at_missing():
    row = ScreenerData(
        symbol="VNM",
        revenue_growth=5.0,
        earnings_growth=6.0,
        operating_margin=10.0,
        ev_ebitda=8.0,
        roic=12.0,
        dividend_yield=1.5,
        change_1d=0.5,
        perf_1w=1.2,
        perf_1m=3.4,
        perf_ytd=9.1,
        debt_to_asset=0.3,
        equity_on_total_asset=0.5,
        market_cap=1_000_000_000,
        updated_at=None,
    )
    db = _NoQueryDB()

    result = await _enrich_screener_metrics([row], db)  # type: ignore[arg-type]

    assert db.calls == 0
    assert len(result) == 1
    assert result[0].symbol == "VNM"
    assert result[0].updated_at is None


@pytest.mark.asyncio
async def test_enrich_skips_price_query_for_fundamental_only_gap():
    row = ScreenerData(
        symbol="VNM",
        revenue_growth=5.0,
        earnings_growth=6.0,
        operating_margin=10.0,
        ev_ebitda=8.0,
        roic=None,
        dividend_yield=1.5,
        change_1d=0.5,
        perf_1w=1.2,
        perf_1m=3.4,
        perf_ytd=9.1,
        debt_to_asset=0.3,
        equity_on_total_asset=0.5,
        market_cap=1_000_000_000,
    )
    db = _RecordingDB()

    result = await _enrich_screener_metrics([row], db)  # type: ignore[arg-type]

    assert len(result) == 1
    assert result[0].roic == 12.5
    assert any("financial_ratios" in query for query in db.queries)
    assert all("stock_prices" not in query for query in db.queries)
