from datetime import datetime

import pytest

from vnibb.api.v1.websocket import get_market_status, is_market_open


@pytest.mark.parametrize(
    ("hour", "minute", "phase", "is_open"),
    [
        (8, 59, "pre-open", False),
        (9, 0, "morning", True),
        (11, 29, "morning", True),
        (11, 30, "lunch", False),
        (12, 59, "lunch", False),
        (13, 0, "afternoon", True),
        (14, 44, "afternoon", True),
        (14, 45, "post-close", False),
        (14, 59, "post-close", False),
        (15, 0, "after-close", False),
    ],
)
def test_market_status_uses_canonical_session_boundaries(hour, minute, phase, is_open):
    status = get_market_status(datetime(2026, 7, 13, hour, minute))

    assert status["phase"] == phase
    assert status["is_open"] is is_open
    assert is_market_open(datetime(2026, 7, 13, hour, minute)) is is_open


def test_market_status_closes_on_weekends():
    status = get_market_status(datetime(2026, 7, 11, 9, 0))

    assert status["phase"] == "weekend"
    assert status["is_open"] is False
    assert status["message"] == "Market is closed for the weekend"
