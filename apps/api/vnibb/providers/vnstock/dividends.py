"""
Dividends Provider - Dividend History

Provides access to dividend payment history.
Uses vnstock company.dividends() method.
"""

import asyncio
import logging
import math
from typing import List, Optional

from pydantic import BaseModel, Field

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError

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
                try:
                    from vnstock_data.api.company import Company

                    company = Company(source="VCI", symbol=symbol.upper())
                    df_events = company.events(event_type=2)
                    if df_events is not None and len(df_events) > 0:
                        records = df_events.to_dict(orient="records")
                        return [r for r in records if _is_dividend_record(r)]
                except Exception as e:
                    logger.debug(f"VCI dividends events failed for {symbol}: {e}")

                from vnstock import Vnstock

                def _fetch_source(source: str):
                    stock = Vnstock().stock(symbol=symbol.upper(), source=source)
                    if not hasattr(stock.company, "dividends"):
                        raise AttributeError("dividends not supported")
                    df = stock.company.dividends()
                    if df is not None and len(df) > 0:
                        return df.to_dict(orient="records")
                    df_events = stock.company.events() if hasattr(stock.company, "events") else None
                    if df_events is not None and len(df_events) > 0:
                        records = df_events.to_dict(orient="records")
                        dividend_records = [r for r in records if _is_dividend_record(r)]
                        if dividend_records:
                            return dividend_records
                    return []

                source = settings.vnstock_source
                try:
                    records = _fetch_source(source)
                    if records:
                        return records
                except Exception as e:
                    logger.debug(f"{source} dividends failed for {symbol}: {e}")

                return []

            loop = asyncio.get_event_loop()
            records = await loop.run_in_executor(None, _fetch)

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
