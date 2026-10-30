"""
VnStock Cash Flow Fetcher

Fetches cash flow statement data for Vietnam-listed companies.
"""

from typing import Any

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher


class CashFlowQueryParams(BaseModel):
    """Query parameters for cash flow data."""

    symbol: str = Field(..., min_length=1, max_length=10)
    period: str = Field(default="year", pattern=r"^(year|quarter)$")

    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class CashFlowData(BaseModel):
    """Standardized cash flow data."""

    symbol: str
    period: str | None = None
    operating_cash_flow: float | None = None
    investing_cash_flow: float | None = None
    financing_cash_flow: float | None = None
    net_cash_flow: float | None = None
    free_cash_flow: float | None = None
    capital_expenditure: float | None = None
    dividends_paid: float | None = None
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
                "operating_cash_flow": 12000000000000,
                "free_cash_flow": 8000000000000,
            }
        }
    }


class VnstockCashFlowFetcher(BaseFetcher[CashFlowQueryParams, CashFlowData]):
    """Fetcher for cash flow statement via vnstock."""

    provider_name = "vnstock"
    requires_credentials = False

    @staticmethod
    def transform_query(params: CashFlowQueryParams) -> dict[str, Any]:
        return {"symbol": params.symbol.upper(), "period": params.period}

    @staticmethod
    async def extract_data(
        query: dict[str, Any],
        credentials: dict[str, str] | None = None,
    ) -> list[dict[str, Any]]:
        from sys import maxsize

        from vnibb.providers.vnstock.financials import VnstockFinancialsFetcher

        return await VnstockFinancialsFetcher.extract_data(
            {**query, "statement_type": "cashflow", "limit": maxsize}, credentials
        )

    @staticmethod
    def transform_data(
        params: CashFlowQueryParams,
        data: list[dict[str, Any]],
    ) -> list[CashFlowData]:
        from sys import maxsize

        from vnibb.providers.vnstock.financials import (
            FinancialsQueryParams,
            StatementType,
            VnstockFinancialsFetcher,
        )
        from vnibb.services.financial_service import admit_statement_rows

        statements = VnstockFinancialsFetcher.transform_data(
            FinancialsQueryParams(symbol=params.symbol, period=params.period, statement_type=StatementType.CASHFLOW, limit=maxsize), data
        )
        return [CashFlowData.model_validate(row.model_dump()) for row in admit_statement_rows(statements, params.period)]
