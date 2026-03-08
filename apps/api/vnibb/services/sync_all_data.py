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

from sqlalchemy import select

from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.models.stock import Stock
from vnibb.services.appwrite_population import populate_appwrite_tables
from vnibb.services.data_pipeline import data_pipeline

logger = logging.getLogger(__name__)


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
            "profiles": ("stocks",),
            "financials": (
                "income_statements",
                "balance_sheets",
                "cash_flows",
                "financial_ratios",
            ),
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

        async def _operation() -> int:
            total = await data_pipeline.sync_screener_data(symbols=resolved_symbols)
            if include_historical:
                total += await data_pipeline.sync_daily_prices(
                    symbols=resolved_symbols,
                    days=price_days,
                    fill_missing_gaps=True,
                    cache_recent=False,
                )
            return total

        return await self._run_stage("prices", _operation)

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

    async def run_full_sync(
        self,
        include_historical: bool = False,
        max_symbols: int | None = None,
        history_days: int | None = None,
    ) -> dict[str, SyncResult]:
        """
        Run complete sync for the VN market universe.

        Execution order:
        1) Stock symbols
        2) Screener + prices
        3) Profiles
        4) Financials + ratios
        """

        logger.info(
            "Starting full market sync (max_symbols=%s, include_historical=%s, history_days=%s)",
            max_symbols,
            include_historical,
            history_days,
        )

        results: dict[str, SyncResult] = {}
        results["symbols"] = await self.sync_all_symbols()

        symbols = await self._get_seeded_symbols(max_symbols=max_symbols)
        if not symbols:
            logger.warning("No symbols available after stock list sync")

        results["prices"] = await self.sync_all_prices(
            symbols=symbols,
            include_historical=include_historical,
            history_days=history_days,
        )
        results["profiles"] = await self.sync_all_profiles(symbols=symbols)
        results["financials"] = await self.sync_all_financials(symbols=symbols)

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


async def run_full_sync(include_historical: bool = False) -> dict[str, SyncResult]:
    """Run full market sync with default settings."""

    sync = FullMarketSync()
    return await sync.run_full_sync(include_historical=include_historical)
