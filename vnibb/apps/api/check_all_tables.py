"""Check all database tables and their row counts."""
from sqlalchemy import create_engine, text, inspect
from vnibb.core.config import settings

def check_tables():
    engine = create_engine(settings.sync_database_url)
    inspector = inspect(engine)
    
    tables = inspector.get_table_names(schema='public')
    print(f"Found {len(tables)} tables in database:\n")
    
    with engine.connect() as conn:
        for table in sorted(tables):
            try:
                result = conn.execute(text(f'SELECT COUNT(*) FROM "{table}"'))
                count = result.scalar()
                print(f"  {table}: {count} rows")
            except Exception as e:
                print(f"  {table}: ERROR - {e}")

if __name__ == "__main__":
    check_tables()
