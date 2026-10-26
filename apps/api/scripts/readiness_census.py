"""Provider-free durable census used by query_plan_preflight --readiness-census."""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import socket
from collections import Counter
from contextlib import contextmanager
from datetime import UTC, date, datetime
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit


def _day(value):
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _same_value(left, right):
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return math.isclose(left, right, rel_tol=1e-12, abs_tol=0)
    return left == right or str(left) == str(right)


def _session_reasons(record, symbol, expected, now):
    if not isinstance(record, dict):
        return ["record_not_object"]
    reasons = []
    for field, value in (("symbol", symbol), ("session_date", str(expected)), ("source", "vietcap"), ("scope", "vietcap_board")):
        if record.get(field) != value:
            reasons.append(f"{field}_mismatch:{record.get(field)}")
    try:
        observed = datetime.fromisoformat(record.get("observed_at", "").replace("Z", "+00:00"))
        if observed.tzinfo is None or observed > now:
            reasons.append("observation_clock_naive_or_future")
    except (ValueError, TypeError, AttributeError):
        reasons.append("observation_clock_invalid")
    raw = record.get("raw")
    if not isinstance(raw, dict):
        return reasons + ["raw_not_object"]
    for name in ("listingInfo", "matchPrice", "bidAsk"):
        section = raw.get(name)
        if not isinstance(section, dict):
            reasons.append(f"{name}_missing_or_invalid")
        elif section.get("symbol") != symbol:
            reasons.append(f"{name}_symbol_mismatch")
    return reasons or ["raw_status_clock_finality_or_price_volume_rejected_by_session_coverage"]


def _envelope_summary(envelope):
    requested, raw = envelope.get("requested_symbols"), envelope.get("raw")
    requested = requested if isinstance(requested, list) else []
    identities = []
    if isinstance(raw, list):
        for row in raw:
            listing = row.get("listingInfo") if isinstance(row, dict) else None
            identities.append(listing.get("symbol") if isinstance(listing, dict) else None)
    counts = Counter(value for value in identities if isinstance(value, str))
    return {"recordKey": envelope.get("recordKey"), "raw_is_list": isinstance(raw, list), "raw_count": len(raw) if isinstance(raw, list) else None, "missing_requested": sorted(set(requested) - set(counts)), "unexpected_symbols": sorted(set(counts) - set(requested)), "duplicate_symbols": sorted(key for key, count in counts.items() if count > 1), "unidentified_rows": identities.count(None)}


def _price_reasons(row, prefix, expected, *, snapshot=False):
    from vnibb.core.price_units import persisted_price_record, screener_price_record

    if row is None:
        return [f"{prefix}_missing"]
    normalized = screener_price_record(row) if snapshot else persisted_price_record(row)
    value = normalized.get("price" if snapshot else "close")
    reasons = []
    if value is None:
        reasons.append(f"{prefix}_actual_price_null" if snapshot else f"{prefix}_price_null")
    elif not isinstance(value, (float, int)) or not math.isfinite(value) or value <= 0:
        reasons.append(f"{prefix}_price_invalid")
    if value is not None and normalized.get("price_unit") != "VND":
        reasons.append(f"{prefix}_unit_uncertified")
    if value is not None and not (normalized.get("price_source") or (row.get("source") if not snapshot else None)):
        reasons.append(f"{prefix}_source_missing")
    day = _day(row.get("trade_date" if snapshot else "time"))
    field = "actual_trade_date" if snapshot else "date"
    if day is None:
        reasons.append(f"{prefix}_{field}_missing")
    elif day != expected:
        label = "stale" if day < expected else "future"
        suffix = f"{field}_" if snapshot else ""
        reasons.append(f"{prefix}_{suffix}{label}:{day}")
    return reasons


