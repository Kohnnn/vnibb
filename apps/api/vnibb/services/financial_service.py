import logging
from typing import List, Optional, Literal
from vnibb.providers.vnstock.financials import VnstockFinancialsFetcher, FinancialsQueryParams, StatementType, FinancialStatementData

logger = logging.getLogger(__name__)

async def get_financials_with_ttm(
    symbol: str,
    statement_type: str = "income",
    period: str = "year",
    limit: int = 5
) -> List[FinancialStatementData]:
    """
    Fetch financials with support for TTM.
    """
    if period == "TTM":
        return await calculate_ttm(symbol, statement_type)
    
    # Map periods like Q1, Q2, Q3, Q4 to quarter and filter
    actual_period = "quarter" if period.startswith("Q") else period
    
    params = FinancialsQueryParams(
        symbol=symbol,
        statement_type=StatementType(statement_type),
        period=actual_period,
        limit=limit if not period.startswith("Q") else 20 # Fetch more for filtering
    )
    
    data = await VnstockFinancialsFetcher.fetch(params)
    
    if period.startswith("Q"):
        # Filter for specific quarter across years
        q_num = period[1]
        data = [d for d in data if f"Q{q_num}" in d.period or d.period.startswith(f"{q_num}/")][:limit]
        
    return data

async def calculate_ttm(symbol: str, statement_type: str) -> List[FinancialStatementData]:
    """
    Calculate Trailing Twelve Months (TTM) by summing last 4 quarters.
    """
    params = FinancialsQueryParams(
        symbol=symbol,
        statement_type=StatementType(statement_type),
        period="quarter",
        limit=4
    )
    
    quarters = await VnstockFinancialsFetcher.fetch(params)
    
    if len(quarters) < 4:
        logger.warning(f"Not enough quarterly data for TTM calculation for {symbol}")
        return quarters # Return whatever we have or empty
    
    # Combine last 4 quarters
    ttm_data = FinancialStatementData(
        symbol=symbol.upper(),
        period="TTM",
        statement_type=statement_type,
        updated_at=quarters[0].updated_at
    )
    
    # Sum metrics for Income Statement and Cash Flow
    if statement_type in ["income", "cashflow"]:
        metrics = [
            "revenue", "gross_profit", "operating_income", "net_income", "ebitda",
            "operating_cash_flow", "investing_cash_flow", "financing_cash_flow", "free_cash_flow"
        ]
        for metric in metrics:
            total = sum(getattr(q, metric) or 0 for q in quarters)
            setattr(ttm_data, metric, total)
            
    # For Balance Sheet, we usually take the most recent quarter instead of summing
    elif statement_type == "balance":
        most_recent = quarters[0]
        ttm_data.total_assets = most_recent.total_assets
        ttm_data.total_liabilities = most_recent.total_liabilities
        ttm_data.total_equity = most_recent.total_equity
        ttm_data.cash_and_equivalents = most_recent.cash_and_equivalents
        
    return [ttm_data]
