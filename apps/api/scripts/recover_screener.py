#!/usr/bin/env python3
"""Read-only preflight, or explicitly coordinated Vietcap-board screener recovery."""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import hashlib
import json
import logging
import math
import os
import re
import signal
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit
from uuid import uuid4

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MAX_SYMBOLS = 10_000
MAX_TIMEOUT = 86_400
SYMBOL = re.compile(r"[A-Z0-9]{1,16}\Z")


class PreflightError(ValueError):
    pass


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        super().error("invalid arguments; use --help (argument values redacted)")


def positive_cap(value: str) -> int:
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("max-symbols must be an integer") from None
    if not 1 <= number <= MAX_SYMBOLS:
        raise argparse.ArgumentTypeError(f"max-symbols must be between 1 and {MAX_SYMBOLS}")
    return number


def positive_timeout(value: str) -> float:
    try:
        number = float(value)
    except ValueError:
        raise argparse.ArgumentTypeError("timeout-seconds must be numeric") from None
    if not math.isfinite(number) or not 0 < number <= MAX_TIMEOUT:
        raise argparse.ArgumentTypeError(f"timeout-seconds must be positive and at most {MAX_TIMEOUT}")
    return number


def session_date(value: str) -> date:
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError("expected-session must be YYYY-MM-DD") from None
    if parsed.isoformat() != value:
        raise argparse.ArgumentTypeError("expected-session must be YYYY-MM-DD")
    return parsed


def parser() -> argparse.ArgumentParser:
    result = SafeArgumentParser(description=__doc__, epilog="""
Default preflight reads only the locally configured database; it never calls a provider.
The universe file is a JSON array of unique canonical uppercase symbols, asserted against
ALL active database symbols, not a selection. The cap never truncates the universe.
--apply is for later operational execution only: production acquisition is NOT currently
authorized. It requires accepted #168 source permission AND Vietcap-board coverage evidence,
fresh paired SQL/Mongo backups with successful off-source restore proof, and stopped
scheduler/other competing producers. Preflight and --apply do NOT verify or certify any
of those prerequisites. No licensing/backup approval flag is provided.
The target SHA256 pins limited credential-free SQL, configured Mongo and Redis locators,
NOT immutable cluster identity or authorization: aliases can differ and targets may be
replaced/restored. Git HEAD is reported, not worktree cleanliness. Mongo and Redis must
be enabled/configured even for preflight; preflight does not contact either service.
Datastore URIs must use unambiguous ampersand-separated nonblank options; duplicate
keys, encoded Mongo keys, and Redis query host/port/path overrides are rejected.
The timeout stops admission and requests cancellation, then waits for already-started
provider/Mongo work and SQL settlement while renewing the daily_sync lease; it is NOT a
hard process-exit deadline. Redis lease loss cannot fence an already-started writer.
SIGKILL, process crash and network partitions cannot guarantee draining or exclusion.
Never retry an uncertain outcome automatically. This command does not claim coverage
beyond Vietcap-board. Exit: 0 complete/preflight; 2 input; 3 preflight mismatch; 4 lock;
5 incomplete; 6 timeout; 7 infrastructure/cache/outcome/unknown commit; 130 interrupted.
""", formatter_class=argparse.RawDescriptionHelpFormatter)
    result.add_argument("--universe-file", type=Path, required=True)
    result.add_argument("--expected-session", type=session_date, required=True)
    result.add_argument("--max-symbols", type=positive_cap, required=True)
    result.add_argument("--timeout-seconds", type=positive_timeout, default=900.0)
    result.add_argument("--expected-target", help="SHA256 from preflight; required for --apply")
    result.add_argument("--apply", action="store_true", help="execute base-only recovery; NOT legal/backup approval")
    result.add_argument("--outcome", type=Path, help="new private local JSON file; existing paths are never overwritten")
    return result


