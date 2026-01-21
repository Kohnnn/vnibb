"""Quick API verification script for task_065"""
import requests
import time
import json

BASE_URL = "http://localhost:8000"

def test_endpoint(name, url, timeout=5):
    """Test a single API endpoint"""
    try:
        start = time.time()
        response = requests.get(url, timeout=timeout)
        elapsed = time.time() - start
        
        status = "✅ PASS" if response.status_code == 200 else f"❌ FAIL ({response.status_code})"
        print(f"{status} | {name:30} | {elapsed*1000:6.0f}ms | {url}")
        
        if response.status_code == 200:
            try:
                data = response.json()
                return True, data
            except:
                return True, response.text
        else:
            return False, response.text
    except requests.Timeout:
        print(f"⏱️  TIMEOUT | {name:30} | >5000ms | {url}")
        return False, "Timeout"
    except Exception as e:
        print(f"❌ ERROR | {name:30} | N/A | {url}")
        print(f"   Error: {str(e)}")
        return False, str(e)

print("=" * 80)
print("VNIBB API Verification - Task 065")
print("=" * 80)

# Test 1: Health check
print("\n📋 Backend Health Check:")
test_endpoint("API Docs", f"{BASE_URL}/docs")
test_endpoint("Health Check", f"{BASE_URL}/api/v1/health")

# Test 2: Core endpoints
print("\n📊 Core API Endpoints:")
success, data = test_endpoint("VNM Quote", f"{BASE_URL}/api/v1/equity/VNM/quote")
if success and isinstance(data, dict):
    print(f"   → Price: {data.get('price', 'N/A')}, Change: {data.get('percent_change', 'N/A')}%")

success, data = test_endpoint("Screener (limit=10)", f"{BASE_URL}/api/v1/screener/?limit=10")
if success and isinstance(data, dict):
    results = data.get('results', [])
    print(f"   → Returned {len(results)} stocks")

# Test 3: Performance check
print("\n⚡ Performance Check (Screener with 100 stocks):")
start = time.time()
try:
    response = requests.get(f"{BASE_URL}/api/v1/screener/?limit=100", timeout=10)
    elapsed = time.time() - start
    
    if response.status_code == 200:
        print(f"✅ PASS | Response time: {elapsed*1000:.0f}ms")
        if elapsed < 0.5:
            print(f"   🎯 EXCELLENT: Under 500ms target!")
        elif elapsed < 1.0:
            print(f"   ✅ GOOD: Under 1 second")
        else:
            print(f"   ⚠️  SLOW: Over 1 second (target: <500ms)")
    else:
        print(f"❌ FAIL | Status: {response.status_code}")
except Exception as e:
    print(f"❌ ERROR | {str(e)}")

print("\n" + "=" * 80)
print("Verification complete!")
print("=" * 80)
