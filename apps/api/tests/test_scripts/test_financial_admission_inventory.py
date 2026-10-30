"""Bounded SQL inventory uses the MCP collection admission contract."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, insert

from scripts.financial_admission_inventory import MODELS, inventory, parse_scope


def lineage(field="revenue", source="vietcap"):
    return {"_financial_lineage": {"canonical_data": {
        "source": source, "symbol": "FPT", "statement_type": "income", "period": "2025",
        "currency": "VND", "value_unit": "VND", "consolidation_basis": "consolidated",
        "flow_basis": "annual", "unit_metadata": {field: {"unit": "VND", "source_unit": "VND"}},
    }}}


def row(symbol="FPT", period="2025", year=2025, source="vietcap", raw=None, **fields):
    return {"symbol": symbol, "period": period, "period_type": "year", "fiscal_year": year,
            "fiscal_quarter": None, "source": source, "raw_data": raw, **fields}


def cell(report, dataset, symbol, period):
    return next(c for c in report["cells"] if (c["dataset"], c["symbol"], c["expected_period"]) == (dataset, symbol, period))


def test_inventory_distinguishes_stored_admitted_missing_and_unsupported(tmp_path):
    path = tmp_path / "inventory.db"
    engine = create_engine(f"sqlite:///{path}")
    for model in MODELS.values():
        model.__table__.create(engine)
    with engine.begin() as conn:
        for item in [
            {"id": 1, **row(raw=lineage(), revenue=0, gross_profit=10)},
            {"id": 2, **row(symbol="VCI", source="issuer_report", revenue=30)},
            {"id": 3, **row(symbol="MSR", period="2024", year=9999, revenue=50)},
        ]:
            conn.execute(insert(MODELS["income_statements"].__table__), item)
        conn.execute(insert(MODELS["balance_sheets"].__table__),
                     {"id": 1, **row(symbol="VNM", source="VCI", total_assets=100)})
    engine.dispose()
    symbols, periods = parse_scope("FPT,VCI,VNM,MSR", "2025,Q1-2025")
    report = inventory(f"sqlite:///{path}", symbols, periods)
    assert report["scope"]["expected_symbol_period_dataset_cells"] == 24
    fpt = cell(report, "income_statements", "FPT", "2025")["rows"][0]
    assert fpt["fields"]["revenue"] == {"stored": True, "admitted": True, "reason": None}
    assert fpt["fields"]["gross_profit"] == {"stored": True, "admitted": False, "reason": "unverified_monetary_unit"}
    assert fpt["fields"]["net_income"]["reason"] == "missing_value"
    vci = cell(report, "income_statements", "VCI", "2025")["rows"][0]
    assert vci["status"] == "unsupported_source"
    assert vci["fields"]["revenue"]["reason"] == "unsupported_source"
    vnm = cell(report, "balance_sheets", "VNM", "2025")["rows"][0]
    assert vnm["fields"]["total_assets"]["reason"] == "unverified_statement_currency_or_unit"
    assert cell(report, "cash_flows", "FPT", "2025")["status"] == "missing_row"
    assert cell(report, "income_statements", "FPT", "Q1-2025")["status"] == "missing_row"
    assert report["invalid_fiscal_year_rows"][0]["fiscal_year"] == 9999
    assert cell(report, "income_statements", "MSR", "2025")["status"] == "missing_row"


def test_consumer_rejects_conflicting_source_and_quarter_basis(tmp_path):
    path = tmp_path / "inventory.db"
    engine = create_engine(f"sqlite:///{path}")
    for model in MODELS.values():
        model.__table__.create(engine)
    table = MODELS["income_statements"].__table__
    quarter = row(period="Q1-2025", raw=lineage(), revenue=10)
    quarter.update(period_type="quarter", fiscal_quarter=1)
    with engine.begin() as conn:
        conn.execute(insert(table), {"id": 1, **row(raw=lineage(source="VCI"), revenue=10)})
        conn.execute(insert(table), {"id": 2, **quarter})
    engine.dispose()
    report = inventory(f"sqlite:///{path}", ["FPT"], ["2025", "Q1-2025"])
    annual = cell(report, "income_statements", "FPT", "2025")["rows"][0]
    assert annual["row_reason"] == "conflicting_statement_source"
    assert not annual["fields"]["revenue"]["admitted"]
    quarterly = cell(report, "income_statements", "FPT", "Q1-2025")["rows"][0]
    assert not quarterly["fields"]["revenue"]["admitted"]
    assert quarterly["fields"]["revenue"]["reason"] != "missing_value"


@pytest.mark.parametrize("value", [float("inf"), float("-inf")])
def test_nonfinite_stored_value_is_consumer_fault(tmp_path, value):
    path = tmp_path / "inventory.db"
    engine = create_engine(f"sqlite:///{path}")
    for model in MODELS.values():
        model.__table__.create(engine)
    with engine.begin() as conn:
        conn.execute(insert(MODELS["income_statements"].__table__),
                     {"id": 1, **row(raw=lineage(), revenue=value)})
    engine.dispose()

    report = inventory(f"sqlite:///{path}", ["FPT"], ["2025"])
    result = cell(report, "income_statements", "FPT", "2025")["rows"][0]
    assert result["status"] == "consumer_fault"
    assert result["error_type"] == "ValueError"
    assert result["fields"]["revenue"] == {
        "stored": True, "admitted": None, "reason": "consumer_fault",
    }


def test_cli_uses_only_explicit_env_file_and_ignores_cwd_settings(tmp_path):
    api = Path(__file__).resolve().parents[2]
    selected = tmp_path / "selected.db"
    unrelated = tmp_path / "unrelated.db"
    for path, symbol in [(selected, "FPT"), (unrelated, "VCI")]:
        engine = create_engine(f"sqlite:///{path}")
        for model in MODELS.values():
            model.__table__.create(engine)
        with engine.begin() as conn:
            conn.execute(insert(MODELS["income_statements"].__table__),
                         {"id": 1, **row(symbol=symbol, revenue=12)})
        engine.dispose()
    (tmp_path / ".env").write_text("VNSTOCK_SOURCE=KBS\nmalformed key !!!\n")
    private = tmp_path / "private.env"
    private.write_text(f"DATABASE_URL=sqlite:///{selected}\n")
    env = {**os.environ, "PYTHONPATH": str(api), "VNSTOCK_SOURCE": "KBS",
           "DATABASE_URL_SYNC": f"sqlite:///{unrelated}"}
    command = [sys.executable, "-m", "scripts.financial_admission_inventory",
               "--symbols", "FPT,VCI", "--periods", "2025", "--env-file"]
    result = subprocess.run([*command, str(private)], cwd=tmp_path, env=env, text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert cell(report, "income_statements", "FPT", "2025")["status"] == "present"
    assert cell(report, "income_statements", "VCI", "2025")["status"] == "missing_row"
    assert "malformed" not in result.stderr

    private.write_text("VNSTOCK_SOURCE=VCI\n")
    result = subprocess.run([*command, str(private)], cwd=tmp_path, env=env, text=True, capture_output=True)
    assert result.returncode == 1
    assert json.loads(result.stdout)["status"] == "inventory_failed"
    assert str(unrelated) not in result.stdout + result.stderr

    result = subprocess.run([*command, str(tmp_path / "missing.env")], cwd=tmp_path, env=env, text=True, capture_output=True)
    assert result.returncode == 1
    assert json.loads(result.stdout) == {"status": "inventory_failed", "error_type": "FileNotFoundError"}
    assert result.stderr == ""


@pytest.mark.parametrize("symbols,periods", [("FPT,FPT", "2025"), ("FPT", "2025,2025"),
                                            ("FPT", "FY2025"), ("", "2025")])
def test_scope_requires_explicit_valid_unique_identities(symbols, periods):
    with pytest.raises(ValueError):
        parse_scope(symbols, periods)