def load_symbols(path: Path, cap: int) -> list[str]:
    with path.open("rb") as stream:
        raw = stream.read(1_048_577)
    if len(raw) > 1_048_576:
        raise ValueError("universe_file_too_large")
    values = json.loads(raw)
    if not isinstance(values, list) or not values or len(values) > cap:
        raise ValueError("universe_empty_or_over_cap")
    if any(not isinstance(value, str) or not SYMBOL.fullmatch(value) for value in values):
        raise ValueError("universe_not_canonical")
    if len(set(values)) != len(values):
        raise ValueError("universe_duplicate_symbols")
    return sorted(values)


def candidate_revision() -> str | None:
    try:
        result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=PROJECT_ROOT,
                                capture_output=True, text=True, timeout=3, check=False)
        revision = result.stdout.strip()
        return revision if result.returncode == 0 and re.fullmatch(r"[a-f0-9]{40,64}", revision) else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def locator_options(query: str, *, mongo: bool) -> dict[str, str]:
    if ";" in query:
        raise ValueError
    if mongo and query and any("%" in part.partition("=")[0] or part.count("=") != 1
                               for part in query.split("&")):
        raise ValueError
    options = {}
    for key, value in parse_qsl(query, keep_blank_values=True, strict_parsing=True):
        if not key.isascii():
            raise ValueError
        normalized = key.lower()
        if mongo and normalized == "ssl":
            normalized = "tls"
        if not key or not value or normalized in options:
            raise ValueError
        if not mongo and (key != normalized or normalized in {"host", "port", "path", "connection_class"}):
            raise ValueError
        options[normalized] = value
    return options


def datastore_locators(settings) -> dict:
    if not settings.mongodb_enabled or not settings.mongodb_url or not settings.mongodb_database:
        raise PreflightError("mongo_not_configured")
    if not settings.redis_url or settings.resolved_cache_backend != "redis":
        raise PreflightError("redis_not_configured")
    try:
        if (not settings.mongodb_url.startswith(("mongodb://", "mongodb+srv://"))
                or any(character.isspace() or ord(character) < 32 or ord(character) == 127
                       for character in settings.mongodb_url)
                or "#" in settings.mongodb_url):
            raise ValueError
        mongo = urlsplit(settings.mongodb_url)
        redis = urlsplit(settings.redis_url)
        if mongo.scheme not in {"mongodb", "mongodb+srv"} or not mongo.netloc or mongo.fragment:
            raise ValueError
        hosts = mongo.netloc.rsplit("@", 1)[-1]
        if not hosts or any(not host for host in hosts.split(",")):
            raise ValueError
        mongo_options = locator_options(mongo.query, mongo=True)
        target_options = {key: value for key, value in mongo_options.items() if key in {
            "tls", "replicaset", "directconnection", "loadbalanced", "srvservicename", "srvmaxhosts"}}
        if redis.scheme not in {"redis", "rediss", "unix"} or redis.fragment:
            raise ValueError
        redis_options = locator_options(redis.query, mongo=False)
        path_database = unquote(redis.path).replace("/", "") if redis.scheme != "unix" else ""
        database = int(redis_options.get("db", path_database or "0"))
        if database < 0 or (redis.scheme != "unix" and not redis.hostname) or (redis.scheme == "unix" and not redis.path):
            raise ValueError
        redis_locator = {"scheme": redis.scheme, "host": unquote(redis.hostname) if redis.hostname else None,
                         "port": redis.port or (6379 if redis.scheme != "unix" else None),
                         "socket": unquote(redis.path) if redis.scheme == "unix" else None, "database": database,
                         "tls_options": {key: value for key, value in redis_options.items() if key in {
                             "ssl_check_hostname", "ssl_cert_reqs", "ssl_min_version"}},
                         "lock_prefix": settings.scheduler_lock_key_prefix}
        return {"mongo": {"scheme": mongo.scheme, "hosts": hosts,
                          "database": settings.mongodb_database, "target_options": target_options},
                "redis": redis_locator}
    except (TypeError, ValueError):
        raise PreflightError("invalid_datastore_locator") from None


