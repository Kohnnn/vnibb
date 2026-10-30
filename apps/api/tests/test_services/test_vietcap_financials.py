"""IQ descriptor regressions; fixture codes are deliberately unrelated to provider codes."""

from copy import deepcopy
from datetime import date
from unittest.mock import AsyncMock

import pytest
from vnibb.services.vietcap_financials import (
    decode_vietcap_financial_record,
    financial_fiscal_basis,
    load_vietcap_financial_rows,
    persist_vietcap_financials,
    persist_vietcap_listings,
    persist_vietcap_prices,
)


@pytest.fixture
def envelope():
    return {
        "symbol": "VNM", "dataset": "finance.income_statement", "datasetVariant": "finance.income_statement.year",
        "source": "vietcap", "providerSource": "vietcap", "comTypeCode": "CT",
        "receivedAt": "2026-10-13T01:00:00Z", "observedAt": "2026-10-13T01:00:00Z",
        "rawFiscalBasis": {"yearReport": 2025, "lengthReport": 5},
        "raw": {"yearReport": 2025, "lengthReport": 5, "random_amount": 12, "random_eps": 0,
                "publicDate": "2026-03-04T00:00:00", "unit": "VND"},
        "descriptors": [
            {"field": "random_amount", "name": "AMOUNT", "parent": None, "fullTitleEn": "Net sales", "titleEn": "Net sales"},
            {"field": "random_eps", "name": "EPS", "parent": None, "fullTitleEn": "EPS basic (VND)"},
        ],
        "descriptorEvidence": {"symbol": "VNM", "section": "INCOME_STATEMENT", "comTypeCode": "CT", "source": "vietcap",
                               "endpoint": "/v1/company/VNM/financial-statement/metrics", "receivedAt": "2026-10-13T01:00:00Z"},
    }


def test_decodes_descriptor_code_not_fixed_provider_code_and_preserves_zero(envelope):
    envelope["raw"].pop("unit")
    decoded = decode_vietcap_financial_record(envelope)
    assert decoded["values"] == {"eps": 0}
    assert decoded["unavailable"]["revenue"] == "unit_unverified"
    assert decoded["fieldEvidence"]["eps"]["unit"] == "VND/share"
    assert decoded["fiscalBasis"]["publicationDate"] == "2026-03-04T00:00:00"
    assert decoded["fiscalBasis"]["quarterBasis"] == "unknown"


@pytest.mark.parametrize("field", ["eps_diluted", "epsDiluted", "dilutedEps"])
def test_income_provider_withholds_unitless_diluted_eps_zero(field):
    from vnibb.providers.vnstock.income_statement import (
        IncomeStatementQueryParams,
        VnstockIncomeStatementFetcher,
    )

    rows = VnstockIncomeStatementFetcher.transform_data(
        IncomeStatementQueryParams(symbol="FPT"), [{"yearReport": 2025, field: 0}],
    )
    assert rows[0].eps_diluted is None


@pytest.mark.parametrize("failure", ["null", "source", "scope", "fiscal"])
def test_diluted_eps_requires_numeric_value_and_verified_identity(envelope, failure):
    envelope["raw"].pop("unit")
    envelope["raw"]["arbitrary_diluted"] = None if failure == "null" else 1507
    envelope["descriptors"].append({"field": "arbitrary_diluted", "parent": None,
                                    "fullTitleEn": "EPS diluted (VND)"})
    if failure == "source":
        envelope["source"] = "VCI"
    elif failure == "scope":
        envelope["descriptorEvidence"]["symbol"] = "FPT"
    elif failure == "fiscal":
        envelope["raw"]["fiscalYear"] = 2024
    decoded = decode_vietcap_financial_record(envelope)
    if failure == "fiscal":
        assert decoded["fiscalBasis"]["period"] is None
    else:
        assert "eps_diluted" not in decoded["values"]
        assert decoded["unavailable"]["eps_diluted"] == {
            "null": "value_unavailable", "source": "descriptor_unavailable", "scope": "descriptor_scope_unverified",
        }[failure]


def test_explicit_amount_unit_and_scale_are_evidence_not_magnitude(envelope):
    envelope["raw"]["scale"] = 1_000_000
    decoded = decode_vietcap_financial_record(envelope)
    assert decoded["values"]["revenue"] == 12_000_000
    assert decoded["fieldEvidence"]["revenue"]["unitEvidence"]["scales"] == [1_000_000]
    assert envelope["raw"]["random_amount"] == 12


def scoped_response(envelope, **metadata):
    envelope["sourceResponse"] = {"receivedAt": envelope["receivedAt"], **metadata}
    section = envelope["descriptorEvidence"]["section"]
    envelope["responseEvidence"] = {
        "symbol": envelope["symbol"], "section": section, "comTypeCode": envelope["comTypeCode"],
        "source": "vietcap", "receivedAt": envelope["receivedAt"],
        "endpoint": f"/v1/company/{envelope['symbol']}/financial-statement?section={section}",
    }


