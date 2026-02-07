import asyncio
import logging
from datetime import date, datetime, timedelta

from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.models.alerts import BlockTrade
from vnibb.models.company import Company, Shareholder, Officer
from vnibb.models.financials import IncomeStatement, BalanceSheet, CashFlow
from vnibb.models.market import MarketSector, Subsidiary, SectorPerformance
from vnibb.models.market_news import MarketNews
from vnibb.models.news import CompanyNews, CompanyEvent, Dividend, InsiderDeal
from vnibb.models.stock import Stock, StockIndex
from vnibb.models.technical_indicator import TechnicalIndicator
from vnibb.models.trading import FinancialRatio, OrderbookSnapshot
from vnibb.models.screener import ScreenerSnapshot
from vnibb.providers.vnstock.equity_screener import VnstockScreenerFetcher, StockScreenerParams
from vnibb.providers.vnstock.market_overview import VnstockMarketOverviewFetcher
from vnibb.services.cache_manager import CacheManager
from vnibb.services.data_pipeline import data_pipeline
from vnibb.services.news_crawler import NewsCrawlerService
from vnibb.services.sector_service import SectorService
from vnibb.services.technical_analysis import TechnicalAnalysisService

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("vnibb.fill_supabase")


async def _table_count(model) -> int:
    async with async_session_maker() as session:
        result = await session.execute(select(func.count()).select_from(model))
        return int(result.scalar() or 0)


async def _get_active_symbols() -> list[str]:
    async with async_session_maker() as session:
        result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
        return [row[0] for row in result.fetchall()]


async def _get_focus_symbols(limit: int = 50) -> list[str]:
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

        rows = await session.execute(
            select(Stock.symbol).where(Stock.is_active == 1).limit(limit)
        )
        return [row[0] for row in rows.fetchall() if row[0]]


def _parse_date(value: object) -> date | None:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        raw = value.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(raw).date()
        except ValueError:
            return None
    return None


async def _sync_stock_indices(days: int = 30) -> int:
    logger.info("Syncing stock indices...")
    total = 0
    raw_indices = await VnstockMarketOverviewFetcher.extract_data({}, None)
    if not raw_indices:
        return 0

    async with async_session_maker() as session:
        for row in raw_indices:
            await data_pipeline.rate_limiters["prices"].wait()
            index_code = row.get("index_name") or row.get("symbol") or row.get("code")
            if not index_code:
                continue

            parsed_date = _parse_date(row.get("time") or row.get("trading_date") or row.get("date"))
            if not parsed_date:
                parsed_date = date.today()

            open_val = row.get("open") or row.get("open_price") or row.get("openPrice")
            high_val = row.get("high") or row.get("highest")
            low_val = row.get("low") or row.get("lowest")
            close_val = row.get("close") or row.get("current_value") or row.get("price")
            volume_val = row.get("volume") or row.get("total_volume") or 0

            if close_val is None:
                continue

            if open_val is None:
                open_val = close_val
            if high_val is None:
                high_val = close_val
            if low_val is None:
                low_val = close_val

            values = {
                "index_code": str(index_code).upper(),
                "time": parsed_date,
                "open": float(open_val),
                "high": float(high_val),
                "low": float(low_val),
                "close": float(close_val),
                "volume": int(volume_val or 0),
                "value": row.get("value"),
                "change": row.get("change"),
                "change_pct": row.get("change_pct") or row.get("pctChange"),
                "created_at": datetime.utcnow(),
            }
            stmt = pg_insert(StockIndex).values(values).on_conflict_do_update(
                constraint="uq_stock_index_code_time",
                set_={
                    "open": values["open"],
                    "high": values["high"],
                    "low": values["low"],
                    "close": values["close"],
                    "volume": values["volume"],
                    "value": values["value"],
                    "change": values["change"],
                    "change_pct": values["change_pct"],
                },
            )
            await session.execute(stmt)
            total += 1
        await session.commit()

    return total


