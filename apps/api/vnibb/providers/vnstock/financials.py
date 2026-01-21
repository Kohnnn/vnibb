"""
VnStock Financials Fetcher

Fetches financial statements (Income Statement, Balance Sheet, Cash Flow)
for Vietnam-listed companies via vnstock library.
"""

import asyncio
import logging
from datetime import datetime
from enum import Enum
from typing import Any, List, Optional, Literal

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)


class StatementType(str, Enum):
    """Financial statement types."""
    INCOME = "income"
    BALANCE = "balance"
    CASHFLOW = "cashflow"


class FinancialsQueryParams(BaseModel):
    """Query parameters for financial statements."""
    
    symbol: str = Field(
        ...,
        min_length=1,
        max_length=10,
        description="Stock ticker symbol (e.g., VNM)",
    )
    statement_type: StatementType = Field(
        default=StatementType.INCOME,
        description="Type of financial statement",
    )
    period: Literal["year", "quarter"] = Field(
        default="year",
        description="Reporting period: year or quarter",
    )
    limit: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Number of periods to return",
    )
    
    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "statement_type": "income",
                "period": "year",
                "limit": 5,
            }
        }
    }


class FinancialStatementData(BaseModel):
    """
    Standardized financial statement data.
    
    Generic structure for income/balance/cashflow statements.
    """
    
    symbol: str = Field(..., description="Stock ticker symbol")
    period: str = Field(..., description="Reporting period (e.g., 2024, Q1-2024)")
    statement_type: str = Field(..., description="Statement type")
    
    # Common metrics (populated based on statement type)
    revenue: Optional[float] = Field(None, description="Total Revenue")
    gross_profit: Optional[float] = Field(None, description="Gross Profit")
    operating_income: Optional[float] = Field(None, description="Operating Income")
    net_income: Optional[float] = Field(None, description="Net Income")
    ebitda: Optional[float] = Field(None, description="EBITDA")
    
    # Balance Sheet specific
    total_assets: Optional[float] = Field(None, description="Total Assets")
    total_liabilities: Optional[float] = Field(None, description="Total Liabilities")
    total_equity: Optional[float] = Field(None, description="Total Equity")
    cash_and_equivalents: Optional[float] = Field(None, description="Cash & Equivalents")
    
    # Cash Flow specific
    operating_cash_flow: Optional[float] = Field(None, description="Operating Cash Flow")
    investing_cash_flow: Optional[float] = Field(None, description="Investing Cash Flow")
    financing_cash_flow: Optional[float] = Field(None, description="Financing Cash Flow")
    free_cash_flow: Optional[float] = Field(None, description="Free Cash Flow")
    
    # Raw data for flexibility
    raw_data: Optional[dict[str, Any]] = Field(None, description="Full raw statement data")
    
    updated_at: Optional[datetime] = Field(None, description="Data timestamp")


from vnibb.core.retry import vnstock_cb, circuit_breaker

class VnstockFinancialsFetcher(BaseFetcher[FinancialsQueryParams, FinancialStatementData]):
    """
    Fetcher for financial statements via vnstock library.
    
    Supports income statement, balance sheet, and cash flow statement.
    """
    
    provider_name = "vnstock"
    requires_credentials = False
    
    @staticmethod
    def transform_query(params: FinancialsQueryParams) -> dict[str, Any]:
        """Transform query params to vnstock-compatible format."""
        return {
            "symbol": params.symbol.upper(),
            "statement_type": params.statement_type.value,
            "period": params.period,
            "limit": params.limit,
        }
    
    @staticmethod
    @circuit_breaker(vnstock_cb)
    async def extract_data(
        query: dict[str, Any],
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:
        """Fetch financial statement data from vnstock."""
        loop = asyncio.get_event_loop()
        
        def _fetch_sync() -> List[dict]:
            try:
                from vnstock import Vnstock
                stock = Vnstock().stock(symbol=query["symbol"], source=settings.vnstock_source)
                finance = stock.finance
                
                # Select statement type
                statement_type = query["statement_type"]
                period = query["period"]
                
                if statement_type == "income":
                    df = finance.income_statement(period=period)
                elif statement_type == "balance":
                    df = finance.balance_sheet(period=period)
                elif statement_type == "cashflow":
                    df = finance.cash_flow(period=period)
                else:
                    raise ValueError(f"Unknown statement type: {statement_type}")
                
                if df is None or df.empty:
                    logger.warning(f"No {statement_type} data for {query['symbol']}")
                    return []
                
                # Limit records
                df = df.head(query["limit"])
                records = df.to_dict("records")
                
                # Add metadata
                for record in records:
                    record["_statement_type"] = statement_type
                
                return records
                
            except Exception as e:
                logger.error(f"vnstock financials fetch error: {e}")
                raise ProviderError(
                    message=str(e),
                    provider="vnstock",
                    details={"symbol": query["symbol"]},
                )
        
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(None, _fetch_sync),
                timeout=settings.vnstock_timeout,
            )
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(
                provider="vnstock",
                timeout=settings.vnstock_timeout,
            )
    
    @staticmethod
    def transform_data(
        params: FinancialsQueryParams,
        data: List[dict[str, Any]],
    ) -> List[FinancialStatementData]:
        """Transform raw financial data to standardized format."""
        results: List[FinancialStatementData] = []
        
        for row in data:
            try:
                # Extract period identifier
                period = row.get("year") or row.get("quarter") or row.get("period", "Unknown")
                if isinstance(period, (int, float)):
                    period = str(int(period))
                
                statement = FinancialStatementData(
                    symbol=params.symbol.upper(),
                    period=str(period),
                    statement_type=params.statement_type.value,
                    # Map common fields
                    revenue=row.get("revenue") or row.get("netRevenue"),
                    gross_profit=row.get("grossProfit"),
                    operating_income=row.get("operatingProfit") or row.get("operatingIncome"),
                    net_income=row.get("netIncome") or row.get("postTaxProfit"),
                    ebitda=row.get("ebitda"),
                    # Balance sheet
                    total_assets=row.get("totalAssets") or row.get("asset"),
                    total_liabilities=row.get("totalLiabilities") or row.get("debt"),
                    total_equity=row.get("totalEquity") or row.get("equity"),
                    cash_and_equivalents=row.get("cash") or row.get("cashAndCashEquivalents"),
                    # Cash flow
                    operating_cash_flow=row.get("operatingCashFlow") or row.get("fromOperating"),
                    investing_cash_flow=row.get("investingCashFlow") or row.get("fromInvesting"),
                    financing_cash_flow=row.get("financingCashFlow") or row.get("fromFinancing"),
                    free_cash_flow=row.get("freeCashFlow"),
                    # Store raw data for flexibility
                    raw_data=row,
                    updated_at=datetime.utcnow(),
                )
                results.append(statement)
                
            except Exception as e:
                logger.warning(f"Skipping invalid financial row: {e}")
                continue
        
        return results
