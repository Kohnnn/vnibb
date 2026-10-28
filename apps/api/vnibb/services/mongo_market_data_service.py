"""Read-only MongoDB access for analytical market datasets."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re
from collections.abc import Iterable
from datetime import UTC, date, datetime, time, timedelta
from functools import lru_cache
from hashlib import sha256
from typing import Any

from vnibb.core.config import settings
from vnibb.core.price_units import normalize_price_record

logger = logging.getLogger(__name__)


class MongoReadRows(list[dict[str, Any]]):
    """Rows plus retained batch evidence, including explicit empty source receipts."""

    def __init__(self, rows: Iterable[dict[str, Any]], metadata: dict[str, Any]) -> None:
        super().__init__(rows)
        self.metadata = metadata


class MongoReadError(RuntimeError):
    """Safe store-access failure, never a successful empty read."""

    def __init__(self, state: str) -> None:
        self.state = state
        super().__init__(f"MongoDB analytical read {state}; retry or check store configuration/connectivity")


def _mongo_read_error(exc: Exception) -> MongoReadError:
    if isinstance(exc, MongoReadError):
        return exc
    from pymongo.errors import ConnectionFailure, ExecutionTimeout, NetworkTimeout

    if isinstance(exc, (TimeoutError, ExecutionTimeout, NetworkTimeout)) or getattr(exc, "timeout", False):
        return MongoReadError("timeout")
    if isinstance(exc, (ConnectionError, ConnectionFailure)):
        return MongoReadError("unavailable")
    return MongoReadError("query_failed")


async def _read_mongo(reader: Any, *, empty_page: bool = False) -> Any:
    try:
        result = await asyncio.to_thread(reader)
        if empty_page:
            return MongoReadRows([], result.metadata) if isinstance(result, MongoReadRows) else []
        return result
    except Exception as exc:
        raise _mongo_read_error(exc) from None


_EOD_SOURCE_RANK = {"vietcap": 0, "vnstock-data": 1}
_EOD_LINEAGE_FIELDS = ("updatedAt", "observedAt", "ingestedAt", "sourceUpdatedAt")


def _eod_lineage_rank(value: Any) -> float:
    if isinstance(value, datetime):
        return -value.timestamp()
    if isinstance(value, date):
        return -datetime.combine(value, time.min).timestamp()
    if isinstance(value, str):
        try:
            return -datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return 0.0
    return 0.0


def _is_valid_eod_ohlcv(row: dict[str, Any]) -> bool:
    values: dict[str, float] = {}
    for field in ("open", "high", "low", "close", "volume"):
        value = row.get(field)
        if isinstance(value, bool):
            return False
        try:
            values[field] = float(value)
        except (TypeError, ValueError):
            return False
        if not math.isfinite(values[field]):
            return False
    return (
        values["open"] > 0
        and values["high"] > 0
        and values["low"] > 0
        and values["close"] > 0
        and values["volume"] >= 0
        and values["volume"].is_integer()
        and values["high"] >= max(values["open"], values["low"], values["close"])
        and values["low"] <= min(values["open"], values["high"], values["close"])
    )


def _eod_row_rank(row: dict[str, Any]) -> tuple[Any, ...]:
    source = str(row.get("source") or "").strip().lower()
    unit = str(row.get("priceUnit") or "").strip().upper()
    return (
        0 if unit == "VND" and _is_valid_eod_ohlcv(row) else 1,
        _EOD_SOURCE_RANK.get(source, 2),
        tuple(_eod_lineage_rank(row.get(field)) for field in _EOD_LINEAGE_FIELDS),
        str(row.get("sourceKey") or ""),
        json.dumps(row, default=str, sort_keys=True, separators=(",", ":")),
    )


def _eod_trade_day(row: dict[str, Any]) -> Any:
    trade_date = row.get("tradeDate")
    return trade_date.date() if isinstance(trade_date, datetime) else trade_date


def _to_float(value: Any) -> float:
    """Coerce a stored price/volume value to float, invalid to 0."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _stream_eod_days(cursor: Iterable[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    days: set[Any] = set()
    for row in cursor:
        trade_day = _eod_trade_day(row)
        if trade_day is None:
            continue
        if trade_day not in days:
            if len(days) == limit:
                break
            days.add(trade_day)
        rows.append(row)
    return rows


def _dedup_eod_rows(
    rows: Iterable[dict[str, Any]],
    *,
    limit: int | None = None,
    preserve_provenance: bool = True,
) -> list[dict[str, Any]]:
    """Collapse to one deterministically ranked bar per logical trade date."""

    best: dict[Any, tuple[tuple[Any, ...], dict[str, Any]]] = {}
    for row in rows:
        key = _eod_trade_day(row)
        if key is None:
            continue
        rank = _eod_row_rank(row)
        current = best.get(key)
        if current is None or rank < current[0]:
            best[key] = (rank, dict(row))
    deduped = [row for _, row in best.values()]
    if not preserve_provenance:
        for row in deduped:
            row.pop("source", None)
            row.pop("sourceKey", None)
            for field in _EOD_LINEAGE_FIELDS:
                row.pop(field, None)
    deduped.sort(key=lambda row: row.get("tradeDate") or datetime.min)
    return deduped[:limit] if limit is not None else deduped


