"""Offline DNSE port isolation and the existing VCI-only acquisition guard."""

import inspect
import subprocess
import sys
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("first_import", ["adapter", "port", "package"])
def test_dnse_exports_are_cold_importable_without_credentials_or_network(first_import, tmp_path):
    code = r'''
import importlib
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])

class NoEnvironment(dict):
    def deny(self, *args, **kwargs):
        raise AssertionError("environment must not be read")
    __getitem__ = get = __contains__ = __iter__ = __len__ = keys = items = values = copy = deny

os.environ = NoEnvironment()
os.getenv = os.environ.deny
os.environb = NoEnvironment()
os.getenvb = os.environ.deny

class NoLegacyImports:
    def find_spec(self, fullname, path=None, target=None):
        blocked = ("vnibb.core", "vnibb.providers.base", "vnibb.providers.fhsc",
                   "vnibb.providers.vnstock", "vnstock", "vnstock_data", "vnai")
        if any(fullname == item or fullname.startswith(item + ".") for item in blocked):
            raise AssertionError("legacy import attempted: " + fullname)
        return None

sys.meta_path.insert(0, NoLegacyImports())

def audit(event, args):
    if event.startswith("socket."):
        raise AssertionError("network access attempted")
    if event == "open":
        path = args[0]
        if not isinstance(path, (str, bytes)) or not os.fsdecode(path).endswith((".py", ".pyc", ".so")):
            raise AssertionError("non-module file access attempted")

sys.addaudithook(audit)
if sys.argv[2] == "adapter":
    adapter = importlib.import_module("vnibb.providers.dnse")
    port = importlib.import_module("vnibb.providers.market_data")
elif sys.argv[2] == "port":
    port = importlib.import_module("vnibb.providers.market_data")
    adapter = importlib.import_module("vnibb.providers.dnse")
else:
    from vnibb.providers import market_data as port
    adapter = importlib.import_module("vnibb.providers.dnse")

from vnibb.providers.market_data import dnse_history, dnse_listing, dnse_quote, dnse_unavailable
for name in ("dnse_history", "dnse_listing", "dnse_quote", "dnse_unavailable"):
    assert name in port.__all__ and name in dir(port)
    assert getattr(port, name) is getattr(adapter, name)
    assert getattr(port, name) is getattr(port, name)
assert dnse_history is adapter.dnse_history
assert dnse_listing is adapter.dnse_listing
assert dnse_quote is adapter.dnse_quote
assert dnse_unavailable is adapter.dnse_unavailable
assert not any(name == "vnibb.core" or name.startswith("vnibb.core.") for name in sys.modules)
'''
    result = subprocess.run(
        [sys.executable, "-I", "-c", code, str(API_ROOT), first_import],
        cwd=tmp_path,
        env={},
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_legacy_port_exports_keep_original_identity_and_signatures():
    from vnibb.providers import market_data
    from vnibb.providers.vnstock import market_data as legacy

    names = (
        "balance_sheet", "company_overview", "company_profile", "financial_ratios",
        "forex_rates", "history", "index_history", "intraday", "listing",
        "listing_metadata", "price_board", "raw_dataset", "run_financial",
        "run_reference", "validate_source",
    )
    for name in names:
        assert name in market_data.__all__ and name in dir(market_data)
        exported = getattr(market_data, name)
        assert exported is getattr(legacy, name)
        assert getattr(market_data, name) is exported
        assert inspect.signature(exported) == inspect.signature(getattr(legacy, name))

    assert market_data.validate_source() == "VCI"
    assert market_data.validate_source(" vci ") == "VCI"
    with pytest.raises(AttributeError):
        _ = market_data.not_a_market_data_export


def test_provider_package_preserves_base_exports():
    from vnibb.providers import BaseFetcher, DataT, QueryT, base

    assert BaseFetcher is base.BaseFetcher
    assert DataT is base.DataT
    assert QueryT is base.QueryT


_SOURCE_OPERATIONS = [
    ("history", ("FPT", "DNSE"), {"start": "2026-01-01", "end": "2026-01-03"}),
    ("intraday", ("FPT", "DNSE"), {"page_size": 10}),
    ("listing", ("DNSE",), {}),
    ("listing_metadata", ("DNSE",), {}),
    ("financial_ratios", ("FPT", "DNSE"), {}),
    ("company_profile", ("FPT", "DNSE"), {}),
    ("index_history", ("VNINDEX", "DNSE"), {"start": "2026-01-01", "end": "2026-01-03"}),
    ("company_overview", ("FPT", "DNSE"), {}),
    ("balance_sheet", ("FPT", "DNSE"), {}),
    ("raw_dataset", ("FPT", "DNSE", "quote.history"), {"start": "2026-01-01", "end": "2026-01-03", "limit": 10}),
    ("price_board", (["FPT"], "DNSE"), {}),
]


@pytest.mark.parametrize("source", ["DNSE", "dnse", " dnse "])
@pytest.mark.parametrize(("name", "args", "kwargs"), _SOURCE_OPERATIONS)
def test_dnse_selector_rejects_before_acquisition_or_transform(monkeypatch, source, name, args, kwargs):
    from vnibb.providers import market_data
    from vnibb.providers.vnstock import runtime

    def forbidden(*args, **kwargs):
        pytest.fail("DNSE selection must not acquire or fall back")

    for method in ("get_quote_class", "get_listing_class", "get_company_class", "get_finance_class", "import_vnstock_symbol"):
        monkeypatch.setattr(runtime, method, forbidden)
    for transform in ("dnse_history", "dnse_listing", "dnse_quote", "dnse_unavailable"):
        monkeypatch.setattr(market_data, transform, forbidden)

    source_args = tuple(source if value == "DNSE" else value for value in args)
    with pytest.raises(ValueError, match="only free VCI"):
        getattr(market_data, name)(*source_args, **kwargs)
    with pytest.raises(ValueError, match="only free VCI"):
        market_data.validate_source(source)
