"""Offline assertions for the opt-in inventory; run directly, without providers."""
import importlib.util
import json
import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory

spec = importlib.util.spec_from_file_location("verify_database", Path(__file__).with_name("verify_database.py"))
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


def main():
    with TemporaryDirectory() as directory:
        universe_path = Path(directory) / "universe.json"
        universe_path.write_text(json.dumps({"instruments": [
            {"symbol": "VCB", "type": "STOCK", "board": "HSX"},
            {"symbol": "OLD", "type": "STOCK", "board": "DELISTED"},
        ]}))
        universe, digest = inventory.load_universe(universe_path)
        assert len(digest) == 64 and len(universe) == 2
        assert inventory.coverage({"VCB", "FPT"}, ["vcb", "VCB"])["missing"] == ["FPT"]
        assert inventory.coverage(None, ["VCB"])["missing_count"] is None
        assert inventory.coverage(None, ["mongodb://user:secret@host", "VCB"])["present"] == ["VCB"]
        proof = {"values": {"eps": 42}, "fieldEvidence": {"eps": {
            "unit": "VND/share", "descriptorEvidence": {"symbol": "VCB", "source": "vietcap",
                "endpoint": "/v1/company/VCB/financial-statement/metrics", "receivedAt": "2026-10-13"},
            "descriptors": [{"titleEn": "EPS"}],
        }}}
        fields = inventory.financial_field_counts([
            {"symbol": "VCB", "source": "vietcap", "eps": 42, "revenue": None, "raw_data": {"structured": proof}},
            {"symbol": "VCB", "source": "vietcap", "eps": 42, "revenue": 100, "raw_data": {}},
        ], ["eps", "revenue"])
        assert {key: value for key, value in fields["eps"].items() if key != "unavailable_reasons"} == {
            "nonnull": 2, "null": 0, "admitted": 1, "unverified_nonnull": 1}
        assert fields["revenue"]["null"] == 1 and fields["revenue"]["admitted"] == 0
        database = Path(directory) / "inventory.db"
        with sqlite3.connect(database) as connection:
            connection.execute("CREATE TABLE stocks (symbol TEXT, is_active INTEGER)")
            connection.execute("INSERT INTO stocks VALUES ('VCB', 1), ('OLD', 0)")
        before = database.read_bytes()
        entries = inventory.sql_inventory(f"sqlite:///{database}", universe)
        stocks = next(row for row in entries if row["dataset"] == "stocks")
        assert stocks["rows"] == 2 and stocks["coverage"]["expected_count"] == 1
        assert stocks["all_stock_type_coverage"]["expected_count"] == 2
        assert stocks["active_sql_coverage"]["expected_count"] == 1
        assert next(row for row in entries if row["dataset"] == "intraday_trades")["reason"] == "table_absent"
        assert database.read_bytes() == before
        assert inventory.premium_catalog()["analytics.valuation.pe"] == "market"
        universe_path.write_text(json.dumps([{"symbol": "VCB", "type": "STOCK"}, {"symbol": "VCB", "type": "CW"}]))
        try:
            inventory.load_universe(universe_path)
        except ValueError:
            pass
        else:
            raise AssertionError("Conflicting universe identities accepted")
    print("Inventory self-check passed")


if __name__ == "__main__":
    main()
