"""
VnStock Foreign Trading Fetcher

Fetches foreign investor buying/selling data for Vietnam-listed stocks.
"""

import asyncio
import logging
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)


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

                results.append(
                    ForeignTradingData(
                        symbol=params.symbol.upper(),
                        date=str(
                            row.get("time")
                            or row.get("date")
                            or row.get(("bid_ask", "transaction_time"))
                            or ""
                        ),
                        buy_volume=float(buy_vol) if buy_vol is not None else None,
                        sell_volume=float(sell_vol) if sell_vol is not None else None,
                        buy_value=float(buy_value) if buy_value is not None else None,
                        sell_value=float(sell_value) if sell_value is not None else None,
                        net_volume=(buy_vol - sell_vol)
                        if buy_vol is not None and sell_vol is not None
                        else None,
                        net_value=net_value,
                    )
                )
            except Exception as e:
                logger.warning(f"Skipping invalid foreign trading row: {e}")
        return results
