import asyncio
from sqlalchemy import select, func
from vnibb.core.database import async_session_maker
from vnibb.models.screener import ScreenerSnapshot

async def check_count():
    async with async_session_maker() as session:
        result = await session.execute(select(func.count()).select_from(ScreenerSnapshot))
        count = result.scalar()
        print(f"Current screener_snapshots count: {count}")
        
        # Also check some data
        result = await session.execute(select(ScreenerSnapshot).limit(5))
        rows = result.scalars().all()
        for row in rows:
            print(f"Row: {row.symbol}, Date: {row.snapshot_date}, PE: {row.pe}")

if __name__ == "__main__":
    asyncio.run(check_count())