def _receipt_reasons(receipt, symbols, now):
    metadata = receipt.get("additional_data")
    if not isinstance(metadata, dict):
        return ["invalid_receipt_metadata"]
    expected = metadata.get("expected_symbols")
    reasons = []
    if receipt.get("status") != "completed" or receipt.get("error_count") != 0:
        reasons.append("not_completed_without_errors")
    if not isinstance(expected, list) or any(not isinstance(v, str) for v in expected):
        reasons.append("invalid_expected_symbols")
    elif len(expected) != len(set(expected)) or set(expected) != symbols:
        reasons.append("active_membership_mismatch")
    if type(metadata.get("expected_count")) is not int or not isinstance(expected, list) or metadata["expected_count"] != len(expected):
        reasons.append("expected_count_mismatch")
    day = _day(metadata.get("snapshot_date"))
    if day is None or not 0 <= (now.date() - day).days <= 7:
        reasons.append("snapshot_date_outside_reader_window")
    completed = receipt.get("completed_at")
    try:
        completed = datetime.fromisoformat(str(completed))
        completed = completed.replace(tzinfo=UTC) if completed.tzinfo is None else completed.astimezone(UTC)
        if completed > now or (now - completed).days > 7:
            reasons.append("completion_time_outside_reader_window")
    except ValueError:
        reasons.append("completion_time_invalid")
    return reasons


def reconcile_census(rows, raw, cache, receipts, admitted, expected, now):
    """Reconcile captured stores without changing admission or filling null prices."""
    from vnibb.services.cache_manager import snapshot_session_coverage
    from vnibb.services.market_session import session_coverage

    symbols = {row["symbol"] for row in rows}
    receipt_rows = [{**receipt, "rejections": _receipt_reasons(receipt, symbols, now)} for receipt in receipts]
    report_rows = []
    for row in rows:
        symbol = row["symbol"]
        retained = raw.get(symbol, {})
        board, snapshot, price = retained.get("board"), row.get("snapshot_row"), row.get("price_row")
        reasons = []
        if not retained.get("envelope_keys"):
            reasons.append("mongo_received_envelope_missing")
        count = retained.get("board_count", 0)
        if count == 0:
            reasons.append("mongo_board_missing")
            latest = retained.get("latest_board")
            if latest is not None:
                reasons.append(f"mongo_board_latest_session:{latest.get('session_date')}")
        elif count != 1:
            reasons.append(f"mongo_board_duplicate:{count}")
        elif session_coverage(board, symbol, expected) is None:
            reasons.append("mongo_board_session_invalid")
            reasons.extend(f"mongo_board_{reason}" for reason in _session_reasons(board, symbol, expected, now))
        metrics = (snapshot or {}).get("extended_metrics") or {}
        session = metrics.get("market_session")
        coverage = snapshot_session_coverage(SimpleNamespace(**snapshot), expected, now) if snapshot else None
        if session is None:
            reasons.append("sql_session_missing")
        elif coverage is None:
            reasons.append("sql_session_invalid")
            reasons.extend(f"sql_session_{reason}" for reason in _session_reasons(session, symbol, expected, now))
        if session is not None and session != board:
            # Mongo adds storage metadata; compare the qualified envelope fields only.
            if not isinstance(session, dict) or not isinstance(board, dict) or any(board.get(key) != value for key, value in session.items()):
                reasons.append("mongo_sql_session_lineage_mismatch")
        eod = retained.get("eod")
        if eod is None:
            reasons.append("mongo_eod_missing")
        elif price and _day(eod.get("tradeDate")) == _day(price.get("time")):
            if not _same_value(eod.get("close"), price.get("close")):
                reasons.append("mongo_sql_price_value_mismatch")
            if not eod.get("raw") or not eod.get("sourceUnitEvidence") or eod.get("priceUnit") != "VND":
                reasons.append("mongo_eod_unit_or_raw_lineage_invalid")
        elif price:
            reasons.append("mongo_sql_price_date_mismatch")
        reasons.extend(_price_reasons(price, "sql_price", expected))
        reasons.extend(_price_reasons(snapshot, "sql_snapshot", expected, snapshot=True))
        if not receipts:
            reasons.append("completion_receipt_missing")
        elif not any(not receipt["rejections"] for receipt in receipt_rows):
            reasons.append("completion_receipt_not_current_member_qualified")
        cached = cache.get(symbol, {})
        for label, durable in (("screener", snapshot), ("price", price)):
            value = cached.get(label)
            if value is None:
                reasons.append(f"redis_{label}_missing")
                continue
            if not isinstance(value, dict):
                reasons.append(f"redis_{label}_invalid_json_shape")
                continue
            if value.get("symbol") != symbol:
                reasons.append(f"redis_{label}_symbol_mismatch")
            if durable:
                fields = ("price", "volume", "trade_date", "snapshot_date") if label == "screener" else ("close", "volume", "time")
                for field in fields:
                    cached_value, durable_value = value.get(field), durable.get(field)
                    if not _same_value(cached_value, durable_value):
                        reasons.append(f"redis_{label}_{field}_mismatch")
            if label == "screener" and value.get("market_session") != session:
                reasons.append("redis_screener_session_lineage_mismatch")
        if symbol not in admitted.get("symbols", []):
            reasons.append("not_in_admitted_universe")
        report_rows.append({**row, "mongo": retained, "redis": cached, "session_coverage": coverage, "reasons": reasons})
    return {
        "active_count": len(rows),
        "active_sha256": hashlib.sha256("\n".join(sorted(symbols)).encode()).hexdigest(),
        "duplicate_active_symbols": len(rows) - len(symbols),
        "durable": {
            "symbols_with_price": sum(row.get("price_row") is not None for row in rows),
            "symbols_with_snapshot": sum(row.get("snapshot_row") is not None for row in rows),
            "null_actual_snapshot_prices": sum(row.get("snapshot_row") is not None and row["snapshot_row"].get("price") is None for row in rows),
            "current_sql_session_qualified": sum(row["session_coverage"] is not None for row in report_rows),
            "current_actual_price_rows": sum(_day((row.get("price_row") or {}).get("time")) == expected for row in rows),
            "current_actual_snapshot_trade_dates": sum(_day((row.get("snapshot_row") or {}).get("trade_date")) == expected for row in rows),
            "current_snapshot_rows": sum(_day((row.get("snapshot_row") or {}).get("snapshot_date")) == now.date() for row in rows),
            "symbols_with_mongo_eod": sum(value.get("eod") is not None for value in raw.values()),
            "current_mongo_eod_rows": sum(_day((value.get("eod") or {}).get("tradeDate")) == expected for value in raw.values()),
            "symbols_with_redis_screener": sum(value.get("screener") is not None for value in cache.values()),
            "symbols_with_redis_price": sum(value.get("price") is not None for value in cache.values()),
            "current_mongo_board_documents": sum(value.get("board_count", 0) for value in raw.values()),
        },
        "admitted": admitted,
        "receipts": receipt_rows,
        "reason_counts": dict(sorted(Counter(reason for row in report_rows for reason in row["reasons"]).items())),
        "rows": report_rows,
    }


