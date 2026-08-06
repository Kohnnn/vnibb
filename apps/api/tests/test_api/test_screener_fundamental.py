from __future__ import annotations

import pytest

import vnibb.api.v1.screener as screener_module
from vnibb.api.v1.screener import (
    _apply_fundamental_filters,
    _apply_fundamental_enrichment,
)
from vnibb.providers.vnstock.equity_screener import ScreenerData


def _row(symbol: str = "VNM", **kwargs) -> ScreenerData:
    return ScreenerData(symbol=symbol, **kwargs)


def _no_params(rows):
    return _apply_fundamental_filters(
        rows,
        moat=None,
        margin_of_safety_min=None,
        margin_of_safety_max=None,
        dividend_years_min=None,
        fcf_positive=None,
    )


class TestApplyFundamentalFilters:
    def test_no_params_returns_rows_unchanged(self):
        rows = [_row("VNM"), _row("FPT", moat="wide")]
        assert _no_params(rows) == rows

    def test_no_params_keeps_null_field_rows(self):
        rows = [_row("VNM")]
        assert _no_params(rows) == rows

    def test_moat_filter_parses_csv_and_lowercases(self):
        rows = [
            _row("VNM", moat="wide"),
            _row("FPT", moat="narrow"),
            _row("HPG", moat="none"),
        ]
        result = _apply_fundamental_filters(
            rows,
            moat="Wide, NARROW",
            margin_of_safety_min=None,
            margin_of_safety_max=None,
            dividend_years_min=None,
            fcf_positive=None,
        )
        assert [r.symbol for r in result] == ["VNM", "FPT"]

    def test_moat_filter_excludes_null_moat(self):
        rows = [_row("VNM", moat="wide"), _row("FPT")]
        result = _apply_fundamental_filters(
            rows,
            moat="wide",
            margin_of_safety_min=None,
            margin_of_safety_max=None,
            dividend_years_min=None,
            fcf_positive=None,
        )
        assert [r.symbol for r in result] == ["VNM"]

    def test_margin_of_safety_min(self):
        rows = [
            _row("VNM", margin_of_safety=25.0),
            _row("FPT", margin_of_safety=5.0),
            _row("HPG"),
        ]
        result = _apply_fundamental_filters(
            rows,
            moat=None,
            margin_of_safety_min=10.0,
            margin_of_safety_max=None,
            dividend_years_min=None,
            fcf_positive=None,
        )
        assert [r.symbol for r in result] == ["VNM"]

    def test_margin_of_safety_max(self):
        rows = [
            _row("VNM", margin_of_safety=25.0),
            _row("FPT", margin_of_safety=5.0),
            _row("HPG"),
        ]
        result = _apply_fundamental_filters(
            rows,
            moat=None,
            margin_of_safety_min=None,
            margin_of_safety_max=10.0,
            dividend_years_min=None,
            fcf_positive=None,
        )
        assert [r.symbol for r in result] == ["FPT"]

    def test_dividend_years_min(self):
        rows = [
            _row("VNM", dividend_years=9),
            _row("FPT", dividend_years=2),
            _row("HPG"),
        ]
        result = _apply_fundamental_filters(
            rows,
            moat=None,
            margin_of_safety_min=None,
            margin_of_safety_max=None,
            dividend_years_min=5,
            fcf_positive=None,
        )
        assert [r.symbol for r in result] == ["VNM"]

    def test_fcf_positive_true_excludes_false_and_null(self):
        rows = [
            _row("VNM", fcf_positive=True),
            _row("FPT", fcf_positive=False),
            _row("HPG"),
        ]
        result = _apply_fundamental_filters(
            rows,
            moat=None,
            margin_of_safety_min=None,
            margin_of_safety_max=None,
            dividend_years_min=None,
            fcf_positive=True,
        )
        assert [r.symbol for r in result] == ["VNM"]

    def test_fcf_positive_false_keeps_only_explicit_false(self):
        rows = [
            _row("VNM", fcf_positive=True),
            _row("FPT", fcf_positive=False),
            _row("HPG"),
        ]
        result = _apply_fundamental_filters(
            rows,
            moat=None,
            margin_of_safety_min=None,
            margin_of_safety_max=None,
            dividend_years_min=None,
            fcf_positive=False,
        )
        assert [r.symbol for r in result] == ["FPT"]

    def test_combined_filters(self):
        rows = [
            _row("VNM", moat="wide", margin_of_safety=20.0, fcf_positive=True),
            _row("FPT", moat="wide", margin_of_safety=-5.0, fcf_positive=True),
            _row("HPG", moat="none", margin_of_safety=30.0, fcf_positive=True),
        ]
        result = _apply_fundamental_filters(
            rows,
            moat="wide",
            margin_of_safety_min=0.0,
            margin_of_safety_max=None,
            dividend_years_min=None,
            fcf_positive=True,
        )
        assert [r.symbol for r in result] == ["VNM"]