async def _sync_sector_performance() -> int:
    logger.info("Syncing sector performance...")
    params = StockScreenerParams(
        exchange="ALL",
        limit=2000,
        source=settings.vnstock_source,
    )
    screener_result = await VnstockScreenerFetcher.fetch(params)
    screener_data = [s.model_dump() for s in screener_result] if screener_result else []
    if not screener_data:
        async with async_session_maker() as session:
            latest_date = await session.scalar(select(func.max(ScreenerSnapshot.snapshot_date)))
            if latest_date is None:
                return 0
            rows = await session.execute(
                select(
                    ScreenerSnapshot.symbol,
                    ScreenerSnapshot.price,
                    Company.industry,
                )
                .join(Company, Company.symbol == ScreenerSnapshot.symbol, isouter=True)
                .where(ScreenerSnapshot.snapshot_date == latest_date)
            )
            screener_data = [
                {
                    "symbol": row[0],
                    "price": row[1],
                    "industry": row[2],
                }
                for row in rows.fetchall()
            ]
            if not screener_data:
                return 0

    sector_data = await SectorService.calculate_sector_performance(screener_data)
    if not sector_data:
        return 0

    trade_date = date.today()
    total = 0
    async with async_session_maker() as session:
        for sector in sector_data:
            advance_count = 0
            decline_count = 0
            unchanged_count = 0
            for stock in sector.stocks:
                change = stock.change_pct
                if change is None:
                    continue
                if change > 0:
                    advance_count += 1
                elif change < 0:
                    decline_count += 1
                else:
                    unchanged_count += 1

            sector_code = str(sector.sector_id)[:20]
            values = {
                "sector_code": sector_code,
                "trade_date": trade_date,
                "change_pct": sector.change_pct,
                "avg_change_pct": sector.change_pct,
                "top_gainer_symbol": sector.top_gainer.symbol if sector.top_gainer else None,
                "top_gainer_change": sector.top_gainer.change_pct if sector.top_gainer else None,
                "top_loser_symbol": sector.top_loser.symbol if sector.top_loser else None,
                "top_loser_change": sector.top_loser.change_pct if sector.top_loser else None,
                "advance_count": advance_count,
                "decline_count": decline_count,
                "unchanged_count": unchanged_count,
                "created_at": datetime.utcnow(),
            }
            stmt = pg_insert(SectorPerformance).values(values).on_conflict_do_update(
                constraint="uq_sector_perf_code_date",
                set_={
                    "change_pct": values["change_pct"],
                    "avg_change_pct": values["avg_change_pct"],
                    "top_gainer_symbol": values["top_gainer_symbol"],
                    "top_gainer_change": values["top_gainer_change"],
                    "top_loser_symbol": values["top_loser_symbol"],
                    "top_loser_change": values["top_loser_change"],
                    "advance_count": values["advance_count"],
                    "decline_count": values["decline_count"],
                    "unchanged_count": values["unchanged_count"],
                },
            )
            await session.execute(stmt)
            total += 1
        await session.commit()

    return total


async def _sync_technical_indicators(symbols: list[str]) -> int:
    logger.info("Syncing technical indicators...")
    service = TechnicalAnalysisService()
    end_date = date.today()
    start_date = end_date - timedelta(days=365)
    total = 0
    for symbol in symbols:
        await data_pipeline.rate_limiters["prices"].wait()
        indicators = await service.calculate_indicators(symbol, start_date, end_date)
        if not indicators:
            continue
        await service.store_indicators(symbol, end_date, indicators)
        total += 1
    return total


async def _sync_market_news() -> int:
    logger.info("Syncing market news...")
    crawler = NewsCrawlerService()
    return await crawler.crawl_market_news(limit=50, analyze_sentiment=False)