@pytest.mark.asyncio
async def test_scoped_response_amount_and_flow_metadata_survive_sql_lineage(envelope):
    envelope["raw"].pop("unit")
    envelope["datasetVariant"] = "finance.income_statement.quarter"
    envelope["raw"]["lengthReport"] = 2
    scoped_response(envelope, unit="VND", currency="VND", scale=1_000_000,
                    flowBasis="single_quarter", consolidationBasis="consolidated")
    original = deepcopy(envelope)
    cache = AsyncMock()
    cache.store_financial_data.return_value = 1
    assert await persist_vietcap_financials([envelope], cache_manager=cache) == 1
    row = cache.store_financial_data.call_args.args[3][0]
    assert row["revenue"] == 12_000_000
    lineage = row["raw_data"]["_financial_lineage"]
    assert lineage["flow_basis"] == "single_quarter"
    assert lineage["consolidation_basis"] == "consolidated"
    assert row["raw_data"]["sourceResponse"] == original["sourceResponse"]
    assert row["raw_data"]["responseEvidence"] == original["responseEvidence"]
    assert lineage["unit_metadata"]["revenue"]["unitEvidence"]["responseEvidence"] == original["responseEvidence"]
    assert envelope == original


@pytest.mark.parametrize("change", ["no_scope", "wrong_symbol", "wrong_section", "wrong_endpoint", "declared_symbol", "wrong_receipt", "wrong_year", "wrong_quarter", "wrong_variant", "unit_conflict", "flow_conflict"])
def test_unscoped_or_conflicting_response_metadata_never_admits_amounts(envelope, change):
    envelope["raw"].pop("unit")
    envelope["datasetVariant"] = "finance.income_statement.quarter"
    envelope["raw"]["lengthReport"] = 2
    scoped_response(envelope, unit="VND", flowBasis="single_quarter")
    if change == "no_scope":
        envelope.pop("responseEvidence")
    elif change in {"wrong_symbol", "wrong_section", "wrong_endpoint"}:
        envelope["responseEvidence"][change.removeprefix("wrong_")] = "WRONG"
    elif change == "declared_symbol":
        envelope["sourceResponse"]["symbol"] = "FPT"
    elif change in {"wrong_receipt", "wrong_year", "wrong_quarter", "wrong_variant"}:
        key, value = {"wrong_receipt": ("receivedAt", "2026-01-01"), "wrong_year": ("fiscalYear", 2024),
                      "wrong_quarter": ("fiscalQuarter", 3), "wrong_variant": ("datasetVariant", "finance.income_statement.year")}[change]
        envelope["sourceResponse"][key] = value
    elif change == "unit_conflict":
        envelope["raw"]["unit"] = "billion VND"
    else:
        envelope["raw"]["flowBasis"] = "cumulative_ytd"
    decoded = decode_vietcap_financial_record(envelope)
    assert "revenue" not in decoded["values"]


def test_response_status_does_not_manufacture_units(envelope):
    envelope["raw"].pop("unit")
    scoped_response(envelope, status=200, code=0, successful=True)
    decoded = decode_vietcap_financial_record(envelope)
    assert decoded["values"] == {"eps": 0}
    assert decoded["unavailable"]["revenue"] == "unit_unverified"

@pytest.mark.parametrize("section", [None, "BALANCE_SHEET", "INCOME_STATEMENT"])
def test_multisection_metrics_response_requires_explicit_section(envelope, section):
    envelope["raw"].pop("unit")
    metadata = {"receivedAt": envelope["receivedAt"], "unit": "VND", "scale": 1_000_000}
    if section is not None:
        metadata["section"] = section
    envelope["descriptorEvidence"]["sourceResponse"] = metadata
    decoded = decode_vietcap_financial_record(envelope)
    assert decoded["values"].get("revenue") == (12_000_000 if section == "INCOME_STATEMENT" else None)



@pytest.mark.parametrize("change", ["repeated_code", "repeated_label", "null_value", "missing_parent", "cycle"])
def test_repeated_null_and_hierarchy_descriptors_are_not_guessed(envelope, change):
    descriptor = envelope["descriptors"][0]
    if change == "repeated_code":
        envelope["descriptors"].append(deepcopy(descriptor))
    elif change == "repeated_label":
        envelope["descriptors"].append({**descriptor, "field": "other", "name": "OTHER"})
        envelope["raw"]["other"] = 99
    elif change == "null_value":
        envelope["raw"]["random_amount"] = None
    elif change == "missing_parent":
        descriptor["parent"] = "MISSING"
    else:
        descriptor["parent"] = descriptor["name"]
    decoded = decode_vietcap_financial_record(envelope)
    assert "revenue" not in decoded["values"]
    assert decoded["unavailable"]["revenue"] in {"ambiguous_descriptor", "value_unavailable"}
    assert decoded["fieldEvidence"]["revenue"]["descriptors"]


