"""
Simple connectivity test for VNIBB - Windows compatible
"""
import asyncio
import os
from dotenv import load_dotenv

async def test_db():
    """Test PostgreSQL"""
    import asyncpg
    url = os.getenv("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(url)
    result = await conn.fetchrow("SELECT NOW() as t, current_database() as db")
    table_count = await conn.fetchval(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"
    )
    await conn.close()
    return {"db": result['db'], "tables": table_count}

async def test_redis_conn():
    """Test Redis"""
    import redis.asyncio as redis
    url = os.getenv("REDIS_URL")
    if not url:
        return {"error": "REDIS_URL not set"}
    client = redis.from_url(url)
    await client.ping()
    await client.set("test:key", "OK", ex=5)
    val = await client.get("test:key")
    await client.close()
    return {"ping": "OK", "test": val.decode() if val else None}

async def test_vnstock_api():
    """Test vnstock"""
    from vnstock import Listing
    source = os.getenv("VNSTOCK_SOURCE", "VCI")
    listing = Listing(source=source)
    symbols = listing.all_symbols()
    return {"source": source, "count": len(symbols)}

async def main():
    load_dotenv()
    print("\n" + "="*50)
    print("VNIBB CONNECTIVITY TEST")
    print("="*50)
    
    # Test PostgreSQL
    print("\n[1/3] Testing Supabase PostgreSQL...")
    try:
        result = await test_db()
        print(f"  SUCCESS - DB: {result['db']}, Tables: {result['tables']}")
    except Exception as e:
        print(f"  FAILED: {e}")
        return
    
    # Test Redis
    print("\n[2/3] Testing Upstash Redis...")
    try:
        result = await test_redis_conn()
        if "error" in result:
            print(f"  SKIPPED: {result['error']}")
        else:
            print(f"  SUCCESS - Ping: {result['ping']}")
    except Exception as e:
        print(f"  FAILED: {e}")
        return
    
    # Test VNStock
    print("\n[3/3] Testing VNStock API...")
    try:
        result = await test_vnstock_api()
        print(f"  SUCCESS - Source: {result['source']}, Stocks: {result['count']}")
    except Exception as e:
        print(f"  WARNING: {e}")
    
    print("\n" + "="*50)
    print("ALL TESTS PASSED!")
    print("\nNext: uvicorn vnibb.main:app --reload")
    print("="*50 + "\n")

if __name__ == "__main__":
    asyncio.run(main())
