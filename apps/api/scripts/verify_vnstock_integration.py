#!/usr/bin/env python3
"""
Vnstock Library Integration Verification Script

This script tests:
1. Database connection and table row counts
2. Vnstock library connectivity
3. Data pipeline functionality
4. Comparison of vnstock APIs vs database schema
"""

import asyncio
import sys
from datetime import datetime


def print_section(title: str):
    """Print a section header."""
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}\n")


# =============================================================================
# 1. DATABASE VERIFICATION
# =============================================================================

def check_database():
    """Check database tables and row counts."""
    print_section("1. DATABASE VERIFICATION")

    try:
        from sqlalchemy import create_engine, inspect, text

        from vnibb.core.config import settings

        engine = create_engine(settings.sync_database_url)
        inspector = inspect(engine)

        tables = inspector.get_table_names(schema='public')
        print("✓ Database connected successfully")
        print(f"✓ Found {len(tables)} tables\n")

        # Get row counts
        results = {}
        with engine.connect() as conn:
            for table in sorted(tables):
                try:
                    result = conn.execute(text(f'SELECT COUNT(*) FROM "{table}"'))
                    count = result.scalar()
                    results[table] = count
                    status = "✓" if count > 0 else "○"
                    print(f"  {status} {table}: {count:,} rows")
                except Exception as e:
                    print(f"  ✗ {table}: ERROR - {e}")
                    results[table] = -1

        # Summary
        print("\n  Summary:")
        tables_with_data = sum(1 for v in results.values() if v > 0)
        total_rows = sum(v for v in results.values() if v > 0)
        print(f"    - Tables with data: {tables_with_data}/{len(tables)}")
        print(f"    - Total records: {total_rows:,}")

        return results

    except Exception as e:
        print(f"✗ Database connection failed: {e}")
        return {}


# =============================================================================
# 2. VNSTOCK LIBRARY VERIFICATION
# =============================================================================

def check_vnstock_library():
    """Verify vnstock library is installed and working."""
    print_section("2. VNSTOCK LIBRARY VERIFICATION")

    results = {
        "installed": False,
        "version": None,
        "modules": {},
    }

    from vnibb.providers.vnstock.runtime import import_vnstock_symbol

    # Check installation through the runtime policy before importing vnstock.
    try:
        results["version"], _ = import_vnstock_symbol("__version__")
        results["installed"] = True
        print(f"✓ vnstock installed (version: {results['version']})")
    except Exception as e:
        print(f"✗ vnstock unavailable: {e}")
        return results

    # Check available modules
    modules_to_check = [
        ("Listing", "vnstock", "Listing"),
        ("Quote", "vnstock", "Quote"),
        ("Company", "vnstock", "Company"),
        ("Finance", "vnstock", "Finance"),
        ("Trading", "vnstock", "Trading"),
        ("Fund", "vnstock", "Fund"),
    ]

    print("\n  Available modules:")
    for name, module_name, class_name in modules_to_check:
        try:
            import_vnstock_symbol(class_name)
            results["modules"][name] = True
            print(f"    ✓ {name}")
        except Exception as e:
            results["modules"][name] = False
            print(f"    ✗ {name}: {e}")

    return results


def test_vnstock_apis():
    """Test basic vnstock API calls."""
    print_section("3. VNSTOCK API TESTS")

    default_source = "VCI"
    print(f"  Using data source: {default_source}\n")

    results = {}

    # Test 1: Listing.all_symbols()
    print("  Testing Listing API...")
    try:
        from vnibb.providers.vnstock.runtime import get_listing_class
        listing = get_listing_class()(source=default_source)
        df = listing.all_symbols()
        results["listing_all_symbols"] = len(df) if df is not None else 0
        print(f"    ✓ all_symbols(): {len(df)} stocks")
    except Exception as e:
        results["listing_all_symbols"] = 0
        print(f"    ✗ all_symbols() failed: {e}")

    # Test 2: Stock quote for a sample symbol
    print("\n  Testing Quote API (VCB)...")
    try:
        from vnibb.providers.vnstock.runtime import get_quote_class
        quote = get_quote_class()(symbol='VCB', source=default_source)
        df = quote.history(start='2024-01-01', end='2024-01-31')
        results["quote_history"] = len(df) if df is not None else 0
        print(f"    ✓ quote.history(): {len(df)} price records")
    except Exception as e:
        results["quote_history"] = 0
        print(f"    ✗ quote.history() failed: {e}")

    # Test 3: Company overview
    print("\n  Testing Company API (VCB)...")
    try:
        from vnibb.providers.vnstock.runtime import get_company_class
        company = get_company_class()(symbol='VCB', source=default_source)
        overview = company.overview()
        has_data = overview is not None and (not hasattr(overview, 'empty') or not overview.empty)
        results["company_overview"] = 1 if has_data else 0
        print("    ✓ company.overview(): data retrieved")
    except Exception as e:
        results["company_overview"] = 0
        print(f"    ✗ company.overview() failed: {e}")

    # Test 4: Financial statements
    print("\n  Testing Finance API (VCB)...")
    try:
        from vnibb.providers.vnstock.runtime import get_finance_class
        finance = get_finance_class()(symbol='VCB', source=default_source)
        bs = finance.balance_sheet(period='year', lang='en')
        has_data = bs is not None and (not hasattr(bs, 'empty') or not bs.empty)
        results["finance_balance_sheet"] = 1 if has_data else 0
        print("    ✓ finance.balance_sheet(): data retrieved")
    except Exception as e:
        results["finance_balance_sheet"] = 0
        print(f"    ✗ finance.balance_sheet() failed: {e}")


    return results


