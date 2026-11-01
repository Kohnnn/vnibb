"""
VnStock Income Statement Fetcher

Fetches income statement data for Vietnam-listed companies.
"""

from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher


class IncomeStatementQueryParams(BaseModel):
    """Query parameters for income statement data."""

    symbol: str = Field(..., min_length=1, max_length=10)
    period: str = Field(default="year", pattern=r"^(year|quarter)$")

    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class IncomeStatementData(BaseModel):
    """Standardized income statement data."""

    symbol: str
    period: Optional[str] = None
    revenue: Optional[float] = None
    cost_of_revenue: Optional[float] = None
    gross_profit: Optional[float] = None
    operating_expense: Optional[float] = None
    operating_income: Optional[float] = None
    interest_expense: Optional[float] = None
    profit_before_tax: Optional[float] = None
    tax_expense: Optional[float] = None
    net_income: Optional[float] = None
    eps: Optional[float] = None
    eps_diluted: Optional[float] = None
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
                "revenue": 60000000000000,
                "net_income": 8000000000000,
            }
        }
    }


class VnstockIncomeStatementFetcher(BaseFetcher[IncomeStatementQueryParams, IncomeStatementData]):
    """Fetcher for income statement via vnstock."""

    provider_name = "vnstock"
    requires_credentials = False

    @staticmethod
    def transform_query(params: IncomeStatementQueryParams) -> dict[str, Any]:
        return {"symbol": params.symbol.upper(), "period": params.period}

    @staticmethod
    async def extract_data(
        query: dict[str, Any],
        credentials: dict[str, str] | None = None,
    ) -> List[dict[str, Any]]:
        from sys import maxsize

        from vnibb.providers.vnstock.financials import VnstockFinancialsFetcher

        return await VnstockFinancialsFetcher.extract_data(
            {**query, "statement_type": "income", "limit": maxsize}, credentials
        )

    @staticmethod
    def transform_data(
        params: IncomeStatementQueryParams,
        data: List[dict[str, Any]],
    ) -> List[IncomeStatementData]:
        from sys import maxsize

        from vnibb.providers.vnstock.financials import (
            FinancialsQueryParams,
            StatementType,
            VnstockFinancialsFetcher,
        )
        from vnibb.services.financial_service import admit_statement_rows

        statements = VnstockFinancialsFetcher.transform_data(
            FinancialsQueryParams(symbol=params.symbol, period=params.period, statement_type=StatementType.INCOME, limit=maxsize), data
        )
        return [IncomeStatementData.model_validate({**row.model_dump(), "operating_expense": row.operating_expenses})
                for row in admit_statement_rows(statements, params.period)]