class _FakeMongoService:
    def __init__(self, *, enabled: bool = True, docs: dict | None = None, error: bool = False):
        self.enabled = enabled
        self._docs = docs or {}
        self._error = error
        self.requested_symbols: list[str] | None = None

    async def get_latest_fundamental_snapshots(self, symbols=None):
        if self._error:
            raise RuntimeError("mongo down")
        self.requested_symbols = symbols
        return self._docs


_CANNED_DOC = {
    "symbol": "VNM",
    "snapshotDate": "2026-06-10",
    "intrinsicValue": 78200.0,
    "marginOfSafety": 16.9,
    "moat": "narrow",
    "dividendYears": 9,
    "fcfPositive": True,
    "valuationMethod": "dcf",
}


@pytest.mark.asyncio
async def test_enrichment_attaches_fundamental_fields(monkeypatch):
    svc = _FakeMongoService(docs={"VNM": dict(_CANNED_DOC)})
    monkeypatch.setattr(screener_module, "get_mongo_market_data_service", lambda: svc)

    rows = [_row("VNM"), _row("FPT")]
    result, outcome = await _apply_fundamental_enrichment(rows)

    assert outcome == "ok"
    enriched = result[0]
    assert enriched.intrinsic_value == 78200.0
    assert enriched.margin_of_safety == 16.9
    assert enriched.moat == "narrow"
    assert enriched.dividend_years == 9
    assert enriched.fcf_positive is True
    assert enriched.valuation_method == "dcf"
    assert enriched.fundamental_as_of == "2026-06-10"
    assert svc.requested_symbols == ["VNM", "FPT"]

    untouched = result[1]
    assert untouched.intrinsic_value is None
    assert untouched.moat is None


@pytest.mark.asyncio
async def test_enrichment_skips_none_doc_values(monkeypatch):
    doc = dict(_CANNED_DOC)
    doc["moat"] = None
    doc["intrinsicValue"] = None
    svc = _FakeMongoService(docs={"VNM": doc})
    monkeypatch.setattr(screener_module, "get_mongo_market_data_service", lambda: svc)

    result, outcome = await _apply_fundamental_enrichment([_row("VNM")])

    assert outcome == "ok"
    assert result[0].moat is None
    assert result[0].intrinsic_value is None
    assert result[0].margin_of_safety == 16.9


@pytest.mark.asyncio
async def test_enrichment_returns_rows_unchanged_when_service_disabled(monkeypatch):
    svc = _FakeMongoService(enabled=False, docs={"VNM": dict(_CANNED_DOC)})
    monkeypatch.setattr(screener_module, "get_mongo_market_data_service", lambda: svc)

    rows = [_row("VNM")]
    result, outcome = await _apply_fundamental_enrichment(rows)

    assert outcome == "unavailable"
    assert result == rows
    assert result[0].intrinsic_value is None
    assert svc.requested_symbols is None


@pytest.mark.asyncio
async def test_enrichment_returns_rows_on_service_failure(monkeypatch):
    svc = _FakeMongoService(error=True)
    monkeypatch.setattr(screener_module, "get_mongo_market_data_service", lambda: svc)

    rows = [_row("VNM")]
    result, outcome = await _apply_fundamental_enrichment(rows)

    assert outcome == "failed"
    assert result == rows
    assert result[0].intrinsic_value is None


@pytest.mark.asyncio
async def test_enrichment_empty_rows_skips_service(monkeypatch):
    def _boom():
        raise AssertionError("service should not be requested for empty rows")

    monkeypatch.setattr(screener_module, "get_mongo_market_data_service", _boom)

    assert await _apply_fundamental_enrichment([]) == ([], "ok")


@pytest.mark.asyncio
async def test_screener_default_skips_fundamental_enrichment(client, monkeypatch):
    async def fake_fetch(_params):
        return [_row("VNM")]

    async def fail_enrich(_rows):
        raise AssertionError("default screener request should not query Mongo")

    monkeypatch.setattr(screener_module.VnstockScreenerFetcher, "fetch", fake_fetch)
    monkeypatch.setattr(screener_module, "_apply_fundamental_enrichment", fail_enrich)

    response = await client.get("/api/v1/screener/?limit=1&use_cache=false")

    assert response.status_code == 200
    assert response.json()["data"][0]["symbol"] == "VNM"