def test_parent_resolves_original_name_without_lowercase_code_guess(envelope):
    envelope["descriptors"].insert(0, {"field": "parent_field", "name": "PARENT_NAME", "parent": None, "titleEn": "Financial section"})
    envelope["descriptors"][1]["parent"] = "PARENT_NAME"
    assert decode_vietcap_financial_record(envelope)["values"]["revenue"] == 12


@pytest.mark.parametrize("change", ["source", "com_type", "year_conflict", "unit_conflict"])
def test_scope_fiscal_and_unit_conflicts_stay_unavailable(envelope, change):
    if change == "source":
        envelope["source"] = "VCI"
    elif change == "com_type":
        envelope["descriptorEvidence"]["comTypeCode"] = "NH"
    elif change == "year_conflict":
        envelope["raw"]["year"] = 2024
    else:
        envelope["descriptors"][0]["unit"] = "USD"
    decoded = decode_vietcap_financial_record(envelope)
    if change == "year_conflict":
        assert decoded["fiscalBasis"]["period"] is None
    else:
        assert "revenue" not in decoded["values"]


def test_actual_annual_ratio_quarter_five_requires_ratio_year(envelope):
    envelope.update(dataset="finance.ratio", datasetVariant="finance.ratio.year", descriptors=None)
    envelope["raw"].update(quarter=5, ratioType="RATIO_YEAR", ratioYearId=123)
    envelope["period"] = "2025-Q5"
    assert financial_fiscal_basis(envelope)["period"] is None
    envelope["period"] = "2025"
    assert decode_vietcap_financial_record(envelope)["fiscalBasis"]["period"] == "2025"
    envelope["raw"]["ratioType"] = "RATIO_TTM"
    assert decode_vietcap_financial_record(envelope)["fiscalBasis"]["period"] is None


@pytest.mark.parametrize("location", ["envelope", "raw"])
@pytest.mark.parametrize("period_type,expected", [("year", "2025"), (" YEAR ", "2025"), ("quarter", None), ("ttm", None)])
def test_explicit_period_type_agrees_with_dataset_variant(envelope, location, period_type, expected):
    target = envelope if location == "envelope" else envelope["raw"]
    target["periodType"] = period_type
    assert financial_fiscal_basis(envelope)["period"] == expected
    assert decode_vietcap_financial_record(envelope)["fiscalBasis"]["period"] == expected


def test_fiscal_identity_requires_exact_dataset_variant_and_explicit_year(envelope):
    envelope["datasetVariant"] = "finance.balance_sheet.year"
    assert financial_fiscal_basis(envelope)["period"] is None
    envelope["datasetVariant"] = "finance.income_statement.year"
    envelope["raw"].pop("yearReport")
    assert financial_fiscal_basis(envelope)["period"] is None


@pytest.mark.parametrize("quarter", [None, 0, 2, 5])
@pytest.mark.parametrize("ttm_evidence", [{"ratioType": "RATIO_TTM"}, {"ratioTTMId": 123}])
def test_explicit_ttm_ratio_never_becomes_annual_or_quarterly(envelope, quarter, ttm_evidence):
    variant = "quarter" if quarter == 2 else "year"
    envelope.update(dataset="finance.ratio", datasetVariant=f"finance.ratio.{variant}")
    envelope["raw"] = {"year": 2025, "quarter": quarter, **ttm_evidence}
    assert financial_fiscal_basis(envelope)["period"] is None


@pytest.mark.parametrize("basis,reason", [(None, "quarter_basis_unverified"), ("cumulative_ytd", "incompatible_quarter_basis"), ("single_quarter", None)])
def test_quarter_flow_requires_explicit_compatible_basis(envelope, basis, reason):
    envelope["datasetVariant"] = "finance.income_statement.quarter"
    envelope["raw"].update(lengthReport=2)
    if basis is not None:
        envelope["raw"]["flowBasis"] = basis
    decoded = decode_vietcap_financial_record(envelope)
    assert decoded["fiscalBasis"]["quarterBasis"] == (basis or "unknown")
    assert decoded["fiscalBasis"]["consolidation"] == "unknown"
    if reason:
        assert "revenue" not in decoded["values"]
        assert decoded["unavailable"]["revenue"] == reason
    else:
        assert decoded["values"]["revenue"] == 12


