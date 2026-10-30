"""
VnStock Balance Sheet Fetcher

Fetches balance sheet data for Vietnam-listed companies.
"""

from typing import Any

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher


class BalanceSheetQueryParams(BaseModel):
    """Query parameters for balance sheet data."""

    symbol: str = Field(..., min_length=1, max_length=10)
    period: str = Field(default="year", pattern=r"^(year|quarter)$")

    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class BalanceSheetData(BaseModel):
    """Standardized balance sheet data."""

    symbol: str
    period: str | None = None
    total_assets: float | None = None
    current_assets: float | None = None
    fixed_assets: float | None = None
    total_liabilities: float | None = None
    current_liabilities: float | None = None
    long_term_liabilities: float | None = None
    equity: float | None = None
    cash: float | None = None
    inventory: float | None = None
    receivables: float | None = None
    source: str | None = None
    raw_data: dict[str, Any] | None = None
    fiscal_year: int | None = None
    fiscal_quarter: int | None = None
    unit_metadata: dict[str, Any] = Field(default_factory=dict)
    value_unit: str | None = None
    currency: str | None = None
    flow_basis: str | None = None
    consolidation_basis: str | None = None
    unavailable_reason: str | None = None

    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "period": "2024",
                "total_assets": 50000000000000,
                "equity": 30000000000000,
            }
        }
    }


class VnstockBalanceSheetFetcher(BaseFetcher[BalanceSheetQueryParams, BalanceSheetData]):
    """Fetcher for balance sheet via vnstock."""

    provider_name = "vnstock"
    requires_credentials = False

    @staticmethod
    def transform_query(params: BalanceSheetQueryParams) -> dict[str, Any]:
        return {"symbol": params.symbol.upper(), "period": params.period}

    @staticmethod
    async def extract_data(
        query: dict[str, Any],
        credentials: dict[str, str] | None = None,
    ) -> list[dict[str, Any]]:
        from sys import maxsize

        from vnibb.providers.vnstock.financials import VnstockFinancialsFetcher

        return await VnstockFinancialsFetcher.extract_data(
            {**query, "statement_type": "balance", "limit": maxsize}, credentials
        )

    @staticmethod
    def transform_data(
        params: BalanceSheetQueryParams,
        data: list[dict[str, Any]],
    ) -> list[BalanceSheetData]:
        from sys import maxsize

        from vnibb.providers.vnstock.financials import (
            FinancialsQueryParams,
            StatementType,
            VnstockFinancialsFetcher,
        )
        from vnibb.services.financial_service import admit_statement_rows

        statements = VnstockFinancialsFetcher.transform_data(
            FinancialsQueryParams(symbol=params.symbol, period=params.period, statement_type=StatementType.BALANCE, limit=maxsize), data
        )
        return [BalanceSheetData.model_validate({**row.model_dump(), "receivables": row.accounts_receivable})
                for row in admit_statement_rows(statements, params.period)]
