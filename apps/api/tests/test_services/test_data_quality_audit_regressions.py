import json
from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker
from vnibb.models.stock import Stock, StockPrice
from vnibb.services import data_quality, mongo_market_data_service

from scripts import v32_data_audit, v34_coverage_delta

OLD_ROW_METRIC = "top_with_price_row_at_or_before_5y_cutoff"


@pytest.mark.parametrize(
    ("represented", "invalid", "late_arrivals", "status", "issues", "integrity", "coverage"),
    [
        (1, 0, False, "warning", ["partial_sample_coverage"], "ok", "partial"),
        (1, 0, True, "warning", ["partial_sample_coverage"], "ok", "partial"),
        (0, 0, False, "warning", ["empty_sample"], "not_assessed", "empty"),
        (1, 1, False, "failed", ["invalid_ohlcv", "partial_sample_coverage"], "failed", "partial"),
        (20, 0, False, "ok", [], "ok", "complete"),
    ],
)
async def test_mongo_audits_integrity_and_sample_coverage_separately(
    monkeypatch, represented, invalid, late_arrivals, status, issues, integrity, coverage
):
    # Three cases reuse the committed #274 reproduction's 20-symbol aggregates.
    symbols = [f"Q{i:02}" for i in range(20)]

    class Corpus:
        enabled = True
        visible_symbols = symbols[:represented]

        def _get_collection(self, name):
            assert name == "market_prices_eod"
            return self

        def aggregate(self, pipeline, *, maxTimeMS):
            assert pipeline[0]["$match"]["symbol"] == {"$in": symbols}
            assert maxTimeMS == 1_500
            # The other symbols arrive after the matched inputs of the first read.
            visible = self.visible_symbols
            if late_arrivals:
                self.visible_symbols = symbols
            if "$facet" in pipeline[-1]:
                return [
                    {
                        "quality_by_symbol": [
                            {"symbol": symbol, "documents": 1, "invalid_ohlcv": invalid if i == 0 else 0}
                            for i, symbol in enumerate(visible)
                        ]
                    }
                ]
            if any("$set" in stage for stage in pipeline):
                return [{"audited_documents": len(visible), "invalid_ohlcv": invalid}]
            if "$limit" in pipeline[-1]:
                return [{"symbol": symbol, "documents": 1} for symbol in visible]
            return []

    monkeypatch.setattr(mongo_market_data_service, "get_mongo_market_data_service", Corpus)
    result = await data_quality.get_mongo_eod_quality_summary(symbols)

    assert (result["status"], result["issues"]) == (status, issues)
    assert result["read_outcome"] == "observed"
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
    assert result["read_outcome"] == "disabled"
    assert result["sample_coverage"] == {
        "status": "not_assessed",
        "requested_symbols": 2,
        "represented_symbols": 0,
        "no_row_symbols": 0,
        "failed_read_symbols": 0,
        "unknown_symbols": 2,
        "session_eligibility": "not_assessed",
    }


async def test_mongo_collection_setup_does_not_count_as_a_failed_read(monkeypatch):
    class UnconfiguredCorpus:
        enabled = True

        def _get_collection(self, name):
            raise RuntimeError("collection setup failed")

    monkeypatch.setattr(mongo_market_data_service, "get_mongo_market_data_service", UnconfiguredCorpus)
    result = await data_quality.get_mongo_eod_quality_summary(["Q01", "Q02"])

    assert result["read_outcome"] == "setup_failed"
    assert result["sample_coverage"]["unknown_symbols"] == 2
    assert result["sample_coverage"]["failed_read_symbols"] == 0
    assert result["sample_coverage"]["no_row_symbols"] == 0
    assert result["integrity_status"] == "not_assessed"


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
    assert result["price_row_five_year_cutoff_policy"] == "host_date_minus_5y_plus_30d_inclusive"
    assert result["historical_session_coverage_status"] == "not_assessed"


