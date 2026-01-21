"""
vnstock Golden Sponsor API Benchmark - Simplified Version
"""

import os
from datetime import datetime, date, timedelta

os.environ['VNSTOCK_API_KEY'] = 'vnstock_302001130d626a7d4fa55a37776ef49c'

from vnstock import Vnstock

def test_api(name, func, *args, **kwargs):
    """Test a single API and print results."""
    try:
        start = datetime.now()
        result = func(*args, **kwargs)
        elapsed = (datetime.now() - start).total_seconds() * 1000
        
        if result is not None and hasattr(result, 'shape'):
            rows, cols = result.shape
            print(f"✅ {name}: {rows} rows x {cols} cols ({elapsed:.0f}ms)")
            if cols > 0:
                print(f"   Columns: {list(result.columns)[:8]}...")
            return True
        elif result is not None:
            print(f"✅ {name}: {type(result).__name__} ({elapsed:.0f}ms)")
            return True
        else:
            print(f"⚠️ {name}: Empty/None")
            return False
    except Exception as e:
        print(f"❌ {name}: {str(e)[:80]}")
        return False

print("=" * 60)
print("vnstock Golden Sponsor API Benchmark")
print("=" * 60)
print(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

vnstock = Vnstock()
stock = vnstock.stock(symbol="FPT", source="VCI")

# Dates
start_date = (date.today() - timedelta(days=30)).strftime('%Y-%m-%d')
end_date = date.today().strftime('%Y-%m-%d')

results = {"ok": 0, "err": 0}

print("\n📋 LISTING APIs")
print("-" * 40)
if test_api("all_symbols()", stock.listing.all_symbols): results["ok"] += 1
else: results["err"] += 1

if test_api("symbols_by_exchange('hose')", stock.listing.symbols_by_exchange, 'hose'): results["ok"] += 1
else: results["err"] += 1

if test_api("symbols_by_group('VN30')", stock.listing.symbols_by_group, 'VN30'): results["ok"] += 1
else: results["err"] += 1

print("\n📈 QUOTE APIs")
print("-" * 40)
if test_api("quote.history()", stock.quote.history, start=start_date, end=end_date): results["ok"] += 1
else: results["err"] += 1

if test_api("quote.intraday()", stock.quote.intraday): results["ok"] += 1
else: results["err"] += 1

if test_api("quote.price_depth()", stock.quote.price_depth): results["ok"] += 1
else: results["err"] += 1

print("\n🏢 COMPANY APIs")
print("-" * 40)
if test_api("company.overview()", stock.company.overview): results["ok"] += 1
else: results["err"] += 1

if test_api("company.profile()", stock.company.profile): results["ok"] += 1
else: results["err"] += 1

if test_api("company.shareholders()", stock.company.shareholders): results["ok"] += 1
else: results["err"] += 1

if test_api("company.officers()", stock.company.officers): results["ok"] += 1
else: results["err"] += 1

if test_api("company.subsidiaries()", stock.company.subsidiaries): results["ok"] += 1
else: results["err"] += 1

if test_api("company.news()", stock.company.news): results["ok"] += 1
else: results["err"] += 1

if test_api("company.events()", stock.company.events): results["ok"] += 1
else: results["err"] += 1

if test_api("company.dividends()", stock.company.dividends): results["ok"] += 1
else: results["err"] += 1

if test_api("company.insider_deals()", stock.company.insider_deals): results["ok"] += 1
else: results["err"] += 1

print("\n💰 FINANCE APIs")
print("-" * 40)
if test_api("finance.balance_sheet()", stock.finance.balance_sheet, period='year'): results["ok"] += 1
else: results["err"] += 1

if test_api("finance.income_statement()", stock.finance.income_statement, period='year'): results["ok"] += 1
else: results["err"] += 1

if test_api("finance.cash_flow()", stock.finance.cash_flow, period='year'): results["ok"] += 1
else: results["err"] += 1

if test_api("finance.ratio()", stock.finance.ratio, period='year'): results["ok"] += 1
else: results["err"] += 1

print("\n🔄 TRADING APIs")
print("-" * 40)
try:
    from vnstock import Trading
    trading = Trading()
    if test_api("price_board(['FPT','VNM'])", trading.price_board, symbols_list=['FPT', 'VNM']): results["ok"] += 1
    else: results["err"] += 1
except Exception as e:
    print(f"❌ Trading: {str(e)[:80]}")
    results["err"] += 1

print("\n" + "=" * 60)
print("📊 SUMMARY")
print("=" * 60)
print(f"✅ OK: {results['ok']}")
print(f"❌ Error/Empty: {results['err']}")
print(f"Total: {results['ok'] + results['err']} APIs tested")
