"""
VnStock Intraday Trades Fetcher

Fetches intraday price/volume data for Vietnam-listed stocks.
"""

import asyncio
import logging
from math import isfinite
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator
from requests.exceptions import Timeout as RequestTimeout

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)
INTRADAY_PROVIDER_LIMIT = 500


class IntradayQueryParams(BaseModel):
    """Query parameters for intraday data."""
    
    symbol: str = Field(..., min_length=1, max_length=10)
    limit: int = Field(default=100, ge=1, le=INTRADAY_PROVIDER_LIMIT)
    
    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class IntradayTradeData(BaseModel):
    """Standardized intraday trade data."""
    
    symbol: str
    time: Optional[str] = None
    price: Optional[float] = None
    volume: Optional[float] = None
    change: Optional[float] = None
    change_pct: Optional[float] = None
    match_type: Optional[str] = None  # Buy/Sell
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "time": "14:30:15",
                "price": 75800,
                "volume": 1000,
                "match_type": "BU",
            }
        }
    }


class VnstockIntradayFetcher(BaseFetcher[IntradayQueryParams, IntradayTradeData]):
    """Fetcher for intraday trades via vnstock."""
    
    provider_name = "vnstock"
    requires_credentials = False
    propagate_provider_errors = True
    
    @staticmethod
    def transform_query(params: IntradayQueryParams) -> dict[str, Any]:
        return {"symbol": params.symbol.upper(), "limit": params.limit}
    
    @staticmethod
    async def extract_data(
        query: dict[str, Any],
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:
        loop = asyncio.get_event_loop()
        
        def _fetch_sync() -> List[dict]:
            try:
                from vnibb.providers.vnstock.runtime import get_quote_class, validate_source

                try:
                    source = validate_source(settings.vnstock_source)
                except ValueError as exc:
                    raise ProviderError(
                        "Intraday source is unsupported", provider="vnstock", capability="intraday_unavailable"
                    ) from exc
                quote = get_quote_class()(symbol=query["symbol"], source=source)
                method = getattr(quote, "intraday", None)
                if not callable(method):
                    raise ProviderError(
                        "Intraday trades are unsupported", provider="vnstock", capability="intraday_unavailable"
                    )
                df = method(page_size=query.get("limit", 100))
                if df is None:
                    raise ValueError("Missing intraday provider response")
                if df.empty:
                    return []
                if str(df.attrs.get("price_unit", "")).upper() != "VND":
                    raise ProviderError(
                        "VCI intraday price unit is unavailable", provider="vnstock", details={"feed_status": "unusable"}
                    )
                
                return df.tail(query.get("limit", 100)).to_dict("records")
            except (ProviderError, TimeoutError):
                raise
            except RequestTimeout as exc:
                raise ProviderTimeoutError(provider="vnstock", timeout_seconds=settings.vnstock_timeout) from exc
            except (Exception, SystemExit) as exc:
                logger.warning("Intraday acquisition failed for %s: %s", query["symbol"], type(exc).__name__)
                raise ProviderError("Intraday acquisition failed", provider="vnstock") from exc
        
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(None, _fetch_sync),
                timeout=settings.vnstock_timeout,
            )
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(provider="vnstock", timeout_seconds=settings.vnstock_timeout)
    
    @staticmethod
    def transform_data(
        params: IntradayQueryParams,
        data: List[dict[str, Any]],
    ) -> List[IntradayTradeData]:
        results = []
        for row in data:
            try:
                trade = IntradayTradeData(
                    symbol=params.symbol,
                    time=str(row.get("time") or row.get("thoiGian") or row.get("datetime") or "") or None,
                    price=row.get("price", row.get("close", row.get("gia"))),
                    volume=row.get("volume", row.get("khoiLuong")),
                    change=_optional_finite(row.get("change", row.get("thayDoi"))),
                    change_pct=_optional_finite(row.get("pctChange", row.get("phanTram"))),
                    match_type=row.get("match_type") or row.get("matchType") or row.get("action") or row.get("loaiGiaoDich"),
                )
                if (trade.price is not None and isfinite(trade.price) and trade.price > 0
                        and trade.volume is not None and isfinite(trade.volume) and trade.volume >= 0):
                    results.append(trade)
            except (TypeError, ValueError):
                continue
        if data and not results:
            raise ProviderError(
                "Intraday batch has no usable trades", provider="vnstock", details={"feed_status": "unusable"}
            )
        return results


def _optional_finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if isfinite(number) else None