@contextmanager
def _datastore_sockets(urls):
    allowed = set()
    for url in urls:
        parsed = urlsplit(url)
        port = parsed.port or (27017 if parsed.scheme.startswith("mongodb") else 6379 if parsed.scheme.startswith("redis") else 5432)
        allowed.update((item[4][0], port) for item in socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM))
    original = socket.socket.connect

    def connect(sock, address):
        if not isinstance(address, tuple) or (address[0], address[1]) not in allowed:
            raise RuntimeError("Readiness census permits datastore sockets only")
        return original(sock, address)

    socket.socket.connect = connect
    try:
        yield
    finally:
        socket.socket.connect = original


def _postgres(settings, now):
    import psycopg2
    from psycopg2.extras import RealDictCursor

    query = """SELECT u.symbol,u.exchange,to_jsonb(p) price_row,to_jsonb(s) snapshot_row
        FROM stocks u
        LEFT JOIN LATERAL (SELECT * FROM stock_prices WHERE symbol=u.symbol AND interval='1D' ORDER BY time DESC,id DESC LIMIT 1) p ON true
        LEFT JOIN LATERAL (SELECT * FROM screener_snapshots WHERE symbol=u.symbol AND snapshot_date<=%s ORDER BY snapshot_date DESC,id DESC LIMIT 1) s ON true
        WHERE u.is_active=1 ORDER BY u.symbol"""
    connection = psycopg2.connect(settings.sync_database_url.replace("postgresql+psycopg2://", "postgresql://"), connect_timeout=3)
    try:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
            cursor.execute("SET LOCAL statement_timeout='5s'")
            cursor.execute("SET LOCAL lock_timeout='1s'")
            cursor.execute("SET LOCAL idle_in_transaction_session_timeout='10s'")
            cursor.execute("EXPLAIN (FORMAT JSON, ANALYZE false) " + query, (now.date(),))
            plan = cursor.fetchone()["QUERY PLAN"]
            def large_scan(value):
                if isinstance(value, dict):
                    return (value.get("Node Type") == "Seq Scan" and value.get("Relation Name") in {"stock_prices", "screener_snapshots"}) or any(large_scan(v) for v in value.values())
                return isinstance(value, list) and any(large_scan(v) for v in value)
            if large_scan(plan):
                raise RuntimeError("Refusing sequential scan of serving price/snapshot stores")
            cursor.execute(query, (now.date(),))
            rows = [dict(row) for row in cursor.fetchall()]
            cursor.execute("SELECT id,status,error_count,success_count,completed_at,additional_data FROM sync_status WHERE sync_type='screener_universe' ORDER BY completed_at DESC NULLS LAST,id DESC LIMIT 1001")
            receipts = [dict(row) for row in cursor.fetchall()]
            if len(receipts) > 1000:
                raise RuntimeError("Completion receipt bound exceeded; census is incomplete")
            cursor.execute("SELECT (SELECT count(*) FROM stock_prices) price_rows,(SELECT count(*) FROM screener_snapshots) snapshot_rows,(SELECT count(*) FROM sync_status WHERE sync_type='screener_universe') completion_receipts")
            counts = dict(cursor.fetchone())
            cursor.execute("SHOW transaction_read_only")
            assert cursor.fetchone()["transaction_read_only"] == "on"
            return rows, receipts, counts, plan
    finally:
        connection.rollback()
        connection.close()


