import psycopg2
import sys

# Hardcoded for now based on previous verification
DB_URL = "postgresql://postgres.cbatjktmwtbhelgtweoi:9jvbkc83su2llhEx@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"

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