def test_unknown_quarter_scope_does_not_withhold_explicit_eps_dimension(envelope):
    envelope["datasetVariant"] = "finance.income_statement.quarter"
    envelope["raw"].update(lengthReport=2)
    envelope["raw"].pop("unit")
    decoded = decode_vietcap_financial_record(envelope)
    assert decoded["values"] == {"eps": 0}
    assert decoded["fieldEvidence"]["eps"]["unit"] == "VND/share"
    assert decoded["fieldEvidence"]["eps"]["fiscalBasis"]["consolidation"] == "unknown"


def test_conflicting_explicit_quarter_basis_is_not_admitted(envelope):
    envelope["datasetVariant"] = "finance.income_statement.quarter"
    envelope["raw"].update(lengthReport=2, flowBasis="single_quarter", quarterBasis="cumulative_ytd")
    decoded = decode_vietcap_financial_record(envelope)
    assert "revenue" not in decoded["values"]
    assert decoded["fiscalBasis"]["quarterBasis"] == "unknown"


@pytest.mark.parametrize("identity", [{"fiscalYear": 2024}, {"fiscalQuarter": 3}, {"period": "Q3-2024"}])
def test_every_supplied_fiscal_identity_must_agree(envelope, identity):
    envelope["datasetVariant"] = "finance.income_statement.quarter"
    envelope["raw"].update(lengthReport=2, flowBasis="single_quarter", **identity)
    assert decode_vietcap_financial_record(envelope)["fiscalBasis"]["period"] is None


@pytest.mark.parametrize("unit", ["VND", "VND/share", "million"])
def test_amount_scale_cannot_manufacture_eps_per_share_units(envelope, unit):
    envelope["raw"].pop("unit")
    envelope["descriptors"][1].update(unit=unit, currency="VND", scale=1_000_000)
    envelope["raw"]["random_eps"] = 2
    decoded = decode_vietcap_financial_record(envelope)
    assert "eps" not in decoded["values"]
    assert decoded["unavailable"]["eps"] == "unit_unverified"


@pytest.mark.asyncio
async def test_reader_retains_explicit_basis_without_inferring_unknown_scope(envelope, monkeypatch):
    from vnibb.services import mongo_market_data_service as mongo_module

    envelope["datasetVariant"] = "finance.income_statement.quarter"
    envelope["raw"].update(lengthReport=2, flowBasis="single_quarter")
    service = AsyncMock()
    service.get_raw_dataset_records_precise.return_value = [envelope]
    monkeypatch.setattr(mongo_module, "get_mongo_market_data_service", lambda: service)
    rows = await load_vietcap_financial_rows("VNM", "finance.income_statement", period="quarter")
    assert rows[0].flow_basis == "single_quarter"
    assert rows[0].consolidation_basis is None
    assert rows[0].raw_data["structured"]["fiscalBasis"]["consolidation"] == "unknown"


@pytest.mark.asyncio
async def test_reader_uses_acquired_envelopes_without_database_and_filters_scope(envelope, monkeypatch):
    from vnibb.services import mongo_market_data_service as mongo_module

    def unavailable():
        raise AssertionError("Supplied acquisition must not read Mongo")

    monkeypatch.setattr(mongo_module, "get_mongo_market_data_service", unavailable)
    rows = await load_vietcap_financial_rows("VNM", "finance.income_statement", records=[
        {**envelope, "dataset": "finance.balance_sheet"}, envelope, {**envelope, "symbol": "FPT"},
    ])
    assert len(rows) == 1
    assert rows[0].revenue == 12


@pytest.mark.asyncio
async def test_sql_quarter_bridge_uses_existing_canonical_lineage(envelope):
    envelope["datasetVariant"] = "finance.income_statement.quarter"
    envelope["raw"].update(lengthReport=2, flowBasis="single_quarter")
    cache = AsyncMock()
    cache.store_financial_data.return_value = 1
    await persist_vietcap_financials([envelope], cache_manager=cache)
    lineage = cache.store_financial_data.call_args.args[3][0]["raw_data"]["_financial_lineage"]
    assert lineage["flow_basis"] == "single_quarter"
    assert lineage["value_unit"] == "VND"
    assert lineage["consolidation_basis"] is None
    assert lineage["canonical_data"]["revenue"] == 12
    assert lineage["canonical_data"]["period"] == "Q2-2025"
    assert lineage["canonical_data"]["statement_type"] == "income"


@pytest.mark.asyncio
async def test_persistence_uses_existing_cache_api_and_retains_full_envelope(envelope):
    cache = AsyncMock()
    cache.store_financial_data.return_value = 1
    assert await persist_vietcap_financials([envelope], cache_manager=cache) == 1
    args = cache.store_financial_data.call_args
    assert args.args[:3] == ("VNM", "income", "year")
    row = args.args[3][0]
    assert row["revenue"] == 12
    assert row["raw_data"]["raw"] == envelope["raw"]
    assert row["raw_data"]["descriptors"] == envelope["descriptors"]
    assert row["raw_data"]["receivedAt"] == envelope["receivedAt"]
    assert row["raw_data"]["structured"]["fiscalBasis"]["consolidation"] == "unknown"
    assert args.kwargs == {"source": "vietcap"}


