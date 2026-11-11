"""Offline FHSC payload transforms proven against documented response shapes."""

import pytest
from vnibb.providers import market_data
from vnibb.services.financial_service import admit_statement_rows


def envelope(data, error_code="0", message="success"):
    return {"error_code": error_code, "message": message, "data": data}


def history_payload(**overrides):
    data = {
        "symbol": "FPT",
        "currency": "VND",
        "resolution": "1D",
        "series": [
            {"t": 1717200000, "o": 100.0, "h": 101.0, "l": 99.0, "c": 100.5, "v": 1000.0},
            {"t": 1717286400, "o": None, "h": None, "l": None, "c": None, "v": None},
        ],
    }
    data.update(overrides)
    return envelope(data)


def quote_payload(**overrides):
    data = {
        "symbol": "FPT",
        "name": "FPT Corp",
        "exchange": "HOSE",
        "currency": "VND",
        "price": 100.0,
        "open": 99.0,
        "high": 101.0,
        "low": 98.0,
        "reference": 99.5,
        "ceiling": 106.0,
        "floor": 93.0,
        "change": 0.5,
        "change_percent": 0.5,
        "volume": 1000.0,
        "updated_at": "2026-05-27T14:30:15+07:00",
    }
    data.update(overrides)
    return envelope(data)


def listing_payload(**overrides):
    data = {
        "symbol": "FPT",
        "exchange": "HOSE",
        "listing_date": "2006-01-19",
        "listing_reference_price": 53000.0,
        "listed_shares": 1000.0,
        "outstanding_shares": 900.0,
        "treasury_shares": 0.0,
        "free_float": 500.0,
        "free_float_pct": 50.0,
    }
    data.update(overrides)
    return envelope(data)


def financial_payload(rows=None):
    return envelope(rows if rows is not None else [
        {"year": 2025, "quarter": 4, "luuchuyentienthuantuhoatdongkinhdoanh": 123.0, "chiphilaivay": None},
    ])


def test_history_keeps_timestamps_and_refuses_usable_ohlc():
    rows = market_data.fhsc_history("fpt", history_payload())

    assert [row["t"] for row in rows] == [1717200000, 1717286400]
    assert rows[0]["raw_data"]["c"] == 100.5
    assert rows[1]["raw_data"]["c"] is None
    for row in rows:
        assert row["source"] == "fhsc"
        assert row["price_unit"] == "unknown"
        assert row["price_basis"] == "unknown"
        assert row["adjustment_mode"] == "unknown"
        assert row["finality"] == "unknown"
        assert row["unavailable_reason"] == "unverified_price_unit_or_basis"
        assert "close" not in row and "price" not in row
        assert row["raw_context"]["resolution"] == "1D"


@pytest.mark.parametrize("field", ["o", "h", "l", "c", "v"])
def test_history_rejects_non_numeric_or_non_finite_values(field):
    payload = history_payload()
    payload["data"]["series"][0][field] = "n/a"
    with pytest.raises(ValueError, match="numeric"):
        market_data.fhsc_history("FPT", payload)
    payload["data"]["series"][0][field] = float("inf")
    with pytest.raises(ValueError, match="numeric"):
        market_data.fhsc_history("FPT", payload)


def test_history_rejects_missing_or_float_timestamp():
    payload = history_payload()
    payload["data"]["series"][0].pop("t")
    with pytest.raises(ValueError, match="timestamp"):
        market_data.fhsc_history("FPT", payload)
    payload["data"]["series"][0]["t"] = 1717200000.5
    with pytest.raises(ValueError, match="timestamp"):
        market_data.fhsc_history("FPT", payload)


def test_quote_preserves_source_timestamp_without_price_inference():
    quote = market_data.fhsc_quote("FPT", quote_payload())

    assert quote["updated_at"] == "2026-05-27T14:30:15+07:00"
    assert "refreshed_at" not in quote
    assert quote["raw_data"]["price"] == 100.0
    assert quote["price_unit"] == "unknown"
    assert quote["unavailable_reason"] == "unverified_price_unit_or_basis"
    assert "price" not in {key for key in quote if key != "raw_data"}


