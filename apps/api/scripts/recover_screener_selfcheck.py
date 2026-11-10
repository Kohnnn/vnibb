"""Stdlib-only offline assertions: python scripts/recover_screener_selfcheck.py."""
from __future__ import annotations

import asyncio
import contextlib
import functools
import importlib.util
import io
import json
import sqlite3
import sys
import threading
import types
from datetime import date, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, MagicMock, patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("recover_screener", HERE / "recover_screener.py")
command = importlib.util.module_from_spec(spec)
spec.loader.exec_module(command)


def load_pipeline():
    """Import the real module, replacing only unavailable I/O/dependency boundaries."""
    modules = {}
    names = ("pandas", "sqlalchemy", "sqlalchemy.exc", "sqlalchemy.ext.asyncio",
             "vnibb.core.cache", "vnibb.core.cache_constants", "vnibb.core.config",
             "vnibb.core.database", "vnibb.core.market_cap", "vnibb.core.insider_units",
             "vnibb.core.retry", "vnibb.core.price_units", "vnibb.core.ratio_units",
             "vnibb.core.vn_sectors", "vnibb.core.screener_shares", "vnibb.providers.vnstock.runtime",
             "vnibb.providers.market_data",
             "vnibb.providers.vnstock.reference_fields", "vnibb.services.screener_metadata",
             "vnibb.services.cache_manager", "vnibb.services.market_session", "vnibb.models.alerts",
             "vnibb.models.company", "vnibb.models.derivatives", "vnibb.models.financials",
             "vnibb.models.market", "vnibb.models.market_news", "vnibb.models.news",
             "vnibb.models.screener", "vnibb.models.stock", "vnibb.models.sync_status",
             "vnibb.models.technical_indicator", "vnibb.models.trading",
             "vnibb.providers.vnstock.financial_ratios", "vnibb.providers.vnstock.financials",
             "vnibb.services.data_quality", "vnibb.services.financial_service",
             "vnibb.services.prediction_market_retention", "vnibb.services.realtime_pipeline")
    for name in names:
        for end in range(1, len(name.split(".")) + 1):
            full = ".".join(name.split(".")[:end])
            if full not in modules:
                module = types.ModuleType(full)
                module.__path__ = []
                module.__getattr__ = lambda attribute: MagicMock(name=attribute)
                modules[full] = module
    modules["vnibb.core.config"].settings = types.SimpleNamespace(
        vnstock_rate_limit_rps=0, vnstock_reinforcement_rps=0, vnstock_calls_per_minute=0,
        price_history_years=1)
    def retry(**options):
        def decorate(operation):
            @functools.wraps(operation)
            async def wrapped(*args, **kwargs):
                return await operation(*args, **kwargs)
            return wrapped
        return decorate
    modules["vnibb.core.retry"].with_retry = retry
    pipeline_spec = importlib.util.spec_from_file_location("recovery_checked_pipeline", HERE.parent / "vnibb/services/data_pipeline.py")
    pipeline = importlib.util.module_from_spec(pipeline_spec)
    with patch.dict(sys.modules, modules):
        pipeline_spec.loader.exec_module(pipeline)
    return pipeline


pipeline = load_pipeline()
DRAIN = pipeline._drain_screener_thread
VALIDATE = pipeline._validate_screener_recovery_target
SYMBOLS = ["FPT", "VCB"]
SESSION = date(2026, 11, 5)
TARGET = "a" * 64


class Lock:
    ttl_seconds = 0.03
    token = "private-token"

    def __init__(self, state="acquired", lose=False):
        self.state, self.lose = state, lose
        self.renewals, self.released, self.active = 0, False, False

    async def acquire(self):
        return self.state

    async def renew(self):
        self.renewals += 1
        return not (self.lose and self.renewals > 1)

    async def release(self):
        assert not self.active, "lease released before started writer drained"
        self.released = True
        return not self.lose