async def _admitted(settings):
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
    from vnibb.services.cache_manager import CacheManager

    engine = create_async_engine(settings.database_url, connect_args={"timeout": 3})
    try:
        async with AsyncSession(engine) as session:
            await session.execute(text("SET TRANSACTION READ ONLY"))
            await session.execute(text("SET LOCAL statement_timeout='5s'"))
            await session.execute(text("SET LOCAL lock_timeout='1s'"))
            await session.execute(text("SET LOCAL idle_in_transaction_session_timeout='10s'"))
            result = await CacheManager(db=session).get_screener_data(source=None)
            rows = result.data or []
            # CacheManager returns a miss on SQL errors; do not mislabel an aborted read as absence.
            await session.execute(text("SELECT 1"))
            await session.rollback()
            return {"hit": result.hit, "count": len(rows), "symbols": sorted(row.symbol for row in rows), "is_stale": result.is_stale, "freshness_basis": result.freshness_basis, "market_session_counts": result.market_session_counts, "health_reason": "verified_universe_unavailable" if not rows else "completed_session_not_covered" if result.is_stale else None, "whole_market_verified": False}
    finally:
        await engine.dispose()


def _retained(settings, symbols, expected, max_time_ms):
    from pymongo import MongoClient
    import redis

    mongo = MongoClient(settings.mongodb_url, serverSelectionTimeoutMS=3000, connectTimeoutMS=3000, socketTimeoutMS=5000)
    raw, cache = {}, {}
    client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=3, socket_timeout=3) if settings.redis_url else None
    try:
        database = mongo[settings.mongodb_database]
        collection = database.market_vnstock_premium_records
        envelopes = list(collection.find({"dataset": "equity.price_board_envelope", "session_date": str(expected)}, {"_id": 0}).hint("idx_dataset_symbol_observedAt_desc").limit(1001).max_time_ms(max_time_ms))
        if len(envelopes) > 1000:
            raise RuntimeError("Raw envelope bound exceeded; census is incomplete")
        for symbol in symbols:
            collection = database.market_vnstock_premium_records
            query = {"dataset": "equity.price_board", "symbol": symbol, "session_date": str(expected)}
            count = collection.count_documents(query, maxTimeMS=max_time_ms, hint="idx_dataset_symbol_observedAt_desc")
            boards = list(collection.find(query, {"_id": 0}).hint("idx_dataset_symbol_observedAt_desc").limit(1).max_time_ms(max_time_ms))
            latest = list(collection.find({"dataset": "equity.price_board", "symbol": symbol}, {"_id": 0}).sort("session_date", -1).hint("idx_dataset_symbol_observedAt_desc").limit(1).max_time_ms(max_time_ms))
            eod = list(database.market_prices_eod.find({"symbol": symbol}, {"_id": 0}).sort("tradeDate", -1).hint("idx_symbol_tradeDate_desc").limit(1).max_time_ms(max_time_ms))
            envelope_keys = [value.get("recordKey") for value in envelopes if isinstance(value.get("requested_symbols"), list) and symbol in value["requested_symbols"]]
            raw[symbol] = {"board_count": count, "board": boards[0] if boards else None, "envelope_keys": envelope_keys, "latest_board": latest[0] if latest else None, "eod": eod[0] if eod else None}
            cached = {}
            if client:
                for label in ("screener", "price"):
                    key = f"vnibb:{label}:latest:{symbol}"
                    # GETRANGE bounds the response without a cache-populating consumer call.
                    value = client.getrange(key, 0, 1048576)
                    if len(value) > 1048576:
                        raise RuntimeError("Redis value exceeded 1 MiB census bound")
                    try:
                        cached[label] = json.loads(value) if value else None
                    except (ValueError, UnicodeDecodeError):
                        cached[label] = "invalid_json"
                    cached[label + "_ttl"] = client.ttl(key)
            cache[symbol] = cached
        return raw, cache, envelopes
    finally:
        mongo.close()
        if client:
            client.close()