def target_fingerprint(sql_locator, settings) -> str:
    locator = {"sql": sql_locator, **datastore_locators(settings)}
    return hashlib.sha256(json.dumps(locator, sort_keys=True).encode()).hexdigest()


class Runtime:
    async def inspect(self, cap: int) -> dict:
        from sqlalchemy import text
        from vnibb.core.config import settings
        from vnibb.core.database import engine
        from vnibb.services.market_session import expected_market_session

        datastore_locators(settings)

        url = engine.url
        locator = [url.get_backend_name(), url.host, url.port, url.database]
        if url.get_backend_name() == "sqlite":
            import sqlite3
            if not url.database or url.database == ":memory:":
                raise PreflightError("non_durable_target")
            database = Path(url.database).resolve(strict=True)
            with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=3) as connection:
                rows = connection.execute("SELECT symbol FROM stocks WHERE is_active=1 ORDER BY symbol LIMIT ?", (cap + 1,)).fetchall()
            locator = ["sqlite", str(database), database.stat().st_dev, database.stat().st_ino]
        elif url.get_backend_name() == "postgresql":
            async with engine.connect() as connection:
                transaction = await connection.begin()
                try:
                    await connection.execute(text("SET TRANSACTION READ ONLY"))
                    await connection.execute(text("SET LOCAL statement_timeout='5s'"))
                    await connection.execute(text("SET LOCAL lock_timeout='1s'"))
                    identity = (await connection.execute(text("SELECT current_database(), current_schema(), inet_server_addr()::text, inet_server_port()"))).one()
                    locator.append(list(identity))
                    rows = (await connection.execute(text("SELECT symbol FROM stocks WHERE is_active=1 ORDER BY symbol LIMIT :bound"), {"bound": cap + 1})).fetchall()
                finally:
                    await transaction.rollback()
        else:
            raise PreflightError("unsupported_read_only_target")
        symbols = [row[0] for row in rows]
        if not symbols or len(symbols) > cap or any(not isinstance(value, str) or not SYMBOL.fullmatch(value) for value in symbols) or len(set(symbols)) != len(symbols):
            raise PreflightError("active_universe_invalid_or_over_cap")
        return {"target": target_fingerprint(locator, settings),
                "symbols": sorted(symbols), "session": expected_market_session().isoformat()}

    def coordination(self):
        from vnibb.core.config import settings
        from vnibb.core.scheduler_lock import DistributedJobLock
        if not settings.scheduler_lock_enabled:
            return None
        return DistributedJobLock("daily_sync", timeout_seconds=30)

    async def acquire(self, symbols: list[str], session: date, progress: dict) -> int:
        from vnibb.services.data_pipeline import DataPipeline
        return await DataPipeline().sync_screener_data(
            symbols=None, exchanges=None, limit=None, acquire_sessions=True, enrich_ratios=False,
            expected_symbols=symbols, expected_session=session, verify_cache=True, progress=progress,
        )

    async def record(self, outcome: dict, run_id: int | None = None) -> int:
        from vnibb.core.database import async_session_maker
        from vnibb.models.sync_status import SyncStatus
        async with asyncio.timeout(5):
            async with async_session_maker() as session:
                if run_id is None:
                    row = SyncStatus(sync_type="screener_recovery", status="running", started_at=datetime.utcnow(),
                                     additional_data=outcome, success_count=0, error_count=0)
                    session.add(row)
                else:
                    row = await session.get(SyncStatus, run_id)
                    if row is None or row.sync_type != "screener_recovery":
                        raise RuntimeError("recovery_run_missing")
                    row.status = "completed" if outcome["exit_code"] == 0 else "failed"
                    row.completed_at = datetime.utcnow()
                    row.success_count = outcome.get("committed_count") or 0
                    row.error_count = int(outcome["exit_code"] != 0)
                    row.additional_data = outcome
                await session.flush()
                identity = row.id
                await session.commit()
                return identity