@pytest.mark.asyncio
async def test_all_unavailable_is_explicit_not_raw_only_success(envelope):
    envelope["descriptors"] = None
    cache = AsyncMock()
    with pytest.raises(ValueError, match="structured financials unavailable"):
        await persist_vietcap_financials([envelope], cache_manager=cache)
    cache.store_financial_data.assert_not_awaited()


@pytest.mark.asyncio
async def test_bounded_reader_retains_model_evidence(envelope, monkeypatch):
    from vnibb.services import mongo_market_data_service as mongo_module

    reader = AsyncMock(return_value=[envelope])
    service = AsyncMock()
    service.get_raw_dataset_records_precise = reader
    monkeypatch.setattr(mongo_module, "get_mongo_market_data_service", lambda: service)
    rows = await load_vietcap_financial_rows("VNM", "finance.income_statement", limit=3)
    reader.assert_awaited_once_with("VNM", dataset="finance.income_statement", variant="finance.income_statement.year", source="vietcap", limit=3)
    assert rows[0].revenue == 12
    assert rows[0].raw_data["descriptors"] == envelope["descriptors"]
    assert rows[0].source == "vietcap"
    assert rows[0].flow_basis == "annual"
    assert rows[0].value_unit == "VND"


@pytest.mark.asyncio
async def test_price_bridge_requires_explicit_vnd_and_valid_date():
    cache = AsyncMock()
    cache.store_historical_prices.return_value = 1
    row = {"symbol": "VNM", "source": "vietcap", "priceUnit": "VND", "time": "2026-10-12", "open": 10, "high": 12, "low": 9, "close": 11, "volume": 0}
    assert await persist_vietcap_prices("VNM", [row], cache_manager=cache) == 1
    assert cache.store_historical_prices.call_args.args[1][0]["time"] == date(2026, 10, 12)
    assert cache.store_historical_prices.call_args.kwargs == {"source": "vietcap_vnd"}
    with pytest.raises(ValueError, match="explicit VND"):
        await persist_vietcap_prices("VNM", [{**row, "priceUnit": "unknown"}], cache_manager=cache)


@pytest.mark.asyncio
async def test_listing_bridge_joins_actual_search_fields_without_fake_shares():
    cache = AsyncMock()
    cache.store_listing_data.return_value = 1
    trading = [{"symbol": "VNM", "type": "STOCK", "board": "HSX", "organName": "Trading Name", "organShortName": "VINAMILK"}]
    search = [{"code": "VNM", "name": "Search Name", "icbLv4": {"code": "FOOD", "name": "Food"}, "icbLv1": {"name": "Consumer"}}]
    assert await persist_vietcap_listings(trading, search, cache_manager=cache) == 1
    row = cache.store_listing_data.call_args.args[0][0]
    assert row == {"symbol": "VNM", "company_name": "Search Name", "short_name": "VINAMILK", "exchange": "HOSE", "is_active": 1, "industry": "Food", "sector": "Consumer"}
    assert cache.store_listing_data.call_args.kwargs == {"source": "vietcap"}


@pytest.mark.asyncio
async def test_listing_bridge_keeps_delisted_stock_without_search_and_rejects_nonstock():
    cache = AsyncMock()
    cache.store_listing_data.return_value = 1
    trading = [{"symbol": "OLD", "type": "STOCK", "board": "DELISTED", "organName": "Old"}, {"symbol": "CW1", "type": "CW", "board": "HSX"}]
    assert await persist_vietcap_listings(trading, [], cache_manager=cache) == 1
    rows = cache.store_listing_data.call_args.args[0]
    assert len(rows) == 1 and rows[0]["symbol"] == "OLD" and rows[0]["is_active"] == 0


@pytest.mark.asyncio
async def test_partial_dataset_failure_persists_reachable_rows_before_reporting(envelope):
    unsupported = {**envelope, "dataset": "finance.balance_sheet", "datasetVariant": "finance.balance_sheet.year", "descriptors": None}
    cache = AsyncMock()
    cache.store_financial_data.return_value = 1
    from vnibb.services.vietcap_financials import StructuredFinancialUnavailable
    with pytest.raises(StructuredFinancialUnavailable, match="persisted 1 rows.*finance.balance_sheet") as raised:
        await persist_vietcap_financials([envelope, unsupported], cache_manager=cache)
    assert raised.value.persisted_rows == 1
    assert raised.value.unavailable_groups == [("VNM", "finance.balance_sheet", "year")]
    cache.store_financial_data.assert_awaited_once()


