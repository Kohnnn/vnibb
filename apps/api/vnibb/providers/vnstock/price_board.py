"""
Price Board Provider - Real-time Multi-Stock Prices

Provides real-time price board data for multiple symbols simultaneously.
Uses vnstock Trading.price_board() method.
"""

import asyncio
import logging
import math
from typing import List, Optional

from pydantic import BaseModel, Field

from vnibb.core.exceptions import ProviderError

logger = logging.getLogger(__name__)


# =============================================================================
# DATA MODELS
# =============================================================================

class PriceBoardData(BaseModel):
    """Real-time price board data for a single stock."""
    symbol: str
    # Price info
    price: Optional[float] = None
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    close: Optional[float] = None
    prev_close: Optional[float] = Field(None, alias="prevClose")
    # Change
    change: Optional[float] = None
    percent_change: Optional[float] = Field(None, alias="percentChange")
    # Volume
    volume: Optional[int] = None
    value: Optional[float] = None
    # Bid/Ask
    best_bid: Optional[float] = Field(None, alias="bestBid")
    best_ask: Optional[float] = Field(None, alias="bestAsk")
    best_bid_vol: Optional[int] = Field(None, alias="bestBidVol")
    best_ask_vol: Optional[int] = Field(None, alias="bestAskVol")
    # Foreign trading
    foreign_buy_vol: Optional[int] = Field(None, alias="foreignBuyVol")
    foreign_sell_vol: Optional[int] = Field(None, alias="foreignSellVol")
    # Reference prices
    ceiling: Optional[float] = None
    floor: Optional[float] = None
    reference: Optional[float] = None
    
    model_config = {"populate_by_name": True}


class PriceBoardQueryParams(BaseModel):
    """Query parameters for price board."""
    symbols: List[str]
    source: str = "KBS"



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
        symbols: List[str],
        source: str = "KBS",
    ) -> List[PriceBoardData]:

        """
        Fetch real-time price board for multiple symbols.

        Args:
            symbols: List of stock symbols (e.g., ['VNM', 'FPT', 'VIC'])
            source: Data source (KBS or VCI). KBS is the recommended primary
                because vnstock 3.5.x ships consistent snake_case columns;
                VCI is used as fallback when KBS is degraded.

        Returns:
            List of PriceBoardData records
        """
        if not symbols:
            return []

        # Source fallback chain: try the requested source first, then alternate.
        # Trading() only accepts {KBS, VCI}.
        primary = (source or "KBS").upper()
        if primary not in {"KBS", "VCI"}:
            primary = "KBS"
        fallback_chain = [primary]
        for alt in ("KBS", "VCI"):
            if alt not in fallback_chain:
                fallback_chain.append(alt)

        records: list = []
        last_error: Optional[Exception] = None
        for src in fallback_chain:
            try:
                def _fetch(_src: str = src):
                    from vnibb.providers.vnstock.runtime import get_trading_class

                    Trading = get_trading_class()
                    trading = Trading(source=_src.upper())

                    df = trading.price_board(
                        symbols_list=[s.upper() for s in symbols],
                        flatten_columns=True,
                        drop_levels=[0],
                    )
                    return df.to_dict(orient="records") if df is not None and len(df) > 0 else []

                loop = asyncio.get_event_loop()
                records = await loop.run_in_executor(None, _fetch)
                if records:
                    if src != primary:
                        logger.info(
                            "Price board recovered via fallback source %s for %d symbols",
                            src,
                            len(symbols),
                        )
                    break
            except Exception as e:  # noqa: BLE001
                last_error = e
                logger.warning("Price board fetch failed via %s: %s", src, e)
                continue

        if not records:
            if last_error is not None:
                raise ProviderError(f"Failed to fetch price board: {last_error}", "vnstock")
            return []

        try:
            # Normalize column names and build response. vnstock 3.5.x ships
            # snake_case columns when `flatten_columns=True, drop_levels=[0]`
            # for both KBS (foreign_buy_volume / foreign_sell_volume) and VCI
            # (same names plus foreign_buy_value / foreign_sell_value). The
            # earlier camelCase guesses (foreignBuyVol / fBuyVol) never match
            # any 3.5.x output, so the fetcher silently shipped NULL foreign
            # volumes for thousands of rows.
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
                    percent_change=_coalesce("percentChange", "pctChange", "percent_change"),
                    volume=_coalesce("volume", "nmTotalTradedQty", "accumulated_volume", "volume_accumulated"),
                    value=_coalesce("value", "nmTotalTradedValue", "accumulated_value", "total_value"),
                    best_bid=_coalesce("bestBid", "bidPrice1", "bid_price_1", "bid_1_price"),
                    best_ask=_coalesce("bestAsk", "offerPrice1", "ask_price_1", "ask_1_price"),
                    best_bid_vol=_coalesce("bestBidVol", "bidVol1", "bid_vol_1", "bid_1_volume"),
                    best_ask_vol=_coalesce("bestAskVol", "offerVol1", "ask_vol_1", "ask_1_volume"),
                    foreign_buy_vol=_coalesce("foreign_buy_volume", "foreignBuyVol", "fBuyVol"),
                    foreign_sell_vol=_coalesce("foreign_sell_volume", "foreignSellVol", "fSellVol"),
                    ceiling=_coalesce("ceiling", "ceilingPrice", "ceiling_price"),
                    floor=_coalesce("floor", "floorPrice", "floor_price"),
                    reference=_coalesce("reference", "refPrice", "ref_price", "reference_price"),
                ))

            return result
            
        except Exception as e:
            logger.error(f"Price board fetch failed: {e}")
            raise ProviderError(f"Failed to fetch price board: {e}", "vnstock")