class Runtime:
    def __init__(self, *, state="complete", lock=True, block=False, change=None, record_error=None):
        self.lock = Lock() if lock is True else lock
        self.state, self.block, self.change, self.record_error = state, block, change, record_error
        self.inspections, self.acquisitions, self.records = 0, 0, 0
        self.started, self.release = threading.Event(), threading.Event()
        self.written = False

    async def inspect(self, cap):
        self.inspections += 1
        result = {"target": TARGET, "symbols": SYMBOLS, "session": SESSION.isoformat()}
        if self.change and self.inspections > 1:
            result.update(self.change)
        return result

    def coordination(self):
        return self.lock

    async def record(self, outcome, run_id=None):
        assert self.lock and not self.lock.released
        self.records += 1
        if self.record_error == self.records:
            raise RuntimeError("postgres://user:secret@private-db/outcome")
        return 17

    async def acquire(self, symbols, session, progress):
        assert symbols == SYMBOLS and session == SESSION
        assert self.lock and not self.lock.released
        self.acquisitions += 1
        progress.update(sql_commit_state="not_started", sql_effects_may_exist=False)
        if self.block:
            self.lock.active = True
            def writer():
                self.started.set()
                assert self.release.wait(2), "selfcheck did not release writer"
                self.written = True
                self.lock.active = False
            await DRAIN(writer)
            raise AssertionError("cancelled acquisition admitted later work")
        progress.update(cohort_published=True, sql_commit_state="committed", sql_effects_may_exist=True,
                        committed_count=2, cache_updates_verified=True, session_input_complete=True,
                        session_requested=SYMBOLS, session_admitted=SYMBOLS, market_session_date=SESSION.isoformat(),
                        error_count=0, cache_expected_count=4, cache_verified_count=4, cache_errors=[])
        if self.state == "cache_failure":
            progress.update(cache_updates_verified=False, cache_verified_count=3, cache_errors=["private detail"])
        elif self.state == "unknown":
            progress.update(cohort_published=False, sql_commit_state="unknown", committed_count=0)
        elif self.state == "incomplete":
            progress.update(cohort_published=False, session_input_complete=False, session_admitted=["FPT"])
        elif self.state == "row_count_only":
            progress.clear()
        return 2


