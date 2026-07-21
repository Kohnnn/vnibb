#!/usr/bin/env python3
"""Manifest-driven VNStock premium Mongo ingestion scaffold."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@dataclass(frozen=True)
class DatasetSpec:
    dataset: str
    layer: str
    scope_type: str
    retention: str
    interval: str
    call_weight: int
    default_batch_size: int
    default_sleep_seconds: float
    enabled: bool = True


MANIFEST: dict[str, DatasetSpec] = {
    "market_prices_eod": DatasetSpec(
        dataset="market_prices_eod",
        layer="market",
        scope_type="symbol",
        retention="long-term",
        interval="daily_after_close",
        call_weight=1,
        default_batch_size=10,
        default_sleep_seconds=2.0,
    ),
    "finance.income_statement.year": DatasetSpec(
        dataset="finance.income_statement.year",
        layer="fundamental",
        scope_type="symbol",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
    ),
    "finance.income_statement.quarter": DatasetSpec(
        dataset="finance.income_statement.quarter",
        layer="fundamental",
        scope_type="symbol",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
    ),
    "finance.balance_sheet.year": DatasetSpec(
        dataset="finance.balance_sheet.year",
        layer="fundamental",
        scope_type="symbol",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
    ),
    "finance.balance_sheet.quarter": DatasetSpec(
        dataset="finance.balance_sheet.quarter",
        layer="fundamental",
        scope_type="symbol",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
    ),
    "finance.cash_flow.year": DatasetSpec(
        dataset="finance.cash_flow.year",
        layer="fundamental",
        scope_type="symbol",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
    ),
    "finance.cash_flow.quarter": DatasetSpec(
        dataset="finance.cash_flow.quarter",
        layer="fundamental",
        scope_type="symbol",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
    ),
    "finance.ratio.year": DatasetSpec(
        dataset="finance.ratio.year",
        layer="fundamental",
        scope_type="symbol",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
    ),
    "finance.ratio.quarter": DatasetSpec(
        dataset="finance.ratio.quarter",
        layer="fundamental",
        scope_type="symbol",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
    ),
    "reference.shareholders": DatasetSpec(
        dataset="reference.shareholders",
        layer="reference",
        scope_type="symbol",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
    ),
    "reference.listings": DatasetSpec(
        dataset="reference.listings",
        layer="reference",
        scope_type="market",
        retention="long-term",
        interval="daily_or_weekly",
        call_weight=1,
        default_batch_size=1,
        default_sleep_seconds=1.0,
    ),
    "company.info": DatasetSpec(
        dataset="company.info",
        layer="reference",
        scope_type="symbol",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
    ),
    "company.events": DatasetSpec(
        dataset="company.events",
        layer="reference",
        scope_type="symbol",
        retention="long-term",
        interval="daily_after_close",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
    ),
    "company.officers": DatasetSpec(
        dataset="company.officers",
        layer="reference",
        scope_type="symbol",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
    ),
    "company.subsidiaries": DatasetSpec(
        dataset="company.subsidiaries",
        layer="reference",
        scope_type="symbol",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
    ),
    "company.capital_history": DatasetSpec(
        dataset="company.capital_history",
        layer="reference",
        scope_type="symbol",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
        enabled=False,
    ),
    "company.affiliate": DatasetSpec(
        dataset="company.affiliate",
        layer="reference",
        scope_type="symbol",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
    ),
    "company.insider_deals": DatasetSpec(
        dataset="company.insider_deals",
        layer="reference",
        scope_type="symbol",
        retention="long-term",
        interval="daily_after_close",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
        enabled=False,
    ),
    "company.news": DatasetSpec(
        dataset="company.news",
        layer="news",
        scope_type="symbol",
        retention="long-term",
        interval="hourly_small_nightly_broad",
        call_weight=1,
        default_batch_size=5,
        default_sleep_seconds=3.0,
    ),
    "reference.listings.etf": DatasetSpec(
        dataset="reference.listings.etf",
        layer="reference",
        scope_type="market",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=1,
        default_sleep_seconds=1.0,
    ),
    "reference.listings.indices": DatasetSpec(
        dataset="reference.listings.indices",
        layer="reference",
        scope_type="market",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=1,
        default_sleep_seconds=1.0,
    ),
    "reference.listings.futures": DatasetSpec(
        dataset="reference.listings.futures",
        layer="reference",
        scope_type="market",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=1,
        default_sleep_seconds=1.0,
    ),
    "reference.listings.covered_warrants": DatasetSpec(
        dataset="reference.listings.covered_warrants",
        layer="reference",
        scope_type="market",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=1,
        default_sleep_seconds=1.0,
    ),
    "reference.listings.symbols_by_exchange": DatasetSpec(
        dataset="reference.listings.symbols_by_exchange",
        layer="reference",
        scope_type="market",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=1,
        default_sleep_seconds=1.0,
    ),
    "reference.listings.symbols_by_group": DatasetSpec(
        dataset="reference.listings.symbols_by_group",
        layer="reference",
        scope_type="market",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=1,
        default_sleep_seconds=1.0,
    ),
    "reference.listings.symbols_by_industries": DatasetSpec(
        dataset="reference.listings.symbols_by_industries",
        layer="reference",
        scope_type="market",
        retention="long-term",
        interval="weekly_full_daily_retry",
        call_weight=1,
        default_batch_size=1,
        default_sleep_seconds=1.0,
    ),
    "macro.gdp": DatasetSpec("macro.gdp", "macro", "market", "long-term", "monthly_or_quarterly", 1, 1, 1.0),
    "macro.cpi": DatasetSpec("macro.cpi", "macro", "market", "long-term", "monthly", 1, 1, 1.0),
    "macro.exchange_rate": DatasetSpec("macro.exchange_rate", "macro", "market", "long-term", "daily", 1, 1, 1.0),
    "macro.interest_rate": DatasetSpec("macro.interest_rate", "macro", "market", "long-term", "daily", 1, 1, 1.0),
    "macro.money_supply": DatasetSpec("macro.money_supply", "macro", "market", "long-term", "monthly", 1, 1, 1.0),
    "macro.fdi": DatasetSpec("macro.fdi", "macro", "market", "long-term", "monthly", 1, 1, 1.0),
    "macro.import_export": DatasetSpec("macro.import_export", "macro", "market", "long-term", "monthly", 1, 1, 1.0),
    "macro.industry_prod": DatasetSpec("macro.industry_prod", "macro", "market", "long-term", "monthly", 1, 1, 1.0),
    "macro.population_labor": DatasetSpec("macro.population_labor", "macro", "market", "long-term", "yearly", 1, 1, 1.0),
    "macro.retail": DatasetSpec("macro.retail", "macro", "market", "long-term", "monthly", 1, 1, 1.0),
    "market.pe": DatasetSpec("market.pe", "market", "market", "long-term", "daily", 1, 1, 1.0),
    "market.pb": DatasetSpec("market.pb", "market", "market", "long-term", "daily", 1, 1, 1.0),
    "market.evaluation": DatasetSpec("market.evaluation", "market", "market", "long-term", "daily", 1, 1, 1.0),
    "equity.summary": DatasetSpec("equity.summary", "market", "symbol", "long-term", "daily_after_close", 1, 10, 2.0),
    "equity.session_stats": DatasetSpec("equity.session_stats", "market", "symbol", "long-term", "daily_after_close", 1, 10, 2.0),
    "equity.foreign_flow": DatasetSpec("equity.foreign_flow", "market", "symbol", "long-term", "daily_after_close", 1, 10, 2.0),
    "equity.proprietary_flow": DatasetSpec("equity.proprietary_flow", "market", "symbol", "long-term", "daily_after_close", 1, 10, 2.0),
    "equity.trade_history": DatasetSpec("equity.trade_history", "market", "symbol", "long-term", "daily_after_close", 1, 10, 2.0),
    "equity.quote": DatasetSpec("equity.quote", "market", "symbol", "short-term", "market_hours_snapshot", 1, 10, 2.0),
    "equity.intraday": DatasetSpec("equity.intraday", "market", "symbol", "short-term", "market_hours_recent", 1, 10, 2.0),
    "equity.trades": DatasetSpec("equity.trades", "market", "symbol", "short-term", "market_hours_recent", 1, 10, 2.0),
    "equity.block_trades": DatasetSpec("equity.block_trades", "market", "symbol", "short-term", "market_hours_recent", 1, 10, 2.0, enabled=False),
    "equity.price_depth": DatasetSpec("equity.price_depth", "market", "symbol", "short-term", "market_hours_snapshot", 1, 10, 2.0),
    "equity.order_book": DatasetSpec("equity.order_book", "market", "symbol", "short-term", "market_hours_snapshot", 1, 10, 2.0),
    "equity.matched_by_price": DatasetSpec("equity.matched_by_price", "market", "symbol", "short-term", "market_hours_snapshot", 1, 10, 2.0),
    "equity.odd_lot": DatasetSpec("equity.odd_lot", "market", "symbol", "short-term", "market_hours_recent", 1, 10, 2.0),
    "equity.put_through": DatasetSpec("equity.put_through", "market", "symbol", "short-term", "market_hours_recent", 1, 10, 2.0, enabled=False),
    "equity.volume_profile": DatasetSpec("equity.volume_profile", "market", "symbol", "short-term", "market_hours_snapshot", 1, 10, 2.0),
    "reference.fund.list": DatasetSpec("reference.fund.list", "reference", "market", "long-term", "weekly_full_daily_retry", 1, 1, 1.0),
    "reference.futures.list": DatasetSpec("reference.futures.list", "reference", "market", "long-term", "daily_or_weekly", 1, 1, 1.0),
    "reference.futures.info": DatasetSpec("reference.futures.info", "reference", "symbol", "long-term", "daily_or_weekly", 1, 5, 2.0),
    "reference.warrant.list": DatasetSpec("reference.warrant.list", "reference", "market", "long-term", "daily_or_weekly", 1, 1, 1.0),
    "reference.warrant.info": DatasetSpec("reference.warrant.info", "reference", "symbol", "long-term", "daily_or_weekly", 1, 10, 2.0),
    "reference.bond.list": DatasetSpec("reference.bond.list", "reference", "market", "long-term", "daily_or_weekly", 1, 1, 1.0),
    "fund.history": DatasetSpec("fund.history", "market", "symbol", "long-term", "daily_or_weekly", 1, 5, 2.0),
    "fund.asset_holding": DatasetSpec("fund.asset_holding", "market", "symbol", "long-term", "daily_or_weekly", 1, 5, 2.0),
    "fund.industry_holding": DatasetSpec("fund.industry_holding", "market", "symbol", "long-term", "daily_or_weekly", 1, 5, 2.0),
    "fund.top_holding": DatasetSpec("fund.top_holding", "market", "symbol", "long-term", "daily_or_weekly", 1, 5, 2.0),
    "index.summary": DatasetSpec("index.summary", "market", "symbol", "long-term", "daily_after_close", 1, 10, 2.0),
    "index.quote": DatasetSpec("index.quote", "market", "symbol", "short-term", "market_hours_snapshot", 1, 10, 2.0),
    "index.trade_history": DatasetSpec("index.trade_history", "market", "symbol", "long-term", "daily_after_close", 1, 10, 2.0),
    "futures.summary": DatasetSpec("futures.summary", "market", "symbol", "short-term", "market_hours_snapshot", 1, 5, 2.0),
    "futures.quote": DatasetSpec("futures.quote", "market", "symbol", "short-term", "market_hours_snapshot", 1, 5, 2.0),
    "futures.trades": DatasetSpec("futures.trades", "market", "symbol", "short-term", "market_hours_recent", 1, 5, 2.0),
    "futures.price_depth": DatasetSpec("futures.price_depth", "market", "symbol", "short-term", "market_hours_snapshot", 1, 5, 2.0),
    "futures.order_book": DatasetSpec("futures.order_book", "market", "symbol", "short-term", "market_hours_snapshot", 1, 5, 2.0),
    "crypto.quote": DatasetSpec("crypto.quote", "market", "symbol", "short-term", "market_hours_snapshot", 1, 5, 2.0),
    "crypto.history": DatasetSpec("crypto.history", "market", "symbol", "long-term", "daily", 1, 5, 2.0),
    "crypto.trades": DatasetSpec("crypto.trades", "market", "symbol", "short-term", "market_hours_recent", 1, 5, 2.0),
    "crypto.price_depth": DatasetSpec("crypto.price_depth", "market", "symbol", "short-term", "market_hours_snapshot", 1, 5, 2.0),
    "crypto.order_book": DatasetSpec("crypto.order_book", "market", "symbol", "short-term", "market_hours_snapshot", 1, 5, 2.0),
    "reference.equity.list": DatasetSpec("reference.equity.list", "reference", "market", "long-term", "weekly_full_daily_retry", 1, 1, 1.0),
    "reference.etf.list": DatasetSpec("reference.etf.list", "reference", "market", "long-term", "weekly_full_daily_retry", 1, 1, 1.0),
    "reference.events.calendar": DatasetSpec("reference.events.calendar", "reference", "market", "long-term", "daily_after_close", 1, 1, 1.0),
    "reference.industry.list": DatasetSpec("reference.industry.list", "reference", "market", "long-term", "weekly_full_daily_retry", 1, 1, 1.0),
    "reference.market.status": DatasetSpec("reference.market.status", "reference", "market", "short-term", "market_hours_snapshot", 1, 1, 1.0),
    "insights.screener.filter": DatasetSpec("insights.screener.filter", "insights", "market", "long-term", "daily_after_close", 1, 1, 1.0),
    "insights.ranking.deal": DatasetSpec("insights.ranking.deal", "insights", "market", "short-term", "market_hours_snapshot", 1, 1, 1.0),
    "insights.ranking.foreign_buy": DatasetSpec("insights.ranking.foreign_buy", "insights", "market", "short-term", "market_hours_snapshot", 1, 1, 1.0),
    "insights.ranking.foreign_sell": DatasetSpec("insights.ranking.foreign_sell", "insights", "market", "short-term", "market_hours_snapshot", 1, 1, 1.0),
    "insights.ranking.gainer": DatasetSpec("insights.ranking.gainer", "insights", "market", "short-term", "market_hours_snapshot", 1, 1, 1.0),
    "insights.ranking.loser": DatasetSpec("insights.ranking.loser", "insights", "market", "short-term", "market_hours_snapshot", 1, 1, 1.0),
    "insights.ranking.value": DatasetSpec("insights.ranking.value", "insights", "market", "short-term", "market_hours_snapshot", 1, 1, 1.0),
    "insights.ranking.volume": DatasetSpec("insights.ranking.volume", "insights", "market", "short-term", "market_hours_snapshot", 1, 1, 1.0),
    "analytics.valuation.pe": DatasetSpec("analytics.valuation.pe", "analytics", "market", "long-term", "daily_after_close", 1, 1, 1.0),
    "analytics.valuation.pb": DatasetSpec("analytics.valuation.pb", "analytics", "market", "long-term", "daily_after_close", 1, 1, 1.0),
}


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _clean_value(value: Any) -> Any:
    if hasattr(value, "item"):
        value = value.item()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    try:
        import pandas as pd

        if pd.isna(value):
            return None
    except Exception:
        pass
    return value


def _frame_rows(frame: Any) -> list[dict[str, Any]]:
    if frame is None or getattr(frame, "empty", True):
        return []
    if hasattr(frame, "to_frame") and not hasattr(frame, "columns"):
        frame = frame.to_frame(name="value").reset_index()
    return [
        {str(key): _clean_value(value) for key, value in row.items()}
        for row in frame.to_dict(orient="records")
    ]


def _model_rows(items: list[Any]) -> list[dict[str, Any]]:
    rows = []
    for item in items:
        if hasattr(item, "model_dump"):
            rows.append(item.model_dump(mode="json", by_alias=False))
        elif isinstance(item, dict):
            rows.append(item)
    return rows


def _run_async(coro: Any) -> Any:
    import asyncio

    return asyncio.run(coro)


def _record_key(dataset: str, scope_key: str, raw: dict[str, Any]) -> str:
    natural_keys = [
        raw.get("time"),
        raw.get("date"),
        raw.get("tradeDate"),
        raw.get("period"),
        raw.get("year_period"),
        raw.get("yearReport"),
        raw.get("year"),
        raw.get("quarter"),
        raw.get("ticker"),
        raw.get("symbol"),
        raw.get("value"),
        raw.get("industry_code"),
        raw.get("industry_name"),
        raw.get("exchange"),
        raw.get("group"),
        raw.get("name"),
        raw.get("id"),
        raw.get("code"),
    ]
    natural = ":".join(str(item) for item in natural_keys if item not in (None, ""))
    if natural:
        return f"vnstock-data:{dataset}:{scope_key}:{natural}"
    raw_key = json.dumps(raw, sort_keys=True, ensure_ascii=False, default=str)
    digest = hashlib.sha1(raw_key.encode("utf-8")).hexdigest()[:16]
    return f"vnstock-data:{dataset}:{scope_key}:{digest}"


def _observed_at(raw: dict[str, Any]) -> datetime:
    for key in ("time", "date", "tradeDate", "publishedAt", "createdAt", "updatedAt"):
        value = raw.get(key)
        if value is None:
            continue
        if isinstance(value, datetime):
            return value.replace(tzinfo=None)
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            pass
    year = raw.get("year") or raw.get("yearReport") or raw.get("period") or raw.get("year_period")
    try:
        return datetime(int(str(year)[:4]), 1, 1)
    except (TypeError, ValueError):
        return _now()


def _trade_date(raw: dict[str, Any]) -> datetime | None:
    for key in ("time", "date", "tradeDate"):
        value = raw.get(key)
        if value is None:
            continue
        if isinstance(value, datetime):
            return value.replace(tzinfo=None)
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return None
    return None


def _float_value(raw: dict[str, Any], key: str) -> float | None:
    value = raw.get(key)
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int_value(raw: dict[str, Any], key: str) -> int | None:
    value = raw.get(key)
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _connect_db() -> Any:
    from pymongo import MongoClient

    mongo_url = os.getenv("MONGODB_URL")
    mongo_db = os.getenv("MONGODB_DATABASE", "vnibb-market")
    if not mongo_url:
        raise SystemExit("MONGODB_URL is required")
    client = MongoClient(mongo_url, serverSelectionTimeoutMS=10000)
    return client[mongo_db]


def _ensure_indexes(db: Any) -> None:
    db.market_prices_eod.create_index(
        [("symbol", 1), ("tradeDate", 1), ("source", 1)],
        unique=True,
        name="uniq_symbol_tradeDate_source",
    )
    db.market_prices_eod.create_index(
        [("symbol", 1), ("tradeDate", -1)],
        name="idx_symbol_tradeDate_desc",
    )
    db.market_prices_eod.create_index(
        [("tradeDate", -1)],
        name="idx_tradeDate_desc",
    )
    db.market_vnstock_premium_records.create_index(
        [("dataset", 1), ("symbol", 1), ("recordKey", 1)],
        unique=True,
        name="uniq_dataset_symbol_recordKey",
    )
    db.market_vnstock_premium_records.create_index(
        [("datasetGroup", 1), ("symbol", 1), ("observedAt", -1)],
        name="idx_datasetGroup_symbol_observedAt_desc",
    )
    db.market_vnstock_premium_records.create_index(
        [("scopeType", 1), ("scopeKey", 1), ("dataset", 1)],
        name="idx_scope_dataset",
    )
    db.vnstock_ingestion_runs.create_index([("runId", 1)], unique=True)
    db.vnstock_ingestion_runs.create_index([("startedAt", -1)])
    db.vnstock_ingestion_checkpoints.create_index(
        [("runGroup", 1), ("dataset", 1), ("scopeKey", 1)], unique=True
    )
    db.vnstock_ingestion_failures.create_index([("runId", 1), ("dataset", 1), ("scopeKey", 1)])
    db.vnstock_ingestion_failures.create_index([("dataset", 1), ("failedAt", -1)])


def _upsert_price_rows(db: Any, symbol: str, rows: list[dict[str, Any]], *, dry_run: bool) -> int:
    from pymongo import UpdateOne

    synced_at = _now()
    ops = []
    count = 0
    for raw in rows:
        trade_date = _trade_date(raw)
        if trade_date is None:
            continue
        doc = {
            "symbol": symbol,
            "tradeDate": trade_date,
            "interval": "1D",
            "source": "vnstock-data",
            "sourceKey": f"vnstock-data:{symbol}:eod:{trade_date.date().isoformat()}",
            "open": _float_value(raw, "open"),
            "high": _float_value(raw, "high"),
            "low": _float_value(raw, "low"),
            "close": _float_value(raw, "close"),
            "volume": _int_value(raw, "volume"),
            "updatedAt": synced_at,
            "syncedAt": synced_at,
            "schemaVersion": 1,
        }
        count += 1
        if not dry_run:
            ops.append(
                UpdateOne(
                    {"symbol": symbol, "tradeDate": trade_date, "source": "vnstock-data"},
                    {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
                    upsert=True,
                )
            )
    if ops:
        db.market_prices_eod.bulk_write(ops, ordered=False)
    return count


def _upsert_raw_rows(
    db: Any,
    spec: DatasetSpec,
    scope_key: str,
    rows: list[dict[str, Any]],
    *,
    dry_run: bool,
) -> int:
    from pymongo import UpdateOne

    synced_at = _now()
    mongo_dataset = spec.dataset.rsplit(".", 1)[0] if spec.dataset.endswith((".year", ".quarter")) else spec.dataset
    ops = []
    for raw in rows:
        symbol = str(raw.get("symbol") or raw.get("ticker") or raw.get("value") or scope_key).upper()
        record_key = _record_key(spec.dataset, scope_key, raw)
        doc = {
            "dataset": mongo_dataset,
            "datasetVariant": spec.dataset,
            "datasetGroup": mongo_dataset.split(".", 1)[0],
            "symbol": symbol,
            "scopeKey": scope_key,
            "scopeType": spec.scope_type,
            "source": "vnstock-data",
            "providerSource": "vnstock_data",
            "recordKey": record_key,
            "observedAt": _observed_at(raw),
            "raw": {**raw, "symbol": symbol, "ticker": raw.get("ticker") or symbol},
            "updatedAt": synced_at,
            "syncedAt": synced_at,
            "schemaVersion": 1,
        }
        if not dry_run:
            ops.append(
                UpdateOne(
                    {"dataset": mongo_dataset, "symbol": symbol, "recordKey": record_key},
                    {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
                    upsert=True,
                )
            )
    if ops:
        db.market_vnstock_premium_records.bulk_write(ops, ordered=False)
    return len(rows)


def _fetcher_for(spec: DatasetSpec, *, start: str, end: str) -> Callable[[str], list[dict[str, Any]]]:
    from vnstock_data import Analytics, Fundamental, Insights, Listing, Macro, Market, Reference
    from vnstock_data.api.company import Company

    if spec.dataset == "market_prices_eod":
        return lambda symbol: _frame_rows(Market().equity(symbol).history(start=start, end=end))

    finance_fetchers: dict[str, Callable[[str], Any]] = {
        "finance.income_statement.year": lambda symbol: Fundamental().equity(symbol).income_statement(period="year"),
        "finance.income_statement.quarter": lambda symbol: Fundamental().equity(symbol).income_statement(period="quarter"),
        "finance.balance_sheet.year": lambda symbol: Fundamental().equity(symbol).balance_sheet(period="year"),
        "finance.balance_sheet.quarter": lambda symbol: Fundamental().equity(symbol).balance_sheet(period="quarter"),
        "finance.cash_flow.year": lambda symbol: Fundamental().equity(symbol).cash_flow(period="year"),
        "finance.cash_flow.quarter": lambda symbol: Fundamental().equity(symbol).cash_flow(period="quarter"),
        "finance.ratio.year": lambda symbol: Fundamental().equity(symbol).ratio(period="year"),
        "finance.ratio.quarter": lambda symbol: Fundamental().equity(symbol).ratio(period="quarter"),
    }
    if spec.dataset in finance_fetchers:
        return lambda symbol: _frame_rows(finance_fetchers[spec.dataset](symbol))

    if spec.dataset == "reference.shareholders":
        return lambda symbol: _frame_rows(Reference().company(symbol).shareholders())

    if spec.dataset == "company.info":
        return lambda symbol: _frame_rows(Reference().company(symbol).info())

    if spec.dataset == "company.events":
        return lambda symbol: _frame_rows(Reference().company(symbol).events())

    if spec.dataset == "company.officers":
        return lambda symbol: _frame_rows(Reference().company(symbol).officers())

    if spec.dataset == "company.subsidiaries":
        return lambda symbol: _frame_rows(Reference().company(symbol).subsidiaries())

    if spec.dataset == "company.capital_history":
        return lambda symbol: _frame_rows(Company(source="VCI", symbol=symbol.upper()).capital_history())

    if spec.dataset == "company.affiliate":
        return lambda symbol: _frame_rows(Company(source="VCI", symbol=symbol.upper()).affiliate())

    if spec.dataset == "company.insider_deals":
        return lambda symbol: _frame_rows(Company(source="VCI", symbol=symbol.upper()).insider_trading(page=1, page_size=100))

    if spec.dataset == "company.news":
        return lambda symbol: _frame_rows(Company(source="VCI", symbol=symbol.upper()).news(page=1, page_size=100))

    if spec.dataset == "reference.listings":
        def _listings(_: str) -> list[dict[str, Any]]:
            source = os.getenv("VNSTOCK_SOURCE", "KBS").lower()
            return _frame_rows(Listing(source=source).all_symbols())

        return _listings

    listing_fetchers: dict[str, Callable[[str], Any]] = {
        "reference.listings.etf": lambda _: Listing(source="kbs").all_etf(),
        "reference.listings.indices": lambda _: Listing(source="kbs").all_indices(),
        "reference.listings.futures": lambda _: Listing(source="kbs").all_future_indices(),
        "reference.listings.covered_warrants": lambda _: Listing(source="kbs").all_covered_warrant(),
        "reference.listings.symbols_by_exchange": lambda _: Listing(source="kbs").symbols_by_exchange(),
        "reference.listings.symbols_by_group": lambda _: Listing(source="kbs").symbols_by_group(),
        "reference.listings.symbols_by_industries": lambda _: Listing(source="kbs").symbols_by_industries(),
    }
    if spec.dataset in listing_fetchers:
        return lambda scope_key: _frame_rows(listing_fetchers[spec.dataset](scope_key))

    macro_fetchers: dict[str, Callable[[str], Any]] = {
        "macro.gdp": lambda _: Macro().economy().gdp(length=500),
        "macro.cpi": lambda _: Macro().economy().cpi(length=500),
        "macro.exchange_rate": lambda _: Macro().currency().exchange_rate(length=500),
        "macro.interest_rate": lambda _: Macro().currency().interest_rate(length=500),
        "macro.money_supply": lambda _: Macro().economy().money_supply(length=500),
        "macro.fdi": lambda _: Macro().economy().fdi(length=500),
        "macro.import_export": lambda _: Macro().economy().import_export(length=500),
        "macro.industry_prod": lambda _: Macro().economy().industry_prod(length=500),
        "macro.population_labor": lambda _: Macro().economy().population_labor(length=500),
        "macro.retail": lambda _: Macro().economy().retail(length=500),
    }
    if spec.dataset in macro_fetchers:
        return lambda scope_key: _frame_rows(macro_fetchers[spec.dataset](scope_key))

    market_fetchers: dict[str, Callable[[str], Any]] = {
        "market.pe": lambda _: Market().pe(duration="5Y"),
        "market.pb": lambda _: Market().pb(duration="5Y"),
        "market.evaluation": lambda _: Market().evaluation(duration="5Y"),
        "equity.summary": lambda symbol: Market().equity(symbol).summary(),
        "equity.session_stats": lambda symbol: Market().equity(symbol).session_stats(),
        "equity.foreign_flow": lambda symbol: Market().equity(symbol).foreign_flow(),
        "equity.proprietary_flow": lambda symbol: Market().equity(symbol).proprietary_flow(),
        "equity.trade_history": lambda symbol: Market().equity(symbol).trade_history(),
        "equity.quote": lambda symbol: Market().equity(symbol).quote(),
        "equity.intraday": lambda symbol: Market().equity(symbol).intraday(),
        "equity.trades": lambda symbol: Market().equity(symbol).trades(limit=1000),
        "equity.block_trades": lambda symbol: Market().equity(symbol).block_trades(limit=1000),
        "equity.price_depth": lambda symbol: Market().equity(symbol).price_depth(),
        "equity.order_book": lambda symbol: Market().equity(symbol).order_book(),
        "equity.matched_by_price": lambda symbol: Market().equity(symbol).matched_by_price(),
        "equity.odd_lot": lambda symbol: Market().equity(symbol).odd_lot(),
        "equity.put_through": lambda symbol: Market().equity(symbol).put_through(),
        "equity.volume_profile": lambda symbol: Market().equity(symbol).volume_profile(),
        "fund.history": lambda symbol: Market().fund(symbol).history(),
        "fund.asset_holding": lambda symbol: Market().fund(symbol).asset_holding(),
        "fund.industry_holding": lambda symbol: Market().fund(symbol).industry_holding(),
        "fund.top_holding": lambda symbol: Market().fund(symbol).top_holding(),
        "index.summary": lambda symbol: Market().index(symbol).summary(),
        "index.quote": lambda symbol: Market().index(symbol).quote(),
        "index.trade_history": lambda symbol: Market().index(symbol).trade_history(),
        "futures.summary": lambda symbol: Market().futures(symbol).summary(),
        "futures.quote": lambda symbol: Market().futures(symbol).quote(),
        "futures.trades": lambda symbol: Market().futures(symbol).trades(),
        "futures.price_depth": lambda symbol: Market().futures(symbol).price_depth(),
        "futures.order_book": lambda symbol: Market().futures(symbol).order_book(),
        "crypto.quote": lambda symbol: Market().crypto(symbol).quote(),
        "crypto.history": lambda symbol: Market().crypto(symbol).history(),
        "crypto.trades": lambda symbol: Market().crypto(symbol).trades(),
        "crypto.price_depth": lambda symbol: Market().crypto(symbol).price_depth(),
        "crypto.order_book": lambda symbol: Market().crypto(symbol).order_book(),
    }
    if spec.dataset in market_fetchers:
        return lambda scope_key: _frame_rows(market_fetchers[spec.dataset](scope_key))

    reference_fetchers: dict[str, Callable[[str], Any]] = {
        "reference.fund.list": lambda _: Reference().fund.list(),
        "reference.futures.list": lambda _: Reference().futures().list(),
        "reference.futures.info": lambda symbol: Reference().futures(symbol).info(),
        "reference.warrant.list": lambda _: Reference().warrant().list(),
        "reference.warrant.info": lambda symbol: Reference().warrant(symbol).info(),
        "reference.bond.list": lambda _: Reference().bond().list(),
        "reference.equity.list": lambda _: Reference().equity.list(),
        "reference.etf.list": lambda _: Reference().etf.list(),
        "reference.events.calendar": lambda _: Reference().events.calendar(),
        "reference.industry.list": lambda _: Reference().industry.list(),
        "reference.market.status": lambda _: Reference().market.status(),
    }
    if spec.dataset in reference_fetchers:
        return lambda scope_key: _frame_rows(reference_fetchers[spec.dataset](scope_key))

    insights_fetchers: dict[str, Callable[[str], Any]] = {
        "insights.screener.filter": lambda _: Insights().screener().filter(),
        "insights.ranking.deal": lambda _: Insights().ranking().deal(),
        "insights.ranking.foreign_buy": lambda _: Insights().ranking().foreign_buy(),
        "insights.ranking.foreign_sell": lambda _: Insights().ranking().foreign_sell(),
        "insights.ranking.gainer": lambda _: Insights().ranking().gainer(),
        "insights.ranking.loser": lambda _: Insights().ranking().loser(),
        "insights.ranking.value": lambda _: Insights().ranking().value(),
        "insights.ranking.volume": lambda _: Insights().ranking().volume(),
    }
    if spec.dataset in insights_fetchers:
        return lambda scope_key: _frame_rows(insights_fetchers[spec.dataset](scope_key))

    analytics_fetchers: dict[str, Callable[[str], Any]] = {
        "analytics.valuation.pe": lambda _: Analytics().valuation(index="VNINDEX").pe(),
        "analytics.valuation.pb": lambda _: Analytics().valuation(index="VNINDEX").pb(),
    }
    if spec.dataset in analytics_fetchers:
        return lambda scope_key: _frame_rows(analytics_fetchers[spec.dataset](scope_key))

    raise KeyError(f"Unsupported dataset in starter manifest: {spec.dataset}")


def _mark_run(db: Any, run_id: str, status: str, payload: dict[str, Any]) -> None:
    db.vnstock_ingestion_runs.update_one(
        {"runId": run_id},
        {
            "$set": {**payload, "status": status, "updatedAt": _now()},
            "$setOnInsert": {"createdAt": _now(), "startedAt": _now()},
        },
        upsert=True,
    )


def _checkpoint(db: Any, run_group: str, dataset: str, scope_key: str, payload: dict[str, Any]) -> None:
    db.vnstock_ingestion_checkpoints.update_one(
        {"runGroup": run_group, "dataset": dataset, "scopeKey": scope_key},
        {"$set": {**payload, "updatedAt": _now()}, "$setOnInsert": {"createdAt": _now()}},
        upsert=True,
    )


def _failure(db: Any, run_id: str, dataset: str, scope_key: str, exc: Exception) -> None:
    db.vnstock_ingestion_failures.insert_one(
        {
            "runId": run_id,
            "dataset": dataset,
            "scopeKey": scope_key,
            "error": str(exc),
            "failedAt": _now(),
        }
    )


def _selected_datasets(raw: str) -> list[str]:
    selected = [item.strip() for item in raw.split(",") if item.strip()]
    if selected == ["all"]:
        return [key for key, spec in MANIFEST.items() if spec.enabled]
    unknown = [item for item in selected if item not in MANIFEST]
    if unknown:
        raise SystemExit(f"Unsupported starter manifest datasets: {', '.join(unknown)}")
    return selected


def _read_symbols_file(path: str) -> list[str]:
    content = Path(path).read_text(encoding="utf-8")
    raw_items = content.replace("\n", ",").split(",")
    return [item.strip().upper() for item in raw_items if item.strip()]


def _resolve_symbols(db: Any, args: argparse.Namespace, datasets: list[str]) -> list[str]:
    symbols: list[str] = []
    if args.symbols_file:
        symbols.extend(_read_symbols_file(args.symbols_file))
    if args.symbols:
        symbols.extend(symbol.strip().upper() for symbol in args.symbols.split(",") if symbol.strip())

    needs_symbol_scope = any(MANIFEST[dataset].scope_type == "symbol" for dataset in datasets)
    if args.symbol_source == "mongo-eod":
        symbols.extend(str(symbol).upper() for symbol in db.market_prices_eod.distinct("symbol") if symbol)
    elif args.symbol_source == "none" and needs_symbol_scope and not symbols:
        raise SystemExit("--symbols, --symbols-file, or --symbol-source mongo-eod is required for symbol-scoped datasets")

    deduped = sorted(set(symbols))
    offset = max(0, args.offset)
    limit = args.limit if args.limit and args.limit > 0 else None
    sliced = deduped[offset : offset + limit if limit is not None else None]
    if needs_symbol_scope and not sliced:
        raise SystemExit("No symbols resolved for symbol-scoped datasets")
    return sliced


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbols", default="", help="Comma-separated symbols for symbol-scoped datasets")
    parser.add_argument("--symbols-file", help="File containing comma/newline separated symbols")
    parser.add_argument(
        "--symbol-source",
        choices=["none", "mongo-eod"],
        default="none",
        help="Optional symbol source. mongo-eod loads distinct symbols from market_prices_eod.",
    )
    parser.add_argument("--datasets", default="reference.shareholders")
    parser.add_argument("--start", default="2000-01-01")
    parser.add_argument("--end", default=datetime.now(UTC).date().isoformat())
    parser.add_argument("--batch-size", type=int, default=0)
    parser.add_argument("--sleep-seconds", type=float, default=-1.0)
    parser.add_argument("--run-group", default="manual")
    parser.add_argument("--limit", type=int, default=0, help="Limit resolved symbols after sorting")
    parser.add_argument("--offset", type=int, default=0, help="Offset resolved symbols after sorting")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    db = _connect_db()
    if not args.dry_run:
        _ensure_indexes(db)

    run_id = f"vnstock-mongo-{uuid4().hex[:10]}"
    datasets = _selected_datasets(args.datasets)
    symbols = _resolve_symbols(db, args, datasets)
    summary: dict[str, Any] = {"datasets": {}, "dryRun": args.dry_run}

    if not args.dry_run:
        _mark_run(
            db,
            run_id,
            "running",
            {
                "runGroup": args.run_group,
                "datasets": datasets,
                "symbols": symbols,
                "dryRun": args.dry_run,
            },
        )

    try:
        for dataset in datasets:
            spec = MANIFEST[dataset]
            fetcher = _fetcher_for(spec, start=args.start, end=args.end)
            scope_values = symbols if spec.scope_type == "symbol" else [spec.scope_type]
            if spec.scope_type == "symbol" and not scope_values:
                raise SystemExit(f"--symbols is required for {dataset}")

            batch_size = args.batch_size if args.batch_size > 0 else spec.default_batch_size
            sleep_seconds = args.sleep_seconds if args.sleep_seconds >= 0 else spec.default_sleep_seconds
            dataset_summary = {"success": 0, "errors": 0, "rows": 0}

            for index, scope_key in enumerate(scope_values, start=1):
                try:
                    rows = fetcher(scope_key)
                    if dataset == "market_prices_eod":
                        written = _upsert_price_rows(db, scope_key, rows, dry_run=args.dry_run)
                    else:
                        written = _upsert_raw_rows(db, spec, scope_key, rows, dry_run=args.dry_run)
                    dataset_summary["success"] += 1
                    dataset_summary["rows"] += written
                    if not args.dry_run:
                        _checkpoint(
                            db,
                            args.run_group,
                            dataset,
                            scope_key,
                            {"status": "completed", "rows": written, "runId": run_id},
                        )
                except Exception as exc:  # noqa: BLE001
                    dataset_summary["errors"] += 1
                    if not args.dry_run:
                        _failure(db, run_id, dataset, scope_key, exc)
                        _checkpoint(
                            db,
                            args.run_group,
                            dataset,
                            scope_key,
                            {"status": "failed", "error": str(exc), "runId": run_id},
                        )
                if index % batch_size == 0 and index < len(scope_values):
                    time.sleep(sleep_seconds)

            summary["datasets"][dataset] = dataset_summary

        if not args.dry_run:
            _mark_run(db, run_id, "completed", {"summary": summary, "finishedAt": _now()})
    except Exception:
        if not args.dry_run:
            _mark_run(db, run_id, "failed", {"summary": summary, "finishedAt": _now()})
        raise

    print(json.dumps({"runId": run_id, **summary}, indent=2, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