@pytest.mark.parametrize("query", ["include_fundamental=true", "fcf_positive=true"])
@pytest.mark.asyncio
async def test_screener_enriches_fundamentals_when_requested(client, monkeypatch, query):
    enrichment_calls = 0

    async def fake_fetch(_params):
        return [_row("VNM")]

    async def fake_enrich(rows):
        nonlocal enrichment_calls
        enrichment_calls += 1
        rows[0].fcf_positive = True
        return rows, "ok"

    monkeypatch.setattr(screener_module.VnstockScreenerFetcher, "fetch", fake_fetch)
    monkeypatch.setattr(screener_module, "_apply_fundamental_enrichment", fake_enrich)

    response = await client.get(f"/api/v1/screener/?limit=1&use_cache=false&{query}")

    assert response.status_code == 200
    assert response.json()["data"][0]["fcf_positive"] is True
    assert enrichment_calls == 1


_FCF_BLOB = '{"logic":"AND","conditions":[{"field":"fcf_positive","operator":"eq","value":true}]}'


async def _seed_screener_snapshots(session, symbols: list[str]) -> None:
    """Populate the Screener Snapshot so cache-path requests get a Candidate Set."""
    from datetime import date as _date

    from vnibb.models.screener import ScreenerSnapshot

    for sym in symbols:
        session.add(
            ScreenerSnapshot(
                symbol=sym,
                snapshot_date=_date.today(),
                exchange="HOSE",
                price=10000.0,
                source="vnstock_ratio",
            )
        )
    await session.commit()


@pytest.mark.asyncio
async def test_blob_only_fundamental_reference_triggers_enrichment(client, monkeypatch):
    """The request shape web actually sends: criteria live in the blob, not typed params."""
    enrichment_calls = 0

    async def fake_fetch(_params):
        return [_row("VNM"), _row("FPT")]

    async def fake_enrich(rows):
        nonlocal enrichment_calls
        enrichment_calls += 1
        for row in rows:
            row.fcf_positive = row.symbol == "VNM"
        return rows, "ok"

    monkeypatch.setattr(screener_module.VnstockScreenerFetcher, "fetch", fake_fetch)
    monkeypatch.setattr(screener_module, "_apply_fundamental_enrichment", fake_enrich)

    response = await client.get(
        f"/api/v1/screener/?limit=10&use_cache=false&filters={_FCF_BLOB}"
    )

    assert response.status_code == 200
    assert enrichment_calls == 1
    assert [r["symbol"] for r in response.json()["data"]] == ["VNM"]


@pytest.mark.asyncio
async def test_cached_fundamental_filter_reaches_beyond_the_page(client, monkeypatch, test_db):
    """The Candidate Set must be enriched before it is cut to a Page.

    Only the last symbol has positive FCF. With a limit of 2 it survives only
    if enrichment and filtering both precede truncation.
    """
    await _seed_screener_snapshots(test_db, ["AAA", "BBB", "CCC", "DDD", "ZZZ"])

    async def fake_enrich(rows):
        for row in rows:
            row.fcf_positive = row.symbol == "ZZZ"
        return rows, "ok"
    monkeypatch.setattr(screener_module, "_apply_fundamental_enrichment", fake_enrich)

    response = await client.get(f"/api/v1/screener/?limit=2&filters={_FCF_BLOB}")

    assert response.status_code == 200
    assert [r["symbol"] for r in response.json()["data"]] == ["ZZZ"]


@pytest.mark.asyncio
async def test_cached_fundamental_request_reads_mongo_once(client, monkeypatch, test_db):
    """Fundamental Enrichment is one bulk read per request, not one per row."""
    await _seed_screener_snapshots(test_db, ["AAA", "BBB", "CCC", "DDD", "ZZZ"])

    enrichment_calls = 0

    async def fake_enrich(rows):
        nonlocal enrichment_calls
        enrichment_calls += 1
        for row in rows:
            row.fcf_positive = True
        return rows, "ok"
    monkeypatch.setattr(screener_module, "_apply_fundamental_enrichment", fake_enrich)

    response = await client.get(f"/api/v1/screener/?limit=2&filters={_FCF_BLOB}")

    assert response.status_code == 200
    assert enrichment_calls == 1


@pytest.mark.asyncio
async def test_fundamental_response_reports_scope_and_counts(client, monkeypatch, test_db):
    """A Page hides how much was screened, so the meta has to say it."""
    await _seed_screener_snapshots(test_db, ["AAA", "BBB", "CCC", "DDD", "ZZZ"])

    async def fake_enrich(rows):
        for row in rows:
            row.fcf_positive = row.symbol in {"CCC", "ZZZ"}
        return rows, "ok"
    monkeypatch.setattr(screener_module, "_apply_fundamental_enrichment", fake_enrich)

    response = await client.get(f"/api/v1/screener/?limit=1&filters={_FCF_BLOB}")

    assert response.status_code == 200
    meta = response.json()["meta"]
    assert meta["screen_scope"] == "universe"
    assert meta["fundamental_enrichment"] == "ok"
    assert meta["candidate_count"] == 5
    assert meta["matched_count"] == 2
    assert meta["count"] == 1


