#!/usr/bin/env python3
"""Publish (or refresh) the Prediction Markets system-layout template.

Adds a single "Prediction Markets" tab to the existing dashboard family.
Mirrors the static fallback shipped in `apps/web/src/contexts/DashboardContext/
systemDashboards.ts::PREDICTION_MARKETS_TAB_TEMPLATE`.

Endpoint: ``PUT /api/v1/admin/system-layouts/default-prediction-markets``
(handler: ``apps/api/vnibb/api/v1/admin.py:save_admin_system_layout``)

Usage
-----

  python apps/api/scripts/publish_prediction_markets_layout.py \\
      --base-url https://vnibb-api.example.com \\
      --admin-key $env:VNIBB_ADMIN_LAYOUT_KEY

By default the script targets ``http://127.0.0.1:8000`` and reads the
admin key from the ``VNIBB_ADMIN_LAYOUT_KEY`` environment variable. The
``--dry-run`` flag prints the payload it would send and exits.

This script is intentionally self-contained: it does not import the
FastAPI app, so it can be run from anywhere with Python 3.11+ and the
standard library only. Network access goes through ``urllib`` to avoid
adding deps just for this one-off.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

DASHBOARD_KEY = "default-prediction-markets"
DASHBOARD_NAME = "Prediction Markets"
DEFAULT_BASE_URL = "http://127.0.0.1:8000"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def build_prediction_markets_dashboard() -> dict[str, Any]:
    """Return the canonical Prediction Markets dashboard JSON.

    Six tiles with the widget IDs introduced in Phase 7.3. The widget types
    must match `WidgetType` in `apps/web/src/types/dashboard.ts`; otherwise the
    frontend will log "widget not found" and fall back to a placeholder.
    """
    timestamp = _now_iso()

    poltil = {
        "id": "tile-polymarket-econ",
        "widget_type": "polymarket",
        "defaultConfig": {"source": "polymarket", "category": "economic", "limit": 12},
        "defaultLayout": {"i": "tile-polymarket-econ", "x": 0, "y": 0, "w": 8, "h": 7, "minW": 6, "minH": 5},
    }
    pol_sports = {
        "id": "tile-polymarket-sports",
        "widget_type": "polymarket",
        "defaultConfig": {"source": "polymarket", "category": "sports", "limit": 12},
        "defaultLayout": {"i": "tile-polymarket-sports", "x": 8, "y": 0, "w": 8, "h": 7, "minW": 6, "minH": 5},
    }
    kalshi_top = {
        "id": "tile-kalshi-top",
        "widget_type": "kalshi",
        "defaultConfig": {"source": "kalshi", "limit": 12},
        "defaultLayout": {"i": "tile-kalshi-top", "x": 0, "y": 7, "w": 8, "h": 7, "minW": 6, "minH": 5},
    }
    election = {
        "id": "tile-election-odds",
        "widget_type": "election_odds",
        "defaultConfig": {},
        "defaultLayout": {"i": "tile-election-odds", "x": 8, "y": 7, "w": 8, "h": 8, "minW": 6, "minH": 6},
    }
    macro = {
        "id": "tile-macro-calibration",
        "widget_type": "macro_calibration",
        "defaultConfig": {},
        "defaultLayout": {"i": "tile-macro-calibration", "x": 0, "y": 14, "w": 16, "h": 8, "minW": 8, "minH": 6},
    }
    movers = {
        "id": "tile-prediction-movers",
        "widget_type": "prediction_movers",
        "defaultConfig": {"windowHours": 24, "limit": 12},
        "defaultLayout": {"i": "tile-prediction-movers", "x": 16, "y": 0, "w": 8, "h": 14, "minW": 6, "minH": 9},
    }

    tab = {
        "id": "tab-prediction-markets-default",
        "name": "Prediction Markets",
        "order": 0,
        "widgets": [poltil, pol_sports, kalshi_top, election, macro, movers],
    }

    return {
        "key": DASHBOARD_KEY,
        "name": DASHBOARD_NAME,
        "description": "Phase 7 — prediction-market coverage. Polymarket, Kalshi, election odds, macro calibration, and probability movers.",
        "layout_config": {
            "tabs": [tab],
            "syncGroups": [],
            "showGroupLabels": True,
        },
        "is_default": False,
        "created_at": timestamp,
        "updated_at": timestamp,
    }


def _post_json(url: str, payload: dict[str, Any], admin_key: str | None) -> dict[str, Any]:
    headers = {"Accept": "application/json"}
    if admin_key:
        headers["X-Admin-Layout-Key"] = admin_key
    body = json.dumps(payload).encode("utf-8")
    req = urllib_request.Request(
        url,
        data=body,
        headers={**headers, "Content-Type": "application/json"},
        method="PUT",
    )
    with urllib_request.urlopen(req, timeout=15) as response:  # noqa: S310 - explicit endpoint, controlled by caller
        return json.loads(response.read().decode("utf-8") or "{}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Publish the Prediction Markets dashboard template")
    parser.add_argument("--base-url", default=os.getenv("VNIBB_API_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--admin-key", default=os.getenv("VNIBB_ADMIN_LAYOUT_KEY"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    dashboard = build_prediction_markets_dashboard()

    if args.dry_run:
        sys.stdout.write(json.dumps(dashboard, indent=2))
        return 0

    endpoint = args.base_url.rstrip("/") + f"/api/v1/admin/system-layouts/{DASHBOARD_KEY}"
    try:
        _post_json(endpoint, dashboard, args.admin_key)
    except urllib_error.HTTPError as exc:  # pragma: no cover - admin path
        sys.stderr.write(f"PUT failed: {exc.code} {exc.reason}\n")
        return 1
    sys.stdout.write(f"Published {DASHBOARD_KEY} -> {endpoint}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
