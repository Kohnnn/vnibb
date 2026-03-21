"""
VnStock Financial Ratios Fetcher

Fetches historical financial ratios for Vietnam-listed companies.
"""

import asyncio
import logging
import re
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)

VALID_PERIOD_RE = re.compile(r"^\d{4}(?:-Q[1-4])?$")


def _as_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_dividend_yield(value: Any) -> Optional[float]:
    numeric = _as_float(value)
    if numeric is None:
        return None

    normalized = numeric
    if 0 < abs(normalized) < 1:
        normalized *= 100

    while abs(normalized) > 100:
        normalized /= 100

    if abs(normalized) > 50:
        normalized = 50.0 if normalized > 0 else -50.0

    return normalized


def _period_sort_key(period: str) -> int:
    upper = str(period or "").upper()
    year_match = re.search(r"(20\d{2})", upper)
    year = int(year_match.group(1)) if year_match else 0
    quarter_match = re.search(r"Q([1-4])", upper)
    quarter = int(quarter_match.group(1)) if quarter_match else 0
    return year * 10 + quarter


def _normalize_period_value(
    period_value: Any,
    *,
    fiscal_year: Any = None,
    fiscal_quarter: Any = None,
    default_period: str = "year",
) -> Optional[str]:
    text = str(period_value or "").strip().upper()

    year_hint = _as_float(fiscal_year)
    quarter_hint = _as_float(fiscal_quarter)
    year = int(year_hint) if year_hint is not None else None
    quarter = int(quarter_hint) if quarter_hint is not None else None
    if year is not None and not (1900 <= year <= 2100):
        year = None
    if quarter is not None and not (1 <= quarter <= 4):
        quarter = None

    if text:
        if VALID_PERIOD_RE.match(text):
            return text

        year_match = re.search(r"(20\d{2})", text)
        quarter_match = re.search(r"Q([1-4])", text)

        if year_match and quarter_match:
            return f"{year_match.group(1)}-Q{quarter_match.group(1)}"

        alt_quarter = re.match(r"^([1-4])[\/_-](20\d{2})$", text)
        if alt_quarter:
            return f"{alt_quarter.group(2)}-Q{alt_quarter.group(1)}"

        compact_quarter = re.match(r"^(20\d{2})[\/_-]?([1-4])$", text)
        if compact_quarter and ("Q" in text or default_period == "quarter"):
            return f"{compact_quarter.group(1)}-Q{compact_quarter.group(2)}"

        if text.isdigit():
            numeric = int(text)
            if 1900 <= numeric <= 2100:
                return str(numeric)
            if 1 <= numeric <= 4 and year is not None:
                return f"{year}-Q{numeric}"

    if year is None:
        return None

    if quarter is not None or default_period == "quarter":
        resolved_quarter = quarter if quarter is not None else 4
        if 1 <= resolved_quarter <= 4:
            return f"{year}-Q{resolved_quarter}"

    return str(year)


class FinancialRatiosQueryParams(BaseModel):
    """Query parameters for financial ratios."""

    symbol: str = Field(..., min_length=1, max_length=10)
    period: str = Field(default="year", pattern=r"^(year|quarter)$")

    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class FinancialRatioData(BaseModel):
    """Standardized financial ratio data."""

    symbol: str
    period: Optional[str] = None  # 2024, Q3/2024
    pe: Optional[float] = None
    pb: Optional[float] = None
    ps: Optional[float] = None
    ev_ebitda: Optional[float] = None
    ev_sales: Optional[float] = None
    ebitda: Optional[float] = None
    roe: Optional[float] = None
    roa: Optional[float] = None
    roic: Optional[float] = None
    eps: Optional[float] = None
    bvps: Optional[float] = None
    debt_equity: Optional[float] = None
    debt_assets: Optional[float] = None
    equity_multiplier: Optional[float] = None
    current_ratio: Optional[float] = None
    quick_ratio: Optional[float] = None
    cash_ratio: Optional[float] = None
    asset_turnover: Optional[float] = None
    inventory_turnover: Optional[float] = None
    receivables_turnover: Optional[float] = None
    loan_to_deposit: Optional[float] = None
    casa_ratio: Optional[float] = None
    deposit_growth: Optional[float] = None
    nim: Optional[float] = None
    equity_to_assets: Optional[float] = None
    asset_yield: Optional[float] = None
    credit_cost: Optional[float] = None
    provision_coverage: Optional[float] = None
    gross_margin: Optional[float] = None
    net_margin: Optional[float] = None
    operating_margin: Optional[float] = None
    interest_coverage: Optional[float] = None
    debt_service_coverage: Optional[float] = None
    ocf_debt: Optional[float] = None
    fcf_yield: Optional[float] = None
    ocf_sales: Optional[float] = None
    revenue_growth: Optional[float] = None
    earnings_growth: Optional[float] = None
    dps: Optional[float] = None
    dividend_yield: Optional[float] = None
    payout_ratio: Optional[float] = None
    peg_ratio: Optional[float] = None

    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "period": "2024",
                "pe": 15.5,
                "pb": 3.2,
                "roe": 25.8,
            }
        }
    }