def assert_target(observed: dict, args, symbols: list[str]) -> None:
    if observed["symbols"] != symbols:
        raise PreflightError("active_universe_identity_mismatch")
    if observed["session"] != args.expected_session.isoformat():
        raise PreflightError("expected_session_mismatch")
    if args.expected_target and observed["target"] != args.expected_target:
        raise PreflightError("target_fingerprint_mismatch")


def pipeline_state(progress: dict, symbols: list[str], session: date) -> dict:
    state = {"cohort_published": progress.get("cohort_published") is True,
             "sql_commit_state": progress.get("sql_commit_state", "unknown"),
             "committed_count": progress.get("committed_count"),
             "sql_effects_may_exist": progress.get("sql_effects_may_exist") is True,
             "cache_updates_verified": progress.get("cache_updates_verified") is True,
             "session_input_complete": progress.get("session_input_complete") is True}
    if state["sql_commit_state"] not in {"not_started", "in_progress", "committed", "unknown"}:
        state["sql_commit_state"] = "unknown"
    if type(state["committed_count"]) is not int or state["committed_count"] < 0:
        state["committed_count"] = None
    state["membership_complete"] = progress.get("session_requested") == symbols and progress.get("session_admitted") == symbols
    state["session_matches"] = progress.get("market_session_date") == session.isoformat()
    state["stage_error_count"] = progress.get("error_count") if type(progress.get("error_count")) is int else None
    for name in ("cache_expected_count", "cache_verified_count"):
        value = progress.get(name)
        state[name] = value if type(value) is int and value >= 0 else None
    errors = progress.get("cache_errors")
    state["cache_error_count"] = len(errors) if isinstance(errors, list) else None
    return state


def completion_code(state: dict) -> int:
    if state["sql_commit_state"] in {"in_progress", "unknown"}:
        return 7
    cache_complete = (state["cache_updates_verified"] and state["cache_expected_count"] is not None
                      and state["cache_expected_count"] > 0
                      and state["cache_verified_count"] == state["cache_expected_count"]
                      and state["cache_error_count"] == 0)
    if state["cohort_published"] and not cache_complete:
        return 7
    if (state["cohort_published"] and state["sql_commit_state"] == "committed"
            and state["committed_count"] is not None and cache_complete
            and state["session_input_complete"] and state["membership_complete"]
            and state["session_matches"] and state["stage_error_count"] == 0):
        return 0
    return 5


async def settle(task: asyncio.Task):
    """Do not abandon a started write when the supervising task is cancelled again."""
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            continue
        except Exception:
            break
    try:
        return task.result(), None
    except BaseException as exc:
        return None, exc


async def renew_lease(lock, stop: asyncio.Event, lost: asyncio.Event) -> None:
    interval = max(0.01, min(10.0, lock.ttl_seconds / 3))
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except TimeoutError:
            try:
                async with asyncio.timeout(min(5.0, interval)):
                    renewed = await lock.renew()
                if not renewed:
                    lost.set()
            except Exception:
                lost.set()


