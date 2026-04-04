from datetime import datetime

import pytest

from vnibb.api.v1.equity import _merge_financial_statement_rows
from vnibb.providers.vnstock.financials import FinancialStatementData, StatementType
from vnibb.services.financial_service import get_financials_with_ttm, normalize_statement_period


@pytest.mark.asyncio
async def test_get_financials_with_ttm_caps_quarter_fetch_limit(monkeypatch):
    captured: list[int] = []

    async def fake_fetch(params, credentials=None):
        captured.append(params.limit)
        return [
            FinancialStatementData(
                symbol="VNM",
                period="2025",
                statement_type=StatementType.BALANCE.value,
                total_assets=100.0,
                updated_at=datetime.utcnow(),
            )
        ]

    async def fake_inject(symbol, statement_type, annual_rows, limit):
        return annual_rows

    monkeypatch.setattr(
        "vnibb.services.financial_service.VnstockFinancialsFetcher.fetch",
        fake_fetch,
    )
    monkeypatch.setattr(
        "vnibb.services.financial_service._inject_latest_ytd_row",
        fake_inject,
    )

    data = await get_financials_with_ttm(
        symbol="VNM",
        statement_type=StatementType.BALANCE.value,
        period="year",
        limit=5,
    )

    assert captured == [5]
    assert len(data) == 1
    assert data[0].period == "2025"


def test_merge_financial_statement_rows_handles_provider_rows_without_fiscal_metadata():
    primary = [
        FinancialStatementData(
            symbol="VNM",
            period="2025",
            statement_type=StatementType.BALANCE.value,
            accounts_payable=100.0,
        )
    ]
    fallback = [
        FinancialStatementData(
            symbol="VNM",
            period="2025",
            statement_type=StatementType.BALANCE.value,
            goodwill=50.0,
        )
    ]

    merged = _merge_financial_statement_rows(primary, fallback)

    assert len(merged) == 1
    assert merged[0].accounts_payable == 100.0
    assert merged[0].goodwill == 50.0


def test_merge_financial_statement_rows_dedupes_mixed_quarter_formats():
    primary = [
        FinancialStatementData(
            symbol="VNM",
            period="2025-Q2",
            statement_type=StatementType.INCOME.value,
            revenue=200.0,
        )
    ]
    fallback = [
        FinancialStatementData(
            symbol="VNM",
            period="Q2-2025",
            statement_type=StatementType.INCOME.value,
            gross_profit=90.0,
        )
    ]

    merged = _merge_financial_statement_rows(primary, fallback)

    assert len(merged) == 1
    assert merged[0].revenue == 200.0
    assert merged[0].gross_profit == 90.0


def test_normalize_statement_period_handles_mixed_formats():
    assert normalize_statement_period("2025-Q2") == "Q2-2025"
    assert normalize_statement_period("Q2/2025") == "Q2-2025"
    assert normalize_statement_period("2", fiscal_year=2025, period_type="quarter") == "Q2-2025"


def test_normalize_statement_period_prefers_quarter_metadata_over_bare_year():
    assert (
        normalize_statement_period(
            "2024",
            fiscal_year=2024,
            fiscal_quarter=1,
            period_type="quarter",
        )
        == "Q1-2024"
    )


@pytest.mark.asyncio
async def test_get_financials_with_ttm_filters_specific_quarter_after_normalization(monkeypatch):
    async def fake_fetch(params, credentials=None):
        return [
            FinancialStatementData(
                symbol="VNM",
                period="2023-Q2",
                statement_type=StatementType.INCOME.value,
                revenue=100.0,
                updated_at=datetime.utcnow(),
            ),
            FinancialStatementData(
                symbol="VNM",
                period="Q2-2024",
                statement_type=StatementType.INCOME.value,
                revenue=120.0,
                updated_at=datetime.utcnow(),
            ),
            FinancialStatementData(
                symbol="VNM",
                period="Q3-2024",
                statement_type=StatementType.INCOME.value,
                revenue=140.0,
                updated_at=datetime.utcnow(),
            ),
        ]

    monkeypatch.setattr(
        "vnibb.services.financial_service.VnstockFinancialsFetcher.fetch",
        fake_fetch,
    )

    data = await get_financials_with_ttm(
        symbol="VNM",
        statement_type=StatementType.INCOME.value,
        period="Q2",
        limit=5,
    )

    assert [row.period for row in data] == ["Q2-2024", "Q2-2023"]
