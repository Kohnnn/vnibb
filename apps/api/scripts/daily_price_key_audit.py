#!/usr/bin/env -S uv run --offline --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
# ─── How to run ───
# python3 -I -B daily_price_key_audit.py MANIFEST.json OBSERVATIONS.json
# ──────────────────
"""Reconcile one completed session's SQL price keys against independent local evidence.

Each v2 input attests to all in-scope changes effective through its stated cutoff,
including changes at that instant. captured_at records when that view was obtained.
"""

import json
import re
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import date, datetime
from enum import StrEnum
from hashlib import sha256
from pathlib import Path
from typing import Final, NewType, TypeAlias, assert_never
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MAX_BYTES: Final = 64 * 1024
MAX_ITEMS: Final = 100
MAX_WITNESSES: Final = 10
INTERVAL: Final = "1D"
MARKET_ZONE_KEY: Final = "Asia/Ho_Chi_Minh"
Symbol = NewType("Symbol", str)
JsonValue: TypeAlias = "str | int | float | bool | None | list[JsonValue] | dict[str, JsonValue]"
Fields: TypeAlias = dict[str, JsonValue]


@dataclass(frozen=True, slots=True)
class AuditInputError(Exception):
    reason: str

    def __str__(self) -> str:
        return self.reason


class Status(StrEnum):
    ELIGIBLE = "eligible"
    UNKNOWN = "unknown"
    EXCLUDED = "excluded"
    UNSUPPORTED = "unsupported"


class Completeness(StrEnum):
    COMPLETE = "complete"
    PARTIAL = "partial"


@dataclass(frozen=True, slots=True)
class Partition:
    exchange: str
    session_date: date
    interval: str = INTERVAL


@dataclass(frozen=True, slots=True)
class Evidence:
    kind: str
    source: str
    revision: str
    effective_through: datetime
    captured_at: datetime
    sha256: str


@dataclass(frozen=True, slots=True)
class Document:
    partition: Partition
    evidence: Evidence
    fields: Fields


def fields(value: JsonValue, names: str) -> Fields:
    if isinstance(value, dict) and value.keys() == set(names.split()):
        return value
    raise AuditInputError(f"expected an object with exactly these fields: {names}")


def array(value: JsonValue, name: str) -> list[JsonValue]:
    if isinstance(value, list) and len(value) <= MAX_ITEMS:
        return value
    raise AuditInputError(f"{name} must be an array of at most {MAX_ITEMS} items")


def identifier(value: JsonValue, name: str) -> str:
    if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,95}", value):
        return value
    raise AuditInputError(f"{name} must be a short provenance identifier")


def symbol(value: JsonValue) -> Symbol:
    if isinstance(value, str) and re.fullmatch(r"[A-Z0-9]{1,10}", value):
        return Symbol(value)
    raise AuditInputError("symbol must contain 1-10 uppercase ASCII letters or digits")


def market_date(value: JsonValue) -> date:
    if isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        return date.fromisoformat(value)
    raise AuditInputError("expected an ISO market date (YYYY-MM-DD)")


def timestamp(value: JsonValue) -> datetime:
    if (
        isinstance(value, str)
        and re.fullmatch(
            r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
            r"(?:\.[0-9]{1,6})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])",
            value,
        )
        and not value.endswith("-00:00")
    ):
        return datetime.fromisoformat(value)
    raise AuditInputError(
        "expected a timestamp with a known UTC offset and at most six fraction digits"
    )


def unique_json_fields(pairs: list[tuple[str, JsonValue]]) -> Fields:
    result = dict(pairs)
    if len(result) != len(pairs):
        raise AuditInputError("duplicate JSON field")
    return result


