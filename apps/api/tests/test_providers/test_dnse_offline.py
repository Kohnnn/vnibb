"""Synthetic, documented DNSE shapes; no account, fixture loader or transport."""

import ast
import inspect
from datetime import UTC, datetime, timedelta, timezone

import pytest
from vnibb.providers import dnse, market_data


def history(**changes):
    return {"t": [1700000060, 1700000000], "o": [0, 1.5], "h": [2.0, 2], "l": [0, 1], "c": [1, 1.5], "v": [0, 3], "nextTime": 1699999999, **changes}


def trade(**changes):
    return {"marketId": "STO", "boardId": "G1", "isin": "VNTEST000001", "symbol": "FPT", "matchPrice": 0.0, "matchQtty": 0, "side": "BUY", "avgPrice": 1.5, "totalVolumeTraded": 0, "grossTradeAmount": 0.0, "highestPrice": 2.0, "lowestPrice": 0.0, "openPrice": 1.0, "time": "2026-11-16 14:35:01.123", **changes}


def page(page_number, symbols, *, total=3, size=2):
    return {"data": [{"symbol": symbol, "marketId": "STO", "securityGroupId": "ST", "indexName": ["VN30"]} for symbol in symbols], "total": total, "page": page_number, "pageSize": size}


def request(**changes):
    args = {"operation": "history", "symbol": "FPT", "params": {"resolution": "1D", "from": 1, "to": 2}, "api_key": "demo-key", "api_secret": "demo-secret", "date": "Wed, 01 Jul 2026 00:00:00 +0000", "nonce": "0123456789abcdef"}
    args.update(changes)
    return dnse.dnse_request(**args)


def test_history_preserves_order_raw_zeros_and_next_time_with_unknown_units():
    rows = market_data.dnse_history("fpt", history())
    assert [row["t"] for row in rows] == [1700000060, 1700000000]
    assert rows[0]["time"] == datetime.fromtimestamp(1700000060, UTC)
    assert rows[0]["raw_data"] == {"t": 1700000060, "o": 0, "h": 2.0, "l": 0, "c": 1, "v": 0}
    assert all(row["nextTime"] == 1699999999 and row["source"] == "DNSE" and row["price_source"] == "dnse_unknown" and row["price_unit"] == "unknown" for row in rows)
    assert all(row[field] is None for row in rows for field in ("open", "high", "low", "close", "price", "volume", "value"))
    assert all(row["unavailable_reason"] for row in rows)
    assert all(not any(key in row for key in ("adjusted", "final", "session_date")) for row in rows)
    assert market_data.dnse_history("FPT", history(t=[], o=[], h=[], l=[], c=[], v=[], nextTime=0)) == []


@pytest.mark.parametrize("field,value", [("t", [True, 1]), ("t", [1.0, 2]), ("t", [2**63, 1]), ("o", [None, 1]), ("h", [float("nan"), 1]), ("l", [float("inf"), 1]), ("c", [True, 1]), ("v", [1.0, 2]), ("v", [False, 2]), ("nextTime", True), ("nextTime", None)])
def test_history_rejects_invalid_types(field, value):
    with pytest.raises(ValueError):
        market_data.dnse_history("FPT", history(**{field: value}))


def test_history_rejects_invalid_envelopes_and_nonterminal_empty():
    for payload in (None, {}, history(v=[1]), history(symbol="VCB"), history(t=[], o=[], h=[], l=[], c=[], v=[], nextTime=4)):
        with pytest.raises(ValueError):
            market_data.dnse_history("FPT", payload)


