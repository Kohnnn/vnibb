import json
from dataclasses import asdict
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from scripts import v32_data_audit, v34_coverage_delta
from vnibb.models.stock import Stock, StockPrice
from vnibb.services import data_quality, mongo_market_data_service

OLD_ROW_METRIC = "top_with_price_row_at_or_before_5y_cutoff"


@pytest.mark.parametrize(
    ("represented", "invalid", "status", "issues", "integrity", "coverage"),
    [
        (1, 0, "warning", ["partial_sample_coverage"], "ok", "partial"),
        (0, 0, "warning", ["empty_sample"], "not_assessed", "empty"),
        (1, 1, "failed", ["invalid_ohlcv", "partial_sample_coverage"], "failed", "partial"),
        (20, 0, "ok", [], "ok", "complete"),
    ],
)
async def test_mongo_audits_integrity_and_sample_coverage_separately(
    monkeypatch, represented, invalid, status, issues, integrity, coverage
):
    # Three cases reuse the committed #274 reproduction's 20-symbol aggregates.
    symbols = [f"Q{i:02}" for i in range(20)]

    class Corpus:
        enabled = True

        def _get_collection(self, name):
            assert name == "market_prices_eod"
            return self

        def aggregate(self, pipeline, *, maxTimeMS):
            assert pipeline[0]["$match"]["symbol"] == {"$in": symbols}
            assert maxTimeMS == 1_500
            if any("$set" in stage for stage in pipeline):
                return [{"audited_documents": represented, "invalid_ohlcv": invalid}]
            if "$limit" in pipeline[-1]:
                return [{"symbol": symbol, "documents": 1} for symbol in symbols[:represented]]
            return []

    monkeypatch.setattr(mongo_market_data_service, "get_mongo_market_data_service", Corpus)
    result = await data_quality.get_mongo_eod_quality_summary(symbols)

    assert (result["status"], result["issues"]) == (status, issues)
    assert result["integrity_status"] == integrity
    assert result["admission_status"] == "not_assessed"
    assert result["freshness_status"] == "not_assessed"
    assert result["sample_coverage"] == {
        "status": coverage,
        "requested_symbols": 20,
        "represented_symbols": represented,
        "no_row_symbols": 20 - represented,
        "failed_read_symbols": 0,
        "unknown_symbols": 0,
        "session_eligibility": "not_assessed",
    }


async def test_disabled_mongo_audit_leaves_requested_symbols_unknown(monkeypatch):
    class DisabledCorpus:
        enabled = False

    monkeypatch.setattr(mongo_market_data_service, "get_mongo_market_data_service", DisabledCorpus)
    result = await data_quality.get_mongo_eod_quality_summary(["Q01", "q01", "Q02"])

    assert result["status"] == "unavailable"
    assert result["sample_coverage"] == {
        "status": "not_assessed",
        "requested_symbols": 2,
        "represented_symbols": 0,
        "no_row_symbols": 0,
        "failed_read_symbols": 0,
        "unknown_symbols": 2,
        "session_eligibility": "not_assessed",
    }


@pytest.fixture
async def historical_price_rows(monkeypatch, test_engine, test_db):
    # The three exact date sets in c85dd6c4's bounded #274 reproduction.
    fixtures = {
        "OLD": (date(2020, 1, 1),),
        "ENDS": (date(2020, 1, 1), date(2026, 11, 23)),
        "NOW": (date(2026, 11, 23),),
    }

    class FixedDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 11, 23)

    for symbol, dates in fixtures.items():
        stock = Stock(symbol=symbol, exchange="HOSE")
        test_db.add(stock)
        await test_db.flush()
        test_db.add_all(
            StockPrice(
                stock_id=stock.id, symbol=symbol, time=day, open=1, high=1, low=1, close=1, volume=0
            )
            for day in dates
        )
    await test_db.commit()
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    for module in (data_quality, v32_data_audit):
        monkeypatch.setattr(module, "async_session_maker", session_factory)
        monkeypatch.setattr(module, "date", FixedDate)
    monkeypatch.setattr(data_quality, "_market_today", FixedDate.today)
    return tuple(fixtures)


async def test_daily_audit_labels_minimum_price_date_without_inventing_history(
    monkeypatch, historical_price_rows, tmp_path: Path
):
    async def top_symbols(_limit):
        return historical_price_rows

    async def retained_source_date():
        return date(2026, 11, 23)

    monkeypatch.setattr(data_quality, "_get_top_symbols", top_symbols)
    monkeypatch.setattr(data_quality, "_vietcap_corpus_latest_date", retained_source_date)
    result = await data_quality.run_data_quality_check(
        run_id="synthetic-price-row-cutoff", output_path=str(tmp_path / "audit.json")
    )

    assert result["metrics"][OLD_ROW_METRIC] == 2
    assert result["targets"][OLD_ROW_METRIC] == 80
    assert "top_with_5y_prices" not in result["metrics"]
    assert result["price_row_five_year_cutoff"] == "2021-12-23"
    assert result["historical_session_coverage_status"] == "not_assessed"


@pytest.mark.parametrize(
    ("symbol", "observed_old_row"), [("OLD", 1), ("ENDS", 1), ("NOW", 0)]
)
async def test_legacy_audit_reports_only_old_row_evidence(
    historical_price_rows, symbol, observed_old_row
):
    result = asdict(await v32_data_audit.coverage_for_symbols([symbol]))

    assert result[OLD_ROW_METRIC] == observed_old_row
    assert "top_with_5y_prices" not in result
    assert result["price_row_five_year_cutoff"] == "2021-12-23"
    assert result["historical_session_coverage_status"] == "not_assessed"


async def test_v34_delta_reads_committed_archive_as_old_row_evidence(monkeypatch, tmp_path, capsys):
    scripts_dir = Path(v34_coverage_delta.__file__).parent
    archived = scripts_dir / "v35_data_audit_final.json"
    before = archived.read_bytes()
    report = json.loads(before)
    counts = report["top_symbol_coverage"]
    assert counts.pop("top_with_5y_prices") == 37
    counts[OLD_ROW_METRIC] = 38
    current = tmp_path / "current.json"
    current.write_text(json.dumps(report), encoding="utf-8")
    result = tmp_path / "delta.json"
    monkeypatch.setattr(
        "sys.argv",
        [
            "v34_coverage_delta.py",
            "--baseline-json",
            str(archived),
            "--current-json",
            str(current),
            "--output-json",
            str(result),
            "--min-old-price-row-improvement",
            "1",
            "--fail-on-miss",
        ],
    )

    assert await v34_coverage_delta.run(v34_coverage_delta.parse_args()) == 0
    delta = json.loads(result.read_bytes())
    assert delta["metrics"][OLD_ROW_METRIC] == {"baseline": 37, "current": 38, "delta": 1}
    assert "top_with_5y_prices" not in delta["metrics"]
    assert delta["historical_session_coverage_status"] == "not_assessed"
    assert "5Y coverage improvement" not in capsys.readouterr().out
    assert archived.read_bytes() == before


def test_serialized_archive_does_not_claim_continuous_price_history():
    run = data_quality.DataQualityRun(summary_counts={"top_with_5y_prices": 1})

    assert data_quality.serialize_quality_run(run)["summary_counts"] == {OLD_ROW_METRIC: 1}
    assert run.summary_counts == {"top_with_5y_prices": 1}
    assert data_quality.serialize_quality_run(run)["historical_session_coverage_status"] == "not_assessed"
