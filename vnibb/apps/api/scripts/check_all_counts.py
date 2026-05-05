import asyncio
from sqlalchemy import select, func
from vnibb.core.database import async_session_maker
from vnibb.models.stock import Stock, StockPrice, StockIndex
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.company import Company

async def check_all_counts():
    tables = [
        ("stocks", Stock),
        ("stock_prices", StockPrice),
        ("stock_indices", StockIndex),
        ("screener_snapshots", ScreenerSnapshot),
        ("companies", Company)
    ]
    
    async with async_session_maker() as session:
        for name, model in tables:
            try:
                result = await session.execute(select(func.count()).select_from(model))
                count = result.scalar()
                print(f"Table {name:20} count: {count}")
            except Exception as e:
                print(f"Error checking {name}: {e}")

if __name__ == "__main__":
    asyncio.run(check_all_counts())
