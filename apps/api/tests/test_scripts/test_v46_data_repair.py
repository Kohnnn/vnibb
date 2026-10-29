import argparse
import importlib.util
from pathlib import Path

import pytest

path = Path(__file__).resolve().parents[2] / "scripts/v46_data_repair.py"
spec = importlib.util.spec_from_file_location("v46_data_repair", path)
assert spec and spec.loader
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


@pytest.mark.asyncio
async def test_eps_backfill_rejects_unsafe_write():
    with pytest.raises(RuntimeError, match="EPS backfill is disabled"):
        await repair._backfill_income_eps_from_ratios(500)


@pytest.mark.asyncio
@pytest.mark.parametrize("target", ["eps", "all"])
async def test_eps_and_all_fail_before_any_database_work(monkeypatch, capsys, target):
    monkeypatch.setattr(repair, "parse_args", lambda: argparse.Namespace(
        target=target, audit_only=False, batch_size=500, output_json="unused.json"
    ))

    async def unexpected_database_work():
        raise AssertionError("must reject before database work")

    monkeypatch.setattr(repair, "_collect_metrics", unexpected_database_work)
    assert await repair.main() != 0
    assert "EPS backfill is disabled" in capsys.readouterr().err
