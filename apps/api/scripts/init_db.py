import asyncio
import os
import sys
from dotenv import load_dotenv

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load env before importing models
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))

from vnibb.core.database import engine, Base
from vnibb.models import * # Import all models

async def init_db():
    print("🚀 Initializing database...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("✅ Database initialized successfully.")

if __name__ == "__main__":
    asyncio.run(init_db())
