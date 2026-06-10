import os
import sys

import psycopg2

# Operator script: requires DATABASE_URL_SYNC (or DATABASE_URL) in the environment.
DB_URL = os.environ.get("DATABASE_URL_SYNC") or os.environ.get("DATABASE_URL")
if not DB_URL:
    print("❌ Set DATABASE_URL_SYNC (or DATABASE_URL) before running this script.")
    sys.exit(1)

print("Connecting to database...")
try:
    conn = psycopg2.connect(DB_URL)
    conn.set_session(autocommit=True)
    cur = conn.cursor()

    # Get all tables in public schema
    cur.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    """)
    tables = [t[0] for t in cur.fetchall()]

    if tables:
        print(f"Found {len(tables)} tables. Dropping...")
        for t in tables:
            print(f"  - Dropping {t}...")
            # Use CASCADE to handle dependencies
            cur.execute(f'DROP TABLE "{t}" CASCADE')
        print("✅ All tables dropped.")
    else:
        print("✅ Database is already empty.")

    conn.close()

except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
