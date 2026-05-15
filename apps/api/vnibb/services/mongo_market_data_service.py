"""Read-only MongoDB access for analytical market datasets."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, date, datetime, time, timedelta
from functools import lru_cache
from typing import Any

from vnibb.core.config import settings

logger = logging.getLogger(__name__)


class MongoMarketDataService:
    """Lazy MongoDB reader for FRB market data.

    The service intentionally performs no writes and never logs the connection string.
    """

    def __init__(self) -> None:
        self._client: Any | None = None

    @property
    def enabled(self) -> bool:
        return bool(settings.mongodb_enabled and settings.mongodb_url)

    def _get_collection(self, name: str) -> Any:
        if not self.enabled:
            raise RuntimeError("MongoDB analytical source is not configured")

        if self._client is None:
            try:
                from pymongo import MongoClient
            except Exception as exc:  # pragma: no cover - depends on environment
                raise RuntimeError("pymongo is required for MongoDB analytical reads") from exc

            self._client = MongoClient(
                settings.mongodb_url,
                serverSelectionTimeoutMS=settings.mongodb_timeout_ms,
                connectTimeoutMS=settings.mongodb_timeout_ms,
                socketTimeoutMS=max(settings.mongodb_timeout_ms, 20000),
            )

        return self._client[settings.mongodb_database][name]

    def _get_database(self) -> Any:
        if not self.enabled:
            raise RuntimeError("MongoDB analytical source is not configured")

        if self._client is None:
            self._get_collection("__connectivity_probe__")

        return self._client[settings.mongodb_database]

    async def inspect_collections(
        self,
        *,
        name_filter: str | None = None,
        sample_limit: int = 5,
    ) -> list[dict[str, Any]]:
        """Return safe collection metadata for wiring decisions."""

        sample_limit = max(1, min(sample_limit, 20))
        filter_text = str(name_filter or "").strip().lower()

        def _read() -> list[dict[str, Any]]:
            db = self._get_database()
            names = sorted(db.list_collection_names())
            if filter_text:
                names = [name for name in names if filter_text in name.lower()]

            results: list[dict[str, Any]] = []
            for name in names:
                coll = db[name]
                sample = list(coll.find({}, {"_id": 0}).limit(sample_limit))
                field_names = sorted({field for row in sample for field in row.keys()})
                if "dataset" in field_names:
                    dataset_values = sorted(str(value) for value in coll.distinct("dataset") if value is not None)[:100]
                else:
                    dataset_values = []
                results.append(
                    {
                        "name": name,
                        "estimated_count": coll.estimated_document_count(),
                        "sample_fields": field_names,
                        "sample_datasets": dataset_values,
                    }
                )
            return results

        try:
            return await asyncio.to_thread(_read)
        except Exception as exc:
            logger.warning("Mongo collection inspection failed: %s", exc)
            return []

    async def get_intraday_trades(
        self,
        symbol: str,
        *,
        lookback_days: int = 7,
        limit: int = 5000,
    ) -> list[dict[str, Any]]:
        """Return tick-like trade rows, preferring the typed derived read model."""

        symbol_upper = symbol.upper()
        lookback_start = datetime.now(UTC) - timedelta(days=max(1, lookback_days))
        limit = max(1, min(limit, 20000))

        def _read_derived() -> list[dict[str, Any]]:
            coll = self._get_collection("market_intraday_trades")
            cursor = (
                coll.find(
                    {
                        "symbol": symbol_upper,
                        "tradeTime": {"$gte": lookback_start.replace(tzinfo=None)},
                    },
                    {
                        "_id": 0,
                        "tradeTime": 1,
                        "price": 1,
                        "volume": 1,
                        "matchType": 1,
                        "tradeId": 1,
                        "symbol": 1,
                    },
                )
                .sort("tradeTime", 1)
                .limit(limit)
            )
            return [
                {
                    "observedAt": row.get("tradeTime"),
                    "raw": {
                        "time": row.get("tradeTime"),
                        "price": row.get("price"),
                        "volume": row.get("volume"),
                        "match_type": row.get("matchType"),
                        "id": row.get("tradeId"),
                        "symbol": row.get("symbol"),
                    },
                    "sourceCollection": "market_intraday_trades",
                }
                for row in cursor
            ]

        def _read_raw() -> list[dict[str, Any]]:
            coll = self._get_collection("market_vnstock_premium_records")
            cursor = (
                coll.find(
                    {
                        "dataset": "quote.intraday",
                        "symbol": symbol_upper,
                        "observedAt": {"$gte": lookback_start.replace(tzinfo=None)},
                    },
                    {
                        "_id": 0,
                        "observedAt": 1,
                        "raw.time": 1,
                        "raw.price": 1,
                        "raw.volume": 1,
                        "raw.match_type": 1,
                        "raw.id": 1,
                        "raw.symbol": 1,
                    },
                )
                .sort("observedAt", 1)
                .limit(limit)
            )
            return list(cursor)

        try:
            rows = await asyncio.to_thread(_read_derived)
            if rows:
                return rows
            return await asyncio.to_thread(_read_raw)
        except Exception as exc:
            logger.warning("Mongo derived intraday read failed for %s: %s", symbol_upper, exc)
            try:
                return await asyncio.to_thread(_read_raw)
            except Exception as raw_exc:
                logger.warning("Mongo raw intraday read failed for %s: %s", symbol_upper, raw_exc)
                return []

    async def get_price_depth(self, symbol: str, *, limit: int = 500) -> list[dict[str, Any]]:
        """Return normalized volume-at-price rows from raw price-depth records."""

        symbol_upper = symbol.upper()
        limit = max(1, min(limit, 5000))

        def _read() -> list[dict[str, Any]]:
            coll = self._get_collection("market_vnstock_premium_records")
            cursor = coll.find(
                {"dataset": "quote.price_depth", "symbol": symbol_upper},
                {
                    "_id": 0,
                    "raw.price": 1,
                    "raw.volume": 1,
                    "raw.buy_volume": 1,
                    "raw.sell_volume": 1,
                    "raw.undefined_volume": 1,
                    "raw.symbol": 1,
                },
            ).limit(limit)
            return list(cursor)

        try:
            return await asyncio.to_thread(_read)
        except Exception as exc:
            logger.warning("Mongo price-depth read failed for %s: %s", symbol_upper, exc)
            return []

    async def get_raw_dataset_records(
        self,
        symbol: str,
        *,
        dataset: str,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Return raw shared vnstock records for a symbol/dataset pair."""

        symbol_upper = symbol.upper()
        limit = max(1, min(limit, 5000))

        def _read() -> list[dict[str, Any]]:
            coll = self._get_collection("market_vnstock_premium_records")
            cursor = (
                coll.find(
                    {
                        "dataset": dataset,
                        "$or": [
                            {"symbol": symbol_upper},
                            {"scopeKey": symbol_upper},
                            {"raw.symbol": symbol_upper},
                        ],
                    },
                    {"_id": 0, "raw": 1, "observedAt": 1, "updatedAt": 1, "dataset": 1},
                )
                .sort([("observedAt", -1), ("updatedAt", -1)])
                .limit(limit)
            )
            return list(cursor)

        try:
            return await asyncio.to_thread(_read)
        except Exception as exc:
            logger.warning("Mongo raw dataset read failed for %s %s: %s", symbol_upper, dataset, exc)
            return []

    async def get_eod_prices(
        self,
        symbol: str,
        *,
        lookback_days: int = 365,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        """Return normalized EOD OHLCV rows."""

        symbol_upper = symbol.upper()
        lookback_start = datetime.now(UTC) - timedelta(days=max(1, lookback_days))
        limit = max(1, min(limit, 5000))

        def _read() -> list[dict[str, Any]]:
            coll = self._get_collection("market_prices_eod")
            cursor = (
                coll.find(
                    {
                        "symbol": symbol_upper,
                        "tradeDate": {"$gte": lookback_start.replace(tzinfo=None)},
                    },
                    {
                        "_id": 0,
                        "symbol": 1,
                        "tradeDate": 1,
                        "open": 1,
                        "high": 1,
                        "low": 1,
                        "close": 1,
                        "volume": 1,
                        "value": 1,
                    },
                )
                .sort("tradeDate", 1)
                .limit(limit)
            )
            return list(cursor)

        try:
            return await asyncio.to_thread(_read)
        except Exception as exc:
            logger.warning("Mongo EOD read failed for %s: %s", symbol_upper, exc)
            return []

    async def get_eod_prices_between(
        self,
        symbol: str,
        *,
        start_date: date,
        end_date: date,
        limit: int = 20000,
    ) -> list[dict[str, Any]]:
        """Return normalized EOD OHLCV rows for an explicit date range."""

        symbol_upper = symbol.upper()
        limit = max(1, min(limit, 50000))
        start_dt = datetime.combine(start_date, time.min)
        end_dt = datetime.combine(end_date, time.max)

        def _read() -> list[dict[str, Any]]:
            coll = self._get_collection("market_prices_eod")
            cursor = (
                coll.find(
                    {
                        "symbol": symbol_upper,
                        "tradeDate": {"$gte": start_dt, "$lte": end_dt},
                    },
                    {
                        "_id": 0,
                        "symbol": 1,
                        "tradeDate": 1,
                        "open": 1,
                        "high": 1,
                        "low": 1,
                        "close": 1,
                        "volume": 1,
                        "value": 1,
                        "adjClose": 1,
                        "adj_close": 1,
                    },
                )
                .sort("tradeDate", 1)
                .limit(limit)
            )
            return list(cursor)

        try:
            return await asyncio.to_thread(_read)
        except Exception as exc:
            logger.warning("Mongo EOD range read failed for %s: %s", symbol_upper, exc)
            return []


@lru_cache(maxsize=1)
def get_mongo_market_data_service() -> MongoMarketDataService:
    return MongoMarketDataService()
