"""The DNSE import command must refuse before credentials or side effects."""

import json
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import pytest


@pytest.mark.parametrize(
    ("environment", "enabled"),
    [("test", "false"), ("development", "true"), ("staging", "true"), ("production", "true")],
)
def test_dnse_command_cold_start_refuses_before_credentials_or_side_effects(environment, enabled):
    script = Path(__file__).resolve().parents[2] / "scripts" / "import_dnse_daily.py"
    # Guard at process start, before imports: no actual provider values are used.
    probe = """
import os, runpy, socket, sys
from collections.abc import MutableMapping
class Guarded(MutableMapping):
    def __init__(self, original): self.original = original
    def __getitem__(self, key):
        if key in {'DNSE_API_KEY', 'DNSE_API_SECRET'}:
            raise AssertionError('credential read before refusal')
        return self.original[key]
    def __setitem__(self, key, value): self.original[key] = value
    def __delitem__(self, key): del self.original[key]
    def __iter__(self): return iter(self.original)
    def __len__(self): return len(self.original)
def forbidden(*args, **kwargs): raise AssertionError('network access before refusal')
os.environ = Guarded(os.environ)
socket.socket.connect = forbidden
sys.argv = sys.argv[1:]
try:
    runpy.run_path(sys.argv[0], run_name='__main__')
except SystemExit as exc:
    assert exc.code == 2
else:
    raise AssertionError('command did not refuse')
assert not any(name.startswith('vnibb.') for name in sys.modules)
assert 'sqlalchemy' not in sys.modules
"""
    # UUIDs are invented at runtime, never provider data or credentials.
    key, secret, signature = (uuid4().hex for _ in range(3))
    result = subprocess.run(
        [
            sys.executable, "-c", probe, str(script), "--symbols", "DEMO",
            "--start", secret, "--end", "2001-02-04",
        ],
        env={
            "ENVIRONMENT": environment,
            "DNSE_ENABLED": enabled,
            "DNSE_API_KEY": key,
            "DNSE_API_SECRET": secret,
            "X_SIGNATURE": signature,
        },
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert not result.stdout
    assert json.loads(result.stderr)["reason"] == "dnse_authorization_missing"
    assert all(value not in result.stderr for value in (key, secret, signature))
