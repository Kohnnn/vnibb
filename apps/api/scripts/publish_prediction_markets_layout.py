#!/usr/bin/env python3
"""Publish (or refresh) the Prediction Markets system-layout template.

Adds a single "Prediction Markets" tab to the existing dashboard family.
Mirrors the static fallback shipped in `apps/web/src/contexts/DashboardContext/
systemDashboards.ts::PREDICTION_MARKETS_TAB_TEMPLATE`.

Endpoint: ``PUT /api/v1/admin/automation/system-layouts/default-prediction-markets``
(server-controlled actor: ``automation:layout-publisher``)

Usage
-----

  python apps/api/scripts/publish_prediction_markets_layout.py \\
      --base-url https://vnibb-api.example.com

By default the script targets ``http://127.0.0.1:8000`` and reads the
automation key from the server-only ``ADMIN_API_KEY`` environment variable.
Inject it from your secret manager; do not store it in browser settings.
The ``--dry-run`` flag prints the payload it would send and exits.

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
        "type": "polymarket",
        "config": {"source": "polymarket", "category": "economic", "limit": 12},
        "layout": {"x": 0, "y": 0, "w": 8, "h": 7, "minW": 6, "minH": 5},
    }
    pol_sports = {
        "id": "tile-polymarket-sports",
        "type": "polymarket",
        "config": {"source": "polymarket", "category": "sports", "limit": 12},
        "layout": {"x": 8, "y": 0, "w": 8, "h": 7, "minW": 6, "minH": 5},
    }
    kalshi_top = {
        "id": "tile-kalshi-top",
        "type": "kalshi",
        "config": {"source": "kalshi", "limit": 12},
        "layout": {"x": 0, "y": 7, "w": 8, "h": 7, "minW": 6, "minH": 5},
    }
    election = {
        "id": "tile-election-odds",
        "type": "election_odds",
        "config": {},
        "layout": {"x": 8, "y": 7, "w": 8, "h": 8, "minW": 6, "minH": 6},
    }
    macro = {
        "id": "tile-macro-calibration",
        "type": "macro_calibration",
        "config": {},
        "layout": {"x": 0, "y": 14, "w": 16, "h": 8, "minW": 8, "minH": 6},
    }
    movers = {
        "id": "tile-prediction-movers",
        "type": "prediction_movers",
        "config": {"windowHours": 24, "limit": 12},
        "layout": {"x": 16, "y": 0, "w": 8, "h": 14, "minW": 6, "minH": 9},
    }

    tab = {
        "id": "tab-prediction-markets-default",
        "name": "Prediction Markets",
        "order": 0,
        "widgets": [poltil, pol_sports, kalshi_top, election, macro, movers],
    }

    return {
        "id": DASHBOARD_KEY,
        "name": DASHBOARD_NAME,
        "description": "Phase 7 — prediction-market coverage. Polymarket, Kalshi, election odds, macro calibration, and probability movers.",
        "tabs": [tab],
        "syncGroups": [],
        "showGroupLabels": True,
        "isDefault": False,
        "isEditable": False,
        "isDeletable": False,
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }


def _post_json(url: str, payload: dict[str, Any], admin_key: str) -> dict[str, Any]:
    headers = {"Accept": "application/json", "X-Admin-Key": admin_key}
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
    parser.add_argument(
        "--admin-key",
        default=os.getenv("ADMIN_API_KEY"),
        help="Server-only automation key; prefer ADMIN_API_KEY over process arguments.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    dashboard = build_prediction_markets_dashboard()
    body = {"dashboard": dashboard, "publish": True}

    if args.dry_run:
        sys.stdout.write(json.dumps(body, indent=2))
        return 0

    if not args.admin_key:
        sys.stderr.write("error: automation key not provided. Set ADMIN_API_KEY.\n")
        return 2

    endpoint = args.base_url.rstrip("/") + f"/api/v1/admin/automation/system-layouts/{DASHBOARD_KEY}"
    try:
        _post_json(endpoint, body, args.admin_key)
    except urllib_error.HTTPError as exc:  # pragma: no cover - admin path
        sys.stderr.write(f"PUT failed: {exc.code} {exc.reason}\n")
        return 1
    sys.stdout.write(f"Published {DASHBOARD_KEY} -> {endpoint}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