def load_document(path: Path, version: str, content_fields: str) -> Document:
    if path.suffix != ".json" or not path.is_file():
        raise AuditInputError("inputs must be local .json files")
    with path.open("rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise AuditInputError(f"input exceeds {MAX_BYTES} bytes")
    value: JsonValue = json.loads(data.decode("utf-8"), object_pairs_hook=unique_json_fields)
    root = fields(value, f"schema_version partition evidence {content_fields}")
    if root["schema_version"] != version:
        raise AuditInputError(f"expected schema version {version}")
    partition = fields(root["partition"], "exchange session_date interval")
    exchange = partition["exchange"]
    if not isinstance(exchange, str) or exchange not in ("HOSE", "HNX", "UPCOM"):
        raise AuditInputError("expected one exchange: HOSE, HNX, or UPCOM")
    if partition["interval"] != INTERVAL:
        raise AuditInputError("expected the 1D interval")
    evidence = fields(root["evidence"], "kind source revision effective_through captured_at")
    kind = identifier(evidence["kind"], "evidence kind")
    if kind not in ("fixture", "bounded_extract"):
        raise AuditInputError("evidence kind must be fixture or bounded_extract")
    source = identifier(evidence["source"], "evidence source")
    revision = identifier(evidence["revision"], "evidence revision")
    effective_through = timestamp(evidence["effective_through"])
    captured_at = timestamp(evidence["captured_at"])
    if effective_through > captured_at:
        raise AuditInputError("evidence cannot apply after its capture")
    provenance = Evidence(
        kind, source, revision, effective_through, captured_at, sha256(data).hexdigest()
    )
    return Document(Partition(exchange, market_date(partition["session_date"])), provenance, root)


def build_report(manifest_path: Path, observations_path: Path) -> str:
    market_zone = ZoneInfo(MARKET_ZONE_KEY)
    manifest = load_document(manifest_path, "daily-price-eligibility-v2", "calendar members")
    extract = load_document(observations_path, "daily-price-observations-v2", "scope rows")
    partition = manifest.partition
    if partition != extract.partition:
        raise AuditInputError("manifest and observation partitions differ")
    if manifest.evidence.kind != extract.evidence.kind:
        raise AuditInputError("manifest and observations must have the same evidence kind")
    if manifest.evidence.source == extract.evidence.source:
        raise AuditInputError("manifest and observations must name separate evidence sources")
    calendar = fields(manifest.fields["calendar"], "source revision completed_at")
    completed_at = timestamp(calendar["completed_at"])
    evidence_cutoff = manifest.evidence.effective_through
    if evidence_cutoff != extract.evidence.effective_through:
        raise AuditInputError("membership and prices must have the same effective cutoff")
    if (
        completed_at > evidence_cutoff
        or completed_at.astimezone(market_zone).date() != partition.session_date
    ):
        raise AuditInputError("both inputs must attest to the same completed session")

    members: dict[Symbol, Status] = {}
    for item in array(manifest.fields["members"], "members"):
        member = fields(item, "symbol status reason")
        key = symbol(member["symbol"])
        if key in members:
            raise AuditInputError("duplicate symbol in eligibility manifest")
        reason = member["reason"]
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 160:
            raise AuditInputError("each manifest member requires a bounded status reason")
        members[key] = Status(identifier(member["status"], "eligibility status"))

    scope = fields(extract.fields["scope"], "completeness symbols")
    completeness = Completeness(identifier(scope["completeness"], "extraction completeness"))
    scoped = [symbol(item) for item in array(scope["symbols"], "scope symbols")]
    scope_symbols = set(scoped)
    if not scope_symbols or len(scope_symbols) != len(scoped):
        raise AuditInputError("observation scope must specify unique symbols")
    rows = array(extract.fields["rows"], "observation rows")
    key_suffix = (partition.session_date.isoformat(), INTERVAL)
    frequencies: Counter[Symbol] = Counter()
    zero_volume = 0
    for item in rows:
        row = fields(item, "symbol time interval volume")
        key = symbol(row["symbol"])
        if key not in scope_symbols or (row["time"], row["interval"]) != key_suffix:
            raise AuditInputError("observation row falls outside declared scope")
        volume = row["volume"]
        if type(volume) is not int or not -(2**63) <= volume < 2**63:
            raise AuditInputError("observation volume must be a SQL bigint")
        frequencies[key] += 1
        zero_volume += volume == 0

    groups = {status: {key for key in members if members[key] == status} for status in Status}
    eligible, unknown = groups[Status.ELIGIBLE], groups[Status.UNKNOWN]
    excluded, unsupported = groups[Status.EXCLUDED], groups[Status.UNSUPPORTED]
    observed = set(frequencies)
    absent = eligible - observed
    match completeness:
        case Completeness.COMPLETE:
            missing = absent & scope_symbols
        case Completeness.PARTIAL:
            missing = set[Symbol]()
        case unreachable:
            assert_never(unreachable)
    unscanned = absent - missing
    extras = observed - members.keys()
    duplicates = {key for key, count in frequencies.items() if count > 1}
    witnesses = {
        "missing_eligible_symbols": missing,
        "unscanned_eligible_symbols": unscanned,
        "unknown_status_symbols": unknown,
        "extra_symbols_outside_manifest": extras,
        "duplicate_symbols": duplicates,
    }
    report = {
        "schema_version": "daily-price-key-report-v2",
        "mode": "offline",
        "table": "stock_prices",
        "natural_key": ["symbol", "time", "interval"],
        "partition": asdict(partition),
        "manifest_evidence": asdict(manifest.evidence),
        "observation_evidence": asdict(extract.evidence),
        "calendar": {
            "source": identifier(calendar["source"], "calendar source"),
            "revision": identifier(calendar["revision"], "calendar revision"),
            "completed_at": completed_at,
        },
        "observation_scope": {"completeness": completeness, "symbols": sorted(scope_symbols)},
        "limits": {
            "input_bytes_per_file": MAX_BYTES,
            "items_per_input_array": MAX_ITEMS,
            "witnesses_per_category": MAX_WITNESSES,
        },
        "not_assessed": [
            "authenticity of supplied evidence",
            "keys outside the supplied partition and evidence",
            "OHLCV validity",
            "admitted or consumer coverage",
        ],
        "counts": {
            "eligible_keys": len(eligible),
            "observed_distinct_eligible_keys": len(eligible & observed),
            "missing_eligible_keys": len(missing),
            "unscanned_eligible_keys": len(unscanned),
            "unknown_status_keys": len(unknown),
            "excluded_keys": len(excluded),
            "unsupported_keys": len(unsupported),
            "observed_unknown_status_keys": len(unknown & observed),
            "observed_excluded_keys": len(excluded & observed),
            "observed_unsupported_keys": len(unsupported & observed),
            "observation_rows": len(rows),
            "extra_keys_outside_manifest": len(extras),
            "duplicate_keys": len(duplicates),
            "duplicate_rows": len(rows) - len(observed),
            "zero_volume_rows": zero_volume,
        },
        "witnesses": {label: sorted(keys)[:MAX_WITNESSES] for label, keys in witnesses.items()},
    }
    return json.dumps(report, indent=2, default=lambda instant: instant.isoformat())


def main() -> int:
    args = sys.argv[1:]
    usage = "usage: daily_price_key_audit.py MANIFEST.json OBSERVATIONS.json"
    if args in (["-h"], ["--help"]):
        print(usage)
        return 0
    if len(args) != 2:
        print(usage, file=sys.stderr)
        return 2
    try:
        report = build_report(Path(args[0]), Path(args[1]))
    except ZoneInfoNotFoundError:
        print(
            f"missing IANA timezone data for {MARKET_ZONE_KEY}; install system tzdata "
            "or the Python tzdata package for this interpreter",
            file=sys.stderr,
        )
        return 2
    except AuditInputError as exc:
        print(f"invalid audit input: {exc}", file=sys.stderr)
        return 2
    except (OSError, ValueError, OverflowError, RecursionError) as exc:
        print(f"cannot read or decode audit evidence ({type(exc).__name__})", file=sys.stderr)
        return 2
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
