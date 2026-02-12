"""
Scheduler Configuration

APScheduler jobs for automated data synchronization.
Schedules daily, hourly, and intraday sync jobs.

Jobs:
- Daily sync at 4:00 PM VNT (9:00 AM UTC) - Full data refresh
- Hourly news sync - Company and market news
- Intraday sync during market hours - Real-time price/trades
- Market open/close - Start/stop real-time streaming
"""

import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

# Global scheduler instance
_scheduler = None


def get_scheduler():
    """Get or create the scheduler instance."""
    global _scheduler

    if _scheduler is None:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler

        _scheduler = AsyncIOScheduler(timezone="UTC")

    return _scheduler


def configure_scheduler():
    """Configure all scheduled jobs."""
    from apscheduler.triggers.cron import CronTrigger

    from vnibb.services.data_pipeline import (
        run_daily_sync,
        run_daily_trading_sync,
        run_hourly_news_sync,
        run_intraday_sync,
    )
    from vnibb.services.data_quality import run_scheduled_data_quality_check
    from vnibb.services.realtime_pipeline import get_realtime_pipeline

    scheduler = get_scheduler()

    # =========================================================================
    # Daily Sync - 4:00 PM VNT (9:00 AM UTC)
    # Full database refresh after market close
    # =========================================================================
    scheduler.add_job(
        run_daily_sync,
        trigger=CronTrigger(hour=9, minute=0, timezone="UTC"),
        id="daily_sync",
        name="Daily Data Sync",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: daily_sync at 9:00 UTC (4:00 PM VNT)")

    # =========================================================================
    # Daily Trading Flow Sync - 4:20 PM VNT (9:20 AM UTC)
    # Order flow, foreign trading, block trades, derivatives
    # =========================================================================
    scheduler.add_job(
        run_daily_trading_sync,
        trigger=CronTrigger(hour=9, minute=20, timezone="UTC"),
        id="daily_trading_sync",
        name="Daily Trading Flow Sync",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: daily_trading_sync at 9:20 UTC (4:20 PM VNT)")

    # =========================================================================
    # Daily Data Quality Check - 4:40 PM VNT (9:40 AM UTC)
    # Coverage + freshness SLA checks with warning logs
    # =========================================================================
    scheduler.add_job(
        run_scheduled_data_quality_check,
        trigger=CronTrigger(hour=9, minute=40, timezone="UTC"),
        id="daily_data_quality_check",
        name="Daily Data Quality Check",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: daily_data_quality_check at 9:40 UTC (4:40 PM VNT)")

    # =========================================================================
    # RS Rating Calculation - 4:10 PM VNT (9:10 AM UTC)
    # Runs after daily sync completes
    # =========================================================================
    async def calculate_rs_ratings_job():
        from vnibb.services.rs_rating_service import RSRatingService

        logger.info("Starting scheduled RS rating calculation...")
        service = RSRatingService()
        await service.calculate_all_rs_ratings()
        logger.info("Scheduled RS rating calculation complete")

    scheduler.add_job(
        calculate_rs_ratings_job,
        trigger=CronTrigger(hour=9, minute=10, timezone="UTC"),
        id="rs_rating_sync",
        name="RS Rating Calculation",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: rs_rating_sync at 9:10 UTC (4:10 PM VNT)")

    # =========================================================================
    # Hourly News Sync - Every hour
    # Company and market news updates
    # =========================================================================
    scheduler.add_job(
        run_hourly_news_sync,
        trigger=CronTrigger(minute=0, timezone="UTC"),
        id="hourly_news",
        name="Hourly News Sync",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: hourly_news every hour")

    # =========================================================================
    # Intraday Sync - Every 5 minutes during market hours
    # Market hours: 9:00 AM - 3:00 PM VNT (2:00 AM - 8:00 AM UTC)
    # =========================================================================
    scheduler.add_job(
        run_intraday_sync,
        trigger=CronTrigger(
            minute="*/5",
            hour="2-8",
            day_of_week="mon-fri",
            timezone="UTC",
        ),
        id="intraday_sync",
        name="Intraday Data Sync",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: intraday_sync every 5 min during market hours")

    # =========================================================================
    # Real-time Streaming - Market hours only
    # Start at 9:00 AM VNT, Stop at 3:00 PM VNT
    # =========================================================================
    async def start_realtime():
        await get_realtime_pipeline().start_streaming()

    async def stop_realtime():
        await get_realtime_pipeline().stop_streaming()

    scheduler.add_job(
        start_realtime,
        trigger=CronTrigger(
            hour=2,
            minute=0,
            day_of_week="mon-fri",
            timezone="UTC",
        ),
        id="realtime_start",
        name="Start Real-time Streaming",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: realtime_start at 2:00 UTC (9:00 AM VNT)")

    scheduler.add_job(
        stop_realtime,
        trigger=CronTrigger(
            hour=8,
            minute=0,
            day_of_week="mon-fri",
            timezone="UTC",
        ),
        id="realtime_stop",
        name="Stop Real-time Streaming",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: realtime_stop at 8:00 UTC (3:00 PM VNT)")


def start_scheduler():
    """Start the scheduler."""
    scheduler = get_scheduler()
    configure_scheduler()
    scheduler.start()
    logger.info("Scheduler started with all jobs configured")


def shutdown_scheduler():
    """Shutdown the scheduler gracefully."""
    scheduler = get_scheduler()
    if scheduler.running:
        scheduler.shutdown(wait=True)
        logger.info("Scheduler shutdown complete")


def get_job_status() -> dict:
    """Get status of all scheduled jobs."""
    scheduler = get_scheduler()

    jobs = []
    for job in scheduler.get_jobs():
        jobs.append(
            {
                "id": job.id,
                "name": job.name,
                "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
                "trigger": str(job.trigger),
            }
        )

    return {
        "running": scheduler.running,
        "jobs": jobs,
    }


def trigger_job_now(job_id: str) -> bool:
    """Manually trigger a job to run immediately."""
    scheduler = get_scheduler()
    job = scheduler.get_job(job_id)

    if job:
        # Run the job now
        scheduler.modify_job(job_id, next_run_time=datetime.now())
        logger.info(f"Triggered job {job_id} to run now")
        return True

    return False
