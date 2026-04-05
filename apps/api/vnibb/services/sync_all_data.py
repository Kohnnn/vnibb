"""
Full market synchronization orchestrator.

This service replaces legacy vnstock-only placeholders with calls into the
production DataPipeline, so /sync/full-market writes real data to Postgres
and mirrors Appwrite primary collections for Appwrite-first runtime reads.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import func, select

from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock
from vnibb.services.appwrite_population import populate_appwrite_tables
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


class FullMarketSync:
    """
    Full market data synchronization service.

    Uses DataPipeline methods that already implement persistence, retries,
    and provider fallbacks.
    """

    def __init__(self, source: str = settings.vnstock_source):
        self.source = source

    @staticmethod
    def _stage_appwrite_tables(stage_name: str) -> tuple[tuple[str, ...], bool]:
        stage_tables = {
            "symbols": ("stocks",),
            "prices": ("stock_prices",),
            "indices": (),
            "profiles": ("stocks",),
            "financials": (
                "income_statements",
                "balance_sheets",
                "cash_flows",
                "financial_ratios",
            ),
            "corporate_actions": ("dividends", "company_events"),
            "shareholders": ("shareholders",),
            "officers": ("officers",),
            "subsidiaries": ("subsidiaries",),
            "company_news": ("company_news",),
        }
        return stage_tables.get(stage_name, ()), stage_name in {"symbols", "profiles"}

    async def _populate_appwrite_for_stage(self, stage_name: str) -> None:
        tables, full_refresh = self._stage_appwrite_tables(stage_name)
        if not tables:
            return

        await populate_appwrite_tables(tables, full_refresh=full_refresh)

    async def _get_seeded_symbols(self, max_symbols: int | None = None) -> list[str]:
        async with async_session_maker() as session:
            result = await session.execute(
                select(Stock.symbol).where(Stock.is_active == 1).order_by(Stock.symbol.asc())
            )
            symbols = [str(row[0]).upper() for row in result.fetchall() if row[0]]

        if max_symbols is not None and max_symbols > 0:
            return symbols[:max_symbols]
        return symbols

    async def _get_priority_symbols(self, limit: int) -> list[str]:
        if limit <= 0:
            return []

        async with async_session_maker() as session:
            latest_snapshot_result = await session.execute(
                select(func.max(ScreenerSnapshot.snapshot_date))
            )
            latest_snapshot = latest_snapshot_result.scalar()

            if latest_snapshot is not None:
                rows = await session.execute(
                    select(ScreenerSnapshot.symbol)
                    .where(
                        ScreenerSnapshot.snapshot_date == latest_snapshot,
                        ScreenerSnapshot.market_cap.is_not(None),
                    )
                    .order_by(ScreenerSnapshot.market_cap.desc().nullslast())
                    .limit(limit)
                )
                symbols = [str(row[0]).upper() for row in rows.fetchall() if row[0]]
                if symbols:
                    return symbols

        return await self._get_seeded_symbols(max_symbols=limit)

    async def _get_rotating_priority_symbols(
        self,
        batch_size: int,
        rotation_buckets: int = 5,
        target_day: date | None = None,
    ) -> list[str]:
        if batch_size <= 0:
            return []

        buckets = max(1, rotation_buckets)
        candidate_limit = batch_size * buckets
        candidates = await self._get_priority_symbols(candidate_limit)
        if not candidates:
            return []

        day = target_day or date.today()
        bucket_index = day.weekday() % buckets
        start = bucket_index * batch_size
        selected = candidates[start : start + batch_size]
        return selected or candidates[:batch_size]

    async def _run_stage(
        self,
        stage_name: str,
        operation: Callable[[], Awaitable[int]],
        *,
        populate_appwrite: bool = True,
    ) -> SyncResult:
        start = time.monotonic()
        errors: list[str] = []
        synced_count = 0
        success = True

        try:
            synced_count = int(await operation())
            if populate_appwrite:
                await self._populate_appwrite_for_stage(stage_name)
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
            return await data_pipeline.sync_company_profiles(symbols=resolved_symbols)

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
        use_appwrite_direct_prices = settings.resolved_data_backend == "appwrite"

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
            if use_appwrite_direct_prices:
                from vnibb.services.appwrite_price_service import AppwritePriceService

                service = AppwritePriceService(source=self.source)
                end_date = date.today()
                start_date = (
                    historical_start_date
                    if include_historical and historical_start_date is not None
                    else end_date - timedelta(days=price_days if include_historical else 30)
                )
                synced_rows = await data_pipeline.sync_daily_prices(
                    symbols=resolved_symbols,
                    start_date=start_date,
                    end_date=end_date,
                    fill_missing_gaps=True,
                    cache_recent=True,
                )
                mirror_stats = await service.mirror_prices_from_postgres(
                    symbols=resolved_symbols,
                    start_date=start_date,
                    end_date=end_date,
                    cache_recent=True,
                )
                mirrored_rows = mirror_stats.rows_upserted
                if max(synced_rows, mirrored_rows) == 0:
                    direct_stats = await service.sync_prices_from_provider(
                        symbols=resolved_symbols,
                        start_date=start_date,
                        end_date=end_date,
                        fill_missing_gaps=True,
                        cache_recent=True,
                    )
                    total += direct_stats.rows_upserted
                else:
                    total += max(synced_rows, mirrored_rows)
            elif include_historical:
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

        return await self._run_stage(
            "prices",
            _operation,
            populate_appwrite=not use_appwrite_direct_prices,
        )

    async def sync_all_financials(
        self,
        symbols: list[str] | None = None,
        max_symbols: int | None = None,
    ) -> SyncResult:
        """Sync annual/quarterly financial statements and ratios."""

        resolved_symbols = symbols or await self._get_seeded_symbols(max_symbols=max_symbols)

        async def _operation() -> int:
            total = 0
            total += await data_pipeline.sync_financials(symbols=resolved_symbols, period="year")
            total += await data_pipeline.sync_financials(symbols=resolved_symbols, period="quarter")
            total += await data_pipeline.sync_financial_ratios(
                symbols=resolved_symbols,
                period="year",
            )
            total += await data_pipeline.sync_financial_ratios(
                symbols=resolved_symbols,
                period="quarter",
            )
            return total

        return await self._run_stage("financials", _operation)

    async def sync_all_indices(self) -> SyncResult:
        """Sync latest market indices into the stock_indices table."""

        async def _operation() -> int:
            return await data_pipeline.sync_market_indices()

        return await self._run_stage("indices", _operation, populate_appwrite=False)

    async def sync_all_corporate_actions(
        self,
        symbols: list[str] | None = None,
        max_symbols: int | None = None,
    ) -> SyncResult:
        """Sync dividend history and company event records."""

        resolved_symbols = symbols or await self._get_seeded_symbols(max_symbols=max_symbols)

        async def _operation() -> int:
            total = 0
            total += await data_pipeline.sync_dividends(symbols=resolved_symbols)
            total += await data_pipeline.sync_company_events(symbols=resolved_symbols)
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
    """Run the post-close daily market refresh for all active symbols."""

    async def _run_direct_stage(
        stage_name: str,
        operation: Callable[[], Awaitable[int]],
        *,
        populate_appwrite_stage: str | None = None,
    ) -> SyncResult:
        start = time.monotonic()
        errors: list[str] = []
        synced_count = 0
        success = True

        try:
            synced_count = int(await operation())
            stage_key = populate_appwrite_stage or stage_name
            tables, full_refresh = FullMarketSync._stage_appwrite_tables(stage_key)
            if tables:
                await populate_appwrite_tables(tables, full_refresh=full_refresh)
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

    sync = FullMarketSync()
    results: dict[str, SyncResult] = {}

    symbols = await sync._get_seeded_symbols()
    if not symbols:
        results["symbols"] = await _run_direct_stage("symbols", data_pipeline.sync_stock_list)
        symbols = await sync._get_seeded_symbols()

    results["prices"] = await sync.sync_all_prices(
        symbols=symbols,
        include_historical=True,
        history_days=history_days,
    )
    results["indices"] = await sync.sync_all_indices()
    results["profiles"] = await sync.sync_all_profiles(symbols=symbols)
    results["financials"] = await sync.sync_all_financials(symbols=symbols)

    async def _sync_rs_ratings() -> int:
        from vnibb.services.rs_rating_service import RSRatingService

        service = RSRatingService()
        result = await service.calculate_all_rs_ratings()
        if not result.get("success"):
            raise RuntimeError(result.get("error") or "RS rating calculation failed")
        return int(result.get("total_stocks") or 0)

    results["rs_ratings"] = await _run_direct_stage("rs_ratings", _sync_rs_ratings)

    if include_corporate_actions:

        async def _sync_corporate_actions() -> int:
            total = await data_pipeline.sync_dividends(symbols=symbols)
            total += await data_pipeline.sync_company_events(symbols=symbols)
            return total

        results["corporate_actions"] = await _run_direct_stage(
            "corporate_actions",
            _sync_corporate_actions,
            populate_appwrite_stage="corporate_actions",
        )

    return results


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


async def run_supplemental_company_sync() -> dict[str, SyncResult]:
    """Rotate company-level vnstock updates into the automatic schedule."""

    async def _run_direct_stage(
        stage_name: str,
        operation: Callable[[], Awaitable[int]],
    ) -> SyncResult:
        start = time.monotonic()
        errors: list[str] = []
        synced_count = 0
        success = True

        try:
            synced_count = int(await operation())
            tables, full_refresh = FullMarketSync._stage_appwrite_tables(stage_name)
            if tables:
                await populate_appwrite_tables(tables, full_refresh=full_refresh)
        except Exception as exc:  # noqa: BLE001
            success = False
            errors.append(str(exc))
            logger.exception("%s supplemental sync failed: %s", stage_name, exc)

        duration_seconds = time.monotonic() - start
        return SyncResult(
            success=success,
            synced_count=synced_count,
            error_count=len(errors),
            duration_seconds=duration_seconds,
            errors=errors,
        )

    sync = FullMarketSync()
    today = date.today()
    weekend = today.weekday() >= 5
    batch_size = (
        settings.scheduler_weekend_symbols_per_run
        if weekend
        else settings.scheduler_supplemental_symbols_per_run
    )

    results: dict[str, SyncResult] = {}

    if weekend:
        symbols = await sync._get_priority_symbols(batch_size)
        if not symbols:
            return results

        results["shareholders"] = await _run_direct_stage(
            "shareholders",
            lambda: data_pipeline.sync_shareholders(symbols=symbols),
        )
        results["officers"] = await _run_direct_stage(
            "officers",
            lambda: data_pipeline.sync_officers(symbols=symbols),
        )
        results["subsidiaries"] = await _run_direct_stage(
            "subsidiaries",
            lambda: data_pipeline.sync_subsidiaries(symbols=symbols),
        )
        results["company_news"] = await _run_direct_stage(
            "company_news",
            lambda: data_pipeline.sync_company_news(
                symbols=symbols,
                limit=settings.scheduler_company_news_limit,
            ),
        )
        return results

    symbols = await sync._get_rotating_priority_symbols(batch_size=batch_size)
    if not symbols:
        return results

    weekday_plan: list[tuple[str, Callable[[], Awaitable[int]]]] = [
        ("shareholders", lambda: data_pipeline.sync_shareholders(symbols=symbols)),
        ("officers", lambda: data_pipeline.sync_officers(symbols=symbols)),
        ("subsidiaries", lambda: data_pipeline.sync_subsidiaries(symbols=symbols)),
        (
            "company_news",
            lambda: data_pipeline.sync_company_news(
                symbols=symbols,
                limit=settings.scheduler_company_news_limit,
            ),
        ),
    ]

    stage_name, operation = weekday_plan[today.weekday() % len(weekday_plan)]
    results[stage_name] = await _run_direct_stage(stage_name, operation)
    return results
