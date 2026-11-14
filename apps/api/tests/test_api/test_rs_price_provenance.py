"""#251: RS ranking rows carry the stored price's own unit, source and dates."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest

from vnibb.api.v1.rs_rating import RSGainerItem, RSStockItem
from vnibb.models.stock import StockPrice
from vnibb.services import rs_rating_service
from vnibb.services.rs_rating_service import RSRatingService


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def scalar(self):
        return self.rows[0] if self.rows else None

    def scalars(self):
        return self

    def all(self):
        return self.rows

    def __iter__(self):
        return iter(self.rows)


class _Session:
    def __init__(self, results):
        self.results = iter(results)
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _Result(next(self.results))

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


def _snapshot(symbol, price, metrics, *, snapshot_date=date(2026, 3, 10), trade_date=None):
    return SimpleNamespace(
        symbol=symbol,
        company_name=symbol,
        rs_rating=90,
        rs_rank=1,
        price=price,
        industry="Technology",
        extended_metrics=metrics,
        snapshot_date=snapshot_date,
        trade_date=trade_date,
    )


@pytest.mark.asyncio
async def test_stored_leaders_keep_the_price_own_unit_source_and_date(monkeypatch):
    rows = [
        _snapshot("TBX", 10000, {"price_unit": "VND", "price_source": "vnstock_vnd:KBS"},
                  trade_date=date(2026, 3, 9)),
        _snapshot("THD", 113.5, {}),
        _snapshot("VNM", 0.5, {"price_unit": "thousand_vnd"}),
        _snapshot("VNINDEX", 1240, {"price_unit": "index_points"}),
    ]
    session = _Session([[date(2026, 3, 10)], rows])
    monkeypatch.setattr(rs_rating_service, "get_db_context", lambda: session)

    leaders = await RSRatingService().get_rs_leaders()

    by_symbol = {item["symbol"]: RSStockItem.model_validate(item).model_dump() for item in leaders}
    assert by_symbol["TBX"]["price"] == 10000
    assert by_symbol["TBX"]["price_unit"] == "VND"
    assert by_symbol["TBX"]["price_source"] == "vnstock_vnd:KBS"
    assert by_symbol["TBX"]["price_asof"] == "2026-03-09"
    assert by_symbol["TBX"]["rating_asof"] == "2026-03-10"
    # An unknown unit keeps its number for the raw record, but the consumer sees
    # the admission marker rather than a unit inferred from 113.5's magnitude.
    # The price carries no trade date, so its observation date stays unknown
    # instead of borrowing the ranking's calculation day.
    assert by_symbol["THD"]["price"] == 113.5
    assert by_symbol["THD"]["price_unit"] == "unknown"
    assert by_symbol["THD"]["price_asof"] is None
    assert by_symbol["VNM"]["price"] == 500
    assert by_symbol["VNM"]["price_unit"] == "VND"
    assert by_symbol["VNINDEX"]["price_unit"] == "index_points"


@pytest.mark.asyncio
async def test_stored_laggards_and_gainers_disclose_the_same_units(monkeypatch):
    laggard = _snapshot("THD", 113.5, {})
    session = _Session([[date(2026, 3, 10)], [laggard]])
    monkeypatch.setattr(rs_rating_service, "get_db_context", lambda: session)

    laggards = await RSRatingService().get_rs_laggards()
    assert laggards[0]["price"] == 113.5
    assert laggards[0]["price_unit"] == "unknown"

    current = _snapshot("THD", 113.5, {}, trade_date=date(2026, 3, 10))
    previous = _snapshot("THD", 1, {"price_unit": "VND"}, snapshot_date=date(2026, 3, 3))
    previous.rs_rating = 70
    session = _Session([[date(2026, 3, 10)], [current], [previous]])
    monkeypatch.setattr(rs_rating_service, "get_db_context", lambda: session)

    gainers = await RSRatingService().get_rs_gainers()
    item = RSGainerItem.model_validate(gainers[0]).model_dump()
    assert item["price_unit"] == "unknown"
    assert item["price_asof"] == "2026-03-10"
    assert item["rating_asof"] == "2026-03-10"
    assert item["rs_rating_change"] == 20


@pytest.mark.asyncio
async def test_live_rankings_carry_persisted_price_evidence(monkeypatch):
    session = _Session([[
        SimpleNamespace(
            symbol="FPT", time=date(2026, 3, 9), open=0.5, high=0.5, low=0.5, close=0.5,
            volume=100, source="KBS", raw_data=None,
        ),
        SimpleNamespace(
            symbol="VCB", time=date(2026, 3, 9), open=80, high=80, low=80, close=80,
            volume=100, source="vnstock", raw_data=None,
        ),
    ]])

    evidence = await RSRatingService()._get_latest_price_evidence(session, ["FPT", "VCB"])

    assert session.statements[0].column_descriptions[0]["expr"] is StockPrice
    # Thousands-scale history is normalized to VND with its own source; the row
    # without declared provenance is excluded instead of being shown as VND.
    assert evidence == {
        "FPT": {
            "price": 500.0,
            "price_unit": "VND",
            "price_source": "vnstock_history:KBS",
            "price_asof": "2026-03-09",
        }
    }


@pytest.mark.asyncio
async def test_live_rankings_never_inherit_a_unit_from_the_request(monkeypatch):
    session = _Session([[]])

    async def fake_active_stocks(_self, _db):
        return [SimpleNamespace(symbol="FPT")]

    async def fake_market_returns(_self, _db, _effective_date):
        return {"3mo": 0.01}

    async def fake_weighted_returns(_self, _db, _stocks, _market_returns, _effective_date):
        return [{"symbol": "FPT", "weighted_return": 0.02}]

    monkeypatch.setattr(RSRatingService, "_get_active_stocks", fake_active_stocks)
    monkeypatch.setattr(RSRatingService, "_get_market_returns", fake_market_returns)
    monkeypatch.setattr(RSRatingService, "_calculate_all_weighted_returns", fake_weighted_returns)
    monkeypatch.setattr(
        RSRatingService, "_percentile_rank_all",
        lambda self, rows: [{**row, "rs_rating": 80, "rs_rank": 1} for row in rows],
    )
    monkeypatch.setattr(RSRatingService, "_calculate_sector_rankings", lambda self, rows: rows)

    async def no_price_evidence(_self, _db, _symbols):
        return {}

    monkeypatch.setattr(RSRatingService, "_get_latest_price_evidence", no_price_evidence)

    ranked = await RSRatingService()._build_live_rankings(session, date(2026, 3, 10))

    assert ranked[0]["price"] is None
    assert ranked[0]["price_unit"] == "unknown"
    assert ranked[0]["price_asof"] is None
    assert ranked[0]["rating_asof"] == "2026-03-10"
    item = RSStockItem.model_validate({
        "symbol": "FPT", "rs_rating": ranked[0]["rs_rating"], "rs_rank": 1,
        "price": ranked[0]["price"], "price_unit": ranked[0]["price_unit"],
        "price_asof": ranked[0]["price_asof"], "rating_asof": ranked[0]["rating_asof"],
    })
    assert item.price is None
    assert item.price_unit == "unknown"


@pytest.mark.asyncio
async def test_carried_forward_price_never_claims_the_calculation_day(monkeypatch):
    """A seed copied without a trade date must not inherit the new snapshot date.

    `_update_screener_snapshots` copies `seed.price` and `seed.trade_date` into a
    row dated `snapshot_date`. When the seed itself had no trade date, reporting
    `snapshot_date` as `price_asof` would present an older carried price as a
    fresh observation of the calculation day.
    """
    carried = SimpleNamespace(
        symbol="THD", company_name="THD", rs_rating=90, rs_rank=1,
        price=1000.0, industry="Technology", extended_metrics={"price_unit": "VND"},
        snapshot_date=date(2026, 3, 10), trade_date=None,
    )
    session = _Session([[date(2026, 3, 10)], [carried]])
    monkeypatch.setattr(rs_rating_service, "get_db_context", lambda: session)

    leaders = await RSRatingService().get_rs_leaders()
    item = RSStockItem.model_validate(leaders[0]).model_dump()

    assert item["price"] == 1000.0
    assert item["price_unit"] == "VND"
    assert item["price_asof"] is None
    # The ranking date is still disclosed, separately from the price's date.
    assert item["rating_asof"] == "2026-03-10"


def test_stored_rank_item_never_derives_price_date_from_snapshot_date():
    dated = SimpleNamespace(
        symbol="FPT", company_name="FPT", rs_rating=90, rs_rank=1, price=100.0,
        industry=None, extended_metrics={"price_unit": "VND"},
        snapshot_date=date(2026, 3, 10), trade_date=date(2026, 3, 6),
    )
    assert RSRatingService._stored_rank_item(dated)["price_asof"] == "2026-03-06"
    assert RSRatingService._stored_rank_item(dated)["rating_asof"] == "2026-03-10"

    undated = SimpleNamespace(
        symbol="FPT", company_name="FPT", rs_rating=90, rs_rank=1, price=100.0,
        industry=None, extended_metrics={"price_unit": "VND"},
        snapshot_date=date(2026, 3, 10), trade_date=None,
    )
    item = RSRatingService._stored_rank_item(undated)
    assert item["price_asof"] is None
    assert item["rating_asof"] == "2026-03-10"
