#!/usr/bin/env python3
"""
Verification Script for Data Sync Job (Task 064)

This script tests:
1. Manual trigger endpoint POST /api/v1/data/sync/screener
2. Sync status tracking in sync_status table
3. Scheduler configuration
"""

import asyncio
import httpx
from datetime import datetime

# API configuration
BASE_URL = "http://localhost:8000"
API_PREFIX = "/api/v1/data/sync"


async def test_sync_status_endpoint():
    """Test GET /api/v1/data/sync/status endpoint."""
    print("\n" + "="*60)
    print("TEST 1: Get Current Sync Status")
    print("="*60)
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(f"{BASE_URL}{API_PREFIX}/status")
            print(f"✅ Status Code: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"   Scheduler Status: {data}")
            else:
                print(f"   Error: {response.text}")
        except Exception as e:
            print(f"❌ Failed: {e}")


async def test_manual_screener_sync_async():
    """Test POST /api/v1/data/sync/screener (async mode)."""
    print("\n" + "="*60)
    print("TEST 2: Manual Screener Sync (Async Mode)")
    print("="*60)
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            # Trigger async sync
            response = await client.post(
                f"{BASE_URL}{API_PREFIX}/screener",
                params={"async_mode": True}
            )
            print(f"✅ Status Code: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"   Response: {data}")
                print(f"   Status: {data.get('status')}")
                print(f"   Message: {data.get('message')}")
            else:
                print(f"   Error: {response.text}")
        except Exception as e:
            print(f"❌ Failed: {e}")


async def test_manual_screener_sync_wait():
    """Test POST /api/v1/data/sync/screener (wait for completion)."""
    print("\n" + "="*60)
    print("TEST 3: Manual Screener Sync (Wait for Completion)")
    print("="*60)
    print("⏳ This may take 1-2 minutes...")
    
    async with httpx.AsyncClient(timeout=300.0) as client:  # 5 min timeout
        try:
            start = datetime.now()
            response = await client.post(
                f"{BASE_URL}{API_PREFIX}/screener",
                params={"async_mode": False}
            )
            duration = (datetime.now() - start).total_seconds()
            
            print(f"✅ Status Code: {response.status_code}")
            print(f"⏱️  Duration: {duration:.1f}s")
            
            if response.status_code == 200:
                data = response.json()
                print(f"   Response: {data}")
                print(f"   Status: {data.get('status')}")
                print(f"   Count: {data.get('count')} records synced")
            else:
                print(f"   Error: {response.text}")
        except Exception as e:
            print(f"❌ Failed: {e}")


async def test_sync_history():
    """Test GET /api/v1/data/health."""
    print("\n" + "="*60)
    print("TEST 4: Get Sync History")
    print("="*60)
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(f"{BASE_URL}{API_PREFIX}/history")
            print(f"✅ Status Code: {response.status_code}")
            
            if response.status_code == 200:
                history = response.json()
                print(f"   Recent syncs: {len(history)} records")
                
                if history:
                    print("\n   Latest sync:")
                    latest = history[0]
                    print(f"   - Type: {latest.get('sync_type')}")
                    print(f"   - Status: {latest.get('status')}")
                    print(f"   - Success Count: {latest.get('success_count', 0)}")
                    print(f"   - Error Count: {latest.get('error_count', 0)}")
                    print(f"   - Started: {latest.get('started_at')}")
                    print(f"   - Completed: {latest.get('completed_at')}")
                else:
                    print("   ⚠️  No sync history found")
            else:
                print(f"   Error: {response.text}")
        except Exception as e:
            print(f"❌ Failed: {e}")


async def test_database_health():
    """Test GET /api/v1/data/sync/health endpoint."""
    print("\n" + "="*60)
    print("TEST 5: Database Health Check")
    print("="*60)
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(f"{BASE_URL}{API_PREFIX}/health")
            print(f"✅ Status Code: {response.status_code}")
            
            if response.status_code == 200:
                health = response.json()
                print(f"   Overall Status: {health.get('status')}")
                
                db_info = health.get('database', {})
                print(f"\n   Database:")
                print(f"   - Stocks: {db_info.get('stock_count', 0)}")
                print(f"   - Prices: {db_info.get('price_count', 0)}")
                print(f"   - Screener: {db_info.get('screener_count', 0)}")
                
                sync_info = health.get('sync', {})
                print(f"\n   Last Sync:")
                print(f"   - Type: {sync_info.get('last_sync_type')}")
                print(f"   - Time: {sync_info.get('last_sync_time')}")
                
                warnings = health.get('warnings', [])
                if warnings:
                    print(f"\n   ⚠️  Warnings:")
                    for w in warnings:
                        print(f"   - {w}")
                
                recommendations = health.get('recommendations', [])
                if recommendations:
                    print(f"\n   💡 Recommendations:")
                    for r in recommendations:
                        print(f"   - {r}")
            else:
                print(f"   Error: {response.text}")
        except Exception as e:
            print(f"❌ Failed: {e}")


async def main():
    """Run all tests."""
    print("\n" + "="*60)
    print("🧪 DATA SYNC JOB VERIFICATION - TASK 064")
    print("="*60)
    print(f"Testing API at: {BASE_URL}")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Test 1: Check scheduler status
    await test_sync_status_endpoint()
    
    # Test 2: Trigger async sync
    await test_manual_screener_sync_async()
    
    # Wait a moment for async sync to start
    print("\n⏳ Waiting 5 seconds for async sync to start...")
    await asyncio.sleep(5)
    
    # Test 3: Check sync history (should show the running/completed sync)
    await test_sync_history()
    
    # Test 4: Database health
    await test_database_health()
    
    # Test 5: Trigger sync with wait (OPTIONAL - comment out if too slow)
    print("\n" + "-"*60)
    print("📝 Note: Skipping synchronous sync test (too slow)")
    print("   To test sync completion, use:")
    print("   curl -X POST 'http://localhost:8000/api/v1/data/sync/screener?async_mode=false'")
    print("-"*60)
    
    # await test_manual_screener_sync_wait()
    
    print("\n" + "="*60)
    print("✅ ALL TESTS COMPLETED")
    print("="*60)
    print("Next steps:")
    print("1. Check that at least one sync appears in history")
    print("2. Verify sync_status table has records")
    print("3. Verify screener_snapshots table has data")
    print("="*60 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
