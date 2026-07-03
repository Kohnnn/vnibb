"""
Job Scheduler

Handles scheduling and execution of data pipeline jobs.
"""

import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Any, Callable, Dict, List, Optional

from vnibb.core.database import async_session_maker
from vnibb.core.config import settings
from vnibb.models.sync_status import SyncStatus
from vnibb.services.pipeline.base import BasePipeline

logger = logging.getLogger(__name__)

DAILY_TRADING_PROGRESS_KEY = "vnibb:sync:daily_trading:progress"
DAILY_TRADING_PROGRESS_TTL = 3 * 24 * 60 * 60


class PipelineScheduler:
    """Scheduler for data pipeline jobs."""

    def __init__(self, pipeline: BasePipeline):
        self.pipeline = pipeline
        self._running_jobs: Dict[str, asyncio.Task] = {}
        self._stop_events: Dict[str, asyncio.Event] = {}

    async def run_daily_sync(
        self,
        symbols: Optional[List[str]] = None,
        days: int = 30,
    ) -> Dict[str, Any]:
        """Run full daily sync pipeline."""
        sync_type = "daily_full"
        lock_key = f"sync:{sync_type}"

        # Try to acquire lock
        acquired, source, token = await self.pipeline._acquire_sync_run_guard(
            sync_type, ttl_seconds=7200  # 2 hour max
        )

        if not acquired:
            logger.warning(f"Could not acquire lock for {sync_type}, already running")
            return {"status": "skipped", "reason": "already_running"}

        try:
            sync_id = await self.pipeline._create_sync_record(sync_type, job_id="daily", days=days)
            progress: Dict[str, Any] = {
                "status": "running",
                "success_count": 0,
                "error_count": 0,
                "stage": None,
            }

            # Run stock list sync
            logger.info("Starting daily full sync...")
            count = await self.pipeline.sync_stock_list(
                progress=progress,
                sync_id=sync_id,
            )

            # Run screener sync
            await self.pipeline.sync_screener_data(
                symbols=symbols,
                progress=progress,
                sync_id=sync_id,
            )

            # Run price sync
            await self.pipeline.sync_daily_prices(
                symbols=symbols,
                days=days,
                progress=progress,
                sync_id=sync_id,
            )

            # Mark as completed
            await self.pipeline._update_sync_record(
                sync_id,
                status="completed",
                success_count=progress.get("success_count", 0),
                error_count=progress.get("error_count", 0),
            )

            return {
                "status": "completed",
                "sync_id": sync_id,
                "success_count": progress.get("success_count", 0),
                "error_count": progress.get("error_count", 0),
            }

        except Exception as e:
            logger.error(f"Daily sync failed: {e}")
            if sync_id:
                await self.pipeline._update_sync_record(
                    sync_id,
                    status="failed",
                    errors={"error": str(e)},
                )
            return {"status": "failed", "error": str(e)}

        finally:
            await self.pipeline._release_sync_run_guard(sync_type, source, token)

    async def run_daily_trading_sync(
        self,
        symbols: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Run daily trading data sync (foreign trading, intraday, etc.)."""
        sync_type = "daily_trading"
        lock_key = f"sync:{sync_type}"

        acquired, source, token = await self.pipeline._acquire_sync_run_guard(
            sync_type, ttl_seconds=3600  # 1 hour max
        )

        if not acquired:
            logger.warning(f"Could not acquire lock for {sync_type}, already running")
            return {"status": "skipped", "reason": "already_running"}

        try:
            sync_id = await self.pipeline._create_sync_record(
                sync_type, job_id="daily_trading", days=0
            )
            progress: Dict[str, Any] = {
                "status": "running",
                "success_count": 0,
                "error_count": 0,
                "stage": None,
            }

            logger.info("Starting daily trading sync...")

            # Run foreign trading sync
            await self.pipeline.sync_foreign_trading(
                symbols=symbols,
                progress=progress,
                sync_id=sync_id,
            )

            # Run intraday trades sync
            await self.pipeline.sync_intraday_trades(
                symbols=symbols,
                progress=progress,
                sync_id=sync_id,
            )

            # Run orderbook snapshots sync
            await self.pipeline.sync_orderbook_snapshots(
                symbols=symbols,
                progress=progress,
                sync_id=sync_id,
            )

            # Run block trades sync
            await self.pipeline.sync_block_trades(
                symbols=symbols,
                progress=progress,
                sync_id=sync_id,
            )

            # Mark as completed
            await self.pipeline._update_sync_record(
                sync_id,
                status="completed",
                success_count=progress.get("success_count", 0),
                error_count=progress.get("error_count", 0),
            )

            return {
                "status": "completed",
                "sync_id": sync_id,
                "success_count": progress.get("success_count", 0),
                "error_count": progress.get("error_count", 0),
            }

        except Exception as e:
            logger.error(f"Daily trading sync failed: {e}")
            if sync_id:
                await self.pipeline._update_sync_record(
                    sync_id,
                    status="failed",
                    errors={"error": str(e)},
                )
            return {"status": "failed", "error": str(e)}

        finally:
            await self.pipeline._release_sync_run_guard(sync_type, source, token)

    async def run_hourly_news_sync(self) -> Dict[str, Any]:
        """Run hourly news sync."""
        sync_type = "hourly_news"

        try:
            sync_id = await self.pipeline._create_sync_record(
                sync_type, job_id="hourly", days=0
            )
            progress: Dict[str, Any] = {
                "status": "running",
                "success_count": 0,
                "error_count": 0,
            }

            logger.info("Starting hourly news sync...")

            # Run company news sync
            await self.pipeline.sync_company_news(
                progress=progress,
                sync_id=sync_id,
            )

            await self.pipeline._update_sync_record(
                sync_id,
                status="completed",
                success_count=progress.get("success_count", 0),
                error_count=progress.get("error_count", 0),
            )

            return {
                "status": "completed",
                "sync_id": sync_id,
                "success_count": progress.get("success_count", 0),
                "error_count": progress.get("error_count", 0),
            }

        except Exception as e:
            logger.error(f"Hourly news sync failed: {e}")
            return {"status": "failed", "error": str(e)}

    async def schedule_daily_sync(
        self,
        hour: int = 2,
        minute: int = 0,
    ) -> None:
        """Schedule daily sync to run at a specific time."""
        logger.info(f"Scheduling daily sync at {hour:02d}:{minute:02d}")

        while True:
            now = datetime.now()
            target_time = now.replace(hour=hour, minute=minute, second=0, microsecond=0)

            if target_time <= now:
                target_time += timedelta(days=1)

            wait_seconds = (target_time - now).total_seconds()
            await asyncio.sleep(wait_seconds)

            try:
                await self.run_daily_sync()
            except Exception as e:
                logger.error(f"Scheduled daily sync failed: {e}")

            # Wait a bit to avoid immediate re-run
            await asyncio.sleep(60)

    def get_running_jobs(self) -> List[str]:
        """Get list of currently running jobs."""
        return list(self._running_jobs.keys())

    def is_job_running(self, job_name: str) -> bool:
        """Check if a job is currently running."""
        return job_name in self._running_jobs