async def async_checks(directory):
    path = Path(directory) / "universe.json"
    path.write_text(json.dumps(SYMBOLS))
    args = command.parser().parse_args(["--universe-file", str(path), "--expected-session", str(SESSION),
                                       "--max-symbols", "2", "--expected-target", TARGET])
    runtime = Runtime()
    outcome = await command.execute(args, SYMBOLS, runtime)
    assert outcome["exit_code"] == 0 and outcome["mode"] == "preflight"
    assert runtime.acquisitions == runtime.records == 0 and not runtime.lock.released
    assert not outcome["operational_prerequisites_verified"] and not outcome["cohort_published"]
    outcome = await command.execute(args, ["ACB", "VCB"], runtime)
    assert outcome["exit_code"] == 3 and runtime.acquisitions == 0
    args.apply = True
    for lock in (None, Lock("contended"), Lock("unavailable")):
        runtime = Runtime(lock=lock)
        outcome = await command.execute(args, SYMBOLS, runtime)
        assert outcome["exit_code"] == 4 and runtime.acquisitions == runtime.records == 0
    for change in ({"symbols": ["ACB", "VCB"]}, {"target": "b" * 64}, {"session": "2026-11-04"}):
        runtime = Runtime(change=change)
        outcome = await command.execute(args, SYMBOLS, runtime)
        assert outcome["exit_code"] == 3 and runtime.acquisitions == runtime.records == 0
        assert runtime.lock.released
    database = Path(directory) / "read-only.db"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE stocks (symbol TEXT, is_active INTEGER)")
        connection.executemany("INSERT INTO stocks VALUES (?, 1)", [(value,) for value in SYMBOLS])
    settings = types.SimpleNamespace(mongodb_enabled=True, mongodb_url="mongodb://user:secret@mongo:27017/?tls=true",
                                     mongodb_database="market", redis_url="redis://user:secret@redis:6379/0",
                                     resolved_cache_backend="redis", scheduler_lock_key_prefix="lock")
    url = types.SimpleNamespace(get_backend_name=lambda: "sqlite", host=None, port=None, database=str(database))
    isolated = {}
    for name, attributes in {
        "sqlalchemy": {"text": lambda value: value},
        "vnibb.core.config": {"settings": settings},
        "vnibb.core.database": {"engine": types.SimpleNamespace(url=url)},
        "vnibb.services.market_session": {"expected_market_session": lambda: SESSION},
    }.items():
        isolated[name] = types.ModuleType(name)
        isolated[name].__dict__.update(attributes)
    with patch.dict(sys.modules, isolated):
        baseline = await command.Runtime().inspect(2)
        for field, changed in (("mongodb_url", "mongodb://mongo-other:27017/?tls=true"),
                               ("redis_url", "rediss://redis:6379/1")):
            original = getattr(settings, field)
            setattr(settings, field, changed)
            observed = await command.Runtime().inspect(2)
            assert baseline["target"] != observed["target"]
            runtime = Runtime(change={"target": observed["target"]})
            with patch.object(args, "expected_target", baseline["target"]):
                runtime.inspect = AsyncMock(side_effect=[baseline, observed])
                outcome = await command.execute(args, SYMBOLS, runtime)
            assert outcome["exit_code"] == 3 and runtime.acquisitions == runtime.records == 0
            setattr(settings, field, original)
        assert "secret" not in json.dumps(command.datastore_locators(settings))
        for field, invalid in (
            ("redis_url", "redis://user:secret@redis/0?db=1&db=2"),
            ("redis_url", "redis://user:secret@redis/0?db=3&db=2"),
            ("redis_url", "redis://user:secret@redis/0?%64b=1&db=2"),
            ("redis_url", "redis://user:secret@redis/0?db=&db=2"),
            ("redis_url", "redis://user:secret@redis/0?db="),
            ("redis_url", "redis://user:secret@redis/0?DB=1"),
            ("redis_url", "redis://user:secret@redis/0?%C5%BFocket_timeout=1"),
            ("redis_url", "redis://user:secret@redis/0?port=6380"),
            ("redis_url", "redis://user:secret@redis/0?%70ort=6380"),
            ("redis_url", "redis://user:secret@redis/0?host=other"),
            ("redis_url", "unix:///tmp/redis.sock?path=/tmp/other.sock"),
            ("mongodb_url", "mongodb://user:secret@mongo/?replicaSet=rsA&REPLICASET=rsB"),
            ("mongodb_url", "mongodb://user:secret@mongo/?tls=true&SSL=true"),
            ("mongodb_url", "mongodb://user:secret@mongo/?replicaSet=rsA;tls=true"),
            ("mongodb_url", "mongodb://user:secret@mongo/?replicaSet=rsA&replica%53et=mask"),
            ("mongodb_url", "mongodb://user:secret@mongo/?replica%53et=rsA"),
            ("mongodb_url", "mongodb://user:secret@mongo/?replicaſet=rsA"),
            ("mongodb_url", "mongodb://user:secret@mongo/?replicaſet=rsB"),
            ("mongodb_url", "mongodb://user:secret@mongo/?replicaSet=rsA&replicaſet=mask"),
            ("mongodb_url", "mongodb://user:secret@mongo/?replicaSet=rsB&replicaſet=mask"),
            ("mongodb_url", "mongodb://user:secret@mongo/?tls="),
            ("mongodb_url", "mongodb://user:secret@mongo/?replicaSet=rsA#"),
            ("mongodb_url", "mongodb://user:secret@mongo/?replicaSet=rsA#ignored"),
            ("mongodb_url", "mongodb://user:secret@mongo/?replicaSet=rsA=ignored"),
            ("mongodb_url", "MongoDB://user:secret@mongo/?replicaSet=rsA"),
            ("mongodb_url", " mongodb://user:secret@mongo/?replicaSet=rsA"),
            ("mongodb_url", "\x00mongodb://user:secret@mongo/?replicaSet=rsA"),
            ("mongodb_url", "mongodb://user:secret@mongo/?replicaSet=rs\tA"),
        ):
            with patch.object(settings, field, invalid):
                try:
                    await command.Runtime().inspect(2)
                except command.PreflightError as error:
                    assert str(error) == "invalid_datastore_locator" and "secret" not in str(error)
                else:
                    raise AssertionError("ambiguous datastore URI accepted")
        for locator in ("redis://user:secret@redis/%32", "redis://user:secret@redis/2",
                        "redis://user:secret@redis/0?%64b=2"):
            with patch.object(settings, "redis_url", locator):
                assert command.datastore_locators(settings)["redis"]["database"] == 2
                decoded_target = (await command.Runtime().inspect(2))["target"]
                if locator.endswith("/%32"):
                    encoded_target = decoded_target
                else:
                    assert decoded_target == encoded_target
    for state, expected in (("complete", 0), ("cache_failure", 7), ("unknown", 7), ("incomplete", 5), ("row_count_only", 7)):
        runtime = Runtime(state=state)
        outcome = await command.execute(args, SYMBOLS, runtime)
        assert outcome["exit_code"] == expected, (state, outcome)
        assert runtime.acquisitions == 1 and runtime.records == 2 and runtime.lock.released
        if state == "cache_failure":
            assert outcome["cohort_published"] and outcome["committed_count"] == 2
            assert "private detail" not in json.dumps(outcome)
    for phase in ("record", "release"):
        runtime = Runtime()
        interrupted = asyncio.Event()
        recorded = []
        original_record, original_release = runtime.record, runtime.lock.release
        async def record(outcome, run_id=None, _record=original_record, _phase=phase,
                         _interrupted=interrupted, _recorded=recorded):
            if run_id is not None:
                _recorded.append(dict(outcome))
                if _phase == "record":
                    _interrupted.set()
            return await _record(outcome, run_id)
        async def release(_release=original_release, _phase=phase, _interrupted=interrupted):
            if _phase == "release":
                _interrupted.set()
            return await _release()
        with patch.object(runtime, "record", record), patch.object(runtime.lock, "release", release):
            outcome = await command.execute(args, SYMBOLS, runtime, interrupted)
        assert outcome["exit_code"] == 130 and runtime.lock.released and outcome["pipeline_settled"]
        assert recorded[0]["exit_code"] == outcome["run_record_exit_code"] == 0
        assert outcome["interrupt_in_run_record"] is False
        assert outcome["run_record_scope"] == "pipeline_settlement_before_lease_release"
    for failure in (1, 2):
        runtime = Runtime(record_error=failure)
        outcome = await command.execute(args, SYMBOLS, runtime)
        assert outcome["exit_code"] == 7 and "secret" not in json.dumps(outcome)
        assert runtime.acquisitions == int(failure == 2)
        if failure == 2:
            assert outcome["cohort_published"] and outcome["run_record_state"] == "unknown"
    for scenario, expected in (("timeout", 6), ("interrupt", 130), ("loss", 4)):
        runtime = Runtime(block=True, lock=Lock(lose=scenario == "loss"))
        args.timeout_seconds = 0.04 if scenario == "timeout" else 1
        interrupted = asyncio.Event()
        task = asyncio.create_task(command.execute(args, SYMBOLS, runtime, interrupted))
        assert await asyncio.to_thread(runtime.started.wait, 1)
        if scenario == "interrupt":
            task.cancel()
            await asyncio.sleep(0)
            task.cancel()
        await asyncio.sleep(0.07)
        assert not task.done() and not runtime.lock.released and runtime.lock.renewals >= 2
        runtime.release.set()
        outcome = await task
        assert outcome["exit_code"] == expected and runtime.written and runtime.lock.released
        assert runtime.acquisitions == 1 and outcome["pipeline_settled"]
        if scenario == "loss":
            assert outcome["coordination"] == "lost_unfenced"
    captured = {}
    class Pipeline:
        async def sync_screener_data(self, **kwargs):
            captured.update(kwargs)
            return 2
    fake_module = types.ModuleType("vnibb.services.data_pipeline")
    fake_module.DataPipeline = Pipeline
    with patch.dict(sys.modules, {"vnibb.services.data_pipeline": fake_module}):
        progress = {}
        await command.Runtime().acquire(SYMBOLS, SESSION, progress)
    assert captured == {"symbols": None, "exchanges": None, "limit": None, "acquire_sessions": True,
                        "enrich_ratios": False, "expected_symbols": SYMBOLS, "expected_session": SESSION,
                        "verify_cache": True, "progress": progress}
    for acknowledge, readback, succeeds in ((True, {"session": str(SESSION)}, True),
                                            (False, {"session": str(SESSION)}, False),
                                            (True, {"session": "wrong"}, False)):
        cache = types.SimpleNamespace(set_json=AsyncMock(return_value=acknowledge),
                                      get_json=AsyncMock(return_value=readback))
        with patch.object(pipeline, "redis_client", cache):
            try:
                await pipeline._write_verified_screener_cache("key", {"session": SESSION}, 60)
            except RuntimeError:
                assert not succeeds
            else:
                assert succeeds
        assert cache.set_json.await_count == 1
        assert cache.get_json.await_count == int(acknowledge)
    for remaining, deletion_error, succeeds in ((None, None, True), ("stale", None, False),
                                               (None, RuntimeError("delete failed"), False)):
        client = types.SimpleNamespace(delete=AsyncMock(return_value=1, side_effect=deletion_error),
                                       get=AsyncMock(return_value=remaining))
        with patch.object(pipeline, "redis_client", types.SimpleNamespace(client=client)):
            try:
                await pipeline._invalidate_verified_screener_cache("key")
            except RuntimeError:
                assert not succeeds
            else:
                assert succeeds
        assert client.delete.await_count == 1
    for committed in (False, True):
        calls = []
        async def operation(self, _calls=calls, _committed=committed, **kwargs):
            _calls.append(kwargs)
            kwargs["progress"].update(sql_effects_may_exist=True,
                                      sql_commit_state="committed" if _committed else "in_progress",
                                      cohort_published=_committed, committed_count=2 if _committed else 0)
            raise RuntimeError("original failure")
        async def decorated(self, **kwargs):
            raise AssertionError("strict wrapper used retry-decorated operation")
        decorated.__wrapped__ = operation
        instance = pipeline.DataPipeline.__new__(pipeline.DataPipeline)
        progress = {}
        with patch.object(pipeline.DataPipeline, "_sync_screener_data", decorated):
            try:
                await instance.sync_screener_data(expected_symbols=SYMBOLS, expected_session=SESSION,
                                                  acquire_sessions=True, verify_cache=True, progress=progress)
            except RuntimeError as error:
                assert str(error) == "original failure"
            else:
                raise AssertionError("public wrapper swallowed original failure")
        assert len(calls) == 1 and calls[0]["symbols"] is None and calls[0]["limit"] is None
        assert progress["sql_commit_state"] == ("committed" if committed else "unknown")
        assert progress["cohort_published"] is committed


