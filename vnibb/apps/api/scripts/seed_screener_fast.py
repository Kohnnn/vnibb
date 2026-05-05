import asyncio
import logging
import sys
import os
from datetime import date, datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

# Add parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vnstock import Vnstock, Listing
from sqlalchemy.dialects.postgresql import insert as pg_insert
from vnibb.core.database import async_session_maker
from vnibb.models.screener import ScreenerSnapshot

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def fetch_single_stock(symbol, stock_instance):
    try:
        stock_obj = stock_instance.stock(symbol=symbol, source='VCI')
        df = stock_obj.company.ratio_summary()
        if df is not None and not df.empty:
            record = df.head(1).to_dict("records")[0]
            record['symbol'] = symbol
            return record
    except Exception:
        pass
    return None

async def seed_fast():
    logger.info("Starting fast screener seeding...")
    
    listing = Listing(source='VCI')
    symbols_df = listing.all_symbols()
    if symbols_df is None or symbols_df.empty:
        logger.error("No symbols found")
        return
    
    all_symbols = symbols_df['symbol'].tolist()
    logger.info(f"Total symbols to process: {len(all_symbols)}")
    
    stock_instance = Vnstock()
    batch_size = 100
    today = date.today()
    
    for i in range(0, len(all_symbols), batch_size):
        batch_symbols = all_symbols[i:i+batch_size]
        logger.info(f"Processing symbols {i+1} to {min(i+batch_size, len(all_symbols))}")
        
        records = []
        with ThreadPoolExecutor(max_workers=20) as executor:
            future_to_symbol = {executor.submit(fetch_single_stock, s, stock_instance): s for s in batch_symbols}
            for future in as_completed(future_to_symbol):
                res = future.result()
                if res:
                    records.append(res)
        
        if records:
            async with async_session_maker() as session:
                for idx, record in enumerate(records):
                    values = {
                        "symbol": record['symbol'],
                        "snapshot_date": today,
                        "market_cap": record.get('market_cap'),
                        "pe": record.get('pe'),
                        "pb": record.get('pb'),
                        "roe": record.get('roe'),
                        "roa": record.get('roa'),
                        "exchange": record.get('exchange'),
                        "industry": record.get('industry_name'),
                        "eps": record.get('eps')
                    }
                    # Filter out None
                    values = {k: v for k, v in values.items() if v is not None}
                    
                    stmt = pg_insert(ScreenerSnapshot).values(**values).on_conflict_do_update(
                        constraint='uq_screener_snapshot_symbol_date',
                        set_={k: v for k, v in values.items() if k not in ['symbol', 'snapshot_date']}
                    )
                    await session.execute(stmt)
                    if (idx + 1) % 10 == 0:
                        await session.commit()
                await session.commit()
            logger.info(f"Inserted {len(records)} records")
        
        # Small sleep to avoid overwhelming provider even with parallel
        await asyncio.sleep(1)

if __name__ == "__main__":
    asyncio.run(seed_fast())
