"""
Dividends Provider - Dividend History

Provides access to dividend payment history.
Uses vnstock company.dividends() method.
"""

import logging
import math
from typing import List, Optional

from pydantic import BaseModel, Field

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError
from vnibb.providers.vnstock.runtime import run_reference_provider

logger = logging.getLogger(__name__)


# =============================================================================
# DATA MODELS
# =============================================================================


class DividendData(BaseModel):
    """Dividend payment record."""

    symbol: str
    # Dates
    ex_date: Optional[str] = Field(None, alias="exDate")
    record_date: Optional[str] = Field(None, alias="recordDate")
    payment_date: Optional[str] = Field(None, alias="paymentDate")
    # Dividend info
    dividend_type: Optional[str] = Field(None, alias="type")
    cash_dividend: Optional[float] = Field(None, alias="cashDividend")
    stock_dividend: Optional[float] = Field(None, alias="stockDividend")
    dividend_ratio: Optional[float | str] = Field(None, alias="ratio")
    # Year
    fiscal_year: Optional[int] = Field(None, alias="year")
    issue_year: Optional[int] = Field(None, alias="issueYear")
    # Description
    description: Optional[str] = None

    model_config = {"populate_by_name": True}


class DividendsQueryParams(BaseModel):
    """Query parameters for dividends."""

    symbol: str


# =============================================================================
# FETCHER
# =============================================================================


class VnstockDividendsFetcher:
    """
    Fetcher for dividend payment history.

    Wraps vnstock company.dividends() method.
    """

    @staticmethod
    async def fetch(
        symbol: str,
    ) -> List[DividendData]:
        """
        Fetch dividend history for a company.

        Args:
            symbol: Stock symbol

        Returns:
            List of DividendData records
        """
        try:

            def _clean_value(value):
                if value is None:
                    return None
                if isinstance(value, float) and math.isnan(value):
                    return None
                if isinstance(value, str) and value.strip().lower() in {"", "nan", "nat", "none"}:
                    return None
                return value

            def _clean_str(value):
                cleaned = _clean_value(value)
                if cleaned is None:
                    return None
                text = str(cleaned)
                return None if text.strip().lower() in {"nan", "nat"} else text

            def _clean_number(value):
                cleaned = _clean_value(value)
                if cleaned is None:
                    return None
                try:
                    return float(cleaned)
                except (TypeError, ValueError):
                    return None

            def _clean_int(value):
                cleaned = _clean_number(value)
                return int(cleaned) if cleaned is not None else None

            def _is_dividend_record(record: dict) -> bool:
                code = str(
                    record.get("event_list_code") or record.get("eventListCode") or ""
                ).upper()
                if code == "DIV":
                    return True
                event_type = str(
                    record.get("eventType") or record.get("event_type") or record.get("type") or ""
                ).lower()
                return "dividend" in event_type

            def _fetch():
                from vnibb.providers.vnstock.runtime import get_company_class, validate_source

                company = get_company_class()(symbol=symbol.upper(), source=validate_source(settings.vnstock_source))
                if hasattr(company, "dividends"):
                    df = company.dividends()
                    if df is not None and len(df) > 0:
                        return df.to_dict(orient="records")
                if hasattr(company, "events"):
                    df_events = company.events()
                    if df_events is not None and len(df_events) > 0:
                        return [r for r in df_events.to_dict(orient="records") if _is_dividend_record(r)]
                elif not hasattr(company, "dividends"):
                    raise AttributeError("Dividends are unavailable in free VCI")

                return []

            records = await run_reference_provider(
                _fetch, settings.vnstock_timeout,
                key=("dividends", symbol.upper(), settings.vnstock_source),
            )

            result = []
            for r in records:
                result.append(
                    DividendData(
                        symbol=symbol.upper(),
                        ex_date=_clean_str(
                            r.get("exDate")
                            or r.get("exRightDate")
                            or r.get("exright_date")
                            or r.get("ex_date")
                        ),
                        record_date=_clean_str(r.get("recordDate") or r.get("record_date")),
                        payment_date=_clean_str(
                            r.get("paymentDate")
                            or r.get("executeDate")
                            or r.get("issue_date")
                            or r.get("public_date")
                        ),
                        dividend_type=_clean_str(
                            r.get("type") or r.get("eventType") or r.get("event_type")
                        ),
                        cash_dividend=_clean_number(
                            r.get("cashDividend") or r.get("cashDividen") or r.get("value")
                        ),
                        stock_dividend=_clean_number(
                            r.get("stockDividend") or r.get("stockDividen")
                        ),
                        dividend_ratio=_clean_value(r.get("ratio") or r.get("dividendRatio")),
                        fiscal_year=_clean_int(r.get("year") or r.get("fiscalYear")),
                        issue_year=_clean_int(r.get("issueYear")),
                        description=_clean_str(
                            r.get("description") or r.get("eventDesc") or r.get("event_name")
                        ),
                    )
                )

            return result

        except Exception as e:
            logger.error(f"Dividends fetch failed for {symbol}: {e}")
            raise ProviderError(
                message=f"Failed to fetch dividends for {symbol}: {e}",
                provider="vnstock",
                details={"symbol": symbol},
            )
