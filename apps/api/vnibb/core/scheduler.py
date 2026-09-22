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

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta

from vnibb.core.config import settings
from vnibb.core.scheduler_lock import DistributedJobLock

logger = logging.getLogger(__name__)

# Global scheduler instance
_scheduler = None
_job_guards: dict[str, asyncio.Lock] = {}
_scheduler_missed_runs = 0
# Per-job outcome counters. `_scheduler_missed_runs` alone only counts APScheduler
# misfires; it says nothing about a job that ran and FAILED, nor about one that
# was silently skipped because a lock was held. That gap is why the seven-day
# intraday outage was invisible: the job kept being scheduled and kept returning
# without error, so nothing surfaced. Keyed by job name.
_job_outcomes: dict[str, dict[str, object]] = {}


def _record_job_outcome(job_name: str, outcome: str, detail: str = "") -> None:
    """Record the most recent outcome for a job (ok / failed / timeout / skipped)."""
    entry = _job_outcomes.setdefault(
        job_name,
        {"last_outcome": None, "consecutive_failures": 0, "last_detail": "", "last_at": None},
    )
    entry["last_outcome"] = outcome
    entry["last_detail"] = detail[:300]
    entry["last_at"] = datetime.utcnow().isoformat()
    if outcome in {"failed", "timeout"}:
        entry["consecutive_failures"] = int(entry["consecutive_failures"] or 0) + 1
    else:
        entry["consecutive_failures"] = 0

DAILY_SYNC_TIMEOUT_SECONDS = 2 * 60 * 60
DAILY_TRADING_TIMEOUT_SECONDS = 2 * 60 * 60
SUPPLEMENTAL_SYNC_TIMEOUT_SECONDS = 90 * 60
RS_RATING_TIMEOUT_SECONDS = 15 * 60
HOURLY_NEWS_TIMEOUT_SECONDS = 20 * 60
INTRADAY_TIMEOUT_SECONDS = 30 * 60
MONGO_EOD_SYNC_TIMEOUT_SECONDS = 90 * 60
PREDICTION_MARKET_INGEST_TIMEOUT_SECONDS = 5 * 60
PREDICTION_MARKET_SNAPSHOT_TIMEOUT_SECONDS = 20 * 60
PREDICTION_MARKET_INTRADAY_SNAPSHOT_TIMEOUT_SECONDS = 5 * 60
PREDICTION_MARKET_INTRADAY_CADENCE_MINUTES = 15
PREDICTION_MARKET_POPULATE_TIMEOUT_SECONDS = 5 * 60
DATA_QUALITY_TIMEOUT_SECONDS = 15 * 60
# Retention deletes scan very large tables (stock_prices, orderbook), so it
# gets a much longer budget than any provider-backed job.
RETENTION_CLEANUP_TIMEOUT_SECONDS = 45 * 60
REALTIME_CONTROL_TIMEOUT_SECONDS = 5 * 60
# Financial ratios walk every active symbol through a provider, so it needs a
# wider budget than a single-market sync.
FINANCIAL_RATIOS_TIMEOUT_SECONDS = 90 * 60

# Last-run counters for the ``predictions_status`` health contribution. Reset
# at the start of each guarded run; read by the ``/health/predictions``
# endpoint via :func:`get_predictions_status`.
_last_intraday_result: dict[str, object] | None = None
_last_nightly_count: int | None = None
_last_nightly_at: datetime | None = None
_last_populate_at: datetime | None = None
_last_populate_counts: dict[str, int] | None = None