@pytest.mark.asyncio
async def test_fundamentals_are_not_persisted_onto_screener_snapshots(client, monkeypatch):
    """ADR-0002: a Fundamental Snapshot carries its own as-of date.

    Writing it onto a daily Screener Snapshot would pin it to a date it does
    not belong to. Enrichment mutates rows in place, so the cache payload must
    be snapshotted before enrichment runs.
    """
    stored: list[dict] = []

    async def fake_fetch(_params):
        return [_row("VNM"), _row("FPT")]

    async def fake_enrich(rows):
        for row in rows:
            row.fcf_positive = True
            row.intrinsic_value = 123456.0
        return rows, "ok"

    async def fake_store(data, source=None):
        stored.extend(data)

    monkeypatch.setattr(screener_module.VnstockScreenerFetcher, "fetch", fake_fetch)
    monkeypatch.setattr(screener_module, "_apply_fundamental_enrichment", fake_enrich)
    monkeypatch.setattr(
        screener_module.CacheManager, "store_screener_data", staticmethod(fake_store)
    )

    response = await client.get(
        f"/api/v1/screener/?limit=10&use_cache=false&filters={_FCF_BLOB}"
    )

    assert response.status_code == 200
    assert stored, "expected the live path to write through to the cache"
    for row in stored:
        assert row.get("intrinsic_value") is None
        assert row.get("fcf_positive") is None


@pytest.mark.asyncio
async def test_enrichment_outcome_reported_when_mongo_unavailable(client, monkeypatch, test_db):
    """US37: 'Mongo unavailable' must be distinguishable from 'no matches'."""
    await _seed_screener_snapshots(test_db, ["AAA", "BBB"])

    svc = _FakeMongoService(enabled=False)
    monkeypatch.setattr(screener_module, "get_mongo_market_data_service", lambda: svc)

    response = await client.get(f"/api/v1/screener/?limit=10&filters={_FCF_BLOB}")

    assert response.status_code == 200
    assert response.json()["data"] == []
    assert response.json()["meta"]["fundamental_enrichment"] == "unavailable"


@pytest.mark.asyncio
async def test_enrichment_outcome_reported_when_mongo_errors(client, monkeypatch, test_db):
    """A Mongo failure degrades the screen; the response must admit it."""
    await _seed_screener_snapshots(test_db, ["AAA", "BBB"])

    svc = _FakeMongoService(error=True)
    monkeypatch.setattr(screener_module, "get_mongo_market_data_service", lambda: svc)

    response = await client.get(f"/api/v1/screener/?limit=10&filters={_FCF_BLOB}")

    assert response.status_code == 200
    assert response.json()["meta"]["fundamental_enrichment"] == "failed"


@pytest.mark.asyncio
async def test_enrichment_outcome_ok_when_corpus_simply_has_no_match(client, monkeypatch, test_db):
    """The honest empty result: enrichment worked, nothing matched."""
    await _seed_screener_snapshots(test_db, ["AAA", "BBB"])

    svc = _FakeMongoService(docs={})
    monkeypatch.setattr(screener_module, "get_mongo_market_data_service", lambda: svc)

    response = await client.get(f"/api/v1/screener/?limit=10&filters={_FCF_BLOB}")

    assert response.status_code == 200
    assert response.json()["data"] == []
    assert response.json()["meta"]["fundamental_enrichment"] == "ok"


@pytest.mark.asyncio
async def test_non_fundamental_request_reports_enrichment_skipped(client, monkeypatch, test_db):
    await _seed_screener_snapshots(test_db, ["AAA", "BBB"])

    response = await client.get("/api/v1/screener/?limit=10")

    assert response.status_code == 200
    assert response.json()["meta"]["fundamental_enrichment"] == "skipped"


def test_cached_dict_without_fundamental_fields_still_validates():
    # Cache round-trip safety: old cached model_dump() dicts predate the
    # fundamental fields and must still validate to None defaults.
    legacy = _row("VNM", pe=15.2).model_dump()
    for key in (
        "intrinsic_value",
        "margin_of_safety",
        "moat",
        "dividend_years",
        "fcf_positive",
        "valuation_method",
        "fundamental_as_of",
    ):
        legacy.pop(key, None)

    revived = ScreenerData(**legacy)
    assert revived.intrinsic_value is None
    assert revived.moat is None
    assert revived.pe == 15.2
