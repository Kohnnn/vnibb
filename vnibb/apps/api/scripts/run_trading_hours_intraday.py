import asyncio
import logging
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, func

from vnibb.core.database import async_session_maker
from vnibb.core.config import settings
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock
from vnibb.services.data_pipeline import data_pipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("vnibb.trading_hours_intraday")


async def _get_focus_symbols(limit: int = 50) -> list[str]:
    try:
        from vnstock import Listing

        listing = Listing(source=settings.vnstock_source.lower())
        group_symbols = listing.symbols_by_group(group="VN30")
        symbols = (
            group_symbols.tolist() if hasattr(group_symbols, "tolist") else list(group_symbols)
        )
        symbols = [symbol for symbol in symbols if symbol]
        if symbols:
            return symbols[:limit]
    except Exception as exc:
        logger.warning("VN30 listing fallback failed: %s", exc)

    async with async_session_maker() as session:
        latest_date = await session.scalar(select(func.max(ScreenerSnapshot.snapshot_date)))
        if latest_date is not None:
            rows = await session.execute(
                select(ScreenerSnapshot.symbol)
                .where(ScreenerSnapshot.snapshot_date == latest_date)
                .order_by(ScreenerSnapshot.market_cap.desc().nullslast())
                .limit(limit)
            )
            symbols = [row[0] for row in rows.fetchall() if row[0]]
            if symbols:
                return symbols

        rows = await session.execute(select(Stock.symbol).where(Stock.is_active == 1).limit(limit))
        return [row[0] for row in rows.fetchall() if row[0]]


def _today_at(tz: ZoneInfo, hour: int, minute: int) -> datetime:
    now = datetime.now(tz)
    return datetime(now.year, now.month, now.day, hour, minute, tzinfo=tz)


async def _sleep_until(target: datetime) -> None:
    now = datetime.now(target.tzinfo)
    if now >= target:
        return
    delta = (target - now).total_seconds()
    logger.info("Waiting %.0f seconds until %s", delta, target.isoformat())
    await asyncio.sleep(delta)


async def _run_intraday(symbols: list[str]) -> None:
    if not symbols:
        logger.warning("No symbols available for intraday sync")
        return

    old_store = settings.store_intraday_trades
    old_orderflow_close = settings.orderflow_at_close_only
    old_require = settings.intraday_require_market_hours
    try:
        settings.store_intraday_trades = True
        settings.orderflow_at_close_only = False
        settings.intraday_require_market_hours = True
        logger.info("Running intraday sync for %s symbols", len(symbols))
        await data_pipeline.sync_intraday_trades(symbols=symbols, limit=200)
    finally:
        settings.store_intraday_trades = old_store
        settings.orderflow_at_close_only = old_orderflow_close
        settings.intraday_require_market_hours = old_require


async def _run_close_tasks(symbols: list[str]) -> None:
    if not symbols:
        logger.warning("No symbols available for close tasks")
        return

    old_store = settings.store_intraday_trades
    old_require = settings.intraday_require_market_hours
    old_orderbook_close = settings.orderbook_at_close_only
    old_orderflow_close = settings.orderflow_at_close_only
    try:
        settings.store_intraday_trades = True
        settings.intraday_require_market_hours = False
        settings.orderbook_at_close_only = True
        settings.orderflow_at_close_only = True
        logger.info("Running orderbook snapshots for %s symbols", len(symbols))
        await data_pipeline.sync_orderbook_snapshots(symbols=symbols)
        logger.info("Running block trade detection for %s symbols", len(symbols))
        await data_pipeline.sync_block_trades(symbols=symbols)
        await data_pipeline.cleanup_intraday_trades(retain_days=1)
    finally:
        settings.store_intraday_trades = old_store
        settings.intraday_require_market_hours = old_require
        settings.orderbook_at_close_only = old_orderbook_close
        settings.orderflow_at_close_only = old_orderflow_close


async def main() -> None:
    tz = ZoneInfo("Asia/Ho_Chi_Minh")
    now = datetime.now(tz)
    market_open = _today_at(tz, 9, 0)
    break_start = _today_at(tz, 11, 30)
    break_end = _today_at(tz, 13, 0)
    market_close = _today_at(tz, 15, 0)
    intraday_time = market_open + timedelta(minutes=10)
    close_time = market_close + timedelta(minutes=5)

    if now >= market_close + timedelta(hours=2):
        logger.info("Market already closed for today; exiting")
        return

    if now < intraday_time:
        await _sleep_until(intraday_time)
    elif break_start <= now < break_end:
        await _sleep_until(break_end + timedelta(minutes=5))

    symbols = await _get_focus_symbols(limit=50)
    await _run_intraday(symbols)

    await _sleep_until(close_time)
    await _run_close_tasks(symbols)
    logger.info("Trading-hours intraday/orderbook/block-trades run completed")


if __name__ == "__main__":
    asyncio.run(main())
