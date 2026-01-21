"""
Financials API Endpoints

Provides endpoints for:
- Income Statements
- Balance Sheets
- Cash Flow Statements
"""

from typing import List, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from vnibb.providers.vnstock.financials import (
    VnstockFinancialsFetcher,
    FinancialsQueryParams,
    FinancialStatementData,
    StatementType,
)
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
from vnibb.core.cache import cached

router = APIRouter()


class FinancialsResponse(BaseModel):
    """API response wrapper for financial statements."""
    
    symbol: str
    statement_type: str
    period_type: str
    count: int
    data: List[FinancialStatementData]


from vnibb.services.financial_service import get_financials_with_ttm

@router.get(
    "/{symbol}",
    response_model=FinancialsResponse,
    summary="Get Financial Statements",
    description="Fetch income statement, balance sheet, or cash flow for a stock.",
)
@cached(ttl=86400, key_prefix="financials")  # 24 hour cache
async def get_financials(
    symbol: str,
    statement_type: Literal["income", "balance", "cashflow"] = Query(
        default="income",
        description="Statement type: income, balance, or cashflow",
    ),
    period: str = Query(
        default="year",
        description="Reporting period: year, quarter, Q1, Q2, Q3, Q4, or TTM",
    ),
    limit: int = Query(
        default=5,
        ge=1,
        le=20,
        description="Number of periods to return",
    ),
) -> FinancialsResponse:
    """
    Fetch financial statements for a company.
    
    ## Statement Types
    - **income**: Revenue, gross profit, operating income, net income
    - **balance**: Assets, liabilities, equity, cash
    - **cashflow**: Operating, investing, financing cash flows
    
    ## Periods
    - **year**: Annual statements
    - **quarter**: Quarterly statements
    - **TTM**: Trailing Twelve Months (sum of last 4 quarters)
    """
    try:
        data = await get_financials_with_ttm(
            symbol=symbol,
            statement_type=statement_type,
            period=period,
            limit=limit,
        )
        
        return FinancialsResponse(
            symbol=symbol.upper(),
            statement_type=statement_type,
            period_type=period,
            count=len(data),
            data=data,
        )

        
    except ProviderTimeoutError as e:
        raise HTTPException(status_code=504, detail=f"Timeout: {e.message}")
    except ProviderError as e:
        raise HTTPException(status_code=502, detail=f"Provider error: {e.message}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
