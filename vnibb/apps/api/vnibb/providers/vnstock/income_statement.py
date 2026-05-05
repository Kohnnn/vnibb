"""
VnStock Income Statement Fetcher

Fetches income statement data for Vietnam-listed companies.
"""

import asyncio
import logging
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)


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
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:
        loop = asyncio.get_event_loop()

        def _fetch_sync() -> List[dict]:
            try:
                from vnstock import Vnstock

                stock = Vnstock().stock(symbol=query["symbol"], source=settings.vnstock_source)
                df = stock.finance.income_statement(period=query.get("period", "year"), lang="en")

                if df is None or df.empty:
                    return []

                return df.to_dict("records")
            except Exception as e:
                logger.error(f"vnstock income statement fetch error: {e}")
                raise ProviderError(
                    message=str(e), provider="vnstock", details={"symbol": query["symbol"]}
                )

        try:
            return await asyncio.wait_for(
                loop.run_in_executor(None, _fetch_sync),
                timeout=settings.vnstock_timeout,
            )
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(provider="vnstock", timeout=settings.vnstock_timeout)

    @staticmethod
    def transform_data(
        params: IncomeStatementQueryParams,
        data: List[dict[str, Any]],
    ) -> List[IncomeStatementData]:
        results = []
        for row in data:
            try:
                results.append(
                    IncomeStatementData(
                        symbol=params.symbol.upper(),
                        period=str(row.get("yearReport") or row.get("period") or ""),
                        revenue=row.get("revenue") or row.get("netRevenue"),
                        cost_of_revenue=row.get("costOfGoodsSold") or row.get("cogs"),
                        gross_profit=row.get("grossProfit"),
                        operating_expense=row.get("operationExpense"),
                        operating_income=row.get("operationProfit"),
                        interest_expense=row.get("interestExpense"),
                        profit_before_tax=row.get("preTaxProfit"),
                        tax_expense=row.get("taxExpense"),
                        net_income=row.get("postTaxProfit") or row.get("netIncome"),
                        eps=row.get("earningPerShare")
                        or row.get("earningsPerShare")
                        or row.get("earning_per_share")
                        or row.get("eps"),
                    )
                )
            except Exception as e:
                logger.warning(f"Skipping invalid income statement row: {e}")
        return results
