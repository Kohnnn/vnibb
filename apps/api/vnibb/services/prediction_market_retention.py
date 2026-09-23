"""Archive-first terminal-market retention. PostgreSQL only; dry-run by default.

A receipt is an operator-supplied JSON object containing backup_path, sha256,
database, and verified_at (UTC ISO timestamp). The backup artifact checksum is
verified locally; --confirm-isolated-restore requires an operator who already
verified a separate isolated database restore. The receipt alone is not proof.
Dry-run: python -m vnibb.services.prediction_market_retention --limit 100
Apply: python -m vnibb.services.prediction_market_retention --apply --limit 100 \
    --backup-receipt /secure/verified-backup.json --archive-file /secure/batch.json \
    --confirm-isolated-restore
Restore: python -m vnibb.services.prediction_market_retention --restore /secure/batch.json
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from sqlalchemy import text

from vnibb.core.database import async_session_maker
from vnibb.models.prediction_market import PredictionMarket

MAX_BATCH = 100
RETENTION_DAYS = 365
COLUMNS = tuple(column.name for column in PredictionMarket.__table__.columns)
DATE_COLUMNS = {"end_date", "created_at", "updated_at"}
TERMINAL_ELIGIBLE = """
    active = false AND closed = true AND end_date < :cutoff
    AND extra -> 'resolution' ->> 'status' = 'resolved'
    AND extra -> 'resolution' ->> 'source' = 'provider'
    AND extra -> 'resolution' ->> 'outcome' IS NOT NULL
    AND jsonb_exists(CAST(outcomes AS jsonb), extra -> 'resolution' ->> 'outcome')
    AND NOT EXISTS (
      SELECT 1 FROM prediction_market_snapshots s
      WHERE s.source = prediction_markets.source AND s.source_id = prediction_markets.source_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM prediction_market_intraday_snapshots s
      WHERE s.source = prediction_markets.source AND s.source_id = prediction_markets.source_id
    )
"""
ELIGIBLE = TERMINAL_ELIGIBLE + """
    AND NOT EXISTS (
      SELECT 1 FROM prediction_market_archive a WHERE a.market_id = prediction_markets.id
    )
