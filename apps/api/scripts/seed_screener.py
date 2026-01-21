"""
Seed screener snapshot data for all stocks.
Uses the VnstockScreenerFetcher for robust parallel data retrieval.
"""
import asyncio
import logging
import sys
import os
import math
from datetime import date, datetime

# Add parent directory to sys.path to allow importing vnibb
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vnibb.core.database import async_session_maker
from vnibb.core.config import settings
from vnibb.models.screener import ScreenerSnapshot
from vnibb.providers.vnstock.equity_screener import VnstockScreenerFetcher, ScreenerQueryParams
from sqlalchemy.dialects.postgresql import insert as pg_insert

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def safe_float(val):
    """Convert value to float, handling NaN and None."""
    if val is None:
        return None
    try:
        f_val = float(val)
        if math.isnan(f_val) or math.isinf(f_val):
            return None
        return f_val
    except (TypeError, ValueError):
        return None

async def seed_screener():
    """Seed screener data using VnstockScreenerFetcher."""
    logger.info("Starting robust screener data seeding...")
    
    # We'll fetch for all major exchanges
    exchanges = ["HOSE", "HNX", "UPCOM"]
    total_synced = 0
    
    for exchange in exchanges:
        logger.info(f"Processing exchange: {exchange}")
        params = ScreenerQueryParams(
            exchange=exchange,
            limit=1700, # Large limit to get all
            source=settings.vnstock_source
        )
        
        try:
            # Using the fetcher which handles parallel requests and transformations
            data_models = await VnstockScreenerFetcher.fetch(params)
            
            if not data_models:
                logger.warning(f"No data returned for {exchange}")
                continue
                
            logger.info(f"Retrieved {len(data_models)} stocks for {exchange}. Inserting into DB...")
            
            async with async_session_maker() as session:
                count = 0
                for item in data_models:
                    # Map ScreenerData model to ScreenerSnapshot database model
                    # We use the field names from ScreenerData
                    record = {
                        'symbol': item.symbol,
                        'snapshot_date': date.today(),
                        'company_name': item.organ_name or '',
                        'exchange': item.exchange or exchange,
                        'industry': item.industry_name,
                        'price': safe_float(item.price),
                        'pe': safe_float(item.pe),
                        'pb': safe_float(item.pb),
                        'roe': safe_float(item.roe),
                        'market_cap': safe_float(item.market_cap),
                        'updated_at': datetime.utcnow(),
                    }
                    
                    # Robust upsert logic
                    stmt = pg_insert(ScreenerSnapshot).values(**record)
                    stmt = stmt.on_conflict_do_update(
                        constraint='uq_screener_snapshot_symbol_date',
                        set_={
                            'company_name': record['company_name'],
                            'exchange': record['exchange'],
                            'industry': record['industry'],
                            'price': record['price'],
                            'pe': record['pe'],
                            'pb': record['pb'],
                            'roe': record['roe'],
                            'market_cap': record['market_cap'],
                            'updated_at': record['updated_at'],
                        }
                    )
                    await session.execute(stmt)
                    count += 1
                
                await session.commit()
                total_synced += count
                logger.info(f"Successfully seeded {count} records for {exchange}")
                
        except Exception as e:
            logger.error(f"Failed to process {exchange}: {e}")
            import traceback
            logger.error(traceback.format_exc())

    logger.info(f"✅ Seeding complete! Total synced: {total_synced}")

if __name__ == "__main__":
    asyncio.run(seed_screener())
