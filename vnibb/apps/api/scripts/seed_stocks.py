import asyncio
import logging
import sys
import os
from datetime import datetime

# Add parent directory to sys.path to allow importing vnibb
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vnstock import Listing
from sqlalchemy.dialects.postgresql import insert as pg_insert
from vnibb.core.database import async_session_maker
from vnibb.models import Stock

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

async def seed_all_stocks():
    """Fetch and seed all stock tickers into the database."""
    logger.info("Fetching stock list from VNStock (VCI source)...")
    
    try:
        # Use VCI as source
        listing = Listing(source='VCI')
        df = listing.all_symbols()
        
        if df is None or df.empty:
            logger.error("No stock data returned from VNStock")
            return
            
        total_stocks = len(df)
        logger.info(f"Found {total_stocks} stocks. Starting database seeding...")
        
        async with async_session_maker() as session:
            count = 0
            for _, row in df.iterrows():
                symbol = str(row.get('symbol', row.get('ticker', ''))).upper()
                if not symbol:
                    continue
                
                # Mapping fields
                company_name = row.get('organName') or row.get('organ_name') or row.get('companyName')
                short_name = row.get('organShortName') or row.get('organ_short_name') or row.get('shortName')
                exchange = row.get('exchange', 'HOSE')
                industry_name = row.get('industryName') or row.get('industry') or row.get('industry_name')
                
                # Truncate to fit DB constraints
                if company_name: company_name = str(company_name)[:255]
                if short_name: short_name = str(short_name)[:100]
                if exchange: exchange = str(exchange)[:10]
                if industry_name: industry_name = str(industry_name)[:100]
                
                stmt = pg_insert(Stock).values(
                    symbol=symbol,
                    company_name=company_name,
                    short_name=short_name,
                    exchange=exchange,
                    industry=industry_name,
                    is_active=1,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                ).on_conflict_do_update(
                    index_elements=['symbol'],
                    set_={
                        'company_name': company_name,
                        'short_name': short_name,
                        'exchange': exchange,
                        'industry': industry_name,
                        'is_active': 1,
                        'updated_at': datetime.utcnow(),
                    }
                )
                await session.execute(stmt)
                count += 1
                
                if count % 10 == 0:
                    logger.info(f"Processed {count}/{total_stocks}: {symbol}")
                
                if count % 100 == 0:
                    await session.commit()
                    logger.info(f"--- Committed {count} stocks ---")
            
            await session.commit()
            logger.info(f"Successfully finished seeding {count} stocks into database!")
            
    except Exception as e:
        logger.error(f"Stock seeding failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise

def main():
    try:
        asyncio.run(seed_all_stocks())
    except KeyboardInterrupt:
        logger.info("Seeding interrupted by user.")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error during seeding: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