def test_quote_allows_null_ceiling_and_floor_but_not_missing_price():
    quote = market_data.fhsc_quote("FPT", quote_payload(ceiling=None, floor=None, currency="USD"))
    assert quote["raw_data"]["ceiling"] is None

    payload = quote_payload()
    payload["data"].pop("price")
    with pytest.raises(ValueError, match="price"):
        market_data.fhsc_quote("FPT", payload)


def test_quote_rejects_naive_or_malformed_updated_at():
    for value in ("2026-05-27T14:30:15", "27/05/2026"):
        with pytest.raises(ValueError, match="updated_at"):
            market_data.fhsc_quote("FPT", quote_payload(updated_at=value))


def test_listing_reference_price_is_normalized_vnd_only():
    listing = market_data.fhsc_listing("FPT", listing_payload())

    assert listing["listing_reference_price"] == 53000.0
    assert listing["listing_reference_price_unit"] == "VND"
    assert listing["price_source"] == "fhsc"
    assert listing["price_basis"] == "listing_reference"
    assert listing["adjustment_mode"] == "unknown"
    assert listing["unavailable_reason"] == "unverified_adjustment_or_finality"
    assert listing["raw_data"]["free_float_pct"] == 50.0


def test_listing_absent_reference_price_is_null_not_zero():
    listing = market_data.fhsc_listing("FPT", listing_payload(listing_reference_price=None))
    assert listing["listing_reference_price"] is None
    assert listing["unavailable_reason"] == "missing_listing_reference_price"


def test_listing_has_no_symbol_universe_capability():
    with pytest.raises(ValueError, match="only per-symbol detail"):
        market_data.fhsc_listing("FPT", listing_payload(), view="all_symbols")


def test_listing_rejects_malformed_date():
    with pytest.raises(ValueError, match="listing_date"):
        market_data.fhsc_listing("FPT", listing_payload(listing_date="19/01/2006"))


def test_financial_codes_reach_real_admission_and_are_withheld():
    rows = market_data.fhsc_financials(
        "FPT", financial_payload(), statement_type="cash-flow", period="quarterly"
    )

    assert len(rows) == 1
    assert rows[0].period == "Q4-2025"
    assert rows[0].raw_data["metric_codes"] == {
        "luuchuyentienthuantuhoatdongkinhdoanh": 123.0, "chiphilaivay": None,
    }
    admitted = admit_statement_rows(rows, "quarter")[0]
    assert admitted.period == "Q4-2025"
    assert admitted.currency is None and admitted.value_unit is None
    assert admitted.unavailable_reason == "unknown_source_unit"
    assert admitted.raw_data["raw"]["year"] == 2025
    for field in ("revenue", "net_income", "operating_cash_flow", "total_assets"):
        assert getattr(admitted, field) is None
    assert admitted.unit_metadata["luuchuyentienthuantuhoatdongkinhdoanh"]["unavailable_reason"] == "unknown_source_unit"


def test_financial_annual_rows_keep_year_only_period():
    rows = market_data.fhsc_financials(
        "FPT", financial_payload([{"year": 2025, "chiphilaivay": 10.0}]),
        statement_type="balance-sheet", period="annual",
    )
    admitted = admit_statement_rows(rows, "year")[0]
    assert admitted.period == "2025"
    assert admitted.fiscal_quarter is None
    assert admitted.total_assets is None


@pytest.mark.parametrize("quarter", [1.0, 4.0, True, False, "1", 0, 5])
def test_financial_quarter_must_be_an_integer_in_range(quarter):
    with pytest.raises(ValueError, match="statement quarter"):
        market_data.fhsc_financials(
            "FPT", financial_payload([{"year": 2025, "quarter": quarter, "chiphilaivay": 10.0}]),
            statement_type="income-statement", period="quarterly",
        )


@pytest.mark.parametrize("period", ["annual", "year"])
@pytest.mark.parametrize("quarter", [1, 4])
def test_financial_annual_rejects_a_quarter(period, quarter):
    with pytest.raises(ValueError, match="annual.*quarter"):
        market_data.fhsc_financials(
            "FPT", financial_payload([{"year": 2025, "quarter": quarter, "chiphilaivay": 10.0}]),
            statement_type="cash-flow", period=period,
        )