# =============================================================================
# 4. DATA PIPELINE VERIFICATION
# =============================================================================

async def test_data_pipeline():
    """Test the data pipeline sync functions."""
    print_section("4. DATA PIPELINE VERIFICATION")

    try:
        from vnibb.services.data_pipeline import DataPipeline
        pipeline = DataPipeline()

        print("  Testing sync_stock_list()...")
        count = await pipeline.sync_stock_list()
        print(f"    ✓ Synced {count} stocks to database")

        return {"sync_stock_list": count}

    except Exception as e:
        print(f"    ✗ Data pipeline test failed: {e}")
        return {"error": str(e)}


# =============================================================================
# 5. VNSTOCK API COVERAGE COMPARISON
# =============================================================================

def compare_vnstock_vs_database():
    """Compare vnstock API capabilities vs database schema."""
    print_section("5. VNSTOCK API vs DATABASE COVERAGE")

    # Define vnstock API capabilities
    vnstock_apis = {
        "Listing": [
            "all_symbols", "symbols_by_exchange", "symbols_by_industries",
            "symbols_by_group", "industries_icb", "all_indices", "indices_by_group"
        ],
        "Quote": ["history", "intraday", "price_depth"],
        "Company": [
            "overview", "profile", "shareholders", "subsidiaries", "officers",
            "events", "insider_trading", "trading_stats"
        ],
        "Finance": ["balance_sheet", "income_statement", "cash_flow", "ratio"],
        "Trading": ["price_board", "foreign_trade", "insider_deal"],
        "Fund": ["listing", "filter", "top_holding", "nav_report"],
    }

    # Database tables mapped to vnstock APIs
    database_mapping = {
        "stocks": ["Listing.all_symbols", "Listing.symbols_by_exchange"],
        "stock_prices": ["Quote.history"],
        "stock_indices": ["Quote.history (indices)", "Listing.all_indices"],
        "intraday_trades": ["Quote.intraday"],
        "orderbook_snapshots": ["Quote.price_depth"],
        "companies": ["Company.overview", "Company.profile"],
        "shareholders": ["Company.shareholders"],
        "officers": ["Company.officers"],
        "subsidiaries": ["Company.subsidiaries"],
        "company_news": ["vnstock_news (separate package)"],
        "company_events": ["Company.events"],
        "dividends": ["Company.events"],
        "insider_deals": ["Company.insider_trading"],
        "income_statements": ["Finance.income_statement"],
        "balance_sheets": ["Finance.balance_sheet"],
        "cash_flows": ["Finance.cash_flow"],
        "financial_ratios": ["Finance.ratio"],
        "screener_snapshots": ["application screener aggregation"],
        "foreign_trading": ["Trading.foreign_trade"],
        "market_sectors": ["Listing.industries_icb", "Listing.symbols_by_industries"],
        "sector_performance": ["application screener aggregation"],
        "technical_indicators": ["derived from Quote.history + calculation"],
        "market_news": ["vnstock_news (separate package)"],
    }

    # APIs NOT implemented in database
    missing_tables = {
        "Fund": ["No fund-related tables - Fund.listing, Fund.filter, Fund.top_holding, Fund.nav_report"],
    }

    print("  Database Tables → Vnstock APIs:")
    for table, apis in database_mapping.items():
        print(f"    • {table}")
        for api in apis:
            print(f"        ← {api}")

    print("\n  ⚠️ Not implemented in database:")
    for category, items in missing_tables.items():
        print(f"    • {category}:")
        for item in items:
            print(f"        - {item}")

    # Count API coverage
    total_apis = sum(len(apis) for apis in vnstock_apis.values())
    covered_apis = sum(len(apis) for apis in database_mapping.values())

    print("\n  Coverage Summary:")
    print(f"    - Total vnstock APIs: ~{total_apis}")
    print(f"    - Database table mappings: {len(database_mapping)}")
    print(f"    - Missing categories: {len(missing_tables)}")


def main():
    """Main entry point."""
    print("\n" + "="*60)
    print("  VNSTOCK INTEGRATION VERIFICATION")
    print("  " + datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    print("="*60)

    # 1. Database check
    db_results = check_database()

    # 2. Vnstock library check
    lib_results = check_vnstock_library()

    # 3. API tests (optional - requires network)
    run_api_tests = "--api" in sys.argv
    if run_api_tests:
        api_results = test_vnstock_apis()
    else:
        print_section("3. VNSTOCK API TESTS")
        print("  ⚠️ Skipped (run with --api flag to enable)")

    # 4. Data pipeline test (optional)
    run_pipeline_test = "--pipeline" in sys.argv
    if run_pipeline_test:
        pipeline_results = asyncio.run(test_data_pipeline())
    else:
        print_section("4. DATA PIPELINE VERIFICATION")
        print("  ⚠️ Skipped (run with --pipeline flag to enable)")

    # 5. Coverage comparison
    compare_vnstock_vs_database()

    # Final summary
    print_section("SUMMARY")
    print(f"  Database: {len(db_results)} tables found")
    print(f"  Vnstock: {'✓' if lib_results.get('installed') else '✗'} installed")
    print(f"  Modules: {sum(lib_results.get('modules', {}).values())}/{len(lib_results.get('modules', {}))}")

    if run_api_tests:
        print(f"  API Tests: {sum(1 for v in api_results.values() if v > 0)}/{len(api_results)} passed")

    print("\n  Run with flags:")
    print("    --api       Run vnstock API tests")
    print("    --pipeline  Run data pipeline sync test")
    print()


if __name__ == "__main__":
    main()
