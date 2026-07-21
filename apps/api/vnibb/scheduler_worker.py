import argparse
import asyncio
import logging
import signal

from vnibb.core.cache import redis_client
from vnibb.core.config import settings
from vnibb.core.logging_config import setup_logging
from vnibb.core.scheduler import shutdown_scheduler, start_scheduler
from vnibb.services.realtime_pipeline import get_realtime_pipeline

logger = logging.getLogger(__name__)


async def start() -> None:
    if settings.scheduler_role != "scheduler":
        raise RuntimeError("SCHEDULER_ROLE=scheduler is required for vnibb.scheduler_worker")
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