@pytest.mark.asyncio
async def test_cache_storage_keeps_lineage_without_inventing_null_metrics(envelope, monkeypatch):
    from vnibb.services.cache_manager import CacheManager

    cache = CacheManager()
    writer = AsyncMock(return_value=1)
    monkeypatch.setattr(cache, "_store_rows", writer)
    assert await persist_vietcap_financials([envelope], cache_manager=cache) == 1
    model, rows, keys = writer.call_args.args
    assert model.__tablename__ == "income_statements"
    assert keys == ["symbol", "period", "period_type"]
    assert rows[0]["source"] == "vietcap"
    assert rows[0]["revenue"] == 12
    assert "net_income" not in rows[0]
    assert rows[0]["raw_data"]["descriptorEvidence"] == envelope["descriptorEvidence"]
    assert rows[0]["raw_data"]["rawFiscalBasis"] == envelope["rawFiscalBasis"]

@pytest.mark.asyncio
@pytest.mark.parametrize("statement_type", ["income", "balance", "cashflow", "ratio"])
async def test_structured_writer_rejects_issuer_before_database_access(monkeypatch, statement_type):
    from vnibb.services.cache_manager import CacheManager

    cache = CacheManager()
    writer = AsyncMock()
    monkeypatch.setattr(cache, "_store_rows", writer)
    with pytest.raises(ValueError, match="issuer_report persistence is not enabled"):
        await cache.store_financial_data("FPT", statement_type, "year", [{
            "fiscal_year": 2025, "period": "2025", "revenue": 100,
        }], source="issuer_report")
    writer.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["vietcap", "vietcap_vnd", "VCI", "vnstock"])
async def test_structured_refresh_does_not_overwrite_retained_issuer_row(test_db, source):
    from sqlalchemy import select
    from vnibb.models import IncomeStatement
    from vnibb.services.cache_manager import CacheManager, StructuredPersistenceConflict

    raw = {"original": "retained"}
    test_db.add(IncomeStatement(id=186780, symbol="FPT", period="2025", period_type="year",
        fiscal_year=2025, source="issuer_report", revenue=0, raw_data=raw))
    await test_db.commit()
    with pytest.raises(StructuredPersistenceConflict):
        await CacheManager(test_db).store_financial_data("FPT", "income", "year", [{
            "fiscal_year": 2025, "period": "2025", "revenue": 100,
        }], source=source)
    test_db.expire_all()
    stored = (await test_db.execute(select(IncomeStatement).where(IncomeStatement.id == 186780))).scalar_one()
    assert (stored.source, stored.revenue, stored.raw_data) == ("issuer_report", 0, raw)


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["VCI", "vnstock", "derived", None])
async def test_pipeline_source_guard_preserves_retained_issuer_atomically(test_db, source):
    from sqlalchemy import select, update
    from vnibb.models import IncomeStatement
    from vnibb.services.cache_manager import source_update_condition

    test_db.add(IncomeStatement(id=186780, symbol="FPT", period="2025", period_type="year",
        fiscal_year=2025, source="issuer_report", revenue=-42, raw_data={"original": "retained"}))
    await test_db.commit()
    await test_db.execute(update(IncomeStatement).where(
        IncomeStatement.id == 186780, source_update_condition(IncomeStatement, source),
    ).values(source=source, revenue=100))
    await test_db.commit()
    test_db.expire_all()
    stored = (await test_db.execute(select(IncomeStatement).where(IncomeStatement.id == 186780))).scalar_one()
    assert (stored.source, stored.revenue, stored.raw_data) == ("issuer_report", -42, {"original": "retained"})


@pytest.mark.asyncio
@pytest.mark.parametrize("refresh", ["missing_eps", "missing_raw", "alternate_source", "changed_receipt", "changed_metric",
                                     "list_scalar_type", "list_length", "list_order"])
