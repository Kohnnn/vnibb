from pydantic import BaseModel
from typing import List, Dict, Optional
from enum import Enum

class RatioCategory(str, Enum):
    VALUATION = "valuation"
    LIQUIDITY = "liquidity"
    PROFITABILITY = "profitability"
    EFFICIENCY = "efficiency"
    LEVERAGE = "leverage"
    COVERAGE = "coverage"
    OCF = "ocf"

class ComparisonMetric(BaseModel):
    id: str
    name: str
    category: RatioCategory
    format: str = "number"  # number, percent, currency, ratio

class StockComparison(BaseModel):
    symbol: str
    company_name: str
    metrics: Dict[str, Optional[float]]  # metric_id -> value

class ComparisonResponse(BaseModel):
    metrics: List[ComparisonMetric]
    stocks: List[StockComparison]
    period: str  # FY, Q1, TTM

# Define all comparison metrics
COMPARISON_METRICS = [
    # Valuation
    ComparisonMetric(id="pe_ratio", name="P/E Ratio", category=RatioCategory.VALUATION),
    ComparisonMetric(id="pb_ratio", name="P/B Ratio", category=RatioCategory.VALUATION),
    ComparisonMetric(id="ps_ratio", name="P/S Ratio", category=RatioCategory.VALUATION),
    ComparisonMetric(id="ev_ebitda", name="EV/EBITDA", category=RatioCategory.VALUATION),
    ComparisonMetric(id="market_cap", name="Market Cap", category=RatioCategory.VALUATION, format="currency"),
    
    # Profitability
    ComparisonMetric(id="roe", name="ROE", category=RatioCategory.PROFITABILITY, format="percent"),
    ComparisonMetric(id="roa", name="ROA", category=RatioCategory.PROFITABILITY, format="percent"),
    ComparisonMetric(id="gross_margin", name="Gross Margin", category=RatioCategory.PROFITABILITY, format="percent"),
    ComparisonMetric(id="net_margin", name="Net Margin", category=RatioCategory.PROFITABILITY, format="percent"),
    ComparisonMetric(id="operating_margin", name="Op. Margin", category=RatioCategory.PROFITABILITY, format="percent"),
    
    # Liquidity
    ComparisonMetric(id="current_ratio", name="Current Ratio", category=RatioCategory.LIQUIDITY),
    ComparisonMetric(id="quick_ratio", name="Quick Ratio", category=RatioCategory.LIQUIDITY),
    
    # Efficiency
    ComparisonMetric(id="asset_turnover", name="Asset Turnover", category=RatioCategory.EFFICIENCY),
    ComparisonMetric(id="inventory_turnover", name="Inv. Turnover", category=RatioCategory.EFFICIENCY),
    
    # Leverage
    ComparisonMetric(id="debt_equity", name="Debt/Equity", category=RatioCategory.LEVERAGE),
    ComparisonMetric(id="debt_assets", name="Debt/Assets", category=RatioCategory.LEVERAGE, format="percent"),

    # Coverage
    ComparisonMetric(
        id="interest_coverage",
        name="Interest Coverage",
        category=RatioCategory.COVERAGE,
        format="ratio",
    ),
    ComparisonMetric(
        id="debt_service_coverage",
        name="Debt Service Coverage",
        category=RatioCategory.COVERAGE,
        format="ratio",
    ),

    # Operating Cash Flow
    ComparisonMetric(id="ocf_debt", name="OCF/Debt", category=RatioCategory.OCF, format="ratio"),
    ComparisonMetric(id="fcf_yield", name="FCF Yield", category=RatioCategory.OCF, format="percent"),
    ComparisonMetric(id="ocf_sales", name="OCF/Sales", category=RatioCategory.OCF, format="percent"),
]