@pytest.mark.parametrize("quarter_field", [{}, {"quarter": None}])
def test_financial_annual_preserves_raw_identity_and_metadata(quarter_field):
    raw = {"year": 2025, **quarter_field, "chiphilaivay": 10.0}
    row = market_data.fhsc_financials(
        "FPT", financial_payload([raw]), statement_type="income-statement", period="annual",
    )[0]
    admitted = admit_statement_rows([row], "year")[0]
    for result in (row, admitted):
        assert (result.period, result.fiscal_year, result.fiscal_quarter) == ("2025", 2025, None)
        assert result.raw_data == {"raw": raw, "metric_codes": {"chiphilaivay": 10.0}}
        assert result.flow_basis == "annual"
        assert result.unit_metadata["chiphilaivay"]["unavailable_reason"] == "unknown_source_unit"


@pytest.mark.parametrize("statement_type, canonical_type", [
    ("income-statement", "income"),
    ("cash-flow", "cashflow"),
])
def test_financial_quarterly_flow_basis_remains_unknown_through_admission(statement_type, canonical_type):
    raw = {"year": 2025, "quarter": 1, "chiphilaivay": 10.0}
    row = market_data.fhsc_financials(
        "FPT", financial_payload([raw]), statement_type=statement_type, period="quarterly",
    )[0]
    admitted = admit_statement_rows([row], "quarter")[0]
    for result in (row, admitted):
        assert (result.period, result.fiscal_year, result.fiscal_quarter) == ("Q1-2025", 2025, 1)
        assert type(result.fiscal_quarter) is int
        assert result.statement_type == canonical_type
        assert result.raw_data == {"raw": raw, "metric_codes": {"chiphilaivay": 10.0}}
        assert result.flow_basis is None
        assert result.currency is None and result.value_unit is None
        assert result.unavailable_reason == "unknown_source_unit"
        assert result.unit_metadata["chiphilaivay"] == {
            "source": "fhsc", "source_field": "chiphilaivay", "source_unit": None,
            "value_unit": None, "unavailable_reason": "unknown_source_unit",
        }


def test_financial_rejects_undocumented_type_and_quarterless_quarterly_row():
    with pytest.raises(ValueError, match="statement type"):
        market_data.fhsc_financials("FPT", financial_payload(), statement_type="notes", period="year")
    with pytest.raises(ValueError, match="missing quarter"):
        market_data.fhsc_financials(
            "FPT", financial_payload([{"year": 2025}]), statement_type="income-statement", period="quarterly"
        )


def test_financial_rejects_non_finite_metric():
    with pytest.raises(ValueError, match="numeric"):
        market_data.fhsc_financials(
            "FPT", financial_payload([{"year": 2025, "chiphilaivay": float("nan")}]),
            statement_type="cash-flow", period="year",
        )


@pytest.mark.parametrize(
    "call",
    [
        lambda: market_data.fhsc_history("FPT", envelope({}, error_code="AUTH_SIGNATURE_INVALID", message="bad")),
        lambda: market_data.fhsc_quote("FPT", envelope({"symbol": "FPT"}, error_code="429", message="slow down")),
        lambda: market_data.fhsc_listing("FPT", envelope({}, error_code="404", message="Not found")),
        lambda: market_data.fhsc_financials("FPT", envelope([], error_code="500", message="boom"),
                                           statement_type="cash-flow", period="year"),
    ],
)
def test_error_envelopes_are_never_returned_as_data(call):
    with pytest.raises(ValueError, match="FHSC error"):
        call()


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [],
        {"error_code": "0", "message": "success"},
        {"error_code": "0", "data": {}},
        {"error_code": 0, "message": "success", "data": {}},
    ],
)
def test_malformed_envelopes_are_rejected(payload):
    with pytest.raises(ValueError):
        market_data.fhsc_quote("FPT", payload)


def test_symbol_mismatch_is_rejected_across_families():
    with pytest.raises(ValueError, match="mismatch"):
        market_data.fhsc_history("FPT", history_payload(symbol="VNM"))
    with pytest.raises(ValueError, match="mismatch"):
        market_data.fhsc_quote("FPT", quote_payload(symbol="vnm"))
    with pytest.raises(ValueError, match="mismatch"):
        market_data.fhsc_listing("FPT", listing_payload(symbol=None))