@pytest.mark.parametrize(
    ("outcome", "status", "coverage_status", "partition", "freshness_failure"),
    [
        ("observed", "warning", "empty", "no_row_symbols", None),
        ("read_failed", "timeout", "not_assessed", "failed_read_symbols", "timeout"),
        ("disabled", "unavailable", "not_assessed", "unknown_symbols", None),
        ("setup_failed", "unavailable", "not_assessed", "unknown_symbols", "query_failed"),
    ],
)
async def test_admin_health_preserves_mongo_sample_outcomes_in_trend(
    monkeypatch,
    historical_price_rows,
    test_db,
    admin_client,
    outcome,
    status,
    coverage_status,
    partition,
    freshness_failure,
):
    class Corpus:
        enabled = outcome != "disabled"

        async def get_source_latest_trade_date(self, _source):
            if freshness_failure:
                raise mongo_market_data_service.MongoReadError(freshness_failure)
            return date(2026, 11, 23)

        def _get_collection(self, name):
            if outcome == "setup_failed":
                raise RuntimeError("collection setup failed")
            return self

        def aggregate(self, pipeline, *, maxTimeMS):
            if outcome == "read_failed":
                raise TimeoutError("timed out")
            return []

    monkeypatch.setattr(mongo_market_data_service, "get_mongo_market_data_service", Corpus)
    await data_quality.complete_quality_run(
        test_db,
        run_id="legacy-zero-counts",
        status="ok",
        completed_at=datetime(2020, 1, 1),
        observed_market_date=date(2026, 11, 20),
        latest_market_date=date(2026, 11, 20),
        market_day_staleness_value=0,
        summary_counts={"audited_symbols": 3, "audited_documents": 0},
        error_category=None,
    )
    if freshness_failure:
        with pytest.raises(mongo_market_data_service.MongoReadError):
            await data_quality.run_data_quality_check(run_id="sample-outcome")
    else:
        await data_quality.run_data_quality_check(run_id="sample-outcome")

    response = await admin_client.get("/api/v1/admin/data-health")

    assert response.status_code == 200
    health = response.json()["data_quality"]
    run = health["source_freshness"]
    assert run["run_id"] == "sample-outcome"
    assert run["status"] == ("failed" if freshness_failure else "warning")
    assert run["summary_counts"]["audited_documents"] == 0
    assert "mongo_eod_quality" not in run["summary_counts"]
    sample = run["mongo_eod_quality"]
    assert (sample["read_outcome"], sample["status"], sample["integrity_status"]) == (
        outcome, status, "not_assessed"
    )
    assert sample["sample_coverage"]["status"] == coverage_status
    assert sample["sample_coverage"]["requested_symbols"] == 3
    assert sample["sample_coverage"][partition] == 3
    assert "details" not in sample
    assert health["trend"][0]["mongo_eod_quality"] == sample
    assert health["trend"][1]["run_id"] == "legacy-zero-counts"
    assert health["trend"][1]["mongo_eod_quality"] is None


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
    assert result["price_row_five_year_cutoff_policy"] == "host_date_minus_5y_plus_30d_inclusive"
    assert result["historical_session_coverage_status"] == "not_assessed"


def _delta_args(monkeypatch, baseline, current, output, *flags):
    monkeypatch.setattr(
        "sys.argv",
        [
            "v34_coverage_delta.py",
            "--baseline-json",
            str(baseline),
            "--current-json",
            str(current),
            "--output-json",
            str(output),
            "--min-old-price-row-improvement",
            "1",
            "--fail-on-miss",
            *flags,
        ],
    )
    return v34_coverage_delta.parse_args()