def readiness_census(expected_revision, max_time_ms=3000):
    from vnibb.core.config import settings
    from vnibb.core.market_calendar import market_calendar_metadata
    from vnibb.services.market_session import expected_market_session

    now = datetime.now(UTC)
    revision_file = Path("/app/.release-revision")
    revision = revision_file.read_text().strip() if revision_file.exists() else settings.release_revision
    if not expected_revision or revision != expected_revision:
        raise ValueError("Serving revision does not match independently pinned --expected-revision")
    expected = expected_market_session(now=now)
    urls = [settings.database_url, settings.mongodb_url] + ([settings.redis_url] if settings.redis_url else [])
    with _datastore_sockets(urls):
        rows, receipts, counts, plan = _postgres(settings, now)
        raw, cache, envelopes = _retained(settings, [row["symbol"] for row in rows], expected, max_time_ms)
        admitted = asyncio.run(_admitted(settings))
        # A cross-store census is not atomic; reject membership drift during capture.
        after, _, _, _ = _postgres(settings, now)
        if [row["symbol"] for row in rows] != [row["symbol"] for row in after]:
            raise RuntimeError("Active SQL membership changed during census")
    report = reconcile_census(rows, raw, cache, receipts, admitted, expected, now)
    report["received_envelopes"] = envelopes
    report["envelope_diagnostics"] = [_envelope_summary(value) for value in envelopes]
    report["durable"]["current_received_envelopes"] = len(envelopes)
    if revision_file.exists() and revision_file.read_text().strip() != revision:
        raise RuntimeError("Serving revision changed during census")
    return {"contract": "database-readiness-census-v1", "at": now.isoformat(), "completed_at": datetime.now(UTC).isoformat(), "revision": revision, "revision_setting": settings.release_revision, "expected_completed_session": str(expected), "calendar": market_calendar_metadata(expected), "policy": {"read_only": True, "provider_calls": 0, "consumer_http_calls": 0, "sql_statement_timeout_ms": 5000, "sql_lock_timeout_ms": 1000, "mongo_max_time_ms": max_time_ms, "redis_commands": ["GETRANGE", "TTL"], "cross_store_atomic": False}, "sql_total_rows": counts, "sql_plan": plan, **report}
