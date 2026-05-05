"""Database verification script for Phase 31."""
import sqlite3
import os
from datetime import datetime

def check_database():
    """Check database structure and content."""
    print("="*60)
    print("PHASE 31: DATABASE VERIFICATION")
    print("="*60)
    
    # 1. Check file exists
    db_path = "test.db"
    if not os.path.exists(db_path):
        print("❌ Database file not found!")
        return False
    
    file_size = os.path.getsize(db_path)
    print(f"✅ Database file exists: {file_size:,} bytes")
    
    # 2. Connect and check tables
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [t[0] for t in cursor.fetchall()]
    
    print(f"\n📊 Found {len(tables)} tables:")
    
    # Get row counts
    table_info = []
    for table in sorted(tables):
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            table_info.append((table, count))
            status = "✅" if count > 0 else "⚠️ "
            print(f"  {status} {table}: {count:,} rows")
        except Exception as e:
            print(f"  ❌ {table}: Error - {e}")
    
    # 3. Summary
    total_rows = sum(count for _, count in table_info)
    empty_tables = sum(1 for _, count in table_info if count == 0)
    
    print("\n" + "="*60)
    print(f"📈 SUMMARY:")
    print(f"  Total tables: {len(tables)}")
    print(f"  Total rows: {total_rows:,}")
    print(f"  Empty tables: {empty_tables}")
    print("="*60)
    
    conn.close()
    return True


def check_vnstock():
    """Check VNStock connection."""
    print("\n🔄 Testing VNStock connection...")
    try:
        from vnstock import Listing
        listing = Listing(source="KBS")
        df = listing.all_symbols()
        print(f"✅ VNStock connected: {len(df):,} symbols available")
        return True
    except Exception as e:
        print(f"❌ VNStock error: {e}")
        return False


if __name__ == "__main__":
    check_database()
    check_vnstock()