async def finish_apply(runtime, lock, stop, lost, renewal, watchers, run_id, outcome, code, interrupted):
    for watcher in watchers:
        watcher.cancel()
        await settle(watcher)
    # ponytail: lease loss is observable, not fencing; producers must remain stopped.
    try:
        async with asyncio.timeout(5):
            if not await lock.renew():
                lost.set()
    except Exception:
        lost.set()
    if lost.is_set():
        outcome["coordination"] = "lost_unfenced"
        if code not in {6, 130}:
            code = 4
    if interrupted.is_set():
        code = 130
    outcome["lease_release_state"] = "pending"
    outcome["run_record_scope"] = "pipeline_settlement_before_lease_release"
    outcome["exit_code"] = code
    if run_id is not None:
        recorded_code = code
        _, error = await settle(asyncio.create_task(runtime.record(dict(outcome), run_id)))
        outcome["run_record_state"] = "stored" if error is None else "unknown"
        outcome["run_record_exit_code"] = recorded_code if error is None else None
        outcome["interrupt_in_run_record"] = recorded_code == 130 if error is None else None
        if error is not None:
            outcome["record_error_type"] = type(error).__name__
            code = 7 if code not in {6, 130} else code
    stop.set()
    await settle(renewal)
    released, error = await settle(asyncio.create_task(lock.release()))
    outcome["lease_released"] = released is True and error is None
    outcome["lease_release_state"] = "released" if outcome["lease_released"] else "uncertain"
    if not outcome["lease_released"] and code == 0:
        code = 4
    return 130 if interrupted.is_set() else code


async def apply_recovery(runtime, args, symbols: list[str], outcome: dict, interrupted: asyncio.Event) -> int:
    lock = runtime.coordination()
    if lock is None:
        outcome["coordination"] = "disabled"
        return 4
    try:
        async with asyncio.timeout(min(5.0, args.timeout_seconds)):
            acquired = await lock.acquire()
    except Exception as exc:
        outcome.update(coordination="unavailable_or_unknown", error_type=type(exc).__name__)
        if lock.token:
            await settle(asyncio.create_task(lock.release()))
        return 4
    outcome["coordination"] = acquired if acquired in {"acquired", "contended", "unavailable"} else "unknown"
    if acquired != "acquired":
        return 4
    stop, lost = asyncio.Event(), asyncio.Event()
    renewal = asyncio.create_task(renew_lease(lock, stop, lost))
    work = None
    watchers = []
    run_id = None
    progress: dict = {}
    code = 7
    try:
        async with asyncio.timeout(min(5.0, args.timeout_seconds)):
            observed = await runtime.inspect(args.max_symbols)
        if load_symbols(args.universe_file, args.max_symbols) != symbols:
            raise PreflightError("universe_file_changed")
        assert_target(observed, args, symbols)
        if interrupted.is_set() or lost.is_set():
            code = 130 if interrupted.is_set() else 4
        else:
            run_id = await runtime.record(dict(outcome))
            outcome["run_id"] = run_id
            async with asyncio.timeout(5):
                if not await lock.renew():
                    lost.set()
            if interrupted.is_set() or lost.is_set():
                code = 130 if interrupted.is_set() else 4
            else:
                outcome["pipeline_settled"] = False
                work = asyncio.create_task(runtime.acquire(symbols, args.expected_session, progress))
                watchers = [asyncio.create_task(interrupted.wait()), asyncio.create_task(lost.wait())]
                done, _ = await asyncio.wait([work, *watchers], timeout=args.timeout_seconds, return_when=asyncio.FIRST_COMPLETED)
                code = 130 if interrupted.is_set() else 4 if lost.is_set() else 6 if not done else 7
                if work not in done or interrupted.is_set() or lost.is_set():
                    work.cancel()
                _, error = await settle(work)
                outcome.update(pipeline_state(progress, symbols, args.expected_session), pipeline_settled=True)
                if error is not None:
                    outcome["error_type"] = type(error).__name__
                if code not in {4, 6, 130}:
                    code = 7 if error else completion_code(outcome)
    except PreflightError as exc:
        outcome["reason"] = str(exc)
        code = 3
    except asyncio.CancelledError:
        code = 130
        if work is not None:
            work.cancel()
            _, error = await settle(work)
            outcome.update(pipeline_state(progress, symbols, args.expected_session), pipeline_settled=True)
            if error is not None:
                outcome["error_type"] = type(error).__name__
    except Exception as exc:
        outcome["error_type"] = type(exc).__name__
        outcome["run_record_state"] = "unknown" if run_id is None else "started"
        code = 7
    finally:
        if work is not None:
            if not work.done():
                work.cancel()
            _, error = await settle(work)
            outcome.update(pipeline_state(progress, symbols, args.expected_session), pipeline_settled=True)
            if error is not None:
                outcome["error_type"] = type(error).__name__
        cleanup = asyncio.create_task(finish_apply(runtime, lock, stop, lost, renewal, watchers, run_id, outcome, code, interrupted))
        final_code, error = await settle(cleanup)
        if error is not None:
            outcome["cleanup_error_type"] = type(error).__name__
            code = 7
        else:
            code = final_code
    return code


