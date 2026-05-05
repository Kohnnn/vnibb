"""
Verification script for Task 062: Fix Screener API Bugs

This script verifies that all three bugs have been fixed:
1. 'now' variable is defined
2. 'cache_age' field exists in ScreenerResponse
3. asyncio is properly imported in main.py
"""

import sys
import importlib.util

def verify_screener_response_model():
    """Verify ScreenerResponse has cache_age field."""
    print("✓ Checking ScreenerResponse model...")
    from vnibb.api.v1.screener import ScreenerResponse
    
    fields = ScreenerResponse.model_fields
    assert 'cache_age' in fields, "cache_age field missing!"
    assert 'count' in fields, "count field missing!"
    assert 'data' in fields, "data field missing!"
    
    print(f"  ✓ ScreenerResponse has all required fields: {list(fields.keys())}")
    return True

def verify_datetime_import():
    """Verify datetime is imported in screener.py."""
    print("✓ Checking datetime import in screener.py...")
    
    # Read the file
    with open('vnibb/api/v1/screener.py', 'r', encoding='utf-8') as f:
        content = f.read()
    
    assert 'from datetime import datetime' in content, "datetime import missing!"
    assert 'now = datetime.now()' in content, "now variable definition missing!"
    
    print("  ✓ datetime imported and now variable defined")
    return True

def verify_asyncio_import():
    """Verify asyncio is imported in main.py."""
    print("✓ Checking asyncio import in main.py...")
    
    # Read the file
    with open('vnibb/api/main.py', 'r', encoding='utf-8') as f:
        content = f.read()
    
    assert 'import asyncio' in content, "asyncio import missing!"
    assert 'asyncio.create_task' in content, "asyncio.create_task usage missing!"
    
    print("  ✓ asyncio imported and used correctly")
    return True

def verify_warmup_service():
    """Verify warmup_service has proper async implementation."""
    print("✓ Checking warmup_service.py...")
    
    # Read the file
    with open('vnibb/services/warmup_service.py', 'r', encoding='utf-8') as f:
        content = f.read()
    
    assert 'import asyncio' in content, "asyncio import missing in warmup_service!"
    assert 'async_session_maker' in content, "async_session_maker import missing!"
    assert 'async with async_session_maker() as db:' in content, "async context manager missing!"
    
    print("  ✓ warmup_service properly implemented")
    return True

def main():
    """Run all verification checks."""
    print("=" * 60)
    print("Task 062: Screener Bug Fixes - Verification Script")
    print("=" * 60)
    print()
    
    try:
        verify_screener_response_model()
        verify_datetime_import()
        verify_asyncio_import()
        verify_warmup_service()
        
        print()
        print("=" * 60)
        print("✅ ALL CHECKS PASSED - All bugs are fixed!")
        print("=" * 60)
        return 0
        
    except AssertionError as e:
        print()
        print("=" * 60)
        print(f"❌ VERIFICATION FAILED: {e}")
        print("=" * 60)
        return 1
    except Exception as e:
        print()
        print("=" * 60)
        print(f"❌ UNEXPECTED ERROR: {e}")
        print("=" * 60)
        return 1

if __name__ == "__main__":
    sys.exit(main())
