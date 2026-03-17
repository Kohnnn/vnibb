from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select

from vnibb.core.appwrite_client import (
    get_appwrite_stock,
    get_appwrite_stock_price_coverage,
    get_appwrite_stock_prices,
    list_appwrite_stock_symbols,
)
from vnibb.core.cache import build_cache_key
from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.models.stock import Stock, StockPrice
from vnibb.services.appwrite_population import (
    DEFAULT_PUBLIC_READ_PERMISSIONS,
    upsert_appwrite_documents,
)
from vnibb.services.data_pipeline import (
    CACHE_TTL_PRICE_LATEST,
    CACHE_TTL_PRICE_RECENT,
    RECENT_PRICE_DAYS,
    data_pipeline,
)

logger = logging.getLogger(__name__)

STOCK_PRICE_COLLECTION_ID = "stock_prices"
STOCK_PRICE_DOCUMENT_KEYS = ("symbol", "time", "interval")
STOCK_PRICE_PRECISION_COLUMNS = {"open", "high", "low", "close", "adj_close", "value"}


@dataclass
class AppwritePriceSyncStats:
    symbols_requested: int = 0
    symbols_processed: int = 0
    symbols_skipped: int = 0
    symbols_failed: int = 0
    rows_created: int = 0
    rows_updated: int = 0
    rows_failed: int = 0

    @property
    def rows_upserted(self) -> int:
        return self.rows_created + self.rows_updated