async def test_readthrough_retains_existing_admitted_evidence(test_db, envelope, refresh):
    from datetime import datetime

    from sqlalchemy import select
    from vnibb.models import IncomeStatement
    from vnibb.services.cache_manager import CacheManager

    prepared = AsyncMock()
    prepared.store_financial_data.return_value = 1
    await persist_vietcap_financials([envelope], cache_manager=prepared)
    incoming = prepared.store_financial_data.call_args.args[3][0]
    retained_raw = deepcopy(incoming["raw_data"])
    retained_raw["_transferOrigin"] = {"receipt": "approved-original"}
    retained_raw["_financial_lineage"]["canonical_data"]["eps_diluted"] = 1507.0
    retained_raw["structured"]["values"]["eps_diluted"] = 1507.0
    retained_raw["retainedEvidence"] = [{"flag": True}, {"flag": False}]
    retained_at = datetime(2026, 10, 14)
    test_db.add(IncomeStatement(id=186780, symbol="VNM", period="2025", period_type="year",
        fiscal_year=2025, source="vietcap", revenue=12, eps=0, eps_diluted=1507,
        raw_data=retained_raw, updated_at=retained_at))
    await test_db.commit()
    source = "vietcap"
    if refresh == "missing_raw":
        incoming.pop("raw_data")
    elif refresh == "alternate_source":
        source = "vietcap_vnd"
    elif refresh != "missing_eps":
        incoming["raw_data"] = deepcopy(retained_raw)
        incoming["eps_diluted"] = 1507.0
        if refresh == "changed_receipt":
            incoming["raw_data"]["receivedAt"] = "2026-10-16T05:33:50Z"
        elif refresh == "list_scalar_type":
            incoming["raw_data"]["retainedEvidence"][0]["flag"] = 1
        elif refresh == "list_length":
            incoming["raw_data"]["retainedEvidence"].append({"flag": True})
        elif refresh == "list_order":
            incoming["raw_data"]["retainedEvidence"].reverse()
        else:
            incoming["revenue"] = 99
    assert await CacheManager(test_db).store_financial_data("VNM", "income", "year", [incoming], source=source) == 1
    test_db.expire_all()
    stored = (await test_db.execute(select(IncomeStatement).where(IncomeStatement.id == 186780))).scalar_one()
    assert (stored.eps_diluted, stored.revenue, stored.raw_data, stored.updated_at) == (1507, 12, retained_raw, retained_at)


@pytest.mark.asyncio
async def test_readthrough_allows_additive_decoder_enrichment(test_db, envelope):
    from sqlalchemy import select
    from vnibb.models import IncomeStatement
    from vnibb.services.cache_manager import CacheManager

    prepared = AsyncMock()
    prepared.store_financial_data.return_value = 1
    await persist_vietcap_financials([envelope], cache_manager=prepared)
    incoming = prepared.store_financial_data.call_args.args[3][0]
    original_raw = deepcopy(incoming["raw_data"])
    test_db.add(IncomeStatement(id=186780, symbol="VNM", period="2025", period_type="year",
        fiscal_year=2025, source="vietcap", revenue=12, eps=0, raw_data=original_raw))
    await test_db.commit()
    incoming["eps_diluted"] = 1507.0
    incoming["raw_data"]["structured"]["values"]["eps_diluted"] = 1507.0
    incoming["raw_data"]["_financial_lineage"]["canonical_data"]["eps_diluted"] = 1507.0
    evidence = {"unit": "VND/share", "descriptors": [{"fullTitleEn": "EPS diluted (VND)"}]}
    incoming["raw_data"]["structured"]["unavailable"].pop("eps_diluted", None)
    incoming["raw_data"]["structured"]["fieldEvidence"]["eps_diluted"] = evidence
    incoming["raw_data"]["_financial_lineage"]["unit_metadata"]["eps_diluted"] = evidence
    incoming["raw_data"]["_financial_lineage"]["canonical_data"]["unit_metadata"]["eps_diluted"] = evidence
    assert await CacheManager(test_db).store_financial_data("VNM", "income", "year", [incoming]) == 1
    test_db.expire_all()
    stored = (await test_db.execute(select(IncomeStatement).where(IncomeStatement.id == 186780))).scalar_one()
    assert (stored.eps_diluted, stored.raw_data) == (1507, incoming["raw_data"])


def test_ratio_requires_descriptor_and_explicit_numeric_unit(envelope):
    envelope.update(dataset="finance.ratio", datasetVariant="finance.ratio.quarter")
    envelope["raw"] = {"year": 2025, "quarter": 2, "percent_field": 0.4}
    envelope["descriptorEvidence"]["section"] = "RATIO"
    envelope["descriptors"] = [{"field": "percent_field", "parent": None, "fullTitleEn": "Return on equity", "unit": "percent"}]
    decoded = decode_vietcap_financial_record(envelope)
    assert decoded["values"]["roe"] == 0.4
    assert decoded["fieldEvidence"]["roe"]["unit"] == "percent"
    envelope["descriptors"][0].pop("unit")
    envelope["descriptors"][0]["fullTitleEn"] = "Return on equity (%)"
    assert "roe" not in decode_vietcap_financial_record(envelope)["values"]