"""


def _json_bytes(payload: object) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _receipt(path: Path, database: str) -> str:
    receipt = json.loads(path.read_text())
    artifact = Path(receipt["backup_path"]).resolve()
    if not artifact.is_file() or not artifact.stat().st_size:
        raise ValueError("backup artifact missing or empty")
    expected = receipt["sha256"]
    if _digest(artifact) != expected:
        raise ValueError("backup checksum mismatch")
    verified_at = datetime.fromisoformat(receipt["verified_at"].replace("Z", "+00:00"))
    age = datetime.now(UTC) - verified_at.astimezone(UTC)
    if not timedelta(0) <= age < timedelta(days=1):
        raise ValueError("recent isolated restore verification required")
    if receipt.get("database") != database:
        raise ValueError("backup database does not match target database")
    return expected


def _payload(row) -> dict:
    return {
        name: (
            value.isoformat() if name in DATE_COLUMNS and value is not None
            else json.loads(value) if name in {"outcomes", "outcome_prices", "extra"} and isinstance(value, str)
            else value
        )
        for name, value in zip(COLUMNS, row, strict=True)
    }


def _write_archive(path: Path, document: dict) -> None:
    # Exclusive creation prevents silently overwriting a prior recovery artifact.
    with path.open("xb") as stream:
        stream.write(_json_bytes(document))
        stream.flush()
        os.fsync(stream.fileno())


async def retention(*, limit: int, apply: bool = False, backup_receipt: Path | None = None,
                    archive_file: Path | None = None,
                    confirm_isolated_restore: bool = False) -> dict:
    if not 1 <= limit <= MAX_BATCH:
        raise ValueError(f"limit must be between 1 and {MAX_BATCH}")
    if apply and (backup_receipt is None or archive_file is None):
        raise ValueError("--apply requires --backup-receipt and --archive-file")
    if apply and not confirm_isolated_restore:
        raise ValueError("--apply requires --confirm-isolated-restore after an actual isolated restore")
    cutoff = datetime.now(UTC) - timedelta(days=RETENTION_DAYS)
    async with async_session_maker() as session:
        if session.bind.dialect.name != "postgresql":
            raise RuntimeError("terminal retention requires PostgreSQL row locking")
        result = await session.execute(text(f"""
            SELECT {', '.join('prediction_markets.' + c for c in COLUMNS)}
            FROM prediction_markets WHERE {ELIGIBLE}
            ORDER BY end_date, id LIMIT :limit
            {"FOR UPDATE SKIP LOCKED" if apply else ""}
        """), {"cutoff": cutoff, "limit": limit + 1})
        rows = result.all()
        candidates = rows[:limit]
        report = {"eligible_in_batch": len(candidates), "more_candidates": len(rows) > limit,
                  "cutoff": cutoff.isoformat(), "limit": limit, "deleted": 0}
        if not apply or not candidates:
            return report
        database = (await session.execute(text("SELECT current_database()"))).scalar_one()
        backup_sha = _receipt(backup_receipt, database)
        batch_id = str(uuid4())
        payloads = [_payload(row) for row in candidates]
        entries = [{"payload": payload, "sha256": hashlib.sha256(_json_bytes(payload)).hexdigest()}
                   for payload in payloads]
        document = {"batch_id": batch_id, "database": database, "backup_sha256": backup_sha,
                    "count": len(entries), "entries": entries}
        document["sha256"] = hashlib.sha256(_json_bytes(entries)).hexdigest()
        _write_archive(archive_file, document)
        now = datetime.now(UTC).replace(tzinfo=None)
        for entry in entries:
            await session.execute(text("""
                INSERT INTO prediction_market_archive
                    (market_id, batch_id, payload, sha256, archived_at, backup_sha256)
                VALUES (:market_id, :batch_id, CAST(:payload AS jsonb), :sha256, :archived_at, :backup_sha256)
            """), {"market_id": entry["payload"]["id"], "batch_id": batch_id,
                   "payload": _json_bytes(entry["payload"]).decode(), "sha256": entry["sha256"],
                   "archived_at": now, "backup_sha256": backup_sha})
        stored = (await session.execute(text("""
            SELECT market_id, payload, sha256 FROM prediction_market_archive WHERE batch_id = :batch_id
        """), {"batch_id": batch_id})).all()
        if len(stored) != len(entries) or {
            row.market_id: row.sha256 for row in stored
        } != {entry["payload"]["id"]: entry["sha256"] for entry in entries} or any(
            hashlib.sha256(_json_bytes(json.loads(row.payload) if isinstance(row.payload, str) else row.payload)).hexdigest() != row.sha256 for row in stored
        ):
            raise RuntimeError("archive verification failed; transaction rolled back")
        ids = [entry["payload"]["id"] for entry in entries]
        deleted = (await session.execute(text(f"""
            DELETE FROM prediction_markets WHERE id = ANY(:ids) AND {TERMINAL_ELIGIBLE}
        """), {"ids": ids, "cutoff": cutoff})).rowcount
        if deleted != len(entries):
            raise RuntimeError("eligibility changed; transaction rolled back, external archive remains")
        await session.commit()
        return {**report, "deleted": deleted, "batch_id": batch_id,
                "archive_sha256": document["sha256"], "archive_file": str(archive_file)}


async def restore(path: Path) -> dict:
    document = json.loads(path.read_text())
    entries = document["entries"]
    if len(entries) != document["count"] or hashlib.sha256(_json_bytes(entries)).hexdigest() != document["sha256"]:
        raise ValueError("archive manifest mismatch")
    if any(hashlib.sha256(_json_bytes(entry["payload"])).hexdigest() != entry["sha256"] for entry in entries):
        raise ValueError("archive row checksum mismatch")
    async with async_session_maker() as session:
        if session.bind.dialect.name != "postgresql":
            raise RuntimeError("restore requires PostgreSQL")
        database = (await session.execute(text("SELECT current_database()"))).scalar_one()
        if database != document["database"]:
            raise ValueError("archive belongs to another database")
        archived = (await session.execute(text("""
            SELECT market_id, sha256 FROM prediction_market_archive WHERE batch_id = :batch_id
        """), {"batch_id": document["batch_id"]})).all()
        if {row.market_id: row.sha256 for row in archived} != {
            entry["payload"]["id"]: entry["sha256"] for entry in entries
        }:
            raise ValueError("database archive differs from manifest")
        for entry in entries:
            payload = entry["payload"].copy()
            for name in DATE_COLUMNS:
                if payload[name] is not None:
                    payload[name] = datetime.fromisoformat(payload[name])
            # ON CONFLICT is intentionally absent: a re-ingested row must not be overwritten.
            session.add(PredictionMarket(**payload))
        await session.flush()
        await session.execute(text("DELETE FROM prediction_market_archive WHERE batch_id = :batch_id"),
                              {"batch_id": document["batch_id"]})
        await session.commit()
    return {"restored": len(entries), "batch_id": document["batch_id"]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup-receipt", type=Path)
    parser.add_argument("--archive-file", type=Path)
    parser.add_argument("--confirm-isolated-restore", action="store_true")
    parser.add_argument("--restore", type=Path)
    args = parser.parse_args()
    if args.restore and (args.apply or args.backup_receipt or args.archive_file or args.confirm_isolated_restore):
        parser.error("--restore cannot be combined with --apply or backup/archive arguments")
    result = (restore(args.restore) if args.restore else retention(
        limit=args.limit, apply=args.apply, backup_receipt=args.backup_receipt,
        archive_file=args.archive_file, confirm_isolated_restore=args.confirm_isolated_restore))
    print(json.dumps(asyncio.run(result), sort_keys=True))


if __name__ == "__main__":
    main()
