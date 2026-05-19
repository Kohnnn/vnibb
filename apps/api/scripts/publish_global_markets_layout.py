#!/usr/bin/env python3
"""Publish (or refresh) the Global Markets system-layout template.

This script ships the same four-tab structure that the frontend's static
fallback in `apps/web/src/contexts/DashboardContext.tsx` provides, so even
if the published template was previously pointing the "Screener" tab at a
TradingView Advanced Chart (the bug we shipped fixes for in PR-2), running
this script will overwrite the bad payload with the correct one.

Endpoint: ``PUT /api/v1/admin/system-layouts/default-global-markets``
(handler: ``apps/api/vnibb/api/v1/admin.py:save_admin_system_layout``)

Usage
-----

  python apps/api/scripts/publish_global_markets_layout.py \
      --base-url https://vnibb-api.example.com \
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

DASHBOARD_KEY = "default-global-markets"
DASHBOARD_NAME = "Global Markets"
DEFAULT_BASE_URL = "http://127.0.0.1:8000"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def build_global_markets_dashboard() -> dict[str, Any]:
    """Return the canonical Global Markets dashboard JSON.

    Mirrors the static fallback shipped in
    `apps/web/src/contexts/DashboardContext.tsx::createGlobalMarketsDashboard`
    after PR-2. Keep this in sync with that factory.
    """

    timestamp = _now_iso()

    overview_widgets = [
        {
            "type": "tradingview_ticker_tape",
            "syncGroupId": 1,
            "config": {},
            "layout": {"x": 0, "y": 0, "w": 24, "h": 4, "minW": 12, "minH": 3},
        },
        {
            "type": "tradingview_chart",
            "syncGroupId": 1,
            "config": {"symbol": "NASDAQ:VFS"},
            "layout": {"x": 0, "y": 4, "w": 14, "h": 10, "minW": 10, "minH": 8},
        },
        {
            "type": "tradingview_technical_analysis",
            "syncGroupId": 1,
            "config": {"symbol": "NASDAQ:VFS"},
            "layout": {"x": 14, "y": 4, "w": 10, "h": 10, "minW": 8, "minH": 8},
        },
        {
            "type": "tradingview_market_overview",
            "syncGroupId": 1,
            "config": {},
            "layout": {"x": 0, "y": 14, "w": 12, "h": 8, "minW": 8, "minH": 6},
        },
        {
            "type": "tradingview_market_data",
            "syncGroupId": 1,
            "config": {},
            "layout": {"x": 12, "y": 14, "w": 12, "h": 8, "minW": 8, "minH": 6},
        },
        {
            "type": "tradingview_forex_cross_rates",
            "syncGroupId": 1,
            "config": {},
            "layout": {"x": 0, "y": 22, "w": 8, "h": 7, "minW": 6, "minH": 5},
        },
        {
            "type": "tradingview_stock_heatmap",
            "syncGroupId": 1,
            "config": {},
            "layout": {"x": 8, "y": 22, "w": 8, "h": 7, "minW": 6, "minH": 5},
        },
        {
            "type": "tradingview_top_stories",
            "syncGroupId": 1,
            "config": {"feedMode": "all_symbols"},
            "layout": {"x": 16, "y": 22, "w": 8, "h": 7, "minW": 6, "minH": 5},
        },
    ]

    screener_widgets = [
        {
            "type": "tradingview_ticker_tape",
            "syncGroupId": 1,
            "config": {},
            "layout": {"x": 0, "y": 0, "w": 24, "h": 4, "minW": 12, "minH": 3},
        },
        {
            "type": "tradingview_screener",
            "syncGroupId": 1,
            "config": {},
            "layout": {"x": 0, "y": 4, "w": 24, "h": 24, "minW": 12, "minH": 12},
        },
    ]

    crypto_widgets = [
        {
            "type": "tradingview_ticker_tape",
            "syncGroupId": 1,
            "config": {"symbols": "crypto"},
            "layout": {"x": 0, "y": 0, "w": 24, "h": 4, "minW": 12, "minH": 3},
        },
        {
            "type": "tradingview_crypto_market",
            "syncGroupId": 1,
            "config": {},
            "layout": {"x": 0, "y": 4, "w": 14, "h": 14, "minW": 8, "minH": 8},
        },
        {
            "type": "tradingview_chart",
            "syncGroupId": 1,
            "config": {"symbol": "BINANCE:BTCUSDT"},
            "layout": {"x": 14, "y": 4, "w": 10, "h": 14, "minW": 8, "minH": 8},
        },
        {
            "type": "tradingview_crypto_heatmap",
            "syncGroupId": 1,
            "config": {},
            "layout": {"x": 0, "y": 18, "w": 24, "h": 10, "minW": 12, "minH": 8},
        },
    ]

    world_news_widgets = [
        {
            "type": "world_news_map",
            "syncGroupId": 1,
            "config": {
                "region": "all",
                "category": "all",
                "limit": 120,
                "freshnessHours": 72,
            },
            "layout": {"x": 0, "y": 0, "w": 14, "h": 12, "minW": 8, "minH": 8},
        },
        {
            "type": "world_news_live_stream",
            "syncGroupId": 1,
            "config": {
                "region": "all",
                "category": "all",
                "limit": 40,
                "freshnessHours": 24,
                "pollSeconds": 60,
            },
            "layout": {"x": 14, "y": 0, "w": 10, "h": 12, "minW": 6, "minH": 8},
        },
        {
            "type": "world_news_monitor",
            "syncGroupId": 1,
            "config": {
                "region": "all",
                "category": "all",
                "limit": 60,
                "freshnessHours": 72,
            },
            "layout": {"x": 0, "y": 12, "w": 16, "h": 10, "minW": 10, "minH": 8},
        },
        {
            "type": "world_news_sources",
            "syncGroupId": 1,
            "config": {"region": "all", "category": "all", "language": "all"},
            "layout": {"x": 16, "y": 12, "w": 8, "h": 10, "minW": 5, "minH": 8},
        },
    ]

    def _tab(id_suffix: str, name: str, widgets: list[dict[str, Any]], order: int) -> dict[str, Any]:
        return {
            "id": f"{DASHBOARD_KEY}-{id_suffix}",
            "name": name,
            "order": order,
            "widgets": [
                {**widget, "id": f"{DASHBOARD_KEY}-{id_suffix}-w{i}"}
                for i, widget in enumerate(widgets)
            ],
        }

    tabs = [
        _tab("global-markets", DASHBOARD_NAME, overview_widgets, 0),
        _tab("screener", "Screener", screener_widgets, 1),
        _tab("cryptocurrencies", "Cryptocurrencies", crypto_widgets, 2),
        _tab("world-news", "WorldNews", world_news_widgets, 3),
    ]

    return {
        "id": DASHBOARD_KEY,
        "name": DASHBOARD_NAME,
        "description": (
            "Editable TradingView-first workspace for international indices, FX, "
            "commodities, and crypto."
        ),
        "isDefault": False,
        "isEditable": False,
        "isDeletable": False,
        "showGroupLabels": True,
        "tabs": tabs,
        "syncGroups": [
            {"id": 1, "name": "Group 1", "color": "#3b82f6", "currentSymbol": "NASDAQ:VFS"}
        ],
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Publish the corrected Global Markets system-layout payload."
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("VNIBB_API_BASE_URL", DEFAULT_BASE_URL),
        help=(
            "API base URL (e.g. https://vnibb-api.example.com). Defaults to "
            "$VNIBB_API_BASE_URL or http://127.0.0.1:8000."
        ),
    )
    parser.add_argument(
        "--admin-key",
        default=os.environ.get("VNIBB_ADMIN_LAYOUT_KEY") or os.environ.get("ADMIN_API_KEY"),
        help=(
            "Admin API key for the X-Admin-Key header. Defaults to "
            "$VNIBB_ADMIN_LAYOUT_KEY or $ADMIN_API_KEY."
        ),
    )
    parser.add_argument(
        "--actor",
        default="screener-tab-fix-script",
        help="Value sent in the X-Admin-Actor header so audit logs attribute the change.",
    )
    parser.add_argument(
        "--notes",
        default=(
            "Replace tradingview_chart on the Screener tab with tradingview_screener; "
            "ensure four-tab structure for Global Markets workspace."
        ),
    )
    parser.add_argument(
        "--draft-only",
        action="store_true",
        help="Save as draft instead of publishing.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the payload that would be sent and exit.",
    )
    args = parser.parse_args()

    dashboard = build_global_markets_dashboard()
    body = {
        "dashboard": dashboard,
        "notes": args.notes,
        "publish": not args.draft_only,
    }

    if args.dry_run:
        json.dump(body, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
        return 0

    if not args.admin_key:
        print(
            "error: admin key not provided. Pass --admin-key or set VNIBB_ADMIN_LAYOUT_KEY.",
            file=sys.stderr,
        )
        return 2

    url = f"{args.base_url.rstrip('/')}/api/v1/admin/system-layouts/{DASHBOARD_KEY}"
    payload = json.dumps(body).encode("utf-8")
    req = urllib_request.Request(  # noqa: S310 - admin script, URL is operator-supplied
        url,
        data=payload,
        method="PUT",
        headers={
            "Content-Type": "application/json",
            "X-Admin-Key": args.admin_key,
            "X-Admin-Actor": args.actor,
        },
    )

    print(f"PUT {url}")
    try:
        with urllib_request.urlopen(req, timeout=30) as response:  # noqa: S310
            status_code = response.status
            response_body = response.read().decode("utf-8", errors="ignore")
    except urllib_error.HTTPError as exc:
        print(f"HTTP {exc.code}: {exc.reason}", file=sys.stderr)
        body_text = exc.read().decode("utf-8", errors="ignore")
        if body_text:
            print(body_text, file=sys.stderr)
        return 1
    except urllib_error.URLError as exc:
        print(f"URL error: {exc.reason}", file=sys.stderr)
        return 1

    print(f"HTTP {status_code}")
    try:
        decoded = json.loads(response_body)
        json.dump(decoded, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
    except json.JSONDecodeError:
        print(response_body)

    return 0 if 200 <= status_code < 400 else 1


if __name__ == "__main__":
    raise SystemExit(main())
