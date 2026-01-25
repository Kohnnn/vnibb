import psycopg2
import sys

DB_URL = "postgresql://postgres.cbatjktmwtbhelgtweoi:9jvbkc83su2llhEx@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"

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
