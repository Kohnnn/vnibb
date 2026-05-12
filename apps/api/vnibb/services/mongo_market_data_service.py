"""Read-only MongoDB access for analytical market datasets."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
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

    async def get_intraday_trades(
        self,
        symbol: str,
        *,
        lookback_days: int = 7,
        limit: int = 5000,
    ) -> list[dict[str, Any]]:
        """Return tick-like trade rows, preferring the typed derived read model."""

        symbol_upper = symbol.upper()
        lookback_start = datetime.now(timezone.utc) - timedelta(days=max(1, lookback_days))
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

    async def get_eod_prices(
        self,
        symbol: str,
        *,
        lookback_days: int = 365,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        """Return normalized EOD OHLCV rows."""

        symbol_upper = symbol.upper()
        lookback_start = datetime.now(timezone.utc) - timedelta(days=max(1, lookback_days))
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


@lru_cache(maxsize=1)
def get_mongo_market_data_service() -> MongoMarketDataService:
    return MongoMarketDataService()