def test_quote_keeps_actual_gmt7_instant_and_unverified_raw_values():
    quote = market_data.dnse_quote("fpt", {"trades": [trade()]})
    assert quote["time"] == datetime(2026, 11, 16, 14, 35, 1, 123000, tzinfo=timezone(timedelta(hours=7)))
    assert quote["raw_data"]["matchPrice"] == 0.0
    assert quote["raw_data"]["matchQtty"] == 0
    assert quote["boardId"] == "G1"
    assert all(quote[field] is None for field in ("open", "high", "low", "close", "price", "volume", "value"))
    assert quote["price_unit"] == "unknown" and quote["price_source"] == "dnse_unknown"
    assert market_data.dnse_quote("FPT", {"trades": [trade(time="2026-11-16 14:35:01.123 (GMT+7)")]})["time"] == quote["time"]


@pytest.mark.parametrize("item", [trade(symbol="VCB"), trade(symbol=None), trade(boardId=""), trade(matchPrice=None), trade(matchPrice=True), trade(matchPrice=float("nan")), trade(matchQtty=1.0), trade(totalVolumeTraded=True), trade(side="UNKNOWN"), trade(time="2026-11-16 14:35:01"), trade(time="2026-02-30 14:35:01.123"), trade(time=None)])
def test_quote_rejects_mismatch_or_malformed_values(item):
    with pytest.raises(ValueError):
        market_data.dnse_quote("FPT", {"trades": [item]})


def test_quote_empty_or_ambiguous_is_unavailable_not_arbitrary_selection():
    for items in ([], [trade(), trade(boardId="G4")], [trade(), trade()]):
        with pytest.raises(ValueError, match="unavailable"):
            market_data.dnse_quote("FPT", {"trades": items})
    for payload in ({}, {"trades": None}, {"trades": [None]}):
        with pytest.raises(ValueError):
            market_data.dnse_quote("FPT", payload)


def test_listing_and_bounded_assembly_retain_page_provenance():
    first, second = page(1, ["FPT", "VCB"]), page(2, ["ACB"])
    rows = market_data.dnse_listing(first)
    assert [(row["symbol"], row["marketId"], row["page"], row["pageSize"], row["total"]) for row in rows] == [("FPT", "STO", 1, 2, 3), ("VCB", "STO", 1, 2, 3)]
    assert rows[0]["raw_data"]["indexName"] == ["VN30"]
    assembled = dnse.dnse_assemble_pages([second, first])
    assert [row["symbol"] for row in assembled["data"]] == ["FPT", "VCB", "ACB"]
    assert (assembled["total"], assembled["pageSize"], assembled["pages"], assembled["pagination_complete"]) == (3, 2, 2, True)
    assert market_data.dnse_listing(page(1, [], total=0)) == []
    assert dnse.dnse_assemble_pages([page(1, [], total=0)])["pagination_complete"]
    two_pages = dnse.dnse_assemble_pages([page(1, ["FPT"], total=2, size=1), page(2, ["VCB"], total=2, size=1)])
    assert two_pages["pagination_complete"] and len(two_pages["data"]) == 2


def test_listing_rejects_bad_types_missing_identity_and_page_metadata():
    invalid = [None, {}, page(True, ["FPT"]), page(0, ["FPT"]), page(1, [], total=3), page(2, [], total=0), page(1, ["FPT"], size=0), page(1, ["FPT", "VCB"], size=1), {**page(1, ["FPT"]), "total": True}, {**page(1, ["FPT"]), "data": [{"symbol": "FPT"}]}, {**page(1, ["FPT"]), "data": [{"symbol": "FPT", "marketId": "STO", "indexName": [None]}]}]
    for payload in invalid:
        with pytest.raises(ValueError):
            market_data.dnse_listing(payload)
    with pytest.raises(ValueError, match="metadata"):
        market_data.dnse_listing(page(3, ["ACB"], total=3, size=2))
    with pytest.raises(ValueError, match="length"):
        market_data.dnse_listing(page(1, ["FPT"], total=3, size=2))


