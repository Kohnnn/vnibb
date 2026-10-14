"""Bounded matched-trade acquisition; quote snapshots are not ticks."""

import inspect
from collections.abc import Callable
from datetime import date, datetime
from typing import Any

MAX_SESSION_TRADES = 30000


def acquire_session_trades(fetch: Callable, session_date: date, limit: int, *, session_closed: bool) -> tuple[list[dict], dict]:
    parameters = inspect.signature(fetch).parameters
    paginated = "page_size" in parameters
    size = min(max(1, limit), MAX_SESSION_TRADES)
    exhausted = False
    session_verified = False
    while True:
        frame = fetch(page_size=size) if paginated else fetch()
        records = [] if frame is None else frame.to_dict("records")
        session_verified = bool(getattr(frame, "attrs", {}).get("complete_session"))
        exhausted = paginated and len(records) < size
        if not paginated or exhausted or size == MAX_SESSION_TRADES:
            break
        # VCI truncTime is a strict timestamp boundary. Widening the page avoids
        # losing simultaneous trades at that boundary; ceiling remains explicit.
        size = min(size * 2, MAX_SESSION_TRADES)
    if not paginated:
        records = records[-limit:]
    dates = set()
    times = []
    for row in records:
        value = row.get("time") or row.get("datetime") or row.get("thoiGian")
        try:
            timestamp = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue
        if timestamp.tzinfo is not None:
            from zoneinfo import ZoneInfo
            timestamp = timestamp.astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).replace(tzinfo=None)
        dates.add(timestamp.date())
        times.append(timestamp.isoformat())
    source_date = next(iter(dates)).isoformat() if len(dates) == 1 else None
    matching_session = dates == {session_date}
    complete = bool(records) and exhausted and matching_session and session_closed and session_verified
    stale = bool(records) and dates and not matching_session
    coverage = {
        "scope": "full_session" if complete else "unknown" if stale or not records else "sampled",
        "status": "complete_session" if complete else "source_session_mismatch" if stale else "empty" if not records else "sampled",
        "completed_session": complete,
        "observed_trade_count": len(records),
        "observed_window_start": min(times) if times else None,
        "observed_window_end": max(times) if times else None,
        "session_date": source_date,
        "requested_session_date": session_date.isoformat(),
        "denominator_trade_count": len(records) if complete else None,
        "session_fraction": 1.0 if complete else None,
        "acquisition": "bounded_page_expansion" if paginated else "provider_tail",
        "page_limit": size if paginated else limit,
        "provider_exhausted": exhausted,
        "historical_replay_supported": False,
    }
    return ([] if stale else records), coverage


def fetch_primary_trades(client, symbol: str, *, page_size: int):
    from zoneinfo import ZoneInfo

    import pandas as pd

    from vnibb.services.vietcap_client import TRADING_BASE

    payload = client._unwrap(client._request("POST", f"{TRADING_BASE}/api/market-watch/LEData/getAll", TRADING_BASE, json_body={"symbol": symbol, "limit": page_size, "truncTime": None}))
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise ValueError("Unexpected Vietcap Trading matched-trade envelope")
    payload = payload["data"]
    rows = []
    for row in payload:
        row = dict(row)
        value = row.get("truncTime")
        row["time"] = datetime.fromtimestamp(float(value), ZoneInfo("Asia/Ho_Chi_Minh")).replace(tzinfo=None) if value is not None else None
        row["price"] = row.get("matchPrice")
        row["volume"] = row.get("matchVol")
        row["match_type"] = row.get("matchType")
        rows.append(row)
    return pd.DataFrame(rows)


async def persist_trade_stores(writers: dict[str, Callable], receipt: dict | None = None) -> dict[str, dict[str, Any]]:
    outcomes = {}
    for store, writer in writers.items():
        try:
            count = await writer()
            outcomes[store] = {"status": "persisted", "rows": count}
        except Exception as exc:
            outcomes[store] = {"status": "failed", "rows": 0, "error": type(exc).__name__}
        if receipt is not None:
            receipt[store] = outcomes[store]
    return outcomes


def persist_mongo_trades(symbol: str, rows: list[dict], coverage: dict) -> int:
    from pymongo import ReplaceOne

    from vnibb.services.mongo_market_data_service import get_mongo_market_data_service

    service = get_mongo_market_data_service()
    stamp = datetime.utcnow()
    stored_coverage = dict(coverage)
    stored_coverage["mongo_ticks"] = {"status": "persisted", "rows": len(rows)}
    envelope = {
        "dataset": "equity.intraday", "symbol": symbol,
        "source": "vietcap" if coverage.get("provider") == "vietcap:Trading" else "vnstock",
        "providerSource": coverage.get("provider", "vnstock:VCI"), "sourceDate": coverage["session_date"],
        "sessionDate": coverage["session_date"], "requestedSessionDate": coverage["requested_session_date"],
        "updatedAt": stamp, "syncedAt": stamp, "coverage": stored_coverage,
        "latestSessionStatus": coverage["status"], "rowCount": len(rows),
        "priceUnit": "VND", "volumeUnit": "shares", "timestampMeaning": "source_trade_time",
    }
    collection = service._get_collection("market_vnstock_premium_records")
    operations = []
    from collections import Counter
    from hashlib import sha256
    occurrences = Counter()
    for row in rows:
        raw = {"time": row["trade_time"], "price": row["price"], "volume": row["volume"], "match_type": row["match_type"], "id": row.get("transaction_id")}
        identity = (row["trade_time"].isoformat(), row["price"], row["volume"], row["match_type"])
        occurrences[identity] += 1
        transaction = row.get("transaction_id")
        identity_key = f"id:{transaction}" if transaction is not None else f"{sha256(repr(identity).encode()).hexdigest()}:{occurrences[identity]}"
        key = f"matched-trade:{symbol}:{coverage['session_date']}:{identity_key}"
        operations.append(ReplaceOne({"recordKey": key}, {**envelope, "recordKey": key, "observedAt": row["trade_time"], "raw": raw}, upsert=True))
    # A batch receipt is not a trade. Empty latest access must suppress older ticks.
    key = f"matched-trade:{symbol}:latest-batch"
    operations.append(ReplaceOne({"recordKey": key}, {**envelope, "recordKey": key, "batchReceipt": True, "observedAt": None, "raw": {}}, upsert=True))
    collection.bulk_write(operations, ordered=True)
    return len(rows)