async def main() -> None:
    logger.info("Checking current table counts...")
    counts = {
        "companies": await _table_count(Company),
        "financial_ratios": await _table_count(FinancialRatio),
        "income_statements": await _table_count(IncomeStatement),
        "balance_sheets": await _table_count(BalanceSheet),
        "cash_flows": await _table_count(CashFlow),
        "company_news": await _table_count(CompanyNews),
        "company_events": await _table_count(CompanyEvent),
        "dividends": await _table_count(Dividend),
        "insider_deals": await _table_count(InsiderDeal),
        "shareholders": await _table_count(Shareholder),
        "officers": await _table_count(Officer),
        "subsidiaries": await _table_count(Subsidiary),
        "market_sectors": await _table_count(MarketSector),
        "market_news": await _table_count(MarketNews),
        "sector_performance": await _table_count(SectorPerformance),
        "stock_indices": await _table_count(StockIndex),
        "technical_indicators": await _table_count(TechnicalIndicator),
        "orderbook_snapshots": await _table_count(OrderbookSnapshot),
        "block_trades": await _table_count(BlockTrade),
    }

    for name, value in counts.items():
        logger.info("%s: %s", name, value)

    if counts["companies"] < 100:
        logger.info("Syncing company profiles...")
        await data_pipeline.sync_company_profiles()

    if counts["dividends"] < 1:
        logger.info("Syncing dividends...")
        await data_pipeline.sync_dividends()

    if counts["insider_deals"] < 1:
        logger.info("Syncing insider deals...")
        await data_pipeline.sync_insider_deals(limit=20)

    if counts["financial_ratios"] < 100:
        logger.info("Syncing financial ratios...")
        await data_pipeline.sync_financial_ratios(period="quarter")

    if (
        counts["income_statements"] < 100
        or counts["balance_sheets"] < 100
        or counts["cash_flows"] < 100
    ):
        logger.info("Syncing financial statements...")
        await data_pipeline.sync_financials(period="year")

    if counts["market_sectors"] < 1:
        logger.info("Syncing market sectors...")
        await data_pipeline.sync_market_sectors()

    if counts["company_news"] < 1:
        logger.info("Syncing company news...")
        await data_pipeline.sync_company_news(limit=20)

    if counts["company_events"] < 1:
        logger.info("Skipping company events (per request)")

    if counts["shareholders"] < 1:
        logger.info("Syncing shareholders...")
        await data_pipeline.sync_shareholders()

    if counts["officers"] < 1:
        logger.info("Syncing officers...")
        await data_pipeline.sync_officers()

    if counts["subsidiaries"] < 1:
        logger.info("Syncing subsidiaries...")
        await data_pipeline.sync_subsidiaries()

    if counts["stock_indices"] < 1:
        await _sync_stock_indices()

    if counts["sector_performance"] < 1:
        await _sync_sector_performance()

    if counts["technical_indicators"] < 100:
        symbols = await _get_active_symbols()
        if symbols:
            await _sync_technical_indicators(symbols)

    if counts["market_news"] < 1:
        logger.info("Skipping market news (per request)")

    if counts["orderbook_snapshots"] < 1 or counts["block_trades"] < 1:
        symbols = await _get_focus_symbols(limit=50)
        if symbols:
            logger.info("Syncing intraday/orderbook/block trades for %s symbols...", len(symbols))
            old_store = settings.store_intraday_trades
            old_require = settings.intraday_require_market_hours
            old_orderbook_close = settings.orderbook_at_close_only
            old_orderflow_close = settings.orderflow_at_close_only
            try:
                settings.store_intraday_trades = True
                settings.intraday_require_market_hours = False
                settings.orderbook_at_close_only = False
                settings.orderflow_at_close_only = False

                await data_pipeline.sync_intraday_trades(symbols=symbols, limit=200)
                await data_pipeline.sync_orderbook_snapshots(symbols=symbols)
                await data_pipeline.sync_block_trades(symbols=symbols)
            finally:
                settings.store_intraday_trades = old_store
                settings.intraday_require_market_hours = old_require
                settings.orderbook_at_close_only = old_orderbook_close
                settings.orderflow_at_close_only = old_orderflow_close

    logger.info("Supabase fill run completed.")


if __name__ == "__main__":
    asyncio.run(main())
