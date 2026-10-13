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


def test_explicit_amount_unit_and_scale_are_evidence_not_magnitude(envelope):
    envelope["raw"]["scale"] = 1_000_000
    decoded = decode_vietcap_financial_record(envelope)
    assert decoded["values"]["revenue"] == 12_000_000
    assert decoded["fieldEvidence"]["revenue"]["unitEvidence"]["scales"] == [1_000_000]
    assert envelope["raw"]["random_amount"] == 12


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
    assert rows[0].flow_basis is None
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
async def test_cache_storage_keeps_lineage_and_clears_uncertified_metrics(envelope, monkeypatch):
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
    assert rows[0]["net_income"] is None
    assert rows[0]["raw_data"]["descriptorEvidence"] == envelope["descriptorEvidence"]
    assert rows[0]["raw_data"]["rawFiscalBasis"] == envelope["rawFiscalBasis"]


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
    assert f"WHERE {model.__tablename__}.source {'IN' if price else '='}" in str(statement)
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
    session.execute.return_value = result
    row = {"symbol": "VNM", "period": "2025", "period_type": "year", "source": "VCI", "eps": 99}
    with pytest.raises(StructuredPersistenceConflict) as raised:
        await CacheManager(session)._store_rows(FinancialRatio, [row], ["symbol", "period", "period_type"])
    assert raised.value.conflicting_keys == [{"table": "financial_ratios", "symbol": "VNM", "period": "2025", "period_type": "year"}]
    statement = session.execute.call_args.args[0].compile(dialect=dialect())
    assert "financial_ratios.source NOT IN" in str(statement)
    assert ["vietcap", "vietcap_vnd"] in statement.params.values()
