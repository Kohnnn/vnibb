import asyncio
import sys
import os
from datetime import datetime

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from vnibb.core.database import async_session_maker
from vnibb.models.sync_status import SyncStatus
from sqlalchemy import select

from vnibb.services.data_pipeline import data_pipeline

async def verify_sync_status():
    """Verify that sync status records are created."""
    print("Triggering screener sync (test limit=10)...")
    try:
        # Run a small sync to generate a status record
        await data_pipeline.sync_screener_data(exchanges=['HOSE'], limit=10)
    except Exception as e:
        print(f"Sync failed (expected/unexpected): {e}")

    print("\nChecking for recent sync status records...")
    
    async with async_session_maker() as session:
        # Get latest sync status
        stmt = select(SyncStatus).order_by(SyncStatus.started_at.desc()).limit(5)
        result = await session.execute(stmt)
        statuses = result.scalars().all()
        
        if not statuses:
            print("No sync status records found.")
            return
            
        print(f"Found {len(statuses)} recent sync records:")
        for s in statuses:
            print(f"- [{s.status.upper()}] {s.sync_type} (Started: {s.started_at})")
            if s.status == 'completed':
                print(f"  Success: {s.success_count}, Errors: {s.error_count}")
            elif s.status == 'failed':
                print(f"  Error: {s.errors}")

if __name__ == "__main__":
    asyncio.run(verify_sync_status())
