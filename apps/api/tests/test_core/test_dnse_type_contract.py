import os
import subprocess
import sys
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize(
    ("source", "expected_exit", "error_codes"),
    [
        (
            """
from typing import assert_type
from vnibb.providers.market_data import dnse_history, dnse_quote, dnse_listing, dnse_unavailable, validate_source
from vnibb.providers.dnse import dnse_assemble_pages, dnse_error, dnse_request
from vnibb.providers.dnse_types import HistoryObservation, QuoteObservation, ListingObservation, ListingAssembly, SignedRequest, ProviderError, UnavailableCapability
assert_type(dnse_history('FPT', {}), list[HistoryObservation])
assert_type(dnse_quote('FPT', {}), QuoteObservation)
assert_type(dnse_listing({}), list[ListingObservation])
assert_type(dnse_assemble_pages([]), ListingAssembly)
assert_type(dnse_request('listing', api_key='key', api_secret='secret', date='date'), SignedRequest)
assert_type(dnse_error(429), ProviderError)
assert_type(dnse_unavailable('news'), UnavailableCapability)
assert_type(validate_source(), str)
""",
            0,
            (),
        ),
        (
            """
from vnibb.providers.market_data import dnse_history, validate_source, listing
dnse_history(123, {})
validate_source(123)
listing('VCI', unexpected=True)
""",
            1,
            ("[arg-type]", "[call-arg]"),
        ),
    ],
)
def test_static_provider_port_contract(tmp_path, source, expected_exit, error_codes):
    program = tmp_path / "consumer.py"
    program.write_text(source, encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-m", "mypy", "--follow-imports=silent", "--ignore-missing-imports",
         "--no-incremental", "--cache-dir", str(tmp_path / "mypy-cache"), str(program)],
        cwd=tmp_path,
        env={**os.environ, "MYPYPATH": str(API_ROOT)},
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode == expected_exit, result.stdout + result.stderr
    for code in error_codes:
        assert code in result.stdout
