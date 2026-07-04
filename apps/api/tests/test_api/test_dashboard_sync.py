"""Regression guard for the dashboard-sync 422 bug.

Phase 0 made two complementary fixes:

* frontend `useDashboardSync.toBackendPayload` strips null/undefined keys
  and skips PATCH for non-numeric (i.e. still-local) placeholder dashboard
  IDs (`dash-xxx`);
* backend `DashboardUpdate` now declares `model_config.extra="forbid"` so
  future contract drift fails loudly rather than silently accepting data.

These tests assert the frontend half indirectly: we round-trip a small but
realistic patch body through Pydantic and confirm both the happy path and
that unknown fields are rejected with 422.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from vnibb.api.v1.dashboard import DashboardUpdate


def _good_payload() -> dict:
    return {
        "name": "Main",
        "is_default": True,
        "layout_config": {
            "tabs": [
                {
                    "id": "tab-1",
                    "name": "Overview",
                    "widgets": [
                        {
                            "widget_id": "w-polymarket",
                            "widget_type": "polymarket",
                            "layout": {"i": "w-polymarket", "x": 0, "y": 0, "w": 8, "h": 7},
                        }
                    ],
                }
            ],
            "syncGroups": [],
            "showGroupLabels": True,
            "folderId": "folder-main",
            "order": 0,
        },
    }


def test_dashboard_update_accepts_canonical_payload():
    """The payload shape that useDashboardSync sends round-trips cleanly."""
    payload = _good_payload()
    parsed = DashboardUpdate.model_validate(payload)
    assert parsed.name == "Main"
    assert parsed.is_default is True
    assert parsed.layout_config is not None
    assert parsed.layout_config["order"] == 0
    assert parsed.layout_config["tabs"][0]["widgets"][0]["widget_type"] == "polymarket"


def test_dashboard_update_rejects_unknown_top_level_keys():
    """Strict mode (`extra=forbid`) catches frontend contract drift early."""
    bad = _good_payload()
    bad["mystery_field"] = "drift"
    with pytest.raises(ValidationError) as exc_info:
        DashboardUpdate.model_validate(bad)
    assert "mystery_field" in str(exc_info.value)


def test_dashboard_update_handles_optional_description():
    """`description` is Optional[str]; omitting it must not 422."""
    payload = _good_payload()
    parsed = DashboardUpdate.model_validate(payload)
    assert parsed.description is None

    payload["description"] = "primary"
    parsed = DashboardUpdate.model_validate(payload)
    assert parsed.description == "primary"