async def _run_with_lock_renewal(
    job_name: str,
    runner: Callable[[], Awaitable[object]],
    distributed_lock: DistributedJobLock,
) -> object:
    runner_task = asyncio.create_task(runner())

    async def renew_while_running() -> bool:
        interval = min(max(1, distributed_lock.ttl_seconds // 3), 300)
        while not runner_task.done():
            await asyncio.sleep(interval)
            if not runner_task.done() and not await distributed_lock.renew():
                logger.error("Cancelling %s because distributed lock renewal failed", job_name)
                runner_task.cancel()
                return False
        return True

    renewal_task = asyncio.create_task(renew_while_running())
    try:
        done, _ = await asyncio.wait(
            {runner_task, renewal_task}, return_when=asyncio.FIRST_COMPLETED
        )
        if runner_task in done:
            try:
                return await runner_task
            except asyncio.CancelledError:
                if renewal_task.done() and not renewal_task.cancelled() and not renewal_task.result():
                    raise RuntimeError("distributed lock renewal failed") from None
                raise
            except Exception:
                if renewal_task.done() and not renewal_task.cancelled() and not renewal_task.result():
                    logger.exception("%s failed while being cancelled", job_name)
                    raise RuntimeError("distributed lock renewal failed") from None
                raise
        if not await renewal_task:
            try:
                await runner_task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("%s failed while being cancelled", job_name)
            raise RuntimeError("distributed lock renewal failed")
        return await runner_task
    finally:
        if not runner_task.done():
            runner_task.cancel()
            try:
                await runner_task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("%s failed while being cancelled", job_name)
        renewal_task.cancel()
        try:
            await renewal_task
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("%s lock renewal failed while being cancelled", job_name)


async def _run_guarded_job(
    job_name: str,
    runner: Callable[[], Awaitable[object]],
    timeout_seconds: int,
) -> None:
    lock = _job_guards.setdefault(job_name, asyncio.Lock())
    if lock.locked():
        _record_job_outcome(job_name, "skipped", "previous run still active")
        logger.warning("Skipping %s because previous run is still active", job_name)
        return

    async with lock:
        distributed_lock = DistributedJobLock(job_name, timeout_seconds)
        lock_state = await distributed_lock.acquire()
        if lock_state == "contended":
            _record_job_outcome(job_name, "skipped", "another scheduler owns the lock")
            logger.warning("Skipping %s because another scheduler owns its lock", job_name)
            return
        if lock_state == "unavailable" and settings.scheduler_lock_mode == "required":
            _record_job_outcome(job_name, "skipped", "required coordination unavailable")
            logger.error("Skipping %s because required scheduler coordination is unavailable", job_name)
            return
        if lock_state == "unavailable":
            logger.warning("Running %s without distributed coordination", job_name)
        started_at = datetime.utcnow()
        try:
            guarded_runner = (
                _run_with_lock_renewal(job_name, runner, distributed_lock)
                if lock_state == "acquired"
                else runner()
            )
            if timeout_seconds > 0:
                await asyncio.wait_for(guarded_runner, timeout=timeout_seconds)
            else:
                await guarded_runner
            elapsed = (datetime.utcnow() - started_at).total_seconds()
            _record_job_outcome(job_name, "ok", f"completed in {elapsed:.1f}s")
            logger.info("%s completed in %.1fs", job_name, elapsed)
        except TimeoutError:
            elapsed = (datetime.utcnow() - started_at).total_seconds()
            _record_job_outcome(
                job_name, "timeout", f"exceeded {timeout_seconds}s after {elapsed:.1f}s"
            )
            logger.error(
                "%s timed out after %.1fs (limit=%ss)",
                job_name,
                elapsed,
                timeout_seconds,
            )
        except Exception as exc:
            elapsed = (datetime.utcnow() - started_at).total_seconds()
            _record_job_outcome(job_name, "failed", f"{type(exc).__name__}: {exc}")
            logger.error(
                "%s failed after %.1fs: %s",
                job_name,
                elapsed,
                exc,
                exc_info=True,
            )
        finally:
            if lock_state == "acquired":
                await distributed_lock.release()


def _record_scheduler_miss(event: object) -> None:
    global _scheduler_missed_runs
    _scheduler_missed_runs += 1
    logger.error("Scheduler missed run: %s", getattr(event, "job_id", "unknown"))


def get_scheduler():
    """Get or create the scheduler instance."""
    global _scheduler

    if _scheduler is None:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler

        _scheduler = AsyncIOScheduler(timezone="UTC")

    return _scheduler


def configure_scheduler():
    """Configure all scheduled jobs."""
    from apscheduler.events import EVENT_JOB_MISSED
    from apscheduler.triggers.cron import CronTrigger

    from vnibb.services.data_pipeline import (
        run_daily_trading_sync,
        run_hourly_news_sync,
        run_intraday_sync,
    )
    from vnibb.services.data_quality import run_scheduled_data_quality_check
    from vnibb.services.realtime_pipeline import get_realtime_pipeline
    from vnibb.services.sync_all_data import run_daily_market_sync, run_supplemental_company_sync

    scheduler = get_scheduler()
    scheduler.add_listener(_record_scheduler_miss, EVENT_JOB_MISSED)

    async def guarded_daily_market_sync():
        await _run_guarded_job(
            "daily_sync",
            run_daily_market_sync,
            DAILY_SYNC_TIMEOUT_SECONDS,
        )

    async def guarded_daily_trading_sync():
        await _run_guarded_job(
            "daily_trading_sync",
            run_daily_trading_sync,
            DAILY_TRADING_TIMEOUT_SECONDS,
        )

    async def guarded_hourly_news_sync():
        await _run_guarded_job(
            "hourly_news",
            run_hourly_news_sync,
            HOURLY_NEWS_TIMEOUT_SECONDS,
        )

    async def guarded_supplemental_company_sync():
        await _run_guarded_job(
            "supplemental_company_sync",
            run_supplemental_company_sync,
            SUPPLEMENTAL_SYNC_TIMEOUT_SECONDS,
        )

    async def guarded_intraday_sync():
        await _run_guarded_job(
            "intraday_sync",
            run_intraday_sync,
            INTRADAY_TIMEOUT_SECONDS,
        )

    async def guarded_data_quality_check():
        await _run_guarded_job(
            "daily_data_quality_check",
            run_scheduled_data_quality_check,
            DATA_QUALITY_TIMEOUT_SECONDS,
        )

    # =========================================================================
    # Daily Sync - 4:00 PM VNT (9:00 AM UTC)
    # Market freshness refresh after market close
    # =========================================================================
    scheduler.add_job(
        guarded_daily_market_sync,
        trigger=CronTrigger(hour=9, minute=0, timezone="UTC"),
        id="daily_sync",
        name="Daily Data Sync",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
    )
    logger.info("Scheduled: daily_sync at 9:00 UTC (4:00 PM VNT)")

    # =========================================================================
    # Daily Trading Flow Sync - 4:20 PM VNT (9:20 AM UTC)
    # Order flow, foreign trading, block trades, derivatives
    # =========================================================================
    scheduler.add_job(
        guarded_daily_trading_sync,
        trigger=CronTrigger(hour=9, minute=20, timezone="UTC"),
        id="daily_trading_sync",
        name="Daily Trading Flow Sync",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
    )
    logger.info("Scheduled: daily_trading_sync at 9:20 UTC (4:20 PM VNT)")

    # =========================================================================
    # Financial Ratios Sync - monthly, 3rd at 18:00 UTC
    # =========================================================================
    # `financial_ratios` had no scheduled owner at all. Its only writers are
    # `FullMarketSync.run_full_sync` and `run_full_seeding`, neither a cron, so
    # the table sat at 2026-05-20 for 125 days while the freshness probe
    # correctly reported it critical. Ratios only move when a company files,
    # so a monthly pass is the right cadence; it also re-covers any symbol the
    # initial seeding missed.
    async def guarded_financial_ratios_sync() -> None:
        from vnibb.services.data_pipeline import data_pipeline

        await _run_guarded_job(
            "financial_ratios_sync",
            lambda: data_pipeline.sync_financial_ratios(period="quarter"),
            FINANCIAL_RATIOS_TIMEOUT_SECONDS,
        )

    scheduler.add_job(
        guarded_financial_ratios_sync,
        trigger=CronTrigger(day=3, hour=18, minute=0, timezone="UTC"),
        id="financial_ratios_sync",
        name="Financial Ratios Sync (monthly)",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
    )
    logger.info("Scheduled: financial_ratios_sync monthly on day 3 at 18:00 UTC")

    # =========================================================================
    # Daily Data Quality Check - 4:40 PM VNT (9:40 AM UTC)
    # Coverage + freshness SLA checks with warning logs
    # =========================================================================
    scheduler.add_job(
        guarded_data_quality_check,
        trigger=CronTrigger(hour=9, minute=40, timezone="UTC"),
        id="daily_data_quality_check",
        name="Daily Data Quality Check",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: daily_data_quality_check at 9:40 UTC (4:40 PM VNT)")

    # =========================================================================
    # Nightly Price Backfill - 5:00 PM VNT (10:00 AM UTC)
    # Curated active-symbol list to keep the dashboard hot when the upstream
    # daily price stage degrades. Cheap (~5 day window) so safe to run daily.
    # =========================================================================
    async def guarded_nightly_price_backfill():
        from vnibb.services.nightly_price_backfill import run_nightly_price_backfill

        await _run_guarded_job(
            "nightly_price_backfill",
            run_nightly_price_backfill,
            45 * 60,
        )

    scheduler.add_job(
        guarded_nightly_price_backfill,
        trigger=CronTrigger(hour=10, minute=0, timezone="UTC"),
        id="nightly_price_backfill",
        name="Nightly Price Backfill",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
    )
    logger.info("Scheduled: nightly_price_backfill at 10:00 UTC (5:00 PM VNT)")

    # =========================================================================
    # Mongo EOD Daily Sync - 5:15 PM VNT (10:15 AM UTC)
    # Advances the canonical Mongo `market_prices_eod` corpus, which otherwise
    # only ever moved via operator-run backfill scripts. Runs after the Postgres
    # daily sync + nightly backfill so upstream is warm. Bounded rolling window
    # keeps it cheap; idempotent upserts keyed on (symbol, tradeDate, source).
    # =========================================================================
    async def guarded_mongo_eod_sync():
        from vnibb.services.mongo_eod_sync import run_mongo_eod_sync

        await _run_guarded_job(
            "mongo_eod_sync",
            run_mongo_eod_sync,
            MONGO_EOD_SYNC_TIMEOUT_SECONDS,
        )

    scheduler.add_job(
        guarded_mongo_eod_sync,
        trigger=CronTrigger(hour=10, minute=15, timezone="UTC"),
        id="mongo_eod_sync",
        name="Mongo EOD Daily Sync",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
    )
    logger.info("Scheduled: mongo_eod_sync at 10:15 UTC (5:15 PM VNT)")

    # =========================================================================
    # Prediction Market Ingestion - Every 5 minutes during market hours
    # Phase 7.1 / 7.2: refreshes Polymarket Gamma and Kalshi public markets
    # so the read endpoints stay fresh throughout the trading day. Both
    # ingest paths are idempotent (upsert keyed on (source, source_id)) and
    # are cheap enough to run on a 5-minute cadence.
    # =========================================================================
    async def guarded_prediction_market_ingest():
        from vnibb.core.database import async_session_maker
        from vnibb.services.kalshi_service import (
            ingest_kalshi_markets_with_default_client,
        )
        from vnibb.services.limitless_service import (
            ingest_limitless_markets_with_default_client,
        )
        from vnibb.services.manifold_service import (
            ingest_manifold_markets_with_default_client,
        )
        from vnibb.services.prediction_market_service import (
            ingest_polymarket_gamma_markets_with_default_client,
        )
        from vnibb.services.predictit_service import (
            ingest_predictit_markets_with_default_client,
        )

        async def _run():
            async with async_session_maker() as session:
                poly_count = await ingest_polymarket_gamma_markets_with_default_client(
                    session
                )
                kalshi_count = await ingest_kalshi_markets_with_default_client(session)
                predictit_count = 0
                limitless_count = 0
                manifold_count = 0
                # Per-source try/except so one failing source does not
                # poison the others (Phase 9 + 10).
                try:
                    predictit_count = await ingest_predictit_markets_with_default_client(
                        session
                    )
                except Exception as exc:
                    logger.warning("predictit ingest failed: %s", exc)
                try:
                    limitless_count = await ingest_limitless_markets_with_default_client(
                        session
                    )
                except Exception as exc:
                    logger.warning("limitless ingest failed: %s", exc)
                try:
                    manifold_count = await ingest_manifold_markets_with_default_client(
                        session
                    )
                except Exception as exc:
                    logger.warning("manifold ingest failed: %s", exc)
            logger.info(
                "prediction_market_ingest complete: polymarket=%d kalshi=%d "
                "predictit=%d limitless=%d manifold=%d",
                poly_count,
                kalshi_count,
                predictit_count,
                limitless_count,
                manifold_count,
            )

        await _run_guarded_job(
            "prediction_market_ingest",
            _run,
            PREDICTION_MARKET_INGEST_TIMEOUT_SECONDS,
        )

    scheduler.add_job(
        guarded_prediction_market_ingest,
        trigger=CronTrigger(
            minute="*/5",
            timezone="UTC",
        ),
        id="prediction_market_ingest",
        name="Prediction Market Ingest (Polymarket + Kalshi + PredictIt + Limitless + Manifold)",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
    )
    logger.info("Scheduled: prediction_market_ingest every 5 min")

    # =========================================================================
    # Prediction Market Snapshot - Nightly at 10:30 UTC (5:30 PM VNT)
    # Phase 7.4: snapshots every active prediction market into
    # `prediction_market_snapshots` so the /movers endpoint can diff against
    # historical rows. The snapshot service also enforces 30-day retention.
    # =========================================================================
    async def guarded_prediction_market_snapshot():
        from vnibb.core.database import async_session_maker
        from vnibb.services.prediction_market_snapshot_service import (
            snapshot_active_prediction_markets,
        )

        async def _run():
            global _last_nightly_count, _last_nightly_at
            async with async_session_maker() as session:
                count = await snapshot_active_prediction_markets(session)
            _last_nightly_count = count
            _last_nightly_at = datetime.utcnow()
            logger.info("prediction_market_snapshot complete: %d rows", count)

        await _run_guarded_job(
            "prediction_market_snapshot",
            _run,
            PREDICTION_MARKET_SNAPSHOT_TIMEOUT_SECONDS,
        )

    scheduler.add_job(
        guarded_prediction_market_snapshot,
        trigger=CronTrigger(hour=10, minute=30, timezone="UTC"),
        id="prediction_market_snapshot",
        name="Prediction Market Nightly Snapshot",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=600,
    )
    logger.info("Scheduled: prediction_market_snapshot at 10:30 UTC (5:30 PM VNT)")

    # =========================================================================
    # Prediction Market Intraday Snapshot - every 15 minutes
    # Phase 8: writes a micro-snapshot of every active market into
    # ``prediction_market_intraday_snapshots`` so the /movers, /alerts and
    # /history endpoints can answer 1h / 4h / 24h diffs without forcing a
    # full-nightly-batch reload.
    # =========================================================================
    async def guarded_intraday_prediction_market_snapshot():
        from vnibb.core.database import async_session_maker
        from vnibb.services.prediction_market_intraday_snapshot_service import (
            snapshot_active_prediction_markets_intraday,
        )

        async def _run():
            global _last_intraday_result
            async with async_session_maker() as session:
                result = await snapshot_active_prediction_markets_intraday(session)
            _last_intraday_result = result.as_log_dict() | {"ran_at": datetime.utcnow().isoformat()}
            logger.info(
                "prediction_market_intraday_snapshot complete: %s",
                _last_intraday_result,
            )

        await _run_guarded_job(
            "prediction_market_intraday_snapshot",
            _run,
            PREDICTION_MARKET_INTRADAY_SNAPSHOT_TIMEOUT_SECONDS,
        )

    scheduler.add_job(
        guarded_intraday_prediction_market_snapshot,
        trigger=CronTrigger(
            minute=f"*/{PREDICTION_MARKET_INTRADAY_CADENCE_MINUTES}",
            timezone="UTC",
        ),
        id="prediction_market_intraday_snapshot",
        name="Prediction Market Intraday Snapshot (15 min)",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
    )
    logger.info(
        "Scheduled: prediction_market_intraday_snapshot every %s min",
        PREDICTION_MARKET_INTRADAY_CADENCE_MINUTES,
    )

    # =========================================================================
    # RS Rating Calculation - 4:10 PM VNT (9:10 AM UTC)
    # Runs after daily sync completes
    # =========================================================================
    async def calculate_rs_ratings_job():
        async def _run():
            from vnibb.services.rs_rating_service import RSRatingService

            logger.info("Starting scheduled RS rating calculation...")
            service = RSRatingService()
            await service.calculate_all_rs_ratings()

        await _run_guarded_job("rs_rating_sync", _run, RS_RATING_TIMEOUT_SECONDS)

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
        guarded_hourly_news_sync,
        trigger=CronTrigger(minute=0, timezone="UTC"),
        id="hourly_news",
        name="Hourly News Sync",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
    )
    logger.info("Scheduled: hourly_news every hour")

    # =========================================================================
    # Supplemental Company Sync - After close / off hours
    # Rotates shareholders, officers, subsidiaries, and broad company news.
    # Weekend runs process a broader universe.
    # =========================================================================
    scheduler.add_job(
        guarded_supplemental_company_sync,
        trigger=CronTrigger(hour=10, minute=30, timezone="UTC"),
        id="supplemental_company_sync",
        name="Supplemental Company Sync",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=600,
    )
    logger.info("Scheduled: supplemental_company_sync at 10:30 UTC (5:30 PM VNT)")

    # =========================================================================
    # Intraday Sync - Every 5 minutes during market hours
    # Market hours: 9:00 AM - 3:00 PM VNT (2:00 AM - 8:00 AM UTC)
    # =========================================================================
    scheduler.add_job(
        guarded_intraday_sync,
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
        coalesce=True,
        misfire_grace_time=300,
    )
    logger.info("Scheduled: intraday_sync every 5 min during market hours")

    async def start_realtime():
        await get_realtime_pipeline().reconcile_streaming()

    async def stop_realtime():
        await get_realtime_pipeline().stop_streaming()

    scheduler.add_job(
        start_realtime,
        trigger=CronTrigger(hour=2, minute=0, day_of_week="mon-fri", timezone="UTC"),
        id="realtime_start",
        name="Start Real-time Streaming",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.add_job(
        stop_realtime,
        trigger=CronTrigger(hour=4, minute=30, day_of_week="mon-fri", timezone="UTC"),
        id="realtime_lunch_stop",
        name="Stop Real-time Streaming for Lunch",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.add_job(
        start_realtime,
        trigger=CronTrigger(hour=6, minute=0, day_of_week="mon-fri", timezone="UTC"),
        id="realtime_afternoon_start",
        name="Restart Real-time Streaming",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.add_job(
        stop_realtime,
        trigger=CronTrigger(hour=7, minute=45, day_of_week="mon-fri", timezone="UTC"),
        id="realtime_stop",
        name="Stop Real-time Streaming",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("Scheduled: realtime streaming for 9:00-11:30 and 13:00-14:45 VNT")


def start_scheduler():
    """Start the scheduler."""
    scheduler = get_scheduler()
    configure_scheduler()
    scheduler.start()
    logger.info("Scheduler started with all jobs configured")
    _maybe_populate_prediction_markets_on_startup()
    schedule_retention_cleanup()


def _maybe_populate_prediction_markets_on_startup() -> None:
    """Run a one-shot prediction-market populate if the scheduler is starting
    up and the snapshot tables are still empty. Schedules itself via
    APScheduler so it doesn't block the boot loop.
    """
    scheduler = get_scheduler()

    async def _populate_now() -> None:
        from vnibb.core.database import async_session_maker
        from vnibb.services.populate_prediction_markets import (
            populate_prediction_markets_now,
        )

        global _last_populate_at, _last_populate_counts

        async def _runner() -> None:
            async with async_session_maker() as session:
                counts = await populate_prediction_markets_now(session)
            _last_populate_at = datetime.utcnow()
            _last_populate_counts = counts

        await _run_guarded_job(
            "populate_prediction_markets_on_startup",
            _runner,
            PREDICTION_MARKET_POPULATE_TIMEOUT_SECONDS,
        )

    # Always schedule once at startup; the guarded job will no-op if the
    # scheduler is mid-restart.
    try:
        scheduler.add_job(
            _populate_now,
            trigger="date",
            run_date=datetime.utcnow() + timedelta(seconds=15),
            id="populate_prediction_markets_on_startup",
            name="One-shot populate prediction markets",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        logger.info("Scheduled: populate_prediction_markets_on_startup in 15s")
    except Exception as exc:
        logger.warning("could not schedule populate_prediction_markets_on_startup: %s", exc)


def schedule_retention_cleanup() -> None:
    """Schedule the data-retention sweep as a real job.

    ``run_retention_cleanup`` already existed and deletes expired rows from
    the large tables, but its only caller was a manual admin endpoint
    (``POST /data-sync/retention/cleanup``). Nothing called it on a schedule,
    so tables grew without bound: ``prediction_markets`` reached 13 M rows /
    9.3 GB, and unbounded reads against it OOM-killed the scheduler every 15
    minutes. Running it nightly at 19:10 UTC (02:10 VNT, after the daily sync
    window and before the 03:30 host-time backup) keeps the corpus bounded and
    the backup size predictable.
    """
    from apscheduler.triggers.cron import CronTrigger

    from vnibb.services.data_pipeline import data_pipeline

    async def _run() -> None:
        removed = await data_pipeline.run_retention_cleanup(include_price_history=True)
        if removed:
            logger.info("Retention cleanup removed rows: %s", removed)
        else:
            logger.info("Retention cleanup found nothing to remove")

    scheduler = get_scheduler()
    scheduler.add_job(
        lambda: _run_guarded_job(
            "retention_cleanup",
            _run,
            RETENTION_CLEANUP_TIMEOUT_SECONDS,
        ),
        trigger=CronTrigger(hour=19, minute=10, timezone="UTC"),
        id="retention_cleanup",
        name="Retention cleanup (daily 19:10 UTC)",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    logger.info("Scheduled: retention_cleanup daily at 19:10 UTC")


async def shutdown_scheduler() -> bool:
    from vnibb.services.realtime_pipeline import get_realtime_pipeline

    realtime_stopped = await get_realtime_pipeline().stop_streaming()
    if not realtime_stopped:
        logger.error("Real-time streaming cleanup failed; stopping scheduler without waiting")
    scheduler = get_scheduler()
    if scheduler.running:
        scheduler.shutdown(wait=realtime_stopped)
        logger.info("Scheduler shutdown complete")
    return realtime_stopped


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
                # Last observed outcome. A job that runs and silently fails, or
                # is skipped because a lock is held, previously looked identical
                # to one that never fired.
                **_job_outcomes.get(job.id, {}),
            }
        )

    failing = {
        name: state
        for name, state in _job_outcomes.items()
        if str(state.get("last_outcome")) in {"failed", "timeout"}
    }

    return {
        "running": scheduler.running,
        "jobs": jobs,
        "missed_runs": _scheduler_missed_runs,
        "failing_jobs": failing,
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


def get_predictions_status() -> dict:
    """Snapshot of the prediction-market ingestion/snapshot health.

    Returns the last intraday micro-snapshot outcome + the last nightly
    snapshot count + timestamp + the last one-shot populate counts.
    Consumed by ``/health/predictions`` so the platform can flag a stale
    or zero-row cycle without scraping logs.
    """
    return {
        "intraday": _last_intraday_result,
        "nightly": {
            "rows_written": _last_nightly_count,
            "ran_at": _last_nightly_at.isoformat() if _last_nightly_at else None,
        },
        "populate": {
            "ran_at": _last_populate_at.isoformat() if _last_populate_at else None,
            "counts": _last_populate_counts,
        },
        "cadence_minutes": PREDICTION_MARKET_INTRADAY_CADENCE_MINUTES,
    }
