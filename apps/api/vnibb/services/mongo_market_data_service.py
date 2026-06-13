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
    """Lazy MongoDB accessor for the canonical `vnibb-market` corpus.

    Reads are the primary use. A single controlled writer
    (`bulk_upsert_eod_prices`) exists so the scheduled daily-EOD sync can keep
    `market_prices_eod` fresh through the same db-name/connection the reads use,
    avoiding the drift that occurs when only operator-run scripts write.
    The service never logs the connection string.
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
                        "dataset": "equity.intraday",
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
                {"dataset": "equity.price_depth", "symbol": symbol_upper},
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
        variant: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Return raw shared vnstock records for a symbol/dataset pair.

        ``variant`` filters on ``datasetVariant`` (e.g. the year/quarter split:
        dataset ``finance.ratio`` stores variants ``finance.ratio.year`` and
        ``finance.ratio.quarter``).
        """

        symbol_upper = symbol.upper()
        limit = max(1, min(limit, 5000))

        def _read() -> list[dict[str, Any]]:
            coll = self._get_collection("market_vnstock_premium_records")
            query: dict[str, Any] = {
                "dataset": dataset,
                "$or": [
                    {"symbol": symbol_upper},
                    {"scopeKey": symbol_upper},
                    {"raw.symbol": symbol_upper},
                ],
            }
            if variant is not None:
                query["datasetVariant"] = variant
            cursor = (
                coll.find(
                    query,
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

    async def get_universe_latest_eod(
        self,
        *,
        limit: int = 2000,
    ) -> list[dict[str, Any]]:
        """Return the two most recent EOD bars per symbol across the universe.

        Used as a resilience fallback for market-wide widgets (heatmap / breadth /
        money-flow) so a stale or empty Postgres ScreenerSnapshot cannot blank them
        while the n6v `market_prices_eod` collection is fresh. Returns one dict per
        symbol with the latest close/volume plus the prior close so callers can
        derive change_pct without a second query.
        """

        limit = max(1, min(limit, 5000))

        def _read() -> list[dict[str, Any]]:
            coll = self._get_collection("market_prices_eod")
            # Latest tradeDate present in the collection.
            latest_doc = list(
                coll.find({}, {"_id": 0, "tradeDate": 1}).sort("tradeDate", -1).limit(1)
            )
            if not latest_doc:
                return []
            latest_trade_date = latest_doc[0].get("tradeDate")
            if latest_trade_date is None:
                return []

            # Pull a recent window so we can compute prior close per symbol.
            window_start = latest_trade_date - timedelta(days=12)
            cursor = coll.find(
                {"tradeDate": {"$gte": window_start, "$lte": latest_trade_date}},
                {
                    "_id": 0,
                    "symbol": 1,
                    "tradeDate": 1,
                    "close": 1,
                    "open": 1,
                    "high": 1,
                    "low": 1,
                    "volume": 1,
                    "value": 1,
                },
            ).sort("tradeDate", 1)

            by_symbol: dict[str, list[dict[str, Any]]] = {}
            for doc in cursor:
                sym = str(doc.get("symbol") or "").upper()
                if not sym:
                    continue
                by_symbol.setdefault(sym, []).append(doc)

            results: list[dict[str, Any]] = []
            for sym, bars in by_symbol.items():
                if not bars:
                    continue
                latest = bars[-1]
                prev_close = bars[-2].get("close") if len(bars) >= 2 else None
                latest_close = latest.get("close")
                change_pct = None
                try:
                    if prev_close not in (None, 0) and latest_close is not None:
                        change_pct = ((float(latest_close) - float(prev_close)) / float(prev_close)) * 100
                except (TypeError, ValueError, ZeroDivisionError):
                    change_pct = None
                results.append(
                    {
                        "symbol": sym,
                        "tradeDate": latest.get("tradeDate"),
                        "price": latest_close,
                        "open": latest.get("open"),
                        "high": latest.get("high"),
                        "low": latest.get("low"),
                        "volume": latest.get("volume"),
                        "value": latest.get("value"),
                        "prev_close": prev_close,
                        "change_pct": change_pct,
                    }
                )

            # Largest by traded value first as a rough liquidity proxy.
            results.sort(
                key=lambda r: (r.get("value") or 0, r.get("volume") or 0),
                reverse=True,
            )
            return results[:limit]

        try:
            return await asyncio.to_thread(_read)
        except Exception as exc:
            logger.warning("Mongo universe latest-EOD read failed: %s", exc)
            return []

    async def get_universe_latest_trade_date(self) -> date | None:
        """Return the most recent ``tradeDate`` present in ``market_prices_eod``.

        Used by the daily writer (to size the catch-up window) and by callers
        that need to decide whether a Postgres snapshot is stale relative to the
        canonical Mongo corpus.
        """

        def _read() -> date | None:
            coll = self._get_collection("market_prices_eod")
            doc = list(
                coll.find({}, {"_id": 0, "tradeDate": 1}).sort("tradeDate", -1).limit(1)
            )
            if not doc:
                return None
            value = doc[0].get("tradeDate")
            if isinstance(value, datetime):
                return value.date()
            if isinstance(value, date):
                return value
            return None

        try:
            return await asyncio.to_thread(_read)
        except Exception as exc:
            logger.warning("Mongo latest trade-date read failed: %s", exc)
            return None

    async def get_latest_fundamental_snapshots(
        self,
        symbols: list[str] | None = None,
    ) -> dict[str, dict[str, Any]]:
        """Return the latest fundamental-screener snapshot per symbol.

        Reads ``market_fundamental_screener`` (written by the fundamental
        valuation backfill). Missing collection or any Mongo failure degrades
        to an empty mapping so screener responses simply carry null fields.
        """

        symbol_filter = sorted({s.upper() for s in symbols if s}) if symbols else None

        def _read() -> dict[str, dict[str, Any]]:
            coll = self._get_collection("market_fundamental_screener")
            pipeline: list[dict[str, Any]] = []
            if symbol_filter:
                pipeline.append({"$match": {"symbol": {"$in": symbol_filter}}})
            pipeline.extend(
                [
                    {"$sort": {"symbol": 1, "snapshotDate": -1}},
                    {"$group": {"_id": "$symbol", "doc": {"$first": "$$ROOT"}}},
                ]
            )
            results: dict[str, dict[str, Any]] = {}
            for row in coll.aggregate(pipeline):
                doc = row.get("doc")
                if not isinstance(doc, dict):
                    continue
                doc.pop("_id", None)
                symbol = str(doc.get("symbol") or "").upper()
                if symbol:
                    results[symbol] = doc
            return results

        try:
            return await asyncio.to_thread(_read)
        except Exception as exc:
            logger.warning("Mongo fundamental snapshot read failed: %s", exc)
            return {}

    async def bulk_upsert_eod_prices(
        self,
        symbol: str,
        rows: list[dict[str, Any]],
    ) -> int:
        """Upsert normalized EOD OHLCV rows into ``market_prices_eod``.

        The scheduled vnstock path is a fallback behind the Vietcap-primary
        corpus. Runtime reads filter only on ``symbol``/``tradeDate`` and ignore
        ``source``, so this writer must never create a vnstock row for a day that
        already has a Vietcap bar. vnstock prices also arrive in thousand VND;
        the corpus now uses raw VND, so OHLC values are multiplied by 1000 before
        persisting and marked with ``priceUnit='VND'``. Rows must already be
        normalized dicts carrying ``tradeDate`` (a naive ``datetime``) plus OHLCV
        fields. Returns the number of upsert operations issued.
        """

        symbol_upper = symbol.upper()
        if not rows:
            return 0

        def _write() -> int:
            from pymongo import UpdateOne

            coll = self._get_collection("market_prices_eod")
            synced_at = datetime.now(UTC).replace(tzinfo=None)
            normalized_rows: list[dict[str, Any]] = []
            for raw in rows:
                trade_date = raw.get("tradeDate")
                if not isinstance(trade_date, datetime):
                    continue
                # The existing corpus stores tradeDate at 07:00:00 (ICT close,
                # naive). Normalize to that exact instant so the
                # (symbol, tradeDate, source) upsert key matches the existing
                # document and overwrites it in place. A date-only (00:00:00)
                # key would miss the existing bar and insert a duplicate for the
                # same trading day, which poisons the chart series.
                trade_date = trade_date.replace(
                    hour=7, minute=0, second=0, microsecond=0
                )
                close_value = raw.get("close")
                if close_value is None:
                    # An EOD bar without a close is unusable downstream; skip it
                    # rather than overwrite a good prior value with a null.
                    continue
                normalized_rows.append({**raw, "tradeDate": trade_date})

            if not normalized_rows:
                return 0

            vietcap_dates = {
                doc.get("tradeDate")
                for doc in coll.find(
                    {
                        "symbol": symbol_upper,
                        "source": "vietcap",
                        "tradeDate": {"$in": [row["tradeDate"] for row in normalized_rows]},
                    },
                    {"_id": 0, "tradeDate": 1},
                )
                if doc.get("tradeDate") is not None
            }

            def _scale_price(value: Any) -> float | None:
                if value is None:
                    return None
                try:
                    return float(value) * 1000
                except (TypeError, ValueError):
                    return None

            ops: list[Any] = []
            for raw in normalized_rows:
                trade_date = raw["tradeDate"]
                if trade_date in vietcap_dates:
                    # Vietcap is primary. Do not create a duplicate vnstock-data
                    # bar for a date already covered by Vietcap.
                    continue

                doc = {
                    "symbol": symbol_upper,
                    "tradeDate": trade_date,
                    "interval": "1D",
                    "source": "vnstock-data",
                    "sourceKey": (
                        f"vnstock-data:{symbol_upper}:eod:"
                        f"{trade_date.date().isoformat()}"
                    ),
                    "open": _scale_price(raw.get("open")),
                    "high": _scale_price(raw.get("high")),
                    "low": _scale_price(raw.get("low")),
                    "close": _scale_price(raw.get("close")),
                    "volume": raw.get("volume"),
                    "value": raw.get("value"),
                    "priceUnit": "VND",
                    "rescaledFromThousandVnd": True,
                    "updatedAt": synced_at,
                    "syncedAt": synced_at,
                    "schemaVersion": 1,
                }
                ops.append(
                    UpdateOne(
                        {
                            "symbol": symbol_upper,
                            "tradeDate": trade_date,
                            "source": "vnstock-data",
                        },
                        {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
                        upsert=True,
                    )
                )
            if not ops:
                return 0
            coll.bulk_write(ops, ordered=False)
            return len(ops)

        try:
            return await asyncio.to_thread(_write)
        except Exception as exc:
            logger.warning("Mongo EOD upsert failed for %s: %s", symbol_upper, exc)
            return 0


@lru_cache(maxsize=1)
def get_mongo_market_data_service() -> MongoMarketDataService:
    return MongoMarketDataService()
