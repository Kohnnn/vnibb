import asyncio
import logging
import sys
import os
from datetime import date, datetime

# Add parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vnstock import Vnstock
from sqlalchemy.dialects.postgresql import insert as pg_insert
from vnibb.core.database import async_session_maker
from vnibb.models.trading import FinancialRatio
from vnibb.core.config import settings

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

async def seed_metrics(symbols=None):
    if symbols is None:
        symbols = ['VNM', 'FPT', 'HPG', 'VCB', 'VIC', 'MSN']
    
    logger.info(f"Seeding metrics for: {symbols}")
    
    stock_instance = Vnstock()
    source = settings.vnstock_source
    
    async with async_session_maker() as session:
        for symbol in symbols:
            try:
                logger.info(f"Fetching quarterly ratios for {symbol}...")
                stock_obj = stock_instance.stock(symbol=symbol, source=source)
                df = stock_obj.finance.ratio(period='quarter', lang='en')
                
                if df is None or df.empty:
                    logger.warning(f"No ratios found for {symbol}")
                    continue
                
                # Take last 12 quarters
                df = df.head(12)
                
                for _, row in df.iterrows():
                    period_val = row.get('period') or row.get('yearReport') or row.name
                    period_str = str(period_val)
                    
                    # Parse fiscal year/quarter
                    fiscal_year = 0
                    fiscal_quarter = None
                    
                    if '/' in period_str:
                        q_part, y_part = period_str.split('/')
                        fiscal_quarter = int(q_part.replace('Q', ''))
                        fiscal_year = int(y_part)
                    else:
                        try:
                            fiscal_year = int(period_str)
                        except:
                            fiscal_year = datetime.now().year

                    values = {
                        "symbol": symbol,
                        "period": period_str,
                        "period_type": "quarter",
                        "fiscal_year": fiscal_year,
                        "fiscal_quarter": fiscal_quarter,
                        "pe_ratio": float(row.get('P/E', row.get('pe', row.get('priceToEarning', 0))) or 0),
                        "pb_ratio": float(row.get('P/B', row.get('pb', row.get('priceToBook', 0))) or 0),
                        "roe": float(row.get('ROE', row.get('roe', 0)) or 0),
                        "roa": float(row.get('ROA', row.get('roa', 0)) or 0),
                        "gross_margin": float(row.get('Gross Margin', row.get('grossMargin', 0)) or 0),
                        "net_margin": float(row.get('Net Margin', row.get('netMargin', 0)) or 0),
                        "eps": float(row.get('EPS', row.get('eps', 0)) or 0),
                        "source": "vnstock",
                    }
                    
                    stmt = pg_insert(FinancialRatio).values(**values).on_conflict_do_update(
                        constraint='uq_financial_ratio_symbol_period',
                        set_={k: v for k, v in values.items() if k not in ['symbol', 'period', 'period_type']}
                    )
                    await session.execute(stmt)
                
                await session.commit()
                logger.info(f"Seeded {len(df)} quarters for {symbol}")
                
            except Exception as e:
                logger.error(f"Failed to seed {symbol}: {e}")
                await session.rollback()

if __name__ == "__main__":
    # Get symbols from command line if provided
    test_symbols = sys.argv[1:] if len(sys.argv) > 1 else None
    asyncio.run(seed_metrics(test_symbols))