class VnstockFinancialRatiosFetcher(BaseFetcher[FinancialRatiosQueryParams, FinancialRatioData]):
    """Fetcher for financial ratios via vnstock."""

    provider_name = "vnstock"
    requires_credentials = False

    @staticmethod
    def transform_query(params: FinancialRatiosQueryParams) -> dict[str, Any]:
        return {"symbol": params.symbol.upper(), "period": params.period}

    @staticmethod
    async def extract_data(
        query: dict[str, Any],
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:
        loop = asyncio.get_event_loop()

        def _fetch_sync() -> List[dict[str, Any]]:
            try:
                from vnstock import Vnstock

                stock = Vnstock().stock(symbol=query["symbol"], source=settings.vnstock_source)
                finance = stock.finance
                df = finance.ratio(period=query.get("period", "year"))

                if df is None or df.empty:
                    return []

                if "period" not in df.columns:
                    index_name = df.index.name or "index"
                    df = df.reset_index()
                    if "period" not in df.columns:
                        if index_name in df.columns:
                            df = df.rename(columns={index_name: "period"})
                        elif "index" in df.columns:
                            df = df.rename(columns={"index": "period"})

                return df.to_dict("records")
            except Exception as e:
                logger.error(f"vnstock ratios fetch error: {e}")
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
        params: FinancialRatiosQueryParams,
        data: List[dict[str, Any]],
    ) -> List[FinancialRatioData]:
        if not data:
            return []

        def _to_float(value: Any) -> Optional[float]:
            if value is None:
                return None
            try:
                return float(value)
            except (TypeError, ValueError):
                return None

        def _pick_float(*values: Any) -> Optional[float]:
            for value in values:
                numeric = _to_float(value)
                if numeric is not None:
                    return numeric
            return None

        def _normalize_key(key: Any) -> str:
            if isinstance(key, tuple):
                text = " ".join(str(part).strip() for part in key if part is not None)
            else:
                text = str(key or "").strip()
            return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")

        def _build_lookup(row: dict[str, Any]) -> dict[str, Any]:
            lookup: dict[str, Any] = {}
            for key, value in row.items():
                normalized = _normalize_key(key)
                if normalized and normalized not in lookup:
                    lookup[normalized] = value

                if isinstance(key, tuple):
                    for part in key:
                        part_normalized = _normalize_key(part)
                        if part_normalized and part_normalized not in lookup:
                            lookup[part_normalized] = value

            return lookup

        def _lookup(lookup: dict[str, Any], *aliases: str) -> Any:
            for alias in aliases:
                if alias in lookup:
                    return lookup[alias]
            return None

        has_tuple_keys = any(
            isinstance(key, tuple)
            for row in data
            for key in (row.keys() if isinstance(row, dict) else [])
        )
        if has_tuple_keys:
            results: list[FinancialRatioData] = []
            for row in data:
                if not isinstance(row, dict):
                    continue

                lookup = _build_lookup(row)
                period_hint_year = _pick_float(
                    _lookup(
                        lookup,
                        "year_report",
                        "yearreport",
                        "fiscal_year",
                        "fiscalyear",
                        "year",
                    )
                )
                period_hint_quarter = _pick_float(
                    _lookup(
                        lookup,
                        "quarter",
                        "fiscal_quarter",
                        "fiscalquarter",
                        "length_report",
                    )
                )
                period_value = _lookup(
                    lookup,
                    "year_report",
                    "yearreport",
                    "period",
                    "quarter",
                    "fiscal_year",
                    "fiscalyear",
                )
                period_text = _normalize_period_value(
                    period_value,
                    fiscal_year=period_hint_year,
                    fiscal_quarter=period_hint_quarter,
                    default_period=params.period,
                )
                if not period_text:
                    continue

                try:
                    dso = _pick_float(
                        _lookup(lookup, "days_sales_outstanding"),
                        _lookup(lookup, "day_sales_outstanding"),
                    )
                    receivables_turnover = _pick_float(
                        _lookup(lookup, "receivables_turnover"),
                        _lookup(lookup, "account_receivables_turnover"),
                    )
                    if receivables_turnover is None and dso not in (None, 0):
                        receivables_turnover = 365.0 / dso

                    results.append(
                        FinancialRatioData(
                            symbol=params.symbol.upper(),
                            period=period_text,
                            pe=_pick_float(_lookup(lookup, "p_e"), _lookup(lookup, "pe")),
                            pb=_pick_float(_lookup(lookup, "p_b"), _lookup(lookup, "pb")),
                            ps=_pick_float(_lookup(lookup, "p_s"), _lookup(lookup, "ps")),
                            ev_ebitda=_pick_float(
                                _lookup(lookup, "ev_ebitda"),
                                _lookup(lookup, "ev_to_ebitda"),
                            ),
                            ev_sales=_pick_float(
                                _lookup(lookup, "ev_sales"),
                                _lookup(lookup, "ev_to_sales"),
                                _lookup(lookup, "enterprise_value_to_sales"),
                            ),
                            ebitda=_pick_float(
                                _lookup(lookup, "ebitda"),
                                _lookup(lookup, "ebitda_bn_vnd"),
                            ),
                            roe=_pick_float(_lookup(lookup, "roe"), _lookup(lookup, "roe_percent")),
                            roa=_pick_float(_lookup(lookup, "roa"), _lookup(lookup, "roa_percent")),
                            roic=_pick_float(
                                _lookup(lookup, "roic"),
                                _lookup(lookup, "roic_percent"),
                            ),
                            eps=_pick_float(_lookup(lookup, "eps"), _lookup(lookup, "eps_vnd")),
                            bvps=_pick_float(_lookup(lookup, "bvps"), _lookup(lookup, "bvps_vnd")),
                            debt_equity=_pick_float(
                                _lookup(lookup, "debt_equity"),
                                _lookup(lookup, "debt_on_equity"),
                            ),
                            debt_assets=_pick_float(
                                _lookup(lookup, "debt_assets"),
                                _lookup(lookup, "debt_on_assets"),
                            ),
                            equity_multiplier=_pick_float(
                                _lookup(lookup, "equity_multiplier"),
                                _lookup(lookup, "financial_leverage"),
                            ),
                            current_ratio=_pick_float(_lookup(lookup, "current_ratio")),
                            quick_ratio=_pick_float(_lookup(lookup, "quick_ratio")),
                            cash_ratio=_pick_float(_lookup(lookup, "cash_ratio")),
                            asset_turnover=_pick_float(_lookup(lookup, "asset_turnover")),
                            inventory_turnover=_pick_float(_lookup(lookup, "inventory_turnover")),
                            receivables_turnover=receivables_turnover,
                            gross_margin=_pick_float(
                                _lookup(lookup, "gross_profit_margin"),
                                _lookup(lookup, "gross_profit_margin_percent"),
                            ),
                            net_margin=_pick_float(
                                _lookup(lookup, "net_profit_margin"),
                                _lookup(lookup, "net_profit_margin_percent"),
                            ),
                            operating_margin=_pick_float(
                                _lookup(lookup, "operating_margin"),
                                _lookup(lookup, "ebit_margin"),
                                _lookup(lookup, "ebit_margin_percent"),
                            ),
                            interest_coverage=_pick_float(_lookup(lookup, "interest_coverage")),
                            debt_service_coverage=_pick_float(
                                _lookup(lookup, "debt_service_coverage")
                            ),
                            ocf_debt=_pick_float(
                                _lookup(lookup, "ocf_to_debt"),
                                _lookup(lookup, "ocf_debt"),
                            ),
                            fcf_yield=_pick_float(_lookup(lookup, "fcf_yield")),
                            ocf_sales=_pick_float(_lookup(lookup, "ocf_sales")),
                            revenue_growth=_pick_float(_lookup(lookup, "revenue_growth")),
                            earnings_growth=_pick_float(_lookup(lookup, "earnings_growth")),
                            dps=_pick_float(
                                _lookup(lookup, "dividends_per_share"),
                                _lookup(lookup, "dps"),
                            ),
                            dividend_yield=_normalize_dividend_yield(
                                _pick_float(
                                    _lookup(lookup, "dividend_yield"),
                                    _lookup(lookup, "dividend_yield_percent"),
                                )
                            ),
                            payout_ratio=_pick_float(_lookup(lookup, "payout_ratio")),
                            peg_ratio=_pick_float(_lookup(lookup, "peg_ratio")),
                        )
                    )
                except Exception as e:
                    logger.warning(f"Skipping tuple-key ratio row: {e}")

            if results:
                results = [
                    item for item in results if VALID_PERIOD_RE.match(str(item.period or ""))
                ]
                results.sort(
                    key=lambda item: _period_sort_key(str(item.period or "")), reverse=True
                )
                return results

        has_row_items = any("item_id" in row for row in data)
        if has_row_items:
            metric_map = {
                "p_e": "pe",
                "p_b": "pb",
                "p_s": "ps",
                "ev_ebitda": "ev_ebitda",
                "ev_sales": "ev_sales",
                "ev_to_sales": "ev_sales",
                "enterprise_value_to_sales": "ev_sales",
                "ebitda": "ebitda",
                "roe": "roe",
                "roa": "roa",
                "roic": "roic",
                "trailing_eps": "eps",
                "book_value_per_share_bvps": "bvps",
                "dividends_per_share": "dps",
                "dps": "dps",
                "dividend_yield": "dividend_yield",
                "payout_ratio": "payout_ratio",
                "peg_ratio": "peg_ratio",
                "gross_profit_margin": "gross_margin",
                "net_profit_margin": "net_margin",
                "short_term_ratio": "current_ratio",
                "quick_ratio": "quick_ratio",
                "cash_ratio": "cash_ratio",
                "asset_turnover": "asset_turnover",
                "inventory_turnover": "inventory_turnover",
                "receivables_turnover": "receivables_turnover",
                "operating_margin": "operating_margin",
                "interest_coverage": "interest_coverage",
                "debt_service_coverage": "debt_service_coverage",
                "ocf_to_debt": "ocf_debt",
                "ocf_debt": "ocf_debt",
                "fcf_yield": "fcf_yield",
                "ocf_sales": "ocf_sales",
                "revenue_growth": "revenue_growth",
                "earnings_growth": "earnings_growth",
            }

            raw_fields = {
                key for row in data for key in row.keys() if key not in {"item", "item_id"}
            }
            period_columns: list[tuple[Any, str]] = []
            period_values: set[str] = set()

            for raw_key in raw_fields:
                normalized_period = _normalize_period_value(raw_key, default_period=params.period)
                if not normalized_period:
                    continue
                period_columns.append((raw_key, normalized_period))
                period_values.add(normalized_period)

            periods = sorted(period_values, key=_period_sort_key, reverse=True)

            if not periods:
                logger.warning("No valid ratio periods found in vnstock response")
                return []

            by_period: dict[str, dict[str, Any]] = {
                period: {"symbol": params.symbol.upper(), "period": period} for period in periods
            }
            liabilities_by_period: dict[str, float] = {}
            equity_by_period: dict[str, float] = {}
            enterprise_value_by_period: dict[str, float] = {}
            revenue_by_period: dict[str, float] = {}

            for row in data:
                item_id = row.get("item_id")
                if not item_id:
                    continue
                item_id_lower = str(item_id).strip().lower()
                for raw_key, period in period_columns:
                    if raw_key not in row:
                        continue
                    value = _to_float(row.get(raw_key))
                    if value is None:
                        continue
                    if item_id_lower in metric_map:
                        field = metric_map[item_id_lower]
                        by_period[period][field] = value
                        continue
                    if item_id_lower == "liabilities":
                        liabilities_by_period[period] = value
                        continue
                    if item_id_lower == "owners_equity":
                        equity_by_period[period] = value
                        continue
                    if item_id_lower in {"enterprise_value", "ev"}:
                        enterprise_value_by_period[period] = value
                        continue
                    if item_id_lower in {
                        "revenue",
                        "net_revenue",
                        "total_revenue",
                        "sales_revenue",
                    }:
                        revenue_by_period[period] = value

            for period in periods:
                if by_period[period].get("debt_equity") is None:
                    liabilities = liabilities_by_period.get(period)
                    equity = equity_by_period.get(period)
                    if liabilities is not None and equity not in (None, 0):
                        by_period[period]["debt_equity"] = liabilities / equity

                if by_period[period].get("ev_sales") is None:
                    enterprise_value = enterprise_value_by_period.get(period)
                    revenue = revenue_by_period.get(period)
                    if enterprise_value is not None and revenue not in (None, 0):
                        by_period[period]["ev_sales"] = enterprise_value / revenue

            results = []
            for period in periods:
                try:
                    results.append(FinancialRatioData(**by_period[period]))
                except Exception as e:
                    logger.warning(f"Skipping invalid ratio row: {e}")
            return results

        results = []
        for row in data:
            try:
                enterprise_value = _pick_float(
                    row.get("enterpriseValue"),
                    row.get("enterprise_value"),
                    row.get("ev"),
                )
                revenue = _pick_float(
                    row.get("revenue"),
                    row.get("netRevenue"),
                    row.get("totalRevenue"),
                    row.get("salesRevenue"),
                )
                computed_ev_sales = None
                if enterprise_value is not None and revenue not in (None, 0):
                    computed_ev_sales = enterprise_value / revenue

                period_value = _normalize_period_value(
                    row.get("yearReport")
                    or row.get("period")
                    or row.get("quarter")
                    or row.get("fiscalYear")
                    or row.get("year"),
                    fiscal_year=row.get("fiscalYear") or row.get("year"),
                    fiscal_quarter=row.get("quarter") or row.get("fiscalQuarter"),
                    default_period=params.period,
                )
                if not period_value:
                    continue

                results.append(
                    FinancialRatioData(
                        symbol=params.symbol.upper(),
                        period=period_value,
                        pe=row.get("priceToEarning") or row.get("pe"),
                        pb=row.get("priceToBook") or row.get("pb"),
                        ps=row.get("priceToSales") or row.get("ps"),
                        ev_ebitda=row.get("evToEbitda")
                        or row.get("evEbitda")
                        or row.get("ev_ebitda"),
                        ev_sales=_pick_float(
                            row.get("evToSales"),
                            row.get("evSales"),
                            row.get("ev_sales"),
                            row.get("enterpriseValueToSales"),
                            row.get("ev_to_sales"),
                            computed_ev_sales,
                        ),
                        ebitda=_pick_float(
                            row.get("ebitda"),
                            row.get("EBITDA"),
                            row.get("ebitdaTtm"),
                        ),
                        roe=row.get("roe"),
                        roa=row.get("roa"),
                        roic=row.get("roic") or row.get("roicPercent"),
                        eps=row.get("earningPerShare")
                        or row.get("earningsPerShare")
                        or row.get("eps"),
                        bvps=row.get("bookValuePerShare") or row.get("bvps"),
                        debt_equity=row.get("debtOnEquity") or row.get("de"),
                        debt_assets=row.get("debtOnAssets") or row.get("debtAssets"),
                        equity_multiplier=row.get("equityMultiplier"),
                        current_ratio=row.get("currentRatio"),
                        quick_ratio=row.get("quickRatio"),
                        cash_ratio=row.get("cashRatio"),
                        asset_turnover=row.get("assetTurnover"),
                        inventory_turnover=row.get("inventoryTurnover"),
                        receivables_turnover=row.get("receivablesTurnover"),
                        gross_margin=row.get("grossProfitMargin") or row.get("grossMargin"),
                        net_margin=row.get("postTaxMargin") or row.get("netMargin"),
                        operating_margin=row.get("operatingMargin") or row.get("opMargin"),
                        interest_coverage=row.get("interestCoverage"),
                        debt_service_coverage=row.get("debtServiceCoverage"),
                        ocf_debt=row.get("ocfToDebt") or row.get("ocfDebt"),
                        fcf_yield=row.get("fcfYield"),
                        ocf_sales=row.get("ocfSales"),
                        revenue_growth=row.get("revenueGrowth") or row.get("revenue_growth"),
                        earnings_growth=row.get("earningsGrowth") or row.get("earnings_growth"),
                        dps=row.get("dividendPerShare") or row.get("dps"),
                        dividend_yield=_normalize_dividend_yield(
                            row.get("dividendYield") or row.get("dividend_yield")
                        ),
                        payout_ratio=row.get("payoutRatio") or row.get("payout_ratio"),
                        peg_ratio=row.get("pegRatio") or row.get("peg_ratio"),
                    )
                )
            except Exception as e:
                logger.warning(f"Skipping invalid ratio row: {e}")
        results = [item for item in results if VALID_PERIOD_RE.match(str(item.period or ""))]
        results.sort(key=lambda item: _period_sort_key(str(item.period or "")), reverse=True)
        return results
