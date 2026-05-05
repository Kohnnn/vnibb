#!/usr/bin/env python3
"""
Alternative Verification Script for Data Sync Job (Task 064)

This script directly tests the database and service layer without
relying on the API endpoints (which may be blocked by cache warmup).

Tests:
1. Database: Check sync_status table structure
2. Service: Call sync_screener_data() directly
3. Verify sync status is logged
"""

import asyncio
import sys
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from datetime import datetime
from sqlalchemy import select, func
from vnibb.core.database import async_session_maker
from vnibb.models.sync_status import SyncStatus
from vnibb.services.data_pipeline import DataPipeline


async def test_sync_status_table():
    """Test 1: Verify sync_status table exists and has correct structure."""
    print("\n" + "="*70)
    print("TEST 1: Sync Status Table Structure")
    print("="*70)
    
    try:
        async with async_session_maker() as session:
            # Check if table exists and get count
            result = await session.execute(
                select(func.count()).select_from(SyncStatus)
            )
            count = result.scalar()
            print(f"✅ sync_status table exists")
            print(f"   Current records: {count}")
            
            # Get latest sync if any
            if count > 0:
                result = await session.execute(
                    select(SyncStatus).order_by(SyncStatus.started_at.desc()).limit(5)
                )
                syncs = result.scalars().all()
                
                print(f"\n   Latest syncs:")
                for s in syncs:
                    print(f"   - {s.sync_type}: {s.status} (started: {s.started_at})")
            
            return True
    except Exception as e:
        print(f"❌ Failed: {e}")
        return False


async def test_sync_screener_tracking():
    """Test 2: Trigger sync and verify status tracking."""
    print("\n" + "="*70)
    print("TEST 2: Manual Sync with Status Tracking")
    print("="*70)
    print("⏳ Running screener sync (may take 1-2 minutes with rate limits)...")
    
    try:
        # Get initial count
        async with async_session_maker() as session:
            result = await session.execute(
                select(func.count()).select_from(SyncStatus)
            )
            initial_count = result.scalar()
        
        # Create pipeline and run sync
        pipeline = DataPipeline()
        start_time = datetime.utcnow()
        
        print(f"   Starting sync at: {start_time}")
        count = await pipeline.sync_screener_data(limit=50)  # Use small limit for testing
        
        duration = (datetime.utcnow() - start_time).total_seconds()
        print(f"✅ Sync completed in {duration:.1f}s")
        print(f"   Records synced: {count}")
        
        # Verify status was logged
        async with async_session_maker() as session:
            result = await session.execute(
                select(func.count()).select_from(SyncStatus)
            )
            final_count = result.scalar()
            
            if final_count > initial_count:
                print(f"✅ Sync status logged to database")
                print(f"   Status records: {initial_count} → {final_count}")
                
                # Get the latest sync status
                result = await session.execute(
                    select(SyncStatus)
                    .where(SyncStatus.sync_type == "screener")
                    .order_by(SyncStatus.started_at.desc())
                    .limit(1)
                )
                latest = result.scalar_one_or_none()
                
                if latest:
                    print(f"\n   Latest screener sync:")
                    print(f"   - Status: {latest.status}")
                    print(f"   - Started: {latest.started_at}")
                    print(f"   - Completed: {latest.completed_at}")
                    print(f"   - Success count: {latest.success_count}")
                    print(f"   - Error count: {latest.error_count}")
                    
                    if latest.status == "completed":
                        print(f"✅ Sync completed successfully!")
                        return True
                    else:
                        print(f"⚠️  Sync status: {latest.status}")
                        return False
            else:
                print(f"❌ No new sync status record created")
                return False
                
    except Exception as e:
        print(f"❌ Sync failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_screener_data():
    """Test 3: Verify screener data was actually synced."""
    print("\n" + "="*70)
    print("TEST 3: Verify Screener Data in Database")
    print("="*70)
    
    try:
        from vnibb.models.screener import ScreenerSnapshot
        
        async with async_session_maker() as session:
            # Get screener count
            result = await session.execute(
                select(func.count()).select_from(ScreenerSnapshot)
            )
            count = result.scalar()
            
            print(f"   Screener snapshots: {count} records")
            
            if count > 0:
                # Get sample
                result = await session.execute(
                    select(ScreenerSnapshot).limit(3)
                )
                samples = result.scalars().all()
                
                print(f"\n   Sample records:")
                for s in samples:
                    print(f"   - {s.symbol}: PE={s.pe}, PB={s.pb}, ROE={s.roe}")
                
                print(f"✅ Screener data is present")
                return True
            else:
                print(f"⚠️  No screener data found (may need to run sync)")
                return False
                
    except Exception as e:
        print(f"❌ Failed: {e}")
        return False


async def main():
    """Run all tests."""
    print("\n" + "="*70)
    print("🧪 DATA SYNC DIRECT VERIFICATION - TASK 064")
    print("="*70)
    print(f"Testing database and service layer directly")
    print(f"Timestamp: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}")
    
    results = []
    
    # Test 1: Table structure
    result = await test_sync_status_table()
    results.append(("Table Structure", result))
    
    # Test 2: Trigger sync with tracking
    result = await test_sync_screener_tracking()
    results.append(("Sync & Tracking", result))
    
    # Test 3: Verify data
    result = await test_screener_data()
    results.append(("Data Verification", result))
    
    # Summary
    print("\n" + "="*70)
    print("📊 TEST SUMMARY")
    print("="*70)
    for test_name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    all_passed = all(r[1] for r in results)
    
    print("\n" + "="*70)
    if all_passed:
        print("✅ ALL TESTS PASSED - Task 064 Complete!")
    else:
        print("⚠️  SOME TESTS FAILED - Review output above")
    print("="*70 + "\n")
    
    return all_passed


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
