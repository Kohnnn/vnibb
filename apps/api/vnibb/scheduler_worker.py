import argparse
import asyncio
import logging
import os
import signal

from vnibb.core.cache import redis_client
from vnibb.core.config import settings
from vnibb.core.logging_config import setup_logging
from vnibb.core.scheduler import shutdown_scheduler, start_scheduler
from vnibb.services.realtime_pipeline import get_realtime_pipeline
from vnibb.services.vnstock_registration import ensure_vnstock_registration

logger = logging.getLogger(__name__)


def _registration_timeout() -> int:
    raw = os.getenv("STARTUP_VNSTOCK_REG_TIMEOUT_SECONDS")
    try:
        return max(1, int(raw)) if raw is not None else 10
    except ValueError:
        return 10


async def _ensure_golden_registration() -> None:
    """Register the configured Golden key before any scheduled acquisition.

    The scheduler process has no API lifespan, so it must register itself.
    Free tier needs no credential; Golden fails closed on any failure.
    """
    if settings.vnstock_runtime_tier != "golden":
        return
    try:
        result = await asyncio.wait_for(ensure_vnstock_registration(), timeout=_registration_timeout())
    except Exception:
        raise RuntimeError("VNStock Golden registration failed") from None
    if not result.registered:
        raise RuntimeError(f"VNStock Golden registration failed: {result.reason}")


async def start() -> None:
    if settings.scheduler_role != "scheduler":
        raise RuntimeError("SCHEDULER_ROLE=scheduler is required for vnibb.scheduler_worker")
    await _ensure_golden_registration()
    try:
        await redis_client.connect()
    except Exception as exc:
        if settings.scheduler_lock_mode == "required":
            raise RuntimeError("Redis is required for scheduler coordination") from exc
        logger.warning("Scheduler starting without Redis coordination: %s", exc)
    start_scheduler()
    await get_realtime_pipeline().reconcile_streaming()


async def run() -> None:
    await start()
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, stopped.set)
    await stopped.wait()
    await shutdown_scheduler()
    await redis_client.disconnect()


async def check() -> None:
    if settings.scheduler_role != "scheduler":
        raise RuntimeError("SCHEDULER_ROLE=scheduler is required for vnibb.scheduler_worker")
    await redis_client.connect()
    await redis_client.client.ping()
    await redis_client.disconnect()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    setup_logging()
    asyncio.run(check() if args.check else run())


if __name__ == "__main__":
    main()