class AppwritePriceService:
    def __init__(self, source: str | None = None):
        self.source = (source or settings.vnstock_source or "KBS").strip().upper()

    @staticmethod
    def _normalize_symbols(symbols: list[str] | None) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for symbol in symbols or []:
            value = str(symbol or "").strip().upper()
            if not value or value in seen:
                continue
            seen.add(value)
            normalized.append(value)
        return normalized

    @staticmethod
    def _appwrite_time(day: date) -> str:
        return f"{day.isoformat()}T17:00:00.000Z"

    @staticmethod
    def _created_at_iso() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    @staticmethod
    def _synthetic_row_id(symbol: str, row_time: str, interval: str = "1D") -> str:
        return f"{symbol.upper()}:{row_time}:{interval.upper()}"

    @staticmethod
    def _payload_from_stock_price(row: StockPrice) -> dict[str, Any]:
        row_time = AppwritePriceService._appwrite_time(row.time)
        created_at = (
            row.created_at.isoformat()
            if getattr(row, "created_at", None)
            else AppwritePriceService._created_at_iso()
        )
        return {
            "id": str(row.id),
            "stock_id": str(row.stock_id),
            "symbol": row.symbol.upper(),
            "time": row_time,
            "open": float(row.open),
            "high": float(row.high),
            "low": float(row.low),
            "close": float(row.close),
            "volume": int(row.volume),
            "value": None,
            "adj_close": None,
            "interval": row.interval or "1D",
            "source": row.source or "vnstock",
            "created_at": created_at,
        }

    async def _resolve_symbols(
        self,
        symbols: list[str] | None = None,
        max_symbols: int | None = None,
    ) -> list[str]:
        normalized = self._normalize_symbols(symbols)
        if normalized:
            return normalized[:max_symbols] if max_symbols is not None else normalized

        if settings.is_appwrite_configured:
            appwrite_symbols = await list_appwrite_stock_symbols(active_only=True)
            if appwrite_symbols:
                return (
                    appwrite_symbols[:max_symbols] if max_symbols is not None else appwrite_symbols
                )

        async with async_session_maker() as session:
            result = await session.execute(
                select(Stock.symbol).where(Stock.is_active == 1).order_by(Stock.symbol.asc())
            )
            db_symbols = [str(row[0]).strip().upper() for row in result.fetchall() if row[0]]
        return db_symbols[:max_symbols] if max_symbols is not None else db_symbols

    async def _get_appwrite_stock_id(self, symbol: str) -> str | None:
        stock_doc = await get_appwrite_stock(symbol)
        if not stock_doc:
            return None
        stock_id = str(stock_doc.get("id") or "").strip()
        return stock_id or None

    async def _resolve_provider_fetch_ranges(
        self,
        symbol: str,
        start_date: date,
        end_date: date,
        *,
        fill_missing_gaps: bool,
    ) -> list[tuple[date, date]]:
        if not fill_missing_gaps:
            return [(start_date, end_date)]

        earliest_raw, latest_raw = await get_appwrite_stock_price_coverage(symbol, interval="1D")
        if not earliest_raw or not latest_raw:
            return [(start_date, end_date)]

        try:
            earliest = date.fromisoformat(str(earliest_raw)[:10])
            latest = date.fromisoformat(str(latest_raw)[:10])
        except ValueError:
            return [(start_date, end_date)]

        ranges: list[tuple[date, date]] = []
        if start_date < earliest:
            head_end = min(end_date, earliest - timedelta(days=1))
            if start_date <= head_end:
                ranges.append((start_date, head_end))
        if latest < end_date:
            tail_start = max(start_date, latest + timedelta(days=1))
            if tail_start <= end_date:
                ranges.append((tail_start, end_date))
        return ranges

    async def _fetch_provider_rows(
        self,
        symbol: str,
        start_date: date,
        end_date: date,
    ) -> list[dict[str, Any]]:
        await data_pipeline._wait_for_rate_limit("prices")
        frame = await data_pipeline._fetch_quote_history_frame(
            symbol=symbol,
            start=start_date.isoformat(),
            end=end_date.isoformat(),
            interval="1D",
            bypass_internal_retry=True,
        )
        if frame is None or frame.empty:
            return []

        created_at = self._created_at_iso()
        rows: list[dict[str, Any]] = []
        for _, row in frame.iterrows():
            row_day = row["time"].date() if hasattr(row["time"], "date") else row["time"]
            if not isinstance(row_day, date):
                continue
            row_time = self._appwrite_time(row_day)
            rows.append(
                {
                    "id": self._synthetic_row_id(symbol, row_time),
                    "symbol": symbol.upper(),
                    "time": row_time,
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": int(row["volume"]),
                    "value": None,
                    "adj_close": None,
                    "interval": "1D",
                    "source": "vnstock",
                    "created_at": created_at,
                }
            )
        return rows

    @staticmethod
    def _dedupe_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        deduped: dict[tuple[str, str, str], dict[str, Any]] = {}
        for row in rows:
            key = (
                str(row.get("symbol") or "").upper(),
                str(row.get("time") or ""),
                str(row.get("interval") or "1D").upper(),
            )
            deduped[key] = row
        ordered = list(deduped.values())
        ordered.sort(key=lambda row: str(row.get("time") or ""))
        return ordered

    async def _upsert_rows(
        self,
        rows: list[dict[str, Any]],
        *,
        appwrite_concurrency: int,
        appwrite_batch_size: int,
    ) -> dict[str, int]:
        return await upsert_appwrite_documents(
            STOCK_PRICE_COLLECTION_ID,
            rows,
            document_id_columns=STOCK_PRICE_DOCUMENT_KEYS,
            precision_columns=STOCK_PRICE_PRECISION_COLUMNS,
            permissions=DEFAULT_PUBLIC_READ_PERMISSIONS,
            concurrency=appwrite_concurrency,
            batch_size=appwrite_batch_size,
        )

    async def _refresh_symbol_price_cache(self, symbol: str, end_date: date) -> None:
        latest_docs = await get_appwrite_stock_prices(
            symbol, interval="1D", limit=2, descending=True
        )
        if latest_docs:
            latest_doc = latest_docs[0]
            latest_payload = {
                "symbol": symbol.upper(),
                "time": latest_doc.get("time"),
                "open": float(latest_doc.get("open"))
                if latest_doc.get("open") is not None
                else None,
                "high": float(latest_doc.get("high"))
                if latest_doc.get("high") is not None
                else None,
                "low": float(latest_doc.get("low")) if latest_doc.get("low") is not None else None,
                "close": float(latest_doc.get("close"))
                if latest_doc.get("close") is not None
                else None,
                "volume": int(latest_doc.get("volume"))
                if latest_doc.get("volume") is not None
                else None,
                "interval": latest_doc.get("interval") or "1D",
            }
            latest_key = build_cache_key("vnibb", "price", "latest", symbol.upper())
            await data_pipeline._cache_set_json(latest_key, latest_payload, CACHE_TTL_PRICE_LATEST)

        recent_start = max(date(2019, 1, 1), end_date - timedelta(days=RECENT_PRICE_DAYS))
        recent_docs = await get_appwrite_stock_prices(
            symbol,
            interval="1D",
            start_date=recent_start,
            end_date=end_date,
            limit=max(RECENT_PRICE_DAYS * 6, 500),
            descending=False,
        )
        if recent_docs:
            recent_rows = [
                {
                    "time": doc.get("time"),
                    "open": float(doc.get("open")) if doc.get("open") is not None else None,
                    "high": float(doc.get("high")) if doc.get("high") is not None else None,
                    "low": float(doc.get("low")) if doc.get("low") is not None else None,
                    "close": float(doc.get("close")) if doc.get("close") is not None else None,
                    "volume": int(doc.get("volume")) if doc.get("volume") is not None else None,
                }
                for doc in recent_docs
            ]
            recent_key = build_cache_key("vnibb", "price", "recent", symbol.upper())
            await data_pipeline._cache_set_json(recent_key, recent_rows, CACHE_TTL_PRICE_RECENT)

    async def mirror_prices_from_postgres(
        self,
        *,
        symbols: list[str] | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        max_symbols: int | None = None,
        cache_recent: bool = True,
        symbol_concurrency: int = 2,
        appwrite_concurrency: int = 6,
        appwrite_batch_size: int = 200,
    ) -> AppwritePriceSyncStats:
        resolved_symbols = await self._resolve_symbols(symbols, max_symbols=max_symbols)
        stats = AppwritePriceSyncStats(symbols_requested=len(resolved_symbols))
        if not resolved_symbols:
            return stats

        async with async_session_maker() as session:
            stmt = (
                select(StockPrice)
                .where(
                    StockPrice.interval == "1D",
                    StockPrice.symbol.in_(resolved_symbols),
                )
                .order_by(StockPrice.symbol.asc(), StockPrice.time.asc())
            )
            if start_date is not None:
                stmt = stmt.where(StockPrice.time >= start_date)
            if end_date is not None:
                stmt = stmt.where(StockPrice.time <= end_date)

            result = await session.execute(stmt)
            price_rows = list(result.scalars().all())

        rows_by_symbol: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in price_rows:
            rows_by_symbol[row.symbol.upper()].append(self._payload_from_stock_price(row))

        lock = asyncio.Lock()
        semaphore = asyncio.Semaphore(max(1, symbol_concurrency))

        async def worker(symbol: str) -> None:
            async with semaphore:
                symbol_rows = rows_by_symbol.get(symbol, [])
                if not symbol_rows:
                    async with lock:
                        stats.symbols_skipped += 1
                    return

                try:
                    result = await self._upsert_rows(
                        symbol_rows,
                        appwrite_concurrency=appwrite_concurrency,
                        appwrite_batch_size=appwrite_batch_size,
                    )
                    if cache_recent:
                        cache_end_date = end_date or date.today()
                        await self._refresh_symbol_price_cache(symbol, cache_end_date)

                    async with lock:
                        stats.symbols_processed += 1
                        stats.rows_created += result["created"]
                        stats.rows_updated += result["updated"]
                        stats.rows_failed += result["failed"]
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Appwrite Postgres mirror failed for %s: %s", symbol, exc)
                    async with lock:
                        stats.symbols_failed += 1

        await asyncio.gather(*(worker(symbol) for symbol in resolved_symbols))
        return stats

    async def sync_prices_from_provider(
        self,
        *,
        symbols: list[str] | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        max_symbols: int | None = None,
        fill_missing_gaps: bool = True,
        cache_recent: bool = True,
        symbol_concurrency: int = 2,
        appwrite_concurrency: int = 6,
        appwrite_batch_size: int = 150,
    ) -> AppwritePriceSyncStats:
        resolved_symbols = await self._resolve_symbols(symbols, max_symbols=max_symbols)
        stats = AppwritePriceSyncStats(symbols_requested=len(resolved_symbols))
        if not resolved_symbols:
            return stats

        resolved_end = end_date or date.today()
        resolved_start = start_date or (resolved_end - timedelta(days=30))
        if resolved_start > resolved_end:
            resolved_start, resolved_end = resolved_end, resolved_start

        lock = asyncio.Lock()
        semaphore = asyncio.Semaphore(max(1, symbol_concurrency))

        async def worker(symbol: str) -> None:
            async with semaphore:
                stock_id = await self._get_appwrite_stock_id(symbol)
                if not stock_id:
                    logger.warning(
                        "Skipping Appwrite price sync for %s: stock document not found", symbol
                    )
                    async with lock:
                        stats.symbols_skipped += 1
                    return

                try:
                    fetch_ranges = await self._resolve_provider_fetch_ranges(
                        symbol,
                        resolved_start,
                        resolved_end,
                        fill_missing_gaps=fill_missing_gaps,
                    )
                    if not fetch_ranges:
                        async with lock:
                            stats.symbols_skipped += 1
                        if cache_recent:
                            await self._refresh_symbol_price_cache(symbol, resolved_end)
                        return

                    provider_rows: list[dict[str, Any]] = []
                    for range_start, range_end in fetch_ranges:
                        range_rows = await self._fetch_provider_rows(symbol, range_start, range_end)
                        for row in range_rows:
                            row["stock_id"] = stock_id
                        provider_rows.extend(range_rows)

                    provider_rows = self._dedupe_rows(provider_rows)
                    if not provider_rows:
                        async with lock:
                            stats.symbols_skipped += 1
                        return

                    result = await self._upsert_rows(
                        provider_rows,
                        appwrite_concurrency=appwrite_concurrency,
                        appwrite_batch_size=appwrite_batch_size,
                    )
                    if cache_recent:
                        await self._refresh_symbol_price_cache(symbol, resolved_end)

                    async with lock:
                        stats.symbols_processed += 1
                        stats.rows_created += result["created"]
                        stats.rows_updated += result["updated"]
                        stats.rows_failed += result["failed"]
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "Appwrite provider price sync failed for %s (%s -> %s): %s",
                        symbol,
                        resolved_start,
                        resolved_end,
                        exc,
                    )
                    async with lock:
                        stats.symbols_failed += 1

        await asyncio.gather(*(worker(symbol) for symbol in resolved_symbols))
        return stats
