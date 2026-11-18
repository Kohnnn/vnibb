from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import pytest
from vnibb.api.v1 import screener
from vnibb.services.market_session import qualify_market_session


@pytest.mark.parametrize("case", ["traded", "no_trade", "price_mismatch", "future", "unqualified"])
def test_screener_projects_only_verified_match_price_time(monkeypatch, case):
    session = date(2026, 11, 18)
    tick = "2026-11-18T08:00:00Z"
    received = "2026-11-18T08:00:02Z"
    observed = datetime(2026, 11, 18, 8, 0, 3, tzinfo=UTC)
    now = observed - timedelta(seconds=1) if case == "future" else observed + timedelta(seconds=1)

    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz)

    monkeypatch.setattr(screener, "datetime", FrozenDatetime)
    no_trade = case == "no_trade"
    price = 60_000
    volume = 0 if no_trade else 12
    raw = {
        "listingInfo": {
            "symbol": "FPT", "ticker": "FPT", "type": "STOCK", "stockType": "STOCK",
            "isDelisted": 0, "tradingDate": session.isoformat(), "receivedTime": received,
        },
        "bidAsk": {"symbol": "FPT", "session": "ENDED", "time": tick, "receivedTime": received},
        "matchPrice": {
            "symbol": "FPT", "session": "ENDED", "time": tick, "receivedTime": received,
            "openPrice": None if no_trade else price, "highest": 0 if no_trade else price,
            "lowest": 0 if no_trade else price, "matchPrice": 0 if no_trade else price,
            "accumulatedVolume": volume,
        },
    }
    qualified = qualify_market_session(raw, "FPT", session, observed)
    assert qualified is not None
    metrics = {"price_unit": "VND", "price_source": "vietcap_vnd"}
    if case != "unqualified":
        metrics["market_session"] = qualified
    snapshot = SimpleNamespace(
        symbol="FPT", trade_date=session - timedelta(days=1) if no_trade else session,
        price=price + 100 if case == "price_mismatch" else price, volume=volume,
        extended_metrics=metrics,
    )
    rows = screener.apply_advanced_filters(
        [screener._to_screener_data_row(snapshot)],
        filters='{"logic":"AND","conditions":[{"field":"price","operator":"gte","value":50000}]}',
    )
    (row,) = rows
    payload = row.model_dump(mode="json")["market_session"]
    if case == "traded":
        assert payload == {
            "session_date": session.isoformat(), "status": "traded", "source": "vietcap",
            "scope": "vietcap_board", "match_as_of": tick,
        }
    elif case == "no_trade":
        assert payload["status"] == "no_trade"
        assert "match_as_of" not in payload
    else:
        assert payload is None
