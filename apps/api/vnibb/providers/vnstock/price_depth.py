"""
Price Depth Provider - Order Book / Bid-Ask Depth

Provides real-time order book data showing bid and ask levels.
Uses vnstock Market.equity().order_book() method.
"""

import asyncio
import logging
from typing import List, Optional

from pydantic import BaseModel, Field

from vnibb.core.exceptions import ProviderError

logger = logging.getLogger(__name__)


# =============================================================================
# DATA MODELS
# =============================================================================


class OrderLevel(BaseModel):
    """Single price level in order book."""

    price: float | None = None
    volume: int
    order_count: Optional[int] = Field(None, alias="orderCount")

    model_config = {"populate_by_name": True}


class PriceDepthData(BaseModel):
    """Order book / price depth data."""

    symbol: str
    # Bid levels (buyers)
    bid_1: Optional[OrderLevel] = None
    bid_2: Optional[OrderLevel] = None
    bid_3: Optional[OrderLevel] = None
    # Ask levels (sellers)
    ask_1: Optional[OrderLevel] = None
    ask_2: Optional[OrderLevel] = None
    ask_3: Optional[OrderLevel] = None
    # Summary
    total_bid_volume: Optional[int] = Field(None, alias="totalBidVolume")
    total_ask_volume: Optional[int] = Field(None, alias="totalAskVolume")
    last_price: Optional[float] = Field(None, alias="lastPrice")
    last_volume: Optional[int] = Field(None, alias="lastVolume")
    raw_levels: Optional[list[dict]] = None
    provider_source: str = "VCI"
    observed_at: str | None = None
    timestamp_meaning: str = "unknown"
    price_unit: str = "unknown"
    volume_unit: str = "unknown"
    coverage_scope: str = "current_batch"
    historical_replay_supported: bool = False

    model_config = {"populate_by_name": True}


class PriceDepthQueryParams(BaseModel):
    """Query parameters for price depth."""

    symbol: str
    source: str = Field(default="VCI", pattern=r"^VCI$")


# =============================================================================
# FETCHER
# =============================================================================


class VnstockPriceDepthFetcher:
    """
    Fetcher for order book / price depth data.

    Wraps vnstock Market.equity().order_book() for real-time
    bid/ask order levels.
    """

    @staticmethod
    async def fetch(
        symbol: str,
        source: str = "VCI",
    ) -> PriceDepthData:
        """
        Fetch price depth (order book) for a symbol.

        Args:
            symbol: Stock symbol
            source: Free VCI only

        Returns:
            PriceDepthData with bid/ask levels
        """
        from vnibb.providers.vnstock.runtime import import_vnstock_symbol, validate_source

        source = validate_source(source)
        try:
            def _fetch():
                market = import_vnstock_symbol("Market")[0]()
                df = market.equity(symbol.upper()).order_book(source=source)
                if df is not None and len(df) > 0 and str(df.attrs.get("price_unit", "")).upper() != "VND":
                    raise ValueError("VCI order book price unit is unavailable")
                return df.to_dict(orient="records") if df is not None and len(df) > 0 else []

            loop = asyncio.get_event_loop()
            records = await loop.run_in_executor(None, _fetch)

            if not records:
                return PriceDepthData(symbol=symbol.upper(), raw_levels=[])

            # Parse bid/ask levels from records
            bids = []
            asks = []

            for r in records:
                # Try to identify if this is a bid or ask record
                side = r.get("side") or r.get("type")
                price = r.get("price") or r.get("matchPrice")
                volume = r.get("volume") or r.get("qty")

                if side:
                    # IMPORTANT: do NOT coerce missing price to 0. A 0-price level
                    # defeats the bid-or-ask fallback in equity._normalize_orderbook_entries
                    # because `0 is not None` evaluates True, so the merge picks the
                    # zero bid price over a real ask price. Pass None when the
                    # upstream feed omits the price.
                    level = OrderLevel(
                        price=(float(price) if price is not None else None),
                        volume=int(volume or 0),
                    )
                    if side.lower() in ("bid", "buy", "b"):
                        bids.append(level)
                    elif side.lower() in ("ask", "sell", "s", "offer"):
                        asks.append(level)

            # If no side info, try to parse from column-based format
            if not bids and not asks and records:
                r = records[0]
                for i in range(1, 4):
                    # vnstock 5.x native order_book emits canonical
                    # bid_price_1..3/bid_vol_1..3/ask_price_1..3/ask_vol_1..3.
                    bid_price = r.get(f"bidPrice{i}") or r.get(f"bid{i}") or r.get(f"bid_price_{i}")
                    bid_vol = (
                        r.get(f"bidVol{i}") or r.get(f"bidVolume{i}")
                        or r.get(f"bid_vol_{i}")
                    )
                    if bid_price:
                        bids.append(
                            OrderLevel(price=float(bid_price), volume=int(bid_vol or 0))
                        )

                    ask_price = (
                        r.get(f"offerPrice{i}") or r.get(f"askPrice{i}")
                        or r.get(f"ask{i}") or r.get(f"ask_price_{i}")
                    )
                    ask_vol = (
                        r.get(f"offerVol{i}") or r.get(f"askVolume{i}")
                        or r.get(f"askVol{i}") or r.get(f"ask_vol_{i}")
                    )
                    if ask_price:
                        asks.append(
                            OrderLevel(price=float(ask_price), volume=int(ask_vol or 0))
                        )
            if not bids and not asks:
                raise ValueError("Unrecognized VCI order book response")


            return PriceDepthData(
                symbol=symbol.upper(),
                bid_1=bids[0] if len(bids) > 0 else None,
                bid_2=bids[1] if len(bids) > 1 else None,
                bid_3=bids[2] if len(bids) > 2 else None,
                ask_1=asks[0] if len(asks) > 0 else None,
                ask_2=asks[1] if len(asks) > 1 else None,
                ask_3=asks[2] if len(asks) > 2 else None,
                total_bid_volume=sum(b.volume for b in bids) if bids else None,
                total_ask_volume=sum(a.volume for a in asks) if asks else None,
                raw_levels=records,
            )

        except Exception as e:
            logger.error(f"Price depth fetch failed for {symbol}: {e}")
            raise ProviderError(
                message=f"Failed to fetch price depth for {symbol}: {e}",
                provider="vnstock",
                details={"symbol": symbol},
            )
