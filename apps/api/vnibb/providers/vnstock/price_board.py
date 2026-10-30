"""
Price Board Provider - Real-time Multi-Stock Prices

Provides real-time price board data for multiple symbols simultaneously.
Uses vnstock Trading.price_board() method.
"""

import asyncio
import logging
import math
from datetime import UTC, datetime

from pydantic import BaseModel, Field

from vnibb.core.exceptions import ProviderError
from vnibb.providers.vnstock.runtime import validate_source

logger = logging.getLogger(__name__)


# =============================================================================
# DATA MODELS
# =============================================================================

class PriceBoardData(BaseModel):
    """Real-time price board data for a single stock."""
    symbol: str
    # Price info
    price: float | None = None
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float | None = None
    prev_close: float | None = Field(None, alias="prevClose")
    # Change
    change: float | None = None
    percent_change: float | None = Field(None, alias="percentChange")
    # Volume
    volume: int | None = None
    value: float | None = None
    # Bid/Ask
    best_bid: float | None = Field(None, alias="bestBid")
    best_ask: float | None = Field(None, alias="bestAsk")
    best_bid_vol: int | None = Field(None, alias="bestBidVol")
    best_ask_vol: int | None = Field(None, alias="bestAskVol")
    # Foreign trading
    foreign_buy_vol: int | None = Field(None, alias="foreignBuyVol")
    foreign_sell_vol: int | None = Field(None, alias="foreignSellVol")
    foreign_buy_value: float | None = Field(None, alias="foreignBuyValue")
    foreign_sell_value: float | None = Field(None, alias="foreignSellValue")
    # Reference prices
    ceiling: float | None = None
    floor: float | None = None
    reference: float | None = None
    source: str | None = None
    refreshed_at: datetime = Field(default_factory=lambda: datetime.now(UTC), alias="refreshedAt")

    model_config = {"populate_by_name": True}


class PriceBoardQueryParams(BaseModel):
    """Query parameters for price board."""
    symbols: list[str]
    source: str = Field(default="VCI", pattern=r"^VCI$")



# =============================================================================
# FETCHER
# =============================================================================

class VnstockPriceBoardFetcher:
    """
    Fetcher for real-time price board data.

    Wraps vnstock Trading.price_board() for monitoring
    multiple stocks simultaneously.
    """

    @staticmethod
    async def fetch(
        symbols: list[str],
        source: str = "VCI",
    ) -> list[PriceBoardData]:

        """
        Fetch real-time price board for multiple symbols.

        Args:
            symbols: List of stock symbols (e.g., ['VNM', 'FPT', 'VIC'])
            source: Free VCI data source

        Returns:
            List of PriceBoardData records
        """
        source = validate_source(source)
        if not symbols:
            return []

        try:
            def _fetch():
                from vnibb.providers.vnstock.runtime import get_trading_class

                Trading = get_trading_class()
                trading = Trading(source=source)
                df = trading.price_board(
                    symbols_list=[s.upper() for s in symbols],
                    get_unified=True,
                )
                if df is not None and len(df) > 0 and str(df.attrs.get("price_unit", "")).upper() != "VND":
                    raise ValueError("VCI price board price unit is unavailable")
                if df is not None and str(df.attrs.get("value_unit", "")).upper() != "VND":
                    df = df.drop(columns=[name for name in ("value", "nmTotalTradedValue", "accumulated_value", "total_value", "foreign_buy_value", "foreign_sell_value", "foreignBuyValue", "foreignSellValue", "fBuyValue", "fSellValue") if name in df.columns])
                return df.to_dict(orient="records") if df is not None and len(df) > 0 else []

            loop = asyncio.get_event_loop()
            records = await loop.run_in_executor(None, _fetch)
        except Exception as e:
            logger.warning("Price board fetch failed via %s: %s", source, e)
            raise ProviderError(f"Failed to fetch price board: {e}", "vnstock") from e

        if not records:
            return []

        try:
            # Normalize the deployed snake_case provider fields and retained aliases.
            result = []
            for r in records:
                # Extract symbol from record
                symbol = r.get("symbol") or r.get("ticker") or r.get("code")
                if not symbol:
                    continue

                def _coalesce(*keys):
                    for key in keys:
                        value = r.get(key)
                        if value is None or value == "":
                            continue
                        if isinstance(value, float) and math.isnan(value):
                            continue
                        return value
                    return None

                result.append(PriceBoardData(
                    symbol=symbol,
                    price=_coalesce("price", "matchPrice", "match_price", "match_price_match", "close_price", "closePrice", "close"),
                    open=_coalesce("open", "openPrice", "open_price"),
                    high=_coalesce("high", "highPrice", "highest", "high_price"),
                    low=_coalesce("low", "lowPrice", "lowest", "low_price"),
                    close=_coalesce("close", "closePrice", "close_price"),
                    prev_close=_coalesce("prevClose", "refPrice", "ref", "ref_price", "reference_price"),
                    change=_coalesce("change", "priceChange", "price_change"),
                    percent_change=_coalesce("percentChange", "pctChange", "percent_change", "change_percent"),
                    volume=_coalesce("volume", "nmTotalTradedQty", "accumulated_volume", "volume_accumulated"),
                    value=_coalesce("value", "nmTotalTradedValue", "accumulated_value", "total_value"),
                    best_bid=_coalesce("bestBid", "bidPrice1", "bid_price_1", "bid_1_price"),
                    best_ask=_coalesce("bestAsk", "offerPrice1", "ask_price_1", "ask_1_price"),
                    best_bid_vol=_coalesce("bestBidVol", "bidVol1", "bid_vol_1", "bid_1_volume"),
                    best_ask_vol=_coalesce("bestAskVol", "offerVol1", "ask_vol_1", "ask_1_volume"),
                    foreign_buy_vol=_coalesce("foreign_buy_volume", "foreignBuyVol", "fBuyVol"),
                    foreign_sell_vol=_coalesce("foreign_sell_volume", "foreignSellVol", "fSellVol"),
                    foreign_buy_value=_coalesce("foreign_buy_value", "foreignBuyValue", "fBuyValue"),
                    foreign_sell_value=_coalesce("foreign_sell_value", "foreignSellValue", "fSellValue"),
                    ceiling=_coalesce("ceiling", "ceilingPrice", "ceiling_price"),
                    floor=_coalesce("floor", "floorPrice", "floor_price"),
                    reference=_coalesce("reference", "refPrice", "ref_price", "reference_price"),
                    source=source,
                ))

            return result

        except Exception as e:
            logger.error(f"Price board fetch failed: {e}")
            raise ProviderError(f"Failed to fetch price board: {e}", "vnstock")