def main():
    VALIDATE(SYMBOLS, SYMBOLS, SESSION, SESSION)
    for symbols, session in ((["ACB", "VCB"], SESSION), (["FPT", "FPT"], SESSION), (["fpt", "VCB"], SESSION),
                             ([" FPT", "VCB"], SESSION), ([], SESSION), (SYMBOLS, date(2026, 11, 4)),
                             (SYMBOLS, datetime(2026, 11, 5))):
        try:
            VALIDATE(SYMBOLS, symbols, session, SESSION)
        except ValueError:
            pass
        else:
            raise AssertionError("pipeline accepted invalid assertion")
    with TemporaryDirectory() as directory, patch.object(command, "candidate_revision", return_value="0" * 40):
        path = Path(directory) / "symbols.json"
        for invalid in (["FPT", "FPT"], ["fpt"], [" FPT"], [], {"symbols": SYMBOLS}, ["FPT", "VCB", "ACB"]):
            path.write_text(json.dumps(invalid))
            try:
                command.load_symbols(path, 2)
            except ValueError:
                pass
            else:
                raise AssertionError("invalid universe accepted")
        asyncio.run(async_checks(directory))
        destination = Path(directory) / "existing.json"
        destination.write_text("do not overwrite")
        output = io.StringIO()
        with contextlib.redirect_stdout(output), patch.object(command, "run_with_signals", side_effect=AssertionError("must not start")):
            assert command.main(["--universe-file", str(Path(directory) / "universe.json"), "--expected-session", str(SESSION),
                                 "--max-symbols", "2", "--outcome", str(destination)]) == 2
        assert destination.read_text() == "do not overwrite" and "secret" not in output.getvalue()
    for converter, values in ((command.positive_cap, ("0", "-1", "10001", "x")),
                              (command.positive_timeout, ("0", "nan", "inf", "86401"))):
        for value in values:
            try:
                converter(value)
            except ValueError:
                pass
            except command.argparse.ArgumentTypeError:
                pass
            else:
                raise AssertionError("invalid bound accepted")
    print("Recovery command self-check passed (no providers/datastores)")


if __name__ == "__main__":
    main()
