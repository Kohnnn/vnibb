import os
import sys

import psycopg2

# Operator script: requires DATABASE_URL_SYNC (or DATABASE_URL) in the environment.
DB_URL = os.environ.get("DATABASE_URL_SYNC") or os.environ.get("DATABASE_URL")
if not DB_URL:
    print("❌ Set DATABASE_URL_SYNC (or DATABASE_URL) before running this script.")
    sys.exit(1)

print("Connecting to clean types...")
try:
    conn = psycopg2.connect(DB_URL)
    conn.set_session(autocommit=True)
    cur = conn.cursor()

    # Drop custom types (enums)
    cur.execute("""
        SELECT t.typname
        FROM pg_type t
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' 
        AND t.typtype = 'e' -- Enum types
    """)
    types = [t[0] for t in cur.fetchall()]

    if types:
        print(f"Found {len(types)} enum types. Dropping...")
        for t in types:
            print(f"  - Dropping Type {t}...")
            cur.execute(f'DROP TYPE "{t}" CASCADE')
        print("✅ Types dropped.")
    else:
        print("✅ No custom types found.")

    conn.close()

except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
