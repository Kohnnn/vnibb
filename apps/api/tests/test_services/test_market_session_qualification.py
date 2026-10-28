from copy import deepcopy
from datetime import UTC, date, datetime
from unittest.mock import Mock

import pytest
from vnibb.core.config import settings
from vnibb.services.market_session import (
    expected_market_session,
    qualify_market_session,
    session_coverage,
)
from vnibb.services.vietcap_client import TRADING_BASE, VietcapClient

SESSION = date(2026, 10, 26)
OBSERVED = datetime(2026, 10, 26, 8, 12, tzinfo=UTC)


def _raw(*, suspended=False):
    return {
        "listingInfo": {
            "symbol": "AAA", "ticker": "AAA", "stockType": "STOCK", "type": "STOCK",
            "isDelisted": 0, "tradingDate": SESSION.isoformat(),
            "receivedTime": "2026-10-26T01:44:00Z",
            "tradingStatus": "TRADING_SUSPENSION" if suspended else "TRADING_ACTIVATED",
            "tradingStatusCode": "110" if suspended else "20",
            "securityStatus": "Y" if suspended else "N",
        },
        "bidAsk": {
            "symbol": "AAA", "session": "ENDED", "time": "2026-10-26T08:00:00Z",
            "receivedTime": "2026-10-26T08:00:03Z",
        },
        "matchPrice": {
            "symbol": "AAA", "session": "ENDED", "time": "2026-10-26T08:00:00Z",
            "receivedTime": "2026-10-26T08:00:03Z", "openPrice": None if suspended else 10,
            "highest": 0 if suspended else 11, "lowest": 0 if suspended else 9,
            "matchPrice": 0 if suspended else 10, "accumulatedVolume": 0 if suspended else 100,
        },
    }


def test_expected_session_uses_ict_close_official_and_configured_closures(monkeypatch):
    monkeypatch.setattr(settings, "vn_timezone", "Asia/Ho_Chi_Minh")
    monkeypatch.setattr(settings, "intraday_market_close", "15:00")
    monkeypatch.setattr(settings, "market_holiday_dates", ["2026-10-23"])
    assert expected_market_session(now=datetime(2026, 10, 26, 7, 59, tzinfo=UTC)) == date(2026, 10, 22)
    assert expected_market_session(now=datetime(2026, 10, 26, 8, tzinfo=UTC)) == SESSION
    assert expected_market_session(now=datetime(2026, 1, 2, 9, tzinfo=UTC)) == date(2025, 12, 31)


def test_preclose_observation_cannot_certify_an_ended_current_session():
    raw = _raw()
    for section in (raw["bidAsk"], raw["matchPrice"]):
        section["time"] = "2026-10-26T07:00:00Z"
        section["receivedTime"] = "2026-10-26T07:00:03Z"
    assert qualify_market_session(raw, "AAA", SESSION, OBSERVED.replace(hour=7, minute=30)) is None


def test_ended_book_qualifies_current_actual_trade_without_rewriting_match_session():
    raw = _raw()
    raw["matchPrice"].update({
        "session": "LO_AFTERNOON", "time": "2026-10-26T07:55:00.573Z",
        "receivedTime": "2026-10-26T07:55:00.606Z",
    })
    record = qualify_market_session(raw, "AAA", SESSION, OBSERVED)
    assert record is not None and record["raw"] == raw
    assert session_coverage(record, "AAA", SESSION) == "traded"
    raw["matchPrice"].update({"accumulatedVolume": 0, "openPrice": None, "highest": 0, "lowest": 0, "matchPrice": 0})
    assert qualify_market_session(raw, "AAA", SESSION, OBSERVED) is None


def test_suspension_keeps_old_raw_price_but_never_erases_positive_volume():
    raw = _raw(suspended=True)
    raw["matchPrice"].update({
        "time": "2026-10-20T08:00:00Z", "receivedTime": None,
        "openPrice": 10, "highest": 11, "lowest": 9, "matchPrice": 10,
    })
    record = qualify_market_session(raw, "AAA", SESSION, OBSERVED)
    assert record is not None and record["raw"] == raw
    assert session_coverage(record, "AAA", SESSION) == "suspended"
    raw["matchPrice"]["accumulatedVolume"] = 1
    assert qualify_market_session(raw, "AAA", SESSION, OBSERVED) is None
    record["raw"]["matchPrice"]["accumulatedVolume"] = True
    assert session_coverage(record, "AAA", SESSION) is None


@pytest.mark.parametrize("damage", ["zero_price", "stale_received", "future_clock", "identity", "scope"])
def test_stored_session_revalidates_native_raw(damage):
    record = qualify_market_session(_raw(), "AAA", SESSION, OBSERVED)
    damaged = deepcopy(record)
    if damage == "zero_price":
        damaged["raw"]["matchPrice"]["lowest"] = 0
    elif damage == "stale_received":
        damaged["raw"]["matchPrice"]["receivedTime"] = "2026-10-23T08:00:03Z"
    elif damage == "future_clock":
        damaged["raw"]["bidAsk"]["time"] = "2026-10-26T08:13:00Z"
    elif damage == "identity":
        damaged["raw"]["listingInfo"]["ticker"] = "BBB"
    else:
        damaged["scope"] = "whole_market"
    assert session_coverage(damaged, "AAA", SESSION) is None


def test_price_board_posts_normalized_unique_membership_and_rejects_partial_response():
    client = VietcapClient()
    row = _raw()
    client._request = Mock(return_value=[row])
    assert client.get_price_board([" aaa ", "AAA"]) == [row]
    client._request.assert_called_once_with(
        "POST", f"{TRADING_BASE}/api/price/symbols/getList", TRADING_BASE, json_body={"symbols": ["AAA"]},
    )
    client._request.return_value = [row, row]
    with pytest.raises(ValueError):
        client.get_price_board(["AAA"])
    client._request.return_value = []
    with pytest.raises(ValueError):
        client.get_price_board(["AAA"])
