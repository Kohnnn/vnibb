import asyncio
from vnibb.core.database import async_session_maker
from vnibb.models import StockIndex
from sqlalchemy import select, desc

async def check_data():
    async with async_session_maker() as s:
        res = await s.execute(select(StockIndex.time).order_by(desc(StockIndex.time)).limit(1))
        latest = res.scalar()
        print(f"Latest market date: {latest}")

if __name__ == "__main__":
    asyncio.run(check_data())