def test_assembly_rejects_missing_duplicate_conflicting_and_incomplete_pages():
    first, second = page(1, ["FPT", "VCB"]), page(2, ["ACB"])
    for pages in ([], [first], [first, first], [first, page(3, ["ACB"])], [first, page(2, ["ACB"], total=4)], [first, page(2, ["ACB"], size=3)], [first, page(2, ["FPT"])], [page(1, ["FPT", "fpt"])], [second] * 1001):
        with pytest.raises(ValueError):
            dnse.dnse_assemble_pages(pages)
    with pytest.raises(ValueError):
        dnse.dnse_assemble_pages([page(1, ["FPT"]), page(2, ["VCB"]), page(3, ["ACB"])])


def test_request_signs_path_not_query_and_records_sdk_header_discrepancy():
    signed = request()
    assert signed["method"] == "GET" and signed["path"] == "/price/ohlc"
    assert signed["query"] == "symbol=FPT&resolution=1D&from=1&to=2"
    assert signed["headers"] == {"Date": "Wed, 01 Jul 2026 00:00:00 +0000", "x-api-key": "demo-key", "version": "2026-07-23", "X-Signature": 'Signature keyId="demo-key",algorithm="hmac-sha256",headers="(request-target) date",signature="n4oyzrT94HEH%2BmsMC9F0YYdIYYI5YpHz3xuTUfiR6s8%3D",nonce="0123456789abcdef"'}
    assert request(params={"resolution": "1D", "from": 10, "to": 20})["headers"]["X-Signature"] == signed["headers"]["X-Signature"]
    assert request(operation="quote", symbol="fpt", params={"boardId": "G1"})["path"] == "/price/FPT/trades/latest"
    listing = request(operation="listing", symbol=None, params={"symbol": "FPT,VCB", "page": 1})
    assert listing["path"] == "/market/instruments" and listing["query"] == "symbol=FPT%2CVCB&page=1"
    assert ",nonce=" not in request(nonce=None)["headers"]["X-Signature"]


@pytest.mark.parametrize("changes", [{"operation": "/orders"}, {"method": "POST"}, {"symbol": "FPT/../../orders"}, {"symbol": "FPT?x=1"}, {"api_key": 'key"\nsecret'}, {"date": "bad\r\nheader"}, {"nonce": 'x"'}, {"api_secret": ""}, {"params": {"resolution": "1D", "from": True, "to": 2}}, {"params": {"resolution": "1D", "from": 3, "to": 2}}, {"params": {"resolution": "1D", "from": 1, "to": 2, "symbol": "VCB"}}, {"operation": "quote", "params": {"boardId": "bad"}}, {"operation": "listing", "symbol": None, "params": {"page": False}}])
def test_request_rejects_unsafe_input_without_disclosing_values(changes):
    with pytest.raises(ValueError) as error:
        request(**changes)
    assert "demo-secret" not in str(error.value) and "key\"" not in str(error.value)


def test_error_classification_and_unavailable_capabilities_are_sanitized():
    assert dnse.dnse_error(429)["reason"] == "rate_limited"
    assert dnse.dnse_error(403, "OA-401")["reason"] == "quota_exceeded"
    assert dnse.dnse_error(403)["reason"] == "forbidden"
    assert dnse.dnse_error(401)["reason"] == "authentication_failed"
    assert dnse.dnse_error(503)["reason"] == "provider_error"
    assert "private-response" not in str(dnse.dnse_error(400, "private-response"))
    for capability in ("fundamentals", "financials", "ratios", "news"):
        result = market_data.dnse_unavailable(capability)
        assert result["available"] is False and result["capability"] == capability and result["reason"]
    with pytest.raises(ValueError):
        dnse.dnse_error(True)


def test_adapter_imports_only_stdlib_and_has_no_io_calls():
    tree = ast.parse(inspect.getsource(dnse))
    imports = {node.module.split(".")[0] for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module}
    imports.update(alias.name.split(".")[0] for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names)
    assert imports <= {"__future__", "base64", "datetime", "hashlib", "hmac", "math", "re", "urllib"}
    assert not any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"open", "exec", "eval", "__import__"} for node in ast.walk(tree))
