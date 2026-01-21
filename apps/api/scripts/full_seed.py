"""
Full Database Seeding Script - Phase 49
Populates all critical tables to ensure an error-free app experience.
"""

import asyncio
import logging
import os
import sys
from datetime import date, datetime, timedelta

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vnibb.services.data_pipeline import data_pipeline
from vnibb.core.database import async_session_maker, engine
from sqlalchemy import select, func, text

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

async def run_seeding():
    logger.info("🚀 Starting Full Seeding Pipeline...")
    
    # 1. Stocks
    logger.info("Step 1: Syncing Stock List...")
    try:
        count = await data_pipeline.sync_stock_list()
        logger.info(f"✅ Synced {count} stocks.")
    except Exception as e:
        logger.error(f"❌ Stock sync failed: {e}")

    # 2. Screener Data (Snapshots)
    logger.info("Step 2: Syncing Screener Snapshots...")
    try:
        count = await data_pipeline.sync_screener_data()
        logger.info(f"✅ Synced {count} screener snapshots.")
    except Exception as e:
        logger.error(f"❌ Screener sync failed: {e}")

    # 3. Daily Prices for Top Stocks
    logger.info("Step 3: Syncing Daily Prices (Top 100 by Market Cap)...")
    try:
        # We need to import models here to use them in query
        from vnibb.models.stock import Stock
        from vnibb.models.screener import ScreenerSnapshot
        
        async with async_session_maker() as session:
            stmt = select(Stock.symbol).join(
                ScreenerSnapshot, Stock.symbol == ScreenerSnapshot.symbol
            ).order_by(ScreenerSnapshot.market_cap.desc()).limit(10)
            
            res = await session.execute(stmt)
            symbols = [r[0] for r in res.fetchall()]
            
        if symbols:
            count = await data_pipeline.sync_daily_prices(symbols=symbols, days=365)
            logger.info(f"✅ Synced {count} price records.")
        else:
            logger.warning("⚠️ No symbols found for price sync.")
    except Exception as e:
        logger.error(f"❌ Price sync failed: {e}")

    # 4. Profiles
    logger.info("Step 4: Syncing Company Profiles (Top 100)...")
    try:
        if symbols:
            count = await data_pipeline.sync_company_profiles(symbols=symbols)
            logger.info(f"✅ Synced {count} company profiles.")
    except Exception as e:
        logger.error(f"❌ Profile sync failed: {e}")

    # 5. Financials
    logger.info("Step 5: Syncing Financial Statements (Top 100)...")
    try:
        if symbols:
            count = await data_pipeline.sync_financials(symbols=symbols, period='year')
            logger.info(f"✅ Synced financials for {count} companies.")
    except Exception as e:
        logger.error(f"❌ Financials sync failed: {e}")

    # 6. Indices
    logger.info("Step 6: Syncing Market Indices...")
    try:
        from vnstock import Vnstock
        stock = Vnstock()
        indices = ['VNINDEX', 'HNXINDEX', 'UPCOMINDEX', 'VN30INDEX']
        total_idx = 0
        async with async_session_maker() as session:
            for idx in indices:
                try:
                    df = stock.stock(symbol=idx, source='VCI').quote.history(
                        start=(datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d'),
                        end=datetime.now().strftime('%Y-%m-%d')
                    )
                    if df is not None and not df.empty:
                        from vnibb.models.stock import StockIndex
                        from vnibb.services.data_pipeline import get_upsert_stmt
                        for _, row in df.iterrows():
                            val = {
                                'index_code': idx,
                                'time': row['time'].date() if hasattr(row['time'], 'date') else row['time'],
                                'open': float(row['open']),
                                'high': float(row['high']),
                                'low': float(row['low']),
                                'close': float(row['close']),
                                'volume': int(row['volume']),
                                'created_at': datetime.utcnow()
                            }
                            stmt = get_upsert_stmt(StockIndex, ['index_code', 'time'], val)
                            await session.execute(stmt)
                        total_idx += len(df)
                except Exception as e:
                    logger.warning(f"Failed to sync index {idx}: {e}")
            await session.commit()
        logger.info(f"✅ Synced {total_idx} index price records.")
    except Exception as e:
        logger.error(f"❌ Index sync failed: {e}")

    logger.info("🏁 Full Seeding Pipeline Completed.")

if __name__ == "__main__":
    # Ensure UTF-8 for Windows
    if sys.platform == "win32":
        import _locale
        _locale._getdefaultlocale = (lambda *args: ['en_US', 'utf8'])
    
    asyncio.run(run_seeding())