async def execute(args, symbols: list[str], runtime=None, interrupted=None) -> dict:
    runtime = runtime or Runtime()
    interrupted = interrupted or asyncio.Event()
    outcome = {"operation": "screener_recovery", "mode": "apply" if args.apply else "preflight",
               "attempt_id": uuid4().hex, "scope": "vietcap_board", "candidate_revision": candidate_revision(),
               "symbol_count": len(symbols), "universe_sha256": hashlib.sha256(json.dumps(symbols).encode()).hexdigest(),
               "expected_session": args.expected_session.isoformat(), "operational_prerequisites_verified": False,
               "cohort_published": False, "sql_commit_state": "not_started", "committed_count": 0,
               "sql_effects_may_exist": False,
               "cache_updates_verified": False, "pipeline_settled": True, "exit_code": 7}
    try:
        async with asyncio.timeout(min(5.0, args.timeout_seconds)):
            observed = await runtime.inspect(args.max_symbols)
        outcome["target"] = observed["target"]
        assert_target(observed, args, symbols)
        if args.apply:
            outcome["exit_code"] = await apply_recovery(runtime, args, symbols, outcome, interrupted)
        else:
            outcome.update(exit_code=0, reason="read_only_preflight_passed")
    except PreflightError as exc:
        outcome.update(exit_code=3, reason=str(exc))
    except Exception as exc:
        outcome.update(exit_code=7, error_type=type(exc).__name__)
    outcome["interrupted"] = interrupted.is_set()
    if outcome["interrupted"]:
        outcome["exit_code"] = 130
    return outcome


async def run_with_signals(args, symbols):
    interrupted = asyncio.Event()
    loop = asyncio.get_running_loop()
    installed = []
    for signum in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(signum, interrupted.set)
            installed.append(signum)
        except (NotImplementedError, RuntimeError):
            pass
    try:
        return await execute(args, symbols, interrupted=interrupted)
    finally:
        for signum in installed:
            loop.remove_signal_handler(signum)


def main(argv=None) -> int:
    arguments = parser()
    args = arguments.parse_args(argv)
    if args.apply and not args.expected_target:
        arguments.error("--apply requires --expected-target from a successful preflight")
    if args.expected_target and not re.fullmatch(r"[a-f0-9]{64}", args.expected_target):
        arguments.error("--expected-target must be a lowercase SHA256")
    destination = None
    try:
        symbols = load_symbols(args.universe_file, args.max_symbols)
        if args.outcome:
            fd = os.open(args.outcome, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
            destination = os.fdopen(fd, "w", encoding="utf-8")
    except (OSError, ValueError) as exc:
        print(json.dumps({"operation": "screener_recovery", "exit_code": 2, "error_type": type(exc).__name__}))
        return 2
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))
    logging.disable(logging.CRITICAL)
    with open(os.devnull, "w") as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
        outcome = asyncio.run(run_with_signals(args, symbols))
    if destination:
        try:
            with destination:
                json.dump(outcome, destination, sort_keys=True)
                destination.write("\n")
                destination.flush()
                os.fsync(destination.fileno())
        except OSError as exc:
            outcome.update(exit_code=7, outcome_file_state="unknown", output_error_type=type(exc).__name__)
    print(json.dumps(outcome, sort_keys=True))
    return outcome["exit_code"]


if __name__ == "__main__":
    raise SystemExit(main())
