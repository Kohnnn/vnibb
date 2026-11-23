import asyncio
import logging
import sys
import os
from datetime import datetime

# Add parent directory to sys.path to allow importing vnibb
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vnibb.providers import market_data
from sqlalchemy.dialects.postgresql import insert as pg_insert
from vnibb.core.database import async_session_maker
from vnibb.models import Stock
from vnibb.services.stock_listing import listing_board_evidence, listing_symbol, listed_exchange_update

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
        df = market_data.listing("VCI", view="symbols_by_exchange")
        
        if df is None or df.empty:
            logger.error("No stock data returned from VNStock")
            return
            
        total_stocks = len(df)
        logger.info(f"Found {total_stocks} stocks. Starting database seeding...")
        rows = df.to_dict(orient="records")
        boards, withheld = listing_board_evidence(rows)
        if withheld:
            logger.warning("Withheld %d VCI identities with contradictory listing evidence", len(withheld))
        
        async with async_session_maker() as session:
            count = 0
            for row in rows:
                symbol = listing_symbol(row)
                if symbol not in boards or row.get("type") != "STOCK":
                    continue
                exchange = boards[symbol]

                company_name = row.get('organ_name')
                short_name = row.get('organ_short_name')
                
                # Truncate to fit DB constraints
                if company_name: company_name = str(company_name)[:255]
                if short_name: short_name = str(short_name)[:100]
                
                stmt = pg_insert(Stock).values(
                    symbol=symbol,
                    company_name=company_name,
                    short_name=short_name,
                    exchange=exchange,
                    is_active=1,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                ).on_conflict_do_update(
                    index_elements=['symbol'],
                    set_={
                        'company_name': company_name,
                        'short_name': short_name,
                        'exchange': listed_exchange_update(exchange),
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
