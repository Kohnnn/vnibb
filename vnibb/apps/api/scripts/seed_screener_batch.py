"""
Seed screener snapshot data for all stocks in batches.
This script processes stocks in smaller batches to avoid timeouts.

Usage:
    cd backend
    python scripts/seed_screener_batch.py
"""
import asyncio
import logging
import sys
import os
from datetime import date

# Add parent directory to sys.path to allow importing vnibb
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vnstock import Vnstock, Listing
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy import select, func

from vnibb.core.database import async_session_maker
from vnibb.models.screener import ScreenerSnapshot

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

async def seed_screener_batch(batch_size=100, max_stocks=2000):
    """
    Seed screener data by processing stocks in batches.
    
    Args:
        batch_size: Number of stocks to process in each batch
        max_stocks: Maximum total stocks to process (None for all)
    """
    logger.info("=" * 70)
    logger.info("VNIBB Screener Data Seeding Script (Batch Processing)")
    logger.info("=" * 70)
    
    # Step 1: Get all stock symbols
    logger.info("\nFetching stock symbols list...")
    try:
        listing = Listing(source='VCI')
        symbols_df = listing.all_symbols()
        
        if symbols_df is None or symbols_df.empty:
            logger.error("Failed to fetch stock symbols")
            return False
            
        all_symbols = symbols_df['symbol'].tolist()
        
        if max_stocks:
            all_symbols = all_symbols[:max_stocks]
            
        logger.info(f"Processing {len(all_symbols)} stocks in batches of {batch_size}")
        
    except Exception as e:
        logger.error(f"Failed to fetch symbols: {e}")
        return False
    
    # Step 2: Process in batches
    total_processed = 0
    total_errors = 0
    stock = Vnstock()
    
    for batch_start in range(0, len(all_symbols), batch_size):
        batch_end = min(batch_start + batch_size, len(all_symbols))
        batch_symbols = all_symbols[batch_start:batch_end]
        
        logger.info(f"\nProcessing batch {batch_start//batch_size + 1}: symbols {batch_start+1}-{batch_end} of {len(all_symbols)}")
        
        batch_records = []
        batch_errors = 0
        
        # Fetch data for each symbol in the batch
        for symbol in batch_symbols:
            try:
                stock_obj = stock.stock(symbol=symbol, source='VCI')
                df = stock_obj.company.ratio_summary()
                
                if df is not None and not df.empty:
                    record = df.head(1).to_dict("records")[0]
                    record['symbol'] = symbol
                    batch_records.append(record)
                    
            except Exception as e:
                logger.debug(f"Failed to fetch {symbol}: {str(e)[:100]}")
                batch_errors += 1
                continue
        
        # Step 3: Insert batch into database
        if batch_records:
            try:
                async with async_session_maker() as session:
                    for record in batch_records:
                        symbol = record.get('symbol', 'UNKNOWN')
                        
                        # Map fields to DB schema
                        values = {
                            "symbol": symbol,
                            "snapshot_date": date.today(),
                            "market_cap": record.get('market_cap'),
                            "pe": record.get('pe'),
                            "pb": record.get('pb'),
                            "roe": record.get('roe'),
                            "roa": record.get('roa'),
                            "price": record.get('price'),
                            "volume": record.get('volume'),
                            "exchange": record.get('exchange'),
                            "industry": record.get('industry_name'),
                            "eps": record.get('eps'),
                            "gross_margin": record.get('gross_margin'),
                            "net_margin": record.get('net_profit_margin'),
                            "debt_to_equity": record.get('de'),
                            "current_ratio": record.get('current_ratio'),
                            "revenue_growth": record.get('revenue_growth'),
                            "earnings_growth": record.get('net_profit_growth'),
                            "dividend_yield": record.get('dividend'),
                        }
                        
                        # Remove None values
                        values = {k: v for k, v in values.items() if v is not None}
                        
                        # Upsert
                        stmt = pg_insert(ScreenerSnapshot).values(**values)
                        stmt = stmt.on_conflict_do_update(
                            constraint='uq_screener_snapshot_symbol_date',
                            set_={k: v for k, v in values.items() if k not in ['symbol', 'snapshot_date']}
                        )
                        
                        await session.execute(stmt)
                    
                    await session.commit()
                    total_processed += len(batch_records)
                    logger.info(f"  ✓ Inserted {len(batch_records)} records (errors: {batch_errors})")
                    
            except Exception as e:
                logger.error(f"  ✗ Database error for batch: {e}")
                total_errors += batch_errors
        else:
            logger.warning(f"  ✗ No records in batch (errors: {batch_errors})")
            total_errors += batch_errors
        
        # Small delay between batches to avoid rate limits
        await asyncio.sleep(0.5)
    
    # Step 4: Verify final count
    try:
        async with async_session_maker() as session:
            result = await session.execute(
                select(func.count()).select_from(ScreenerSnapshot)
            )
            final_count = result.scalar()
            
        logger.info("\n" + "=" * 70)
        logger.info("SEEDING COMPLETE")
        logger.info("=" * 70)
        logger.info(f"Records processed: {total_processed}")
        logger.info(f"Errors encountered: {total_errors}")
        logger.info(f"Total in database: {final_count}")
        
        if final_count >= 1600:
            logger.info("✓ SUCCESS: Database fully seeded (1600+ records)")
            return True
        else:
            logger.warning(f"⚠ WARNING: Only {final_count} records, expected 1600+")
            return final_count > 100  # Partial success if we got at least 100
            
    except Exception as e:
        logger.error(f"Failed to verify count: {e}")
        return False

if __name__ == "__main__":
    # Process in batches of 50 stocks at a time
    success = asyncio.run(seed_screener_batch(batch_size=50, max_stocks=None))
    sys.exit(0 if success else 1)