class MongoMarketDataService:
    """Lazy MongoDB accessor for the canonical `vnibb-market` corpus.

    Reads are primary. Controlled EOD and opt-in session writers retain raw
    evidence through the same database connection used by analytical reads.
    The service never logs the connection string.
    """

    def __init__(self) -> None:
        self._client: Any | None = None

    @property
    def enabled(self) -> bool:
        return bool(settings.mongodb_enabled and settings.mongodb_url)

    def _get_collection(self, name: str) -> Any:
        if not self.enabled:
            raise MongoReadError("not_configured")

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

    def _session_collection(self) -> Any:
        from pymongo import ReadPreference
        from pymongo.read_concern import ReadConcern
        from pymongo.write_concern import WriteConcern

        if not self.enabled:
            raise RuntimeError("MongoDB analytical source is not configured")

        collection = self._get_collection("market_vnstock_premium_records").with_options(
            write_concern=WriteConcern(w="majority", j=True),
            read_concern=ReadConcern("majority"), read_preference=ReadPreference.PRIMARY,
        )
        collection.create_index(
            [("recordKey", 1)], unique=True, name="uniq_price_board_record_key",
            partialFilterExpression={"dataset": {"$in": ["equity.price_board", "equity.price_board_envelope"]}},
        )
        return collection

    def retain_price_board_envelope(
        self, requested: list[str], raw: Any, session: date, observed_at: datetime,
    ) -> None:
        payload = {"requested_symbols": requested, "session_date": session.isoformat(), "raw": raw}
        digest = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        key = f"vietcap:price_board_envelope:{session.isoformat()}:{digest}"
        collection = self._session_collection()
        result = collection.update_one({"recordKey": key}, {"$setOnInsert": {
            **payload, "recordKey": key, "dataset": "equity.price_board_envelope",
            "source": "vietcap", "observed_at": observed_at.isoformat(),
        }}, upsert=True)
        if not result.acknowledged:
            raise RuntimeError("Unacknowledged price-board envelope retention")
        retained = collection.find_one({"recordKey": key})
        retained_payload = {field: retained.get(field) for field in payload} if retained else None
        if json.dumps(retained_payload, sort_keys=True, separators=(",", ":")) != json.dumps(payload, sort_keys=True, separators=(",", ":")):
            raise RuntimeError("Price-board envelope retention could not be verified")

    def retain_market_sessions(self, records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        from pymongo import UpdateOne
        from pymongo.errors import BulkWriteError

        from vnibb.services.market_session import session_coverage

        if not records:
            return {}
        collection = self._session_collection()
        keyed = {
            f"vietcap:price_board:{record['symbol']}:{record['session_date']}": record
            for record in records
        }
        operations = [UpdateOne({"recordKey": key}, {"$setOnInsert": {
            **record, "recordKey": key, "dataset": "equity.price_board",
            "updatedAt": datetime.fromisoformat(record["observed_at"]),
        }}, upsert=True) for key, record in keyed.items()]
        failed: set[int] = set()
        try:
            result = collection.bulk_write(operations, ordered=False)
            if not result.acknowledged:
                raise RuntimeError("Unacknowledged market-session retention")
        except BulkWriteError as exc:
            if exc.details.get("writeConcernErrors") or not exc.details.get("writeErrors"):
                raise
            failed = {error["index"] for error in exc.details["writeErrors"]}
        retained = {}
        for index, (key, record) in enumerate(keyed.items()):
            if index in failed:
                continue
            stored = collection.find_one({"recordKey": key})
            if stored is None:
                continue
            candidate = {field: stored.get(field) for field in record}
            if (
                all(candidate[field] == value for field, value in record.items() if field != "observed_at")
                and session_coverage(candidate, record["symbol"], date.fromisoformat(record["session_date"]))
            ):
                retained[record["symbol"]] = candidate
        return retained

    def verified_market_sessions(
        self, records: dict[str, dict[str, Any]], envelopes: list[dict[str, Any]],
    ) -> set[str]:
        """Recheck immutable qualified rows and exact received input envelopes."""
        collection = self._session_collection()
        retained_envelopes = []
        for envelope in envelopes:
            digest = sha256(json.dumps(envelope, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            stored = collection.find_one({
                "recordKey": f"vietcap:price_board_envelope:{envelope['session_date']}:{digest}",
                "dataset": "equity.price_board_envelope",
            })
            if stored is not None and all(stored.get(field) == value for field, value in envelope.items()):
                retained_envelopes.append(envelope)
        verified = set()
        for symbol, record in records.items():
            stored = collection.find_one({
                "recordKey": f"vietcap:price_board:{symbol}:{record['session_date']}",
                "dataset": "equity.price_board",
            })
            if stored is None or any(stored.get(field) != value for field, value in record.items()):
                continue
            for envelope in retained_envelopes:
                raw = envelope.get("raw")
                if (envelope["session_date"] == record["session_date"]
                    and symbol in envelope["requested_symbols"]
                    and isinstance(raw, list) and record["raw"] in raw):
                    verified.add(symbol)
                    break
        return verified

    def ensure_eod_indexes(self) -> list[str]:
        """Ensure the EOD collection has the required unique natural key."""
        if not self.enabled:
            raise RuntimeError("MongoDB analytical source is not configured")

        coll = self._get_collection("market_prices_eod")
        required_keys = [("symbol", 1), ("tradeDate", 1), ("source", 1)]
        required_name = "uniq_symbol_tradeDate_source"
        indexes = list(coll.list_indexes())
        existing = next(
            (
                index
                for index in indexes
                if list(index.get("key", {}).items()) == required_keys
                and index.get("unique") is True
                and not index.get("partialFilterExpression")
                and not index.get("sparse")
            ),
            None,
        )

        if existing is not None:
            index_name = str(existing["name"])
            options = {
                option: existing[option]
                for option in ("collation", "hidden")
                if option in existing
            }
            # Reissuing create_index with the existing specification waits for
            # an in-progress build; failures must block EOD writes.
            coll.create_index(
                required_keys, name=index_name, unique=True, **options
            )
            ensured = [index_name]
        else:
            same_key_index = next(
                (
                    index
                    for index in indexes
                    if list(index.get("key", {}).items()) == required_keys
                ),
                None,
            )
            if same_key_index is not None:
                raise RuntimeError(
                    "Mongo EOD index on (symbol, tradeDate, source) exists with an incompatible specification"
                )
            named_index = next(
                (index for index in indexes if index.get("name") == required_name),
                None,
            )
            if named_index is not None:
                raise RuntimeError(
                    f"Mongo EOD index {required_name} exists with an incompatible specification"
                )
            try:
                coll.create_index(required_keys, name=required_name, unique=True)
            except Exception as exc:
                raise RuntimeError(
                    "Mongo EOD unique index on (symbol, tradeDate, source) could not be ensured"
                ) from exc
            ensured = [required_name]

        secondary_keys = [("symbol", 1), ("tradeDate", -1)]
        if not any(
            list(index.get("key", {}).items()) == secondary_keys for index in indexes
        ):
            try:
                coll.create_index(secondary_keys, name="idx_symbol_tradeDate_desc")
                ensured.append("idx_symbol_tradeDate_desc")
            except Exception as exc:  # pragma: no cover - best-effort read optimization
                logger.warning("Mongo EOD secondary index was not ensured: %s", exc)
        return ensured

    def _get_database(self) -> Any:
        if not self.enabled:
            raise MongoReadError("not_configured")

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

        return await _read_mongo(_read)

    async def get_intraday_trades(
        self,
        symbol: str,
        *,
        lookback_days: int = 7,
        limit: int = 5000,
    ) -> list[dict[str, Any]]:
        """Read current raw batch, legacy only when absent, then retained derived ticks."""
        symbol_upper = symbol.upper()
        lookback_start = (datetime.now(UTC) - timedelta(days=max(1, lookback_days))).replace(tzinfo=None)
        empty_page = limit == 0
        bounded_limit = max(1, min(limit, 20000))

        def _read() -> list[dict[str, Any]]:
            coll = self._get_collection("market_vnstock_premium_records")
            for dataset in ("equity.intraday", "quote.intraday"):
                cursor = coll.find({"dataset": dataset, "symbol": symbol_upper}, {"_id": 0}).sort(
                    [("updatedAt", -1), ("batchReceipt", -1), ("observedAt", -1), ("recordKey", 1)]
                ).limit(20001)
                rows: list[dict[str, Any]] = []
                selected = False
                batch: Any = None
                metadata: dict[str, Any] = {}
                for record in cursor:
                    if not selected:
                        selected = True
                        batch = record.get("updatedAt")
                        metadata = {
                            "source_collection": "market_vnstock_premium_records", "dataset": dataset,
                            "batch_updated_at": batch, "latest_session_status": "unknown",
                            "coverage": "current_retained_batch", "source_date": record.get("sourceDate"),
                            "requested_session_date": record.get("requestedSessionDate"),
                        }
                    elif record.get("updatedAt") != batch:
                        break
                    if record.get("batchReceipt") is True:
                        metadata.update({"latest_session_status": record.get("latestSessionStatus", "unknown"),
                                         "coverage": record.get("coverage", "unknown"),
                                         "requested_session_date": record.get("requestedSessionDate"),
                                         "source_date": record.get("sourceDate")})
                        metadata["batch_receipt"] = record
                        if record.get("rowCount") == 0:
                            return MongoReadRows([], metadata)
                        continue
                    observed = record.get("observedAt")
                    if isinstance(observed, datetime) and observed.replace(tzinfo=None) < lookback_start:
                        continue
                    if len(rows) < bounded_limit:
                        rows.append({**record, "sourceCollection": "market_vnstock_premium_records"})
                if selected:
                    return MongoReadRows(rows, metadata)

            cursor = self._get_collection("market_intraday_trades").find(
                {"symbol": symbol_upper, "tradeTime": {"$gte": lookback_start}}, {"_id": 0}
            ).sort([("tradeTime", 1), ("tradeId", 1)]).limit(bounded_limit)
            rows = [{**row, "observedAt": row.get("observedAt", row.get("tradeTime")),
                     "raw": row.get("raw") or {"time": row.get("tradeTime"), "price": row.get("price"),
                                                "volume": row.get("volume"), "match_type": row.get("matchType"),
                                                "id": row.get("tradeId"), "symbol": row.get("symbol")},
                     "sourceCollection": "market_intraday_trades"} for row in cursor]
            metadata = {"source_collection": "market_intraday_trades", "coverage": "historical_retained_window",
                        "latest_session_status": "unknown"}
            if rows:
                metadata["latest_session_status"] = rows[0].get("latestSessionStatus", "unknown")
                metadata["latest_batch_status"] = rows[0].get("latestBatchStatus", "unknown")
            return MongoReadRows(rows, metadata)

        return await _read_mongo(_read, empty_page=empty_page)

    async def get_price_depth(self, symbol: str, *, limit: int = 500) -> list[dict[str, Any]]:
        """Return current retained depth batch, never arbitrary historical levels."""
        return await self.get_price_depth_precise(symbol, limit=limit)

    async def get_eod_catchup_receipts(self, symbol: str, *, limit: int = 20) -> list[dict[str, Any]]:
        """Return bounded successful/partial/failed catch-up receipts, without mutation."""
        symbol_upper = str(symbol).strip().upper()
        if not symbol_upper:
            raise ValueError("A stock symbol is required")
        empty_page = limit == 0
        bounded_limit = max(1, min(limit, 100))

        def _read() -> list[dict[str, Any]]:
            return list(self._get_collection("market_eod_catchup_receipts").find(
                {"symbol": symbol_upper}, {"_id": 0}
            ).sort([("updatedAt", -1), ("windowEnd", -1), ("recordKey", 1)]).limit(bounded_limit))

        return await _read_mongo(_read, empty_page=empty_page)

    async def get_reference_records(
        self, symbol: str, *, store: str, limit: int = 100
    ) -> list[dict[str, Any]]:
        """Return complete retained IQ profile/descriptor envelopes, without a provider call."""
        if store not in {"market_company_profiles", "market_financial_metric_map"}:
            raise ValueError("Unsupported reference store")
        symbol_upper = str(symbol).strip().upper()
        if not symbol_upper:
            raise ValueError("A stock symbol is required")
        empty_page = limit == 0
        bounded_limit = max(1, min(limit, 100))

        def _read() -> list[dict[str, Any]]:
            query = {"source": "vietcap", "symbol": symbol_upper}
            if store == "market_financial_metric_map":
                query["symbol"] = {"$eq": symbol_upper, "$type": "string"}
                query["schemaVersion"] = 3
            cursor = self._get_collection(store).find(query, {"_id": 0}).sort(
                [("updatedAt", -1), ("comTypeCode", 1), ("section", 1)]
            ).limit(bounded_limit)
            return list(cursor)

        return await _read_mongo(_read, empty_page=empty_page)

    async def get_raw_dataset_records_precise(
        self,
        symbol: str,
        *,
        dataset: str,
        variant: str | None = None,
        limit: int = 100,
        source: str | None = None,
        scope_type: str = "symbol",
        scope_key: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return raw shared vnstock records for a symbol/dataset pair, symbol-exact.

        Unlike :meth:`get_raw_dataset_records`, this reader matches the outer
        ``symbol`` field only. Provider ``raw.symbol`` can differ from the
        retained scope spelling or be absent; it is not an alternate identity.
        Explicit market/index reads use the stored scopeType/scopeKey pair.
        The result carries every storage envelope field except Mongo's ``_id``.
        """

        symbol_upper = symbol.upper()
        empty_page = limit == 0
        limit = max(1, min(limit, 5000))
        if scope_type not in {"symbol", "market", "index"}:
            raise ValueError("scope_type must be symbol, market or index")
        if scope_type != "symbol" and not scope_key:
            raise ValueError("scope_key is required for market/index records")
        if variant is not None and variant not in {f"{dataset}.year", f"{dataset}.quarter"}:
            raise ValueError("Unsupported dataset variant; only exact year/quarter variants are supported")

        def _read() -> list[dict[str, Any]]:
            coll = self._get_collection("market_vnstock_premium_records")
            query: dict[str, Any] = {"dataset": dataset, "symbol": symbol_upper}
            if scope_type != "symbol":
                query = {"dataset": dataset, "scopeType": scope_type, "scopeKey": scope_key}
            if variant is not None:
                query["datasetVariant"] = variant
            if source is not None:
                query["source"] = source
            cursor = (
                coll.find(
                    query,
                    {"_id": 0},
                )
                .sort(
                    [("fiscalYear", -1), ("fiscalQuarter", -1), ("updatedAt", -1), ("recordKey", 1)]
                    if source == "vietcap" and dataset.startswith("finance.")
                    else [("observedAt", -1), ("updatedAt", -1), ("recordKey", 1)]
                )
                .limit(limit)
            )
            rows = list(cursor)
            if dataset.startswith("finance."):
                from vnibb.services.vietcap_financials import financial_fiscal_basis

                retained: list[dict[str, Any]] = []
                legacy_labels: list[str] = []
                unrepresentable: dict[str, str] = {}
                for row in rows:
                    if row.get("source") != "vietcap":
                        retained.append(row)
                        continue
                    raw = row.get("raw") or {}
                    basis = financial_fiscal_basis(row)
                    if basis["period"] is not None:
                        retained.append(row)
                        continue
                    key = str(row.get("recordKey"))
                    # A legacy row whose only defect is the pre-canonical writer
                    # stamping an annual RATIO_YEAR row (raw quarter 5) with a
                    # ``YYYY-Q5`` outer period label: the raw identity is valid and
                    # the label alone is unusable. Any other contradictory fiscal
                    # identity keeps failing the read.
                    if basis["reason"] == "contradictory":
                        alias = re.fullmatch(r"(\d{4})-Q5", str(row.get("period") or ""))
                        stripped = {field: value for field, value in row.items() if field != "period"}
                        stripped_year = financial_fiscal_basis(stripped)["year"]
                        if (
                            alias
                            and raw.get("ratioType") == "RATIO_YEAR"
                            and raw.get("quarter") in (5, "5")
                            and stripped_year is not None
                            and int(alias[1]) == stripped_year
                        ):
                            legacy_labels.append(key)
                            continue
                        raise MongoReadError("invalid_financial_identity")
                    supplied_variant = str(row.get("datasetVariant"))
                    supplied_type = row.get("periodType", raw.get("periodType"))
                    normalized_type = str(supplied_type).strip().lower() if supplied_type is not None else None
                    # Any supplied period type that disagrees with the stored
                    # variant basis is an explicit conflicting identity.
                    if normalized_type is not None and normalized_type != supplied_variant.rsplit(".", 1)[-1]:
                        raise MongoReadError("invalid_financial_identity")
                    # A trailing-twelve-month row has no canonical annual/quarterly
                    # identity and must never be coerced into one; it is disclosed
                    # rather than failing the whole symbol/dataset read.
                    if basis["reason"] == "ratio_ttm":
                        unrepresentable[key] = "ratio_ttm"
                        continue
                    if supplied_variant not in {f"{dataset}.year", f"{dataset}.quarter"}:
                        unrepresentable[key] = f"unsupported_variant:{supplied_variant}"
                        continue
                    if not any(raw.get(field) is not None for field in ("yearReport", "year", "fiscalYear")):
                        # Legacy ordinary row without fiscal identity; retained as stored.
                        retained.append(row)
                        continue
                    unrepresentable[key] = "unavailable"
                if legacy_labels or unrepresentable:
                    return MongoReadRows(retained, {
                        "legacy_period_labels": legacy_labels,
                        "unrepresentable_financial_identity": unrepresentable,
                    })
                rows = retained
            return rows

        return await _read_mongo(_read, empty_page=empty_page)

    async def get_price_depth_precise(
        self, symbol: str, *, limit: int = 500, include_provenance: bool = True
    ) -> list[dict[str, Any]]:
        """Return normalized volume-at-price rows from the newest depth write batch.

        The catalog writer stores one flat document per price level (``raw``
        carries ``price``/``volume`` directly, not a nested ``items`` list) and
        stamps every row of one fetch with the same wall-clock ``updatedAt``
        batch time. This reader groups the freshest batch (the newest
        ``updatedAt``) and returns its rows. This is the current retained write
        batch, not historical-session replay; write time does not prove freshness.
        """

        symbol_upper = symbol.upper()
        empty_page = limit == 0
        limit = max(1, min(limit, 5000))

        def _read() -> list[dict[str, Any]]:
            coll = self._get_collection("market_vnstock_premium_records")
            rows: list[dict[str, Any]] = []
            batch_selected = False
            batch_update: Any = None
            metadata: dict[str, Any] = {"source_collection": "market_vnstock_premium_records", "coverage": "current_write_batch", "latest_session_status": "unknown"}
            for record in coll.find(
                {"dataset": "equity.price_depth", "symbol": symbol_upper},
                {"_id": 0},
            ).sort([("updatedAt", -1), ("batchReceipt", -1), ("observedAt", -1), ("recordKey", 1)]).limit(5001):
                if not batch_selected:
                    batch_update = record.get("updatedAt")
                    batch_selected = True
                    metadata["batch_updated_at"] = batch_update
                elif batch_update != record.get("updatedAt"):
                    break
                if record.get("batchReceipt") is True:
                    metadata.update({"latest_session_status": record.get("latestSessionStatus", "unknown"),
                                     "coverage": record.get("coverage", "unknown"), "batch_receipt": record})
                    if record.get("rowCount") == 0:
                        return MongoReadRows([], metadata)
                    continue
                raw = record.get("raw") or {}
                levels = [raw] if "price" in raw else []
                if not levels:
                    for index in range(1, 4):
                        for side, price_keys, volume_keys in (
                            ("buy", (f"bidPrice{index}", f"bid{index}", f"bid_price_{index}"), (f"bidVol{index}", f"bidVolume{index}", f"bid_vol_{index}")),
                            ("sell", (f"offerPrice{index}", f"askPrice{index}", f"ask{index}", f"ask_price_{index}"), (f"offerVol{index}", f"askVolume{index}", f"askVol{index}", f"ask_vol_{index}")),
                        ):
                            price = next((raw[key] for key in price_keys if raw.get(key) is not None), None)
                            volume = next((raw[key] for key in volume_keys if raw.get(key) is not None), None)
                            if price is not None:
                                levels.append({"price": price, "volume": volume, "side": side, "level": index})
                if not levels and raw and len(rows) < limit:
                    rows.append({**record, "sourceCollection": "market_vnstock_premium_records", "normalizationStatus": "unsupported_depth_shape"})
                for level in levels:
                    row_price = _to_float(level.get("price"))
                    buy_volume = _to_float(level.get("buy_volume", level.get("buyVol")))
                    sell_volume = _to_float(level.get("sell_volume", level.get("sellVol")))
                    row_volume = _to_float(level.get("volume", buy_volume + sell_volume))
                    side = str(level.get("side", level.get("type", ""))).lower()
                    if side in {"bid", "buy", "b"}:
                        buy_volume = row_volume
                    elif side in {"ask", "sell", "s", "offer"}:
                        sell_volume = row_volume
                    if row_price <= 0 or row_volume <= 0 or len(rows) >= limit:
                        continue
                    row: dict[str, Any] = dict(record) if include_provenance else {}
                    row.update({"price": row_price, "volume": row_volume, "buy_volume": buy_volume,
                                "sell_volume": sell_volume, "undefined_volume": _to_float(level.get("undefined_volume"))})
                    if "level" in level:
                        row["level"] = level["level"]
                    if include_provenance:
                        row["sourceCollection"] = "market_vnstock_premium_records"
                        row["coverage"] = "current_write_batch"
                    rows.append(row)
            return MongoReadRows(rows, metadata)

        return await _read_mongo(_read, empty_page=empty_page)

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
        empty_page = limit == 0
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
                    {"_id": 0},
                )
                .sort([("observedAt", -1), ("updatedAt", -1)])
                .limit(limit)
            )
            return list(cursor)

        return await _read_mongo(_read, empty_page=empty_page)

    async def get_eod_prices(
        self,
        symbol: str,
        *,
        lookback_days: int = 365,
        limit: int = 1000,
        include_provenance: bool = True,
    ) -> list[dict[str, Any]]:
        """Return normalized EOD OHLCV rows."""

        symbol_upper = symbol.upper()
        empty_page = limit == 0
        lookback_start = datetime.now(UTC) - timedelta(days=max(1, lookback_days))
        limit = max(1, min(limit, 5000))

        def _read() -> list[dict[str, Any]]:
            coll = self._get_collection("market_prices_eod")
            cursor = coll.find(
                {
                    "symbol": symbol_upper,
                    "tradeDate": {"$gte": lookback_start.replace(tzinfo=None)},
                },
                {"_id": 0},
            ).sort("tradeDate", 1)
            return _dedup_eod_rows(
                _stream_eod_days(cursor, limit),
                preserve_provenance=include_provenance,
            )

        return await _read_mongo(_read, empty_page=empty_page)

    async def get_latest_eod_prices(
        self,
        symbol: str,
        *,
        limit: int = 2,
        include_provenance: bool = True,
    ) -> list[dict[str, Any]]:
        """Return the newest N logical EOD days, with Vietcap/VND precedence."""

        symbol_upper = symbol.upper()
        empty_page = limit == 0
        limit = max(1, min(limit, 5000))

        def _read() -> list[dict[str, Any]]:
            coll = self._get_collection("market_prices_eod")
            cursor = coll.find(
                {"symbol": symbol_upper},
                {"_id": 0},
            ).sort("tradeDate", -1)
            return _dedup_eod_rows(
                _stream_eod_days(cursor, limit),
                preserve_provenance=include_provenance,
            )

        return await _read_mongo(_read, empty_page=empty_page)

    async def get_eod_prices_between(
        self,
        symbol: str,
        *,
        start_date: date | None = None,
        end_date: date | None = None,
        limit: int = 20000,
        include_provenance: bool = True,
    ) -> list[dict[str, Any]]:
        """Return normalized EOD OHLCV rows for an explicit date range."""

        symbol_upper = symbol.upper()
        empty_page = limit == 0
        limit = max(1, min(limit, 50000))
        if start_date and end_date and start_date > end_date:
            raise ValueError("start_date must be on or before end_date")
        bounds: dict[str, Any] = {}
        if start_date:
            bounds["$gte"] = datetime.combine(start_date, time.min)
        if end_date:
            bounds["$lte"] = datetime.combine(end_date, time.max)

        def _read() -> list[dict[str, Any]]:
            coll = self._get_collection("market_prices_eod")
            cursor = coll.find(
                {"symbol": symbol_upper, **({"tradeDate": bounds} if bounds else {})},
                {"_id": 0},
            ).sort("tradeDate", 1)
            return _dedup_eod_rows(
                _stream_eod_days(cursor, limit),
                preserve_provenance=include_provenance,
            )

        return await _read_mongo(_read, empty_page=empty_page)

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
                    "source": 1,
                },
            ).sort("tradeDate", 1)

            by_symbol: dict[str, list[dict[str, Any]]] = {}
            for doc in cursor:
                sym = str(doc.get("symbol") or "").upper()
                if not sym:
                    continue
                by_symbol.setdefault(sym, []).append(doc)

            results: list[dict[str, Any]] = []
            for sym, raw_bars in by_symbol.items():
                bars = _dedup_eod_rows(raw_bars)
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

        return await _read_mongo(_read)

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

        return await _read_mongo(_read)

    async def get_source_latest_trade_date(self, source: str) -> date | None:
        """Return the most recent ``tradeDate`` for one ``source`` in the corpus.

        Distinct from :meth:`get_universe_latest_trade_date`, which reports the
        freshest bar across all sources and therefore hides a frozen primary
        source when a fallback source keeps writing. The daily quality check
        uses this to make a silent Vietcap freeze loud.
        """

        source_value = str(source or "").strip()

        def _read() -> date | None:
            coll = self._get_collection("market_prices_eod")
            doc = list(
                coll.find({"source": source_value}, {"_id": 0, "tradeDate": 1})
                .sort("tradeDate", -1)
                .limit(1)
            )
            if not doc:
                return None
            value = doc[0].get("tradeDate")
            if isinstance(value, datetime):
                return value.date()
            if isinstance(value, date):
                return value
            return None

        return await _read_mongo(_read)

    async def get_current_index_constituents(
        self,
        group: str,
        *,
        max_age_days: int = 7,
    ) -> dict[str, Any] | None:
        group_upper = str(group or "").strip().upper()
        if not group_upper:
            return None

        def _read() -> dict[str, Any] | None:
            coll = self._get_collection("market_index_constituents")
            doc = coll.find_one(
                {"group": group_upper, "source": "vietcap"},
                {"_id": 0, "group": 1, "source": 1, "members": 1, "memberCount": 1, "syncedAt": 1},
            )
            if not isinstance(doc, dict):
                return None
            synced_at = doc.get("syncedAt")
            if isinstance(synced_at, datetime):
                synced_at = synced_at.replace(tzinfo=None)
            elif isinstance(synced_at, date):
                synced_at = datetime.combine(synced_at, time.min)
            else:
                return None
            members = sorted(
                {
                    str(symbol).strip().upper()
                    for symbol in doc.get("members", [])
                    if isinstance(symbol, str) and symbol.strip()
                }
            )
            if not members:
                return None
            return {
                "group": group_upper,
                "source": str(doc.get("source") or "vietcap"),
                "members": members,
                "member_count": len(members),
                "synced_at": synced_at,
                "stale": datetime.utcnow() - synced_at > timedelta(days=max_age_days),
            }

        try:
            return await asyncio.to_thread(_read)
        except Exception as exc:
            logger.warning("Mongo index constituent read failed for %s: %s", group_upper, exc)
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
                doc = dict(doc)
                doc.pop("_id", None)
                if doc.get("schemaVersion") != 3:
                    doc = {**doc, "moatScore": None, "moat": None}
                    factors = doc.get("moatFactors")
                    if isinstance(factors, dict):
                        doc["moatFactors"] = {key: value for key, value in factors.items() if key != "interest_coverage"}
                symbol = str(doc.get("symbol") or "").upper()
                if symbol:
                    results[symbol] = doc
            return results

        try:
            return await asyncio.to_thread(_read)
        except Exception as exc:
            logger.warning("Mongo fundamental snapshot read failed: %s", exc)
            return {}

    async def check_fundamental_snapshot_index(self) -> bool:
        """Report whether the (symbol, snapshotDate) index backing enrichment exists.

        The bulk enrichment aggregation sorts every fundamental snapshot by
        ``(symbol, snapshotDate)``. Without that index the sort is a collection
        scan and enrichment silently becomes the slowest part of a screen.

        Diagnostic only: never creates the index (that belongs to the backfill
        script) and never raises.
        """

        if not self.enabled:
            return False

        def _probe() -> bool:
            coll = self._get_collection("market_fundamental_screener")
            for spec in coll.list_indexes():
                keys = [field for field, _ in spec.get("key", {}).items()]
                if keys[:2] == ["symbol", "snapshotDate"]:
                    return True
            return False

        try:
            return await asyncio.to_thread(_probe)
        except Exception as exc:
            logger.warning("Mongo fundamental index probe failed: %s", exc)
            return False

    async def bulk_upsert_eod_prices(
        self,
        symbol: str,
        rows: list[dict[str, Any]],
        *,
        source: str = "vnstock-data",
    ) -> int:
        """Upsert normalized EOD OHLCV rows into ``market_prices_eod``.

        Vietcap is primary; free vnstock VCI fills uncovered days only. The
        existing natural key remains (symbol, tradeDate, source). Price units
        are normalized from explicit markers or retained source contracts,
        never numeric magnitude. No existing source records are deleted.
        Rows carry ``tradeDate`` (a naive ``datetime``) plus OHLCV
        fields. Returns the number of upsert operations accepted by MongoDB. A bulk
        write exception propagates because unordered writes may partially persist.
        """

        if not self.enabled:
            return 0
        if source not in {"vietcap", "vnstock-data"}:
            raise ValueError(f"Unsupported EOD source: {source}")
        symbol_upper = symbol.upper()
        if not rows:
            return 0

        def _write() -> int:
            from pymongo import UpdateOne

            self.ensure_eod_indexes()
            coll = self._get_collection("market_prices_eod")
            synced_at = datetime.now(UTC).replace(tzinfo=None)
            normalized_rows: list[dict[str, Any]] = []
            for raw in rows:
                if source == "vnstock-data" and str(raw.get("price_source") or "").upper() not in {
                    "VCI", "VNSTOCK_HISTORY:VCI", "VNSTOCK_VND:VCI",
                }:
                    raise ValueError(f"Free VCI provenance required for EOD fallback: {symbol_upper}")
                trade_date = raw.get("tradeDate")
                if not isinstance(trade_date, datetime):
                    continue
                # Preserve the existing naive 07:00:00 trade-day key convention;
                # this is storage identity, not a source close/publication time.
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
                normalized = normalize_price_record(raw, symbol=symbol_upper)
                if normalized["price_unit"] == "unknown":
                    raise ValueError(f"Unknown EOD price unit for {symbol_upper}")
                normalized_rows.append({**normalized, "tradeDate": trade_date})

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


            ops: list[Any] = []
            for raw in normalized_rows:
                trade_date = raw["tradeDate"]
                if source != "vietcap" and trade_date in vietcap_dates:
                    continue

                doc = {
                    "symbol": symbol_upper,
                    "tradeDate": trade_date,
                    "interval": "1D",
                    "source": source,
                    "providerSource": "vietcap" if source == "vietcap" else "VCI",
                    "sourceKey": f"{source}:{symbol_upper}:eod:{trade_date.date().isoformat()}",
                    "open": raw.get("open"),
                    "high": raw.get("high"),
                    "low": raw.get("low"),
                    "close": raw.get("close"),
                    "volume": raw.get("volume"),
                    "accumulatedVolume": raw.get("accumulatedVolume"),
                    "accumulatedValue": raw.get("accumulatedValue"),
                    "value": raw.get("value"),
                    "adj_close": next((raw.get(field) for field in ("adj_close", "adjusted_close", "adjClose") if raw.get(field) is not None), None),
                    "priceUnit": raw["price_unit"],
                    "price_source": raw.get("price_source"),
                    "raw": raw.get("raw", raw),
                    "sourceUnit": raw.get("sourceUnit", raw.get("price_unit")),
                    "sourceUnitEvidence": raw.get("sourceUnitEvidence"),
                    "receivedAt": raw.get("receivedAt", synced_at),
                    "updatedAt": synced_at,
                    "syncedAt": synced_at,
                    "schemaVersion": 1,
                }
                for field in ("observedAt", "sourceDate", "sourceUpdatedAt", "publishedAt", "ingestedAt", "sourceResponse"):
                    if field in raw:
                        doc[field] = raw[field]
                ops.append(
                    UpdateOne(
                        {
                            "symbol": symbol_upper,
                            "tradeDate": trade_date,
                            "source": source,
                        },
                        {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
                        upsert=True,
                    )
                )
            if not ops:
                return 0
            coll.bulk_write(ops, ordered=False)
            return len(ops)

        return await asyncio.to_thread(_write)


@lru_cache(maxsize=1)
def get_mongo_market_data_service() -> MongoMarketDataService:
    return MongoMarketDataService()
