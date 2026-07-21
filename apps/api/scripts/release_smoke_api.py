import asyncio
import os

import uvicorn
from sqlalchemy import select

os.environ.update(
    {
        "ENVIRONMENT": "test",
        "DATABASE_URL": "sqlite+aiosqlite:////tmp/vnibb-release-smoke.db",
        "DATABASE_URL_SYNC": "sqlite+aiosqlite:////tmp/vnibb-release-smoke.db",
        "REDIS_URL": "",
        "REDIS_HOST": "",
        "REDIS_PORT": "0",
        "MONGODB_ENABLED": "false",
        "APPWRITE_ENDPOINT": "",
        "APPWRITE_PROJECT_ID": "",
        "APPWRITE_API_KEY": "",
        "APPWRITE_DATABASE_ID": "",
        "APPWRITE_WRITE_ENABLED": "false",
        "SKIP_SCHEDULER_STARTUP": "1",
        "SKIP_WEBSOCKET_STARTUP": "1",
        "SKIP_WARMUP": "true",
    }
)

from vnibb import models
from vnibb.api.main import app
from vnibb.core.database import Base, async_session_maker, engine


async def prepare_database() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with async_session_maker() as session:
        stock = await session.scalar(
            select(models.Stock).where(models.Stock.symbol == "VCB")
        )
        if stock is None:
            session.add(models.Stock(symbol="VCB", company_name="Vietcombank", exchange="HOSE"))
            await session.commit()


if __name__ == "__main__":
    asyncio.run(prepare_database())
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
