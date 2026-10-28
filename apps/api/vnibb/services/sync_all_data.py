"""
Full market synchronization orchestrator.

This service replaces legacy vnstock-only placeholders with calls into the
production DataPipeline, so /sync/full-market writes real data to Postgres,
which is the single runtime data source.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from fastapi.encoders import jsonable_encoder
from sqlalchemy import select

from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.models.stock import Stock
from vnibb.models.sync_status import SyncStatus
from vnibb.services.data_pipeline import data_pipeline

logger = logging.getLogger(__name__)

DAILY_MARKET_HISTORY_DAYS = 21


@dataclass
class SyncResult:
    """Result from a sync operation."""

    success: bool
    synced_count: int
    error_count: int
    duration_seconds: float
    errors: list[str]
    complete: bool = True
    pending_count: int = 0


class FullMarketSync:
    """
    Full market data synchronization service.

    Uses DataPipeline methods that already implement persistence, retries,
    and provider fallbacks.
    """

    async def _get_seeded_symbols(self, max_symbols: int | None = None) -> list[str]:
        async with async_session_maker() as session:
            result = await session.execute(
                select(Stock.symbol).where(Stock.is_active == 1).order_by(Stock.symbol.asc())
            )
            symbols = [str(row[0]).upper() for row in result.fetchall() if row[0]]

        if max_symbols is not None and max_symbols > 0:
            return symbols[:max_symbols]
        return symbols



    async def _run_stage(
        self,
        stage_name: str,
        operation: Callable[[], Awaitable[int]],
    ) -> SyncResult:
        start = time.monotonic()
        errors: list[str] = []
        synced_count = 0
        success = True

        try:
            synced_count = int(await operation())
        except Exception as exc:  # noqa: BLE001
            success = False
            errors.append(str(exc))
            logger.exception("%s sync failed: %s", stage_name, exc)

        duration_seconds = time.monotonic() - start
        return SyncResult(
            success=success,
            synced_count=synced_count,
            error_count=len(errors),
            duration_seconds=duration_seconds,
            errors=errors,
        )

    async def sync_all_symbols(self) -> SyncResult:
        """Sync stock universe into the Stock table."""

        async def _operation() -> int:
            return await data_pipeline.sync_stock_list()

        return await self._run_stage("symbols", _operation)

    async def sync_all_profiles(
        self,
        symbols: list[str] | None = None,
        max_symbols: int | None = None,
    ) -> SyncResult:
        """Sync company profile records for all (or selected) symbols."""

        resolved_symbols = symbols or await self._get_seeded_symbols(max_symbols=max_symbols)

        async def _operation() -> int:
            progress: dict = {}
            count = await data_pipeline.sync_company_profiles(symbols=resolved_symbols, progress=progress)
            if progress.get("error_count"):
                raise RuntimeError("Profile acquisition has failed symbols")
            return count

        return await self._run_stage("profiles", _operation)

    async def sync_all_prices(
        self,
        symbols: list[str] | None = None,
        max_symbols: int | None = None,
        include_historical: bool = False,
        history_days: int | None = None,
    ) -> SyncResult:
        """
        Sync price-related datasets.

        Includes screener snapshot prices for all symbols and, optionally,
        daily OHLCV history.
        """

        resolved_symbols = symbols or await self._get_seeded_symbols(max_symbols=max_symbols)
        price_days = history_days or (settings.price_history_years * 365)

        historical_start_date: date | None = None
        if include_historical and history_days is None and settings.price_backfill_start_date:
            try:
                historical_start_date = date.fromisoformat(settings.price_backfill_start_date)
            except ValueError:
                logger.warning(
                    "Invalid PRICE_BACKFILL_START_DATE=%s; falling back to history_days=%s",
                    settings.price_backfill_start_date,
                    price_days,
                )

        async def _operation() -> int:
            total = await data_pipeline.sync_screener_data(symbols=resolved_symbols)
            if include_historical:
                if historical_start_date is not None:
                    total += await data_pipeline.sync_daily_prices(
                        symbols=resolved_symbols,
                        start_date=historical_start_date,
                        end_date=date.today(),
                        fill_missing_gaps=True,
                        cache_recent=False,
                    )
                else:
                    total += await data_pipeline.sync_daily_prices(
                        symbols=resolved_symbols,
                        days=price_days,
                        fill_missing_gaps=True,
                        cache_recent=False,
                    )
            return total

        return await self._run_stage("prices", _operation)

    async def run_maintenance_cycle(
        self,
        sync_type: str,
        symbols: list[str],
        stages: list[tuple[str, Callable[[str, dict], Awaitable[int]]]],
        budget_seconds: float,
        refresh_days: int,
        *,
        max_attempts: int | None = None,
        allow_empty: bool = False,
        first_pass_only: bool = False,
        revalidate_empty_receipts: list[dict] | None = None,
        work_symbols: list[str] | None = None,
    ) -> SyncResult:
        """Resume the canonical universe; work_symbols limits work, never cycle scope."""
        started = time.monotonic()
        symbols = sorted(set(symbols))
        if not symbols:
            return SyncResult(False, 0, 1, 0, ["Active Universe is empty"])
        selected_symbols = symbols if work_symbols is None else sorted(set(work_symbols))
        if set(selected_symbols) - set(symbols):
            raise ValueError("Work symbols are outside the maintenance scope")
        async with async_session_maker() as session:
            previous = (await session.scalars(
                select(SyncStatus).where(SyncStatus.sync_type == sync_type)
                .order_by(SyncStatus.id.desc()).limit(1)
            )).first()
        metadata = dict(previous.additional_data or {}) if previous else {}
        revalidation_targets = {}
        for target in revalidate_empty_receipts or []:
            symbol, name = target["symbol"], target["stage"]
            if symbol not in symbols or name not in {stage for stage, _ in stages}:
                raise ValueError("Revalidation target is outside the maintenance scope")
            receipt = metadata.get("stages", {}).get(name, {}).get("receipts", {}).get(symbol, {})
            original = receipt if receipt.get("outcome") == "empty" else next((
                prior for prior in receipt.get("previous_empty_receipts", [])
                if receipt.get("outcome") in {"pending", "deferred", "attempted"} and all(
                    prior.get(key) == target[f"expected_{key}"]
                    for key in ("last_attempted_at", "last_succeeded_at")
                )
            ), {})
            if original and all(original.get(key) == target[f"expected_{key}"] for key in ("last_attempted_at", "last_succeeded_at")):
                revalidation_targets[(symbol, name)] = original.copy()
        same_universe = metadata.get("expected_symbols") == symbols
        same_stages = set(metadata.get("stages", {})) == {name for name, _ in stages}
        fresh = (previous is not None and previous.status == "completed"
                 and previous.completed_at is not None
                 and previous.completed_at >= datetime.utcnow() - timedelta(days=refresh_days))
        if same_universe and same_stages and fresh and not revalidation_targets:
            metadata["attempted_this_run"] = 0
            await data_pipeline._update_sync_record(previous.id, additional_data=metadata)
            return SyncResult(True, 0, 0, time.monotonic() - started, [])
        if previous is not None and (revalidate_empty_receipts is not None or previous.status != "completed" or fresh):
            sync_id = previous.id
        else:
            sync_id = await data_pipeline._create_sync_record(sync_type, f"{sync_type}-{int(time.time())}", 0)
            metadata = {"stages": {
                name: {"acquired_symbols": [], "failed_symbols": [], "receipts": metadata.get("stages", {}).get(name, {}).get("receipts", {})}
                for name, _ in stages
            }}
        metadata.update(expected_symbols=symbols, expected_count=len(symbols), refresh_days=refresh_days)
        stage_metadata = {name: metadata.get("stages", {}).get(name, {"acquired_symbols": [], "failed_symbols": []}) for name, _ in stages}
        metadata["stages"] = stage_metadata
        for name, _ in stages:
            state = stage_metadata.setdefault(name, {"acquired_symbols": [], "failed_symbols": []})
            state["acquired_symbols"] = [symbol for symbol in state["acquired_symbols"] if symbol in symbols]
            state["failed_symbols"] = [symbol for symbol in state["failed_symbols"] if symbol in symbols]
            state.setdefault("receipts", {})
            state["pending_count"] = len(symbols) - len(state["acquired_symbols"])
        for (symbol, name), prior_empty in revalidation_targets.items():
            state = stage_metadata[name]
            receipt = state["receipts"][symbol]
            previous_receipts = receipt.setdefault("previous_empty_receipts", [])
            original = {key: value for key, value in prior_empty.items() if key != "previous_empty_receipts"}
            if original not in previous_receipts:
                previous_receipts.append(original)
            if receipt.get("outcome") == "empty":
                receipt["outcome"] = "pending"
            receipt["revalidation_pending"] = True
            state["acquired_symbols"] = [item for item in state["acquired_symbols"] if item != symbol]
            state["pending_count"] = len(symbols) - len(state["acquired_symbols"])
        if revalidation_targets:
            metadata["complete"] = False
            await data_pipeline._update_sync_record(
                sync_id, status="running", additional_data=metadata,
                success_count=sum(len(value["acquired_symbols"]) for value in stage_metadata.values()),
            )
        work = [(symbol, name, operation) for symbol in selected_symbols for name, operation in stages]
        if revalidate_empty_receipts is not None:
            work = [item for item in work if (item[0], item[1]) in revalidation_targets]
        cursor = (metadata.get("last_symbol"), metadata.get("last_stage"))
        cursor_index = next((index for index, (symbol, name, _) in enumerate(work) if (symbol, name) == cursor), None)
        if cursor_index is not None:
            work = work[cursor_index + 1:] + work[:cursor_index + 1]
        failures = 0
        acquired = 0
        attempted = 0
        errors: list[str] = []
        # Iterate symbols first so every symbol receives every required period before
        # progressing, rather than stranding later periods behind a large first pass.
        try:
            from vnibb.providers.vnstock.runtime import financial_provider_busy
            financial_cycle = any(name.startswith(("financials", "ratios")) for name, _ in stages)
            for symbol, name, operation in work:
                state = stage_metadata[name]
                prior_empty = revalidation_targets.get((symbol, name))
                if prior_empty is None and symbol in state["acquired_symbols"]:
                    continue
                if first_pass_only and state["receipts"].get(symbol, {}).get("outcome") in {"succeeded", "failed", "empty"}:
                    continue
                remaining = budget_seconds - (time.monotonic() - started)
                if remaining <= 0 or (financial_cycle and financial_provider_busy()) or (max_attempts is not None and attempted >= max_attempts):
                    break
                progress: dict = {}
                attempted += 1
                receipt = state["receipts"].setdefault(symbol, {})
                receipt.update(last_attempted_at=datetime.utcnow().isoformat(), outcome="attempted")
                if prior_empty is not None:
                    state["pending_count"] = len(symbols) - len(state["acquired_symbols"])
                    await data_pipeline._update_sync_record(sync_id, status="running", additional_data=metadata)
                deadline = asyncio.timeout(remaining)
                try:
                    async with deadline:
                        count = await operation(symbol, progress)
                    if progress.get("error_count", 0) or (not count and not (allow_empty and progress.get("empty_count", 0))):
                        raise RuntimeError("acquisition unavailable or incomplete")
                    receipt.update(last_succeeded_at=datetime.utcnow().isoformat(), outcome="empty" if not count else "succeeded", rows=int(count))
                    receipt.pop("error", None)
                    receipt.pop("errors", None)
                    receipt.pop("revalidation_pending", None)
                    state["acquired_symbols"].append(symbol)
                    state["failed_symbols"] = [item for item in state["failed_symbols"] if item != symbol]
                    acquired += 1
                except Exception as exc:
                    provider_errors = [item["error"] for item in progress.get("errors", []) if isinstance(item, dict) and item.get("error")]
                    receipt.update(outcome="deferred" if deadline.expired() else "failed", error="; ".join(provider_errors) or f"{type(exc).__name__}: {exc}")
                    if not deadline.expired():
                        failures += 1
                        if symbol not in state["failed_symbols"]:
                            state["failed_symbols"].append(symbol)
                        errors.append(f"{name}:{symbol}:{type(exc).__name__}")
                        failure = errors[-1]
                        history = metadata.setdefault("acquisition_error_history", [])
                        if failure not in history:
                            metadata["acquisition_error_history"] = (history + [failure])[-100:]
                for key in ("acquisition_outcomes", "financial_acquisition", "stage_stats", "acquisition", "errors"):
                    if progress.get(key) is not None:
                        receipt[key] = jsonable_encoder(progress[key])
                state["pending_count"] = len(symbols) - len(state["acquired_symbols"])
                metadata["last_stage"] = name
                metadata["last_symbol"] = symbol
                await data_pipeline._update_sync_record(
                    sync_id, status="running", success_count=sum(len(value["acquired_symbols"]) for value in stage_metadata.values()),
                    error_count=sum(len(value["failed_symbols"]) for value in stage_metadata.values()), additional_data=metadata,
                )
                if deadline.expired() or time.monotonic() - started >= budget_seconds or (financial_cycle and financial_provider_busy()):
                    break
        except BaseException as exc:
            if attempted and receipt.get("outcome") == "attempted":
                receipt.update(outcome="deferred", error=f"{type(exc).__name__}: {exc}")
            metadata["complete"] = False
            for state in stage_metadata.values():
                state["pending_count"] = len(symbols) - len(state["acquired_symbols"])
            await data_pipeline._update_sync_record(sync_id, status="partial", additional_data=metadata)
            raise
        for name, _ in stages:
            state = stage_metadata.setdefault(name, {"acquired_symbols": [], "failed_symbols": []})
            state["pending_count"] = len(symbols) - len(state["acquired_symbols"])
        pending = sum(state["pending_count"] for state in stage_metadata.values())
        metadata["complete"] = pending == 0
        metadata["expected_pairs"] = len(symbols) * len(stages)
        metadata["attempted_this_run"] = attempted
        await data_pipeline._update_sync_record(
            sync_id, status="completed" if pending == 0 else "partial",
            success_count=sum(len(value["acquired_symbols"]) for value in stage_metadata.values()),
            error_count=sum(len(value["failed_symbols"]) for value in stage_metadata.values()),
            additional_data=metadata, errors={"acquisition_failures": metadata.get("acquisition_error_history", [])},
        )
        return SyncResult(failures == 0, acquired, failures, time.monotonic() - started, errors[:20], pending == 0, pending)

    async def sync_daily_profiles(self, symbols: list[str], budget_seconds: float = 600) -> SyncResult:
        return await self.run_maintenance_cycle("daily_profile_maintenance", symbols, [
            ("profiles", lambda symbol, progress: data_pipeline.sync_company_profiles(symbols=[symbol], progress=progress)),
        ], budget_seconds=budget_seconds, refresh_days=7)

    async def sync_daily_maintenance(self, symbols: list[str], budget_seconds: float = 1200) -> SyncResult:
        # Profiles have a separate 600s slice; filing acquisition gets 1200s.
        # Both weekly complete-Universe cycles resume daily, without recertifying
        # symbols already acquired. Quarterly ratios have their daily guarded owner.
        return await self.run_maintenance_cycle("daily_financial_maintenance", symbols, [
            ("financials_year", lambda symbol, progress: data_pipeline.sync_financials(symbols=[symbol], period="year", progress=progress)),
            ("financials_quarter", lambda symbol, progress: data_pipeline.sync_financials(symbols=[symbol], period="quarter", progress=progress)),
            ("ratios_year", lambda symbol, progress: data_pipeline.sync_financial_ratios(symbols=[symbol], period="year", progress=progress)),
        ], budget_seconds, refresh_days=7)

    async def sync_all_financials(
        self,
        symbols: list[str] | None = None,
        max_symbols: int | None = None,
    ) -> SyncResult:
        """Sync annual/quarterly financial statements and ratios."""

        resolved_symbols = symbols or await self._get_seeded_symbols(max_symbols=max_symbols)

        async def _operation() -> int:
            total = 0
            for operation in (data_pipeline.sync_financials, data_pipeline.sync_financial_ratios):
                for period in ("year", "quarter"):
                    progress: dict = {}
                    total += await operation(symbols=resolved_symbols, period=period, progress=progress)
                    if progress.get("error_count"):
                        raise RuntimeError(f"Financial {period} acquisition has failed symbols")
            return total

        return await self._run_stage("financials", _operation)

    async def sync_all_indices(self) -> SyncResult:
        """Sync latest market indices into the stock_indices table."""

        async def _operation() -> int:
            return await data_pipeline.sync_market_indices()

        return await self._run_stage("indices", _operation)

    async def sync_all_corporate_actions(
        self,
        symbols: list[str] | None = None,
        max_symbols: int | None = None,
    ) -> SyncResult:
        """Sync dividend history and company event records."""

        resolved_symbols = symbols or await self._get_seeded_symbols(max_symbols=max_symbols)

        async def _operation() -> int:
            total = 0
            for operation in (data_pipeline.sync_dividends, data_pipeline.sync_company_events):
                progress: dict = {}
                total += await operation(symbols=resolved_symbols, progress=progress)
                if progress.get("error_count"):
                    raise RuntimeError("Corporate action acquisition has failed symbols")
            return total

        return await self._run_stage("corporate_actions", _operation)

    async def run_full_sync(
        self,
        include_historical: bool = False,
        include_corporate_actions: bool = True,
        max_symbols: int | None = None,
        history_days: int | None = None,
    ) -> dict[str, SyncResult]:
        """
        Run complete sync for the VN market universe.

        Execution order:
        1) Stock symbols
        2) Screener + prices
        3) Market indices
        4) Profiles
        5) Financials + ratios
        6) Dividends + company events
        """

        logger.info(
            "Starting full market sync "
            "(max_symbols=%s, include_historical=%s, "
            "include_corporate_actions=%s, history_days=%s)",
            max_symbols,
            include_historical,
            include_corporate_actions,
            history_days,
        )

        sync_record_id: int | None = None
        try:
            sync_record_id = await data_pipeline._create_sync_record(  # noqa: SLF001
                sync_type="full_market",
                job_id=f"full-market-{int(time.time())}",
                days=history_days or 0,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Unable to create sync status record for full market sync: %s", exc)
        sync_metadata: dict[str, object] = {
            "include_historical": include_historical,
            "include_corporate_actions": include_corporate_actions,
            "max_symbols": max_symbols,
            "history_days": history_days,
            "stages": {},
        }

        results: dict[str, SyncResult] = {}
        try:
            results["symbols"] = await self.sync_all_symbols()
            sync_metadata["stages"] = {
                **dict(sync_metadata.get("stages") or {}),
                "symbols": results["symbols"].__dict__,
            }

            symbols = await self._get_seeded_symbols(max_symbols=max_symbols)
            if not symbols:
                logger.warning("No symbols available after stock list sync")

            results["prices"] = await self.sync_all_prices(
                symbols=symbols,
                include_historical=include_historical,
                history_days=history_days,
            )
            results["indices"] = await self.sync_all_indices()
            results["profiles"] = await self.sync_all_profiles(symbols=symbols)
            results["financials"] = await self.sync_all_financials(symbols=symbols)
            if include_corporate_actions:
                results["corporate_actions"] = await self.sync_all_corporate_actions(
                    symbols=symbols
                )

            sync_metadata["stages"] = {key: value.__dict__ for key, value in results.items()}

            total_synced = sum(result.synced_count for result in results.values())
            total_errors = sum(result.error_count for result in results.values())
            final_status = (
                "completed" if all(result.success for result in results.values()) else "partial"
            )
            if sync_record_id is not None:
                await data_pipeline._update_sync_record(  # noqa: SLF001
                    sync_record_id,
                    status=final_status,
                    success_count=total_synced,
                    error_count=total_errors,
                    additional_data=sync_metadata,
                )
        except Exception as exc:
            sync_metadata["error"] = str(exc)
            if sync_record_id is not None:
                await data_pipeline._update_sync_record(  # noqa: SLF001
                    sync_record_id,
                    status="failed",
                    success_count=sum(result.synced_count for result in results.values()),
                    error_count=sum(result.error_count for result in results.values()) + 1,
                    additional_data=sync_metadata,
                    errors={"message": str(exc)},
                )
            raise

        total_synced = sum(result.synced_count for result in results.values())
        total_errors = sum(result.error_count for result in results.values())
        logger.info(
            "Full market sync completed (synced=%s, errors=%s)",
            total_synced,
            total_errors,
        )
        return results


async def run_price_sync() -> SyncResult:
    """Quick price-oriented sync for scheduler integrations."""

    sync = FullMarketSync()
    return await sync.sync_all_prices(include_historical=False)


async def run_profile_sync() -> SyncResult:
    """Profile sync for scheduler integrations."""

    sync = FullMarketSync()
    return await sync.sync_all_profiles()


async def run_daily_market_sync(
    history_days: int = DAILY_MARKET_HISTORY_DAYS,
    include_corporate_actions: bool = True,
) -> dict[str, SyncResult]:
    """Refresh the full daily market Universe and resume weekly filing maintenance."""
    daily_started = time.monotonic()
    sync = FullMarketSync()
    results: dict[str, SyncResult] = {}
    sync_id = await data_pipeline._create_sync_record("daily_market", f"daily-market-{int(time.time())}", history_days)
    metadata: dict = {"stages": {}, "active_stage": "symbols"}
    try:
        await data_pipeline._update_sync_record(sync_id, additional_data=metadata)
        symbols = await sync._get_seeded_symbols()
        if not symbols:
            results["symbols"] = await sync.sync_all_symbols()
            symbols = await sync._get_seeded_symbols()
        if not symbols:
            raise RuntimeError("Active Universe is empty")
        metadata.update(expected_symbols=symbols, expected_count=len(symbols))

        async def record(
            name: str,
            operation: Callable[[], Awaitable[SyncResult]],
            progress: dict | None = None,
        ) -> None:
            started = time.monotonic()
            state = {"status": "running", "started_at": datetime.utcnow().isoformat()}
            metadata["active_stage"] = name
            metadata["stages"][name] = state
            await data_pipeline._update_sync_record(sync_id, additional_data=metadata)
            try:
                results[name] = await operation()
            except BaseException as exc:
                results[name] = SyncResult(
                    False, int((progress or {}).get("committed_count", 0)),
                    max(1, int((progress or {}).get("error_count", 0))),
                    time.monotonic() - started, [f"{type(exc).__name__}: {exc}"],
                    complete=False,
                )
                state.update(results[name].__dict__)
                state["status"] = "cancelled" if isinstance(exc, asyncio.CancelledError) else "failed"
                if progress is not None:
                    state["progress"] = jsonable_encoder(progress)
                raise
            state.update(results[name].__dict__)
            state["status"] = ("completed" if results[name].complete else "partial") if results[name].success else "failed"
            if progress is not None:
                state["progress"] = jsonable_encoder(progress)
            await data_pipeline._update_sync_record(
                sync_id, success_count=sum(result.synced_count for result in results.values()),
                error_count=sum(result.error_count for result in results.values()),
                additional_data=metadata,
            )

        async def acquire(name: str, operation: Callable[[], Awaitable[int]], progress: dict) -> SyncResult:
            started = time.monotonic()
            count = 0
            errors = []
            try:
                count = int(await operation())
                if progress.get("error_count") or (name == "screener" and count != len(symbols)):
                    raise RuntimeError(f"{name} acquisition unavailable or incomplete")
            except Exception as exc:
                count = max(count, int(progress.get("committed_count", 0)))
                errors.append(str(exc))
                logger.exception("%s sync failed: %s", name, exc)
            return SyncResult(
                not errors, count, max(len(errors), int(progress.get("error_count", 0))),
                time.monotonic() - started, errors, complete=not errors,
            )

        price_progress: dict = {}
        await record("daily_prices", lambda: acquire("daily_prices", lambda: data_pipeline.sync_daily_prices(
            symbols=symbols, days=history_days, fill_missing_gaps=True,
            cache_recent=False, progress=price_progress,
        ), price_progress), price_progress)
        screener_progress: dict = {}
        await record("screener", lambda: acquire("screener", lambda: data_pipeline.sync_screener_data(
            progress=screener_progress,
        ), screener_progress), screener_progress)
        await record("indices", sync.sync_all_indices)

        async def rs_ratings() -> SyncResult:
            from vnibb.services.rs_rating_service import RSRatingService
            async def acquire() -> int:
                result = await RSRatingService().calculate_all_rs_ratings()
                if not result.get("success"):
                    raise RuntimeError("RS rating calculation failed")
                return int(result.get("total_stocks") or 0)
            return await sync._run_stage("rs_ratings", acquire)
        await record("rs_ratings", rs_ratings)
        if include_corporate_actions:
            await record("corporate_actions", lambda: sync.sync_all_corporate_actions(symbols=symbols))
        profile_budget = min(600, max(0, 7080 - (time.monotonic() - daily_started)))
        await record("profiles", lambda: sync.sync_daily_profiles(symbols, budget_seconds=profile_budget))
        financial_budget = min(1200, max(0, 7080 - (time.monotonic() - daily_started)))
        await record("financials", lambda: sync.sync_daily_maintenance(symbols, budget_seconds=financial_budget))
        complete = all(result.success and result.complete for result in results.values())
        metadata["active_stage"] = None
        await data_pipeline._update_sync_record(sync_id,
            status="completed" if complete else "partial",
            success_count=sum(result.synced_count for result in results.values()),
            error_count=sum(result.error_count for result in results.values()), additional_data=metadata)
    except BaseException as exc:
        metadata["error"] = f"{type(exc).__name__}: {exc}"
        await data_pipeline._update_sync_record(
            sync_id, status="failed",
            success_count=sum(result.synced_count for result in results.values()),
            error_count=max(1, sum(result.error_count for result in results.values())),
            additional_data=metadata, errors={"message": metadata["error"]},
        )
        raise
    return results


async def run_financial_ratios_sync(budget_seconds: float = 4500) -> SyncResult:
    """Daily guarded continuation of a complete-Universe monthly ratios cycle."""
    sync = FullMarketSync()
    symbols = await sync._get_seeded_symbols()
    return await sync.run_maintenance_cycle("financial_ratios_maintenance", symbols, [
        ("ratios_quarter", lambda symbol, progress: data_pipeline.sync_financial_ratios(symbols=[symbol], period="quarter", progress=progress)),
    ], budget_seconds, refresh_days=30)


async def run_full_sync(
    include_historical: bool = False,
    include_corporate_actions: bool = True,
) -> dict[str, SyncResult]:
    """Run full market sync with default settings."""

    sync = FullMarketSync()
    return await sync.run_full_sync(
        include_historical=include_historical,
        include_corporate_actions=include_corporate_actions,
    )


async def run_iq_reference_sync(budget_seconds: float = 600) -> SyncResult:
    """Refresh IQ physical stores separately from the SQL supplemental cycle."""
    from vnibb.services.vietcap_ingestion import sync_vietcap_reference

    sync = FullMarketSync()
    symbols = await sync._get_seeded_symbols()
    return await sync.run_maintenance_cycle(
        "iq_reference_maintenance", symbols,
        [
            ("iq_company_profile", lambda symbol, progress: sync_vietcap_reference(symbol, "iq_company_profile", progress)),
            ("iq_shareholder_structure", lambda symbol, progress: sync_vietcap_reference(symbol, "iq_shareholder_structure", progress)),
        ], budget_seconds, refresh_days=7, max_attempts=50, allow_empty=True,
    )


async def run_supplemental_company_sync() -> dict[str, SyncResult]:
    """Continue every SQL-confirmed active instrument; weekends never reset cursors."""
    sync = FullMarketSync()
    symbols = await sync._get_seeded_symbols()
    batch_size = (
        settings.scheduler_weekend_symbols_per_run
        if date.today().weekday() >= 5
        else settings.scheduler_supplemental_symbols_per_run
    )
    stages = [
        ("shareholders", lambda symbol, progress: data_pipeline.sync_shareholders(symbols=[symbol], progress=progress)),
        ("officers", lambda symbol, progress: data_pipeline.sync_officers(symbols=[symbol], progress=progress)),
        ("subsidiaries", lambda symbol, progress: data_pipeline.sync_subsidiaries(symbols=[symbol], progress=progress)),
        ("company_news", lambda symbol, progress: data_pipeline.sync_company_news(symbols=[symbol], limit=settings.scheduler_company_news_limit, progress=progress)),
        ("insider_deals", lambda symbol, progress: data_pipeline.sync_insider_deals(symbols=[symbol], progress=progress)),
    ]
    result = await sync.run_maintenance_cycle(
        "supplemental_company_maintenance", symbols, stages, budget_seconds=80 * 60,
        refresh_days=1, max_attempts=max(1, batch_size) * len(stages), allow_empty=True,
    )
    results = {"supplemental_company": result}
    for name, operation in (("market_sectors", data_pipeline.sync_market_sectors), ("sector_performance", data_pipeline.sync_sector_performance)):
        async def bounded_refresh(operation=operation):
            async with asyncio.timeout(120):
                return await operation()
        results[name] = await sync._run_stage(name, bounded_refresh)
    return results