@pytest.mark.parametrize("value,unit,expected", [(0.25, "fraction", 25.0), (6.3257, "percent", 6.3257), (0, "percent", 0), (9.951, None, None)])
def test_iq_payout_requires_explicit_period_matched_units(envelope, value, unit, expected):
    envelope.update(dataset="finance.ratio", datasetVariant="finance.ratio.year")
    envelope["raw"] = {"year": 2025, "quarter": 5, "ratioType": "RATIO_YEAR", "payout_cell": value}
    envelope["descriptorEvidence"]["section"] = "RATIO"
    envelope["descriptors"] = [{"field": "payout_cell", "parent": None, "fullTitleEn": "Dividend payout ratio", "unit": unit}]
    decoded = decode_vietcap_financial_record(envelope)
    assert decoded["values"].get("payout_ratio") == expected
    if expected is not None:
        assert decoded["fieldEvidence"]["payout_ratio"]["unit"] == "percent"
        assert decoded["fieldEvidence"]["payout_ratio"]["fiscalBasis"]["period"] == "2025"


@pytest.mark.asyncio
@pytest.mark.parametrize("price", [False, True])
async def test_sql_upsert_preserves_non_iq_source_and_reports_conflicting_keys(monkeypatch, price):
    from types import SimpleNamespace
    from unittest.mock import Mock

    from sqlalchemy.dialects.postgresql import dialect
    from vnibb.models import IncomeStatement
    from vnibb.models.stock import StockPrice
    from vnibb.services.cache_manager import CacheManager, StructuredPersistenceConflict

    session = AsyncMock()
    session.get_bind = Mock(return_value=SimpleNamespace(dialect=dialect()))
    result = Mock()
    result.scalars.return_value.all.return_value = []
    result.scalar_one_or_none.return_value = None
    session.execute.return_value = result
    cache = CacheManager(session)
    model = StockPrice if price else IncomeStatement
    keys = ["symbol", "time", "interval"] if price else ["symbol", "period", "period_type"]
    row = {"symbol": "VNM", "source": "vietcap_vnd" if price else "vietcap"}
    row.update(time=date(2026, 10, 12), interval="1D") if price else row.update(period="2025", period_type="year", fiscal_year=2025)
    with pytest.raises(StructuredPersistenceConflict) as raised:
        await cache._store_rows(model, [row], keys)
    assert raised.value.persisted_rows == 0
    assert raised.value.conflicting_keys == [{"table": model.__tablename__, **{key: row[key] for key in keys}}]
    statement = session.execute.call_args.args[0].compile(dialect=dialect())
    assert (f"WHERE {model.__tablename__}.source IN" if price else "DO NOTHING") in str(statement)
    if price:
        assert next(value for value in statement.params.values() if isinstance(value, list)) == ["vietcap", "vietcap_vnd"]
    else:
        assert row["source"] in statement.params.values()
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_fresh_certified_price_replaces_owned_generic_iq_not_other_sources():
    from types import SimpleNamespace
    from unittest.mock import Mock

    from sqlalchemy.dialects.postgresql import dialect
    from vnibb.models.stock import StockPrice
    from vnibb.services.cache_manager import CacheManager

    session = AsyncMock()
    session.get_bind = Mock(return_value=SimpleNamespace(dialect=dialect()))
    result = Mock()
    result.scalars.return_value.all.return_value = [42]
    session.execute.return_value = result
    fresh = {"symbol": "VNM", "time": date(2026, 10, 12), "interval": "1D", "source": "vietcap_vnd", "close": 63000}
    assert await CacheManager(session)._store_rows(StockPrice, [fresh], ["symbol", "time", "interval"]) == 1
    statement = session.execute.call_args.args[0].compile(dialect=dialect())
    assert "WHERE stock_prices.source IN" in str(statement)
    allowed_sources = next(value for value in statement.params.values() if isinstance(value, list))
    assert allowed_sources == ["vietcap", "vietcap_vnd"]
    assert statement.params["close"] == 63000


@pytest.mark.asyncio
async def test_secondary_sql_writer_retains_primary_owner_and_conflict_evidence():
    from types import SimpleNamespace
    from unittest.mock import Mock

    from sqlalchemy.dialects.postgresql import dialect
    from vnibb.models.trading import FinancialRatio
    from vnibb.services.cache_manager import CacheManager, StructuredPersistenceConflict

    session = AsyncMock()
    session.get_bind = Mock(return_value=SimpleNamespace(dialect=dialect()))
    result = Mock()
    result.scalars.return_value.all.return_value = []
    result.scalar_one_or_none.return_value = None
    session.execute.return_value = result
    row = {"symbol": "VNM", "period": "2025", "period_type": "year", "source": "VCI", "eps": 99}
    with pytest.raises(StructuredPersistenceConflict) as raised:
        await CacheManager(session)._store_rows(FinancialRatio, [row], ["symbol", "period", "period_type"])
    assert raised.value.conflicting_keys == [{"table": "financial_ratios", "symbol": "VNM", "period": "2025", "period_type": "year"}]
    statement = session.execute.call_args.args[0].compile(dialect=dialect())
    assert "DO NOTHING" in str(statement)
    assert "VCI" in statement.params.values()
