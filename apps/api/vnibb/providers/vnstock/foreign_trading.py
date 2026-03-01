"""
VnStock Foreign Trading Fetcher

Fetches foreign investor buying/selling data for Vietnam-listed stocks.
"""

import asyncio
import logging
from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_trade_date(value: Any) -> Optional[str]:
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    iso_candidate = text.replace("/", "-")
    if " " in iso_candidate and "T" not in iso_candidate:
        iso_candidate = iso_candidate.replace(" ", "T", 1)

    iso_prefix = iso_candidate[:10]
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            parsed = datetime.strptime(iso_prefix if fmt == "%Y-%m-%d" else text, fmt)
            return parsed.date().isoformat()
        except ValueError:
            continue

    if len(text) == 8 and text.isdigit():
        try:
            parsed = datetime.strptime(text, "%Y%m%d")
            return parsed.date().isoformat()
        except ValueError:
            return None

    if text.isdigit():
        # Numeric blobs like "074500016" are not valid trading dates.
        return None

    try:
        parsed_iso = datetime.fromisoformat(iso_candidate)
        return parsed_iso.date().isoformat()
    except ValueError:
        return None


class ForeignTradingQueryParams(BaseModel):
    """Query parameters for foreign trading data."""

    symbol: str = Field(..., min_length=1, max_length=10)
    limit: int = Field(default=30, ge=1, le=100)

    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class ForeignTradingData(BaseModel):
    """Standardized foreign trading data."""

    symbol: str
    date: Optional[str] = None
    buy_volume: Optional[float] = None
    sell_volume: Optional[float] = None
    buy_value: Optional[float] = None
    sell_value: Optional[float] = None
    net_volume: Optional[float] = None
    net_value: Optional[float] = None

    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "date": "2024-01-15",
                "buy_volume": 500000,
                "sell_volume": 300000,
                "net_volume": 200000,
            }
        }
    }


class VnstockForeignTradingFetcher(BaseFetcher[ForeignTradingQueryParams, ForeignTradingData]):
    """Fetcher for foreign trading data via vnstock."""

    provider_name = "vnstock"
    requires_credentials = False

    @staticmethod
    def transform_query(params: ForeignTradingQueryParams) -> dict[str, Any]:
        return {"symbol": params.symbol.upper(), "limit": params.limit}

    @staticmethod
    async def extract_data(
        query: dict[str, Any],
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:
        loop = asyncio.get_event_loop()

        def _fetch_sync() -> List[dict]:
            try:
                from vnstock import Vnstock

                # Foreign flow fields are currently exposed reliably on VCI price board.
                stock = Vnstock().stock(symbol=query["symbol"], source="VCI")
                # Preferred path: real-time board snapshot exposes foreign buy/sell fields.
                board = stock.trading.price_board(symbols_list=[query["symbol"]])
                if board is not None and not board.empty:
                    return board.to_dict("records")[: query.get("limit", 30)]

                # Fallback path: historical quote does not include foreign flows but keeps endpoint resilient.
                df = stock.quote.history(start="2025-01-01", end="2025-12-31", interval="1D")

                if df is None or df.empty:
                    return []

                # Return limited rows
                return df.tail(query.get("limit", 30)).to_dict("records")
            except Exception as e:
                logger.error(f"vnstock foreign trading fetch error: {e}")
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
        params: ForeignTradingQueryParams,
        data: List[dict[str, Any]],
    ) -> List[ForeignTradingData]:
        results = []
        for row in data:
            try:
                # Extract foreign trading columns if present
                buy_vol = row.get("foreignBuyVolume") or row.get(("match", "foreign_buy_volume"))
                if buy_vol is None:
                    buy_vol = row.get("buyForeignQuantity")

                sell_vol = row.get("foreignSellVolume") or row.get(("match", "foreign_sell_volume"))
                if sell_vol is None:
                    sell_vol = row.get("sellForeignQuantity")

                buy_value = row.get("foreignBuyValue") or row.get(("match", "foreign_buy_value"))
                sell_value = row.get("foreignSellValue") or row.get(("match", "foreign_sell_value"))
                net_value = row.get("foreignNetValue")

                has_foreign_fields = any(
                    value is not None
                    for value in (buy_vol, sell_vol, buy_value, sell_value, net_value)
                )
                if not has_foreign_fields:
                    continue

                buy_vol_num = _safe_float(buy_vol)
                sell_vol_num = _safe_float(sell_vol)
                buy_value_num = _safe_float(buy_value)
                sell_value_num = _safe_float(sell_value)
                net_value_num = _safe_float(net_value)
                if (
                    net_value_num is None
                    and buy_value_num is not None
                    and sell_value_num is not None
                ):
                    net_value_num = buy_value_num - sell_value_num

                normalized_date = _normalize_trade_date(
                    row.get("time")
                    or row.get("date")
                    or row.get(("listing", "trading_date"))
                    or row.get(("bid_ask", "trading_date"))
                    or row.get(("bid_ask", "transaction_time"))
                )

                results.append(
                    ForeignTradingData(
                        symbol=params.symbol.upper(),
                        date=normalized_date,
                        buy_volume=buy_vol_num,
                        sell_volume=sell_vol_num,
                        buy_value=buy_value_num,
                        sell_value=sell_value_num,
                        net_volume=(buy_vol_num - sell_vol_num)
                        if buy_vol_num is not None and sell_vol_num is not None
                        else None,
                        net_value=net_value_num,
                    )
                )
            except Exception as e:
                logger.warning(f"Skipping invalid foreign trading row: {e}")
        return results