async def test_v34_discloses_archived_cutoff_policies_without_a_comparable_delta(
    monkeypatch, tmp_path, capsys
):
    scripts = Path(v34_coverage_delta.__file__).parent
    baseline = scripts / "v34_data_audit_baseline.json"
    current = scripts / "v35_data_audit_final.json"
    original = (baseline.read_bytes(), current.read_bytes())
    output = tmp_path / "delta.json"

    args = _delta_args(monkeypatch, baseline, current, output, "--allow-regression")
    assert await v34_coverage_delta.run(args) == 1

    delta = json.loads(output.read_bytes())
    assert delta["sla_passed"] is False
    assert delta["metrics"][OLD_ROW_METRIC] == {"baseline": 0, "current": 37, "delta": None}
    assert delta["price_row_cutoff_comparison"] == {
        "status": "incomparable",
        "baseline": {"policy": "host_date_minus_5y_inclusive", "cutoff_date": None},
        "current": {"policy": "host_date_minus_5y_plus_30d_inclusive", "cutoff_date": None},
        "target_met": None,
    }
    assert delta["historical_session_coverage_status"] == "not_assessed"
    text = capsys.readouterr().out
    assert "incomparable" in text
    assert "host_date_minus_5y_inclusive" in text
    assert "host_date_minus_5y_plus_30d_inclusive" in text
    assert (baseline.read_bytes(), current.read_bytes()) == original


@pytest.mark.parametrize(
    ("current_cutoff", "current_policy", "expected_status", "expected_delta", "exit_code"),
    [
        ("2021-12-23", "host_date_minus_5y_plus_30d_inclusive", "comparable", 1, 0),
        ("2021-12-24", "host_date_minus_5y_plus_30d_inclusive", "incomparable", None, 1),
        ("2021-12-23", None, "unknown", None, 1),
    ],
)
async def test_v34_gates_only_a_comparable_old_row_count(
    monkeypatch, tmp_path, current_cutoff, current_policy, expected_status, expected_delta, exit_code
):
    baseline = tmp_path / "baseline.json"
    current = tmp_path / "current.json"
    output = tmp_path / "delta.json"
    for path, count, cutoff, policy in (
        (baseline, 1, "2021-12-23", "host_date_minus_5y_plus_30d_inclusive"),
        (current, 2, current_cutoff, current_policy),
    ):
        path.write_text(
            json.dumps(
                {
                    "top_symbol_coverage": {
                        OLD_ROW_METRIC: count,
                        "price_row_five_year_cutoff": cutoff,
                        "price_row_five_year_cutoff_policy": policy,
                    }
                }
            ),
            encoding="utf-8",
        )

    assert await v34_coverage_delta.run(_delta_args(monkeypatch, baseline, current, output)) == exit_code

    delta = json.loads(output.read_bytes())
    assert delta["price_row_cutoff_comparison"]["status"] == expected_status
    assert delta["metrics"][OLD_ROW_METRIC] == {"baseline": 1, "current": 2, "delta": expected_delta}
    assert delta["sla_passed"] is (exit_code == 0)
    assert "top_with_5y_prices" not in delta["metrics"]


async def test_v34_does_not_overwrite_an_input_report(monkeypatch, tmp_path):
    archived = Path(v34_coverage_delta.__file__).with_name("v34_data_audit_baseline.json")
    original = archived.read_bytes()
    copy = tmp_path / "baseline.json"
    copy.write_bytes(original)

    with pytest.raises(FileExistsError):
        await v34_coverage_delta.run(_delta_args(monkeypatch, copy, archived, copy))

    assert copy.read_bytes() == original


def test_serialized_archive_does_not_claim_continuous_price_history():
    run = data_quality.DataQualityRun(summary_counts={"top_with_5y_prices": 1})

    assert data_quality.serialize_quality_run(run)["summary_counts"] == {OLD_ROW_METRIC: 1}
    assert run.summary_counts == {"top_with_5y_prices": 1}
    assert data_quality.serialize_quality_run(run)["mongo_eod_quality"] is None
    assert data_quality.serialize_quality_run(run)["historical_session_coverage_status"] == "not_assessed"
