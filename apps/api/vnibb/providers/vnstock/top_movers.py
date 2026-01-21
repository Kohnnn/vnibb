"""
Top Movers Provider - Market Top Gainers/Losers/Volume/Value

Provides top performing stocks based on various criteria.
Uses vnstock Listing.symbols_by_group() and Trading.price_board() methods.

FIXED: Handles MultiIndex DataFrame from price_board() and calculates
price change from match_price and ref_price.
"""

import asyncio
import logging
from typing import List, Optional, Literal, Tuple

from pydantic import BaseModel, Field

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# Shared thread pool for parallel fetching across requests
_executor = ThreadPoolExecutor(max_workers=10)


# =============================================================================

# DATA MODELS
# =============================================================================

class TopMoverData(BaseModel):
    """Top mover stock data."""
    symbol: str
    index: str
    last_price: Optional[float] = Field(None, alias="lastPrice")
    price_change: Optional[float] = Field(None, alias="priceChange")
    price_change_pct: Optional[float] = Field(None, alias="priceChangePct")
    volume: Optional[int] = None
    value: Optional[float] = None
    avg_volume_20d: Optional[float] = Field(None, alias="avgVolume20d")
    volume_spike_pct: Optional[float] = Field(None, alias="volumeSpikePct")
    
    model_config = {"populate_by_name": True}


class SectorStockData(BaseModel):
    """Individual stock data for sector top movers."""
    symbol: str
    price: Optional[float] = None
    change: Optional[float] = None
    change_pct: Optional[float] = None
    volume: Optional[int] = None
    
    model_config = {"populate_by_name": True}


class SectorTopMoversData(BaseModel):
    """Sector with its top movers list."""
    sector: str
    sector_vi: Optional[str] = None
    stocks: List["SectorStockData"] = []
    
    model_config = {"populate_by_name": True}


class TopMoversQueryParams(BaseModel):
    """Query parameters for top movers."""
    type: Literal["gainer", "loser", "volume", "value"] = "gainer"
    index: Literal["VNINDEX", "HNX", "VN30"] = "VNINDEX"
    limit: int = Field(default=10, ge=1, le=50)


# =============================================================================
# INDEX TO GROUP MAPPING
# =============================================================================

INDEX_TO_GROUP = {
    "VNINDEX": "VN100",
    "VN30": "VN30",
    "HNX": "HNX30",
}


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def _safe_float(value, default: float = 0.0) -> float:
    """Safely convert value to float."""
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def _safe_int(value, default: int = 0) -> int:
    """Safely convert value to int."""
    if value is None:
        return default
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return default


def _flatten_multiindex_df(df):
    """Flatten MultiIndex columns to single level with underscore separator."""
    if df is None or df.empty:
        return df
    
    # Check if columns are MultiIndex
    if hasattr(df.columns, 'nlevels') and df.columns.nlevels > 1:
        df.columns = ['_'.join(str(c) for c in col).strip() for col in df.columns]
    
    return df


def _extract_from_flattened(row: dict, keys: List[str], default=None):
    """Extract value from flattened row trying multiple key patterns."""
    for key in keys:
        if key in row and row[key] is not None:
            return row[key]
    return default


def _parse_price_board_record(row: dict) -> Optional[dict]:
    """
    Parse a flattened price_board record into normalized format.
    
    vnstock price_board columns (after flattening):
    - listing_symbol: stock symbol
    - listing_ref_price: reference price (previous close)
    - match_match_price: current match price
    - match_accumulated_volume: total volume
    - match_accumulated_value: total value
    """
    # Extract symbol
    symbol = _extract_from_flattened(row, [
        'listing_symbol', 'symbol', 'ticker', 'code'
    ])
    if not symbol:
        return None
    
    symbol = str(symbol).upper().strip()
    
    # Extract prices
    match_price = _safe_float(_extract_from_flattened(row, [
        'match_match_price', 'match_price', 'price', 'last_price', 'close'
    ]))
    
    ref_price = _safe_float(_extract_from_flattened(row, [
        'listing_ref_price', 'match_reference_price', 'ref_price', 'reference', 'prev_close'
    ]))
    
    # Calculate price change
    price_change = 0.0
    price_change_pct = 0.0
    
    if match_price > 0 and ref_price > 0:
        price_change = match_price - ref_price
        price_change_pct = (price_change / ref_price) * 100
    
    # Extract volume and value
    volume = _safe_int(_extract_from_flattened(row, [
        'match_accumulated_volume', 'accumulated_volume', 'volume', 'total_volume'
    ]))
    
    value = _safe_float(_extract_from_flattened(row, [
        'match_accumulated_value', 'accumulated_value', 'value', 'total_value'
    ]))
    
    return {
        "symbol": symbol,
        "price": match_price,
        "change": round(price_change, 2),
        "change_pct": round(price_change_pct, 2),
        "volume": volume,
        "value": value,
    }


# =============================================================================
# FETCHER
# =============================================================================

class VnstockTopMoversFetcher:
    """
    Fetcher for market top movers.
    
    Uses Trading.price_board() to get real-time prices and calculates
    top gainers/losers/volume/value from the data.
    """
    
    @staticmethod
    async def fetch(
        type: Literal["gainer", "loser", "volume", "value"] = "gainer",
        index: Literal["VNINDEX", "HNX", "VN30"] = "VNINDEX",
        limit: int = 10,
    ) -> List[TopMoverData]:
        """
        Fetch top movers by type.
        
        Args:
            type: Type of top movers (gainer, loser, volume, value)
            index: Market index to filter by
            limit: Number of results to return
        
        Returns:
            List of TopMoverData records
        """
        try:
            def _fetch() -> List[dict]:
                from vnstock import Listing, Trading
                source = settings.vnstock_source
                listing = Listing(source=source)

                trading = Trading(source=source)

                
                # Get symbols for the index group
                group = INDEX_TO_GROUP.get(index, "VN100")
                symbols = []
                
                # Try to get symbols by group first
                try:
                    symbols_result = listing.symbols_by_group(group=group)
                    # symbols_by_group returns a Series directly, not a DataFrame
                    if symbols_result is not None and len(symbols_result) > 0:
                        symbols = symbols_result.tolist()
                        logger.info(f"Got {len(symbols)} symbols for group {group}")
                except Exception as e:
                    logger.warning(f"Failed to get symbols for group {group}: {e}")
                
                # Fallback: get all symbols and filter by exchange
                if not symbols:
                    logger.info(f"Falling back to all_symbols for {index}")
                    try:
                        all_df = listing.all_symbols()
                        if all_df is not None and not all_df.empty:
                            if "exchange" in all_df.columns:
                                if index == "HNX":
                                    all_df = all_df[all_df["exchange"] == "HNX"]
                                else:
                                    all_df = all_df[all_df["exchange"] == "HOSE"]
                            symbols = all_df["symbol"].head(100).tolist()
                            logger.info(f"Got {len(symbols)} symbols from fallback")
                    except Exception as e:
                        logger.error(f"Failed to get all_symbols: {e}")
                        return []
                
                if not symbols:
                    logger.warning("No symbols found for top movers")
                    return []
                
                # Fetch price board for all symbols
                try:
                    df = trading.price_board(symbols_list=symbols)
                    if df is None or df.empty:
                        logger.warning("Price board returned empty DataFrame")
                        return []
                    
                    # Flatten MultiIndex columns
                    df = _flatten_multiindex_df(df)
                    
                    records = df.to_dict(orient="records")
                    logger.info(f"Got {len(records)} records from price_board")
                    return records
                    
                except Exception as e:
                    logger.error(f"Price board fetch failed: {e}")
                    return []
            
            loop = asyncio.get_event_loop()
            # Add a 15 second timeout to the top movers fetch
            records = await asyncio.wait_for(
                loop.run_in_executor(_executor, _fetch),
                timeout=15.0
            )
            
            if not records:

                logger.warning(f"No records returned for top movers {type}/{index}")
                return []
            
            # Parse and normalize the data
            parsed_data = []
            for row in records:
                try:
                    parsed = _parse_price_board_record(row)
                    if parsed and parsed["symbol"]:
                        parsed_data.append(parsed)
                except Exception as e:
                    logger.debug(f"Skipping row due to parse error: {e}")
                    continue
            
            if not parsed_data:
                logger.warning("No valid data after parsing")
                return []
            
            logger.info(f"Parsed {len(parsed_data)} stocks for sorting")
            
            # Sort based on type
            if type == "gainer":
                # Filter to only positive changes, then sort descending
                filtered = [d for d in parsed_data if d.get("change_pct", 0) > 0]
                sorted_data = sorted(
                    filtered,
                    key=lambda x: x.get("change_pct") or 0,
                    reverse=True
                )
            elif type == "loser":
                # Filter to only negative changes, then sort ascending
                filtered = [d for d in parsed_data if d.get("change_pct", 0) < 0]
                sorted_data = sorted(
                    filtered,
                    key=lambda x: x.get("change_pct") or 0,
                    reverse=False
                )
            elif type == "volume":
                sorted_data = sorted(
                    parsed_data,
                    key=lambda x: x.get("volume") or 0,
                    reverse=True
                )
            elif type == "value":
                sorted_data = sorted(
                    parsed_data,
                    key=lambda x: x.get("value") or 0,
                    reverse=True
                )
            else:
                sorted_data = parsed_data
            
            # Take top N
            top_data = sorted_data[:limit]
            
            # Convert to TopMoverData
            results = []
            for item in top_data:
                results.append(TopMoverData(
                    symbol=item["symbol"],
                    index=index,
                    last_price=item.get("price") if item.get("price") else None,
                    price_change=item.get("change") if item.get("change") else None,
                    price_change_pct=item.get("change_pct") if item.get("change_pct") else None,
                    volume=item.get("volume") if item.get("volume") else None,
                    value=item.get("value") if item.get("value") else None,
                ))
            
            logger.info(f"Returning {len(results)} top movers for {type}/{index}")
            return results
            
        except Exception as e:
            logger.error(f"Top movers fetch failed for {type}/{index}: {e}", exc_info=True)
            return []

    @staticmethod
    async def fetch_sector_top_movers(
        type: Literal["gainers", "losers"] = "gainers",
        limit_per_sector: int = 5,
        source: str = settings.vnstock_source,
    ) -> List[SectorTopMoversData]:

        """
        Fetch top movers grouped by sector/industry.
        """
        try:
            def _fetch() -> Tuple[List[dict], dict]:
                from vnstock import Listing, Trading
                listing = Listing(source=source)
                trading = Trading(source=source)

                
                # Get all symbols with their industries using symbols_by_industries
                industry_map = {}
                try:
                    industry_df = listing.symbols_by_industries()
                    if industry_df is not None and not industry_df.empty:
                        for _, row in industry_df.iterrows():
                            symbol = row.get("symbol", "")
                            # Use icb_name3 (industry level 3) as primary, fallback to icb_name2
                            industry = (
                                row.get("icb_name3") or
                                row.get("icb_name2") or
                                row.get("icb_name4") or
                                "Unknown"
                            )
                            if symbol:
                                industry_map[symbol] = industry
                        logger.info(f"Got industry mapping for {len(industry_map)} symbols")
                except Exception as e:
                    logger.warning(f"Failed to get industry mapping: {e}")
                
                # Get VN100 symbols for broader coverage
                symbols = []
                try:
                    vn100_result = listing.symbols_by_group("VN100")
                    # symbols_by_group returns a Series directly
                    if vn100_result is not None and len(vn100_result) > 0:
                        symbols = vn100_result.tolist()
                        logger.info(f"Got {len(symbols)} VN100 symbols")
                except Exception as e:
                    logger.warning(f"Failed to get VN100 symbols: {e}")
                
                if not symbols:
                    # Fallback to all_symbols if VN100 fails
                    try:
                        all_df = listing.all_symbols()
                        if all_df is not None and not all_df.empty:
                            symbols = all_df["symbol"].head(100).tolist()
                            logger.info(f"Using {len(symbols)} symbols from all_symbols fallback")
                    except Exception as e:
                        logger.error(f"Failed to get all_symbols fallback: {e}")
                
                if not symbols:
                    return [], industry_map
                
                # Fetch price board
                try:
                    df = trading.price_board(symbols_list=symbols)
                    if df is None or df.empty:
                        logger.warning("Price board returned empty")
                        return [], industry_map
                    
                    df = _flatten_multiindex_df(df)
                    records = df.to_dict(orient="records")
                    logger.info(f"Got {len(records)} records for sector movers")
                except Exception as e:
                    logger.error(f"Price board fetch failed: {e}")
                    return [], industry_map
                
                return records, industry_map
            
            loop = asyncio.get_event_loop()
            # Add a 20 second timeout to the sector top movers fetch
            result_tuple = await asyncio.wait_for(
                loop.run_in_executor(_executor, _fetch),
                timeout=20.0
            )
            records, industry_map = result_tuple
            
            if not records:

                return []
            
            # Parse records and add industry
            parsed_data = []
            for row in records:
                try:
                    parsed = _parse_price_board_record(row)
                    if parsed and parsed["symbol"]:
                        parsed["industry"] = industry_map.get(parsed["symbol"], "Unknown")
                        parsed_data.append(parsed)
                except Exception:
                    continue
            
            # Group by sector
            sectors: dict[str, List[dict]] = {}
            for record in parsed_data:
                sector = record.get("industry", "Unknown")
                if sector not in sectors:
                    sectors[sector] = []
                sectors[sector].append(record)
            
            # Sort each sector and build results
            results = []
            for sector_name, stocks in sectors.items():
                reverse = type == "gainers"
                sorted_stocks = sorted(
                    stocks,
                    key=lambda x: x.get("change_pct") or 0,
                    reverse=reverse
                )[:limit_per_sector]
                
                stock_data = [
                    SectorStockData(
                        symbol=s["symbol"],
                        price=s.get("price") if s.get("price") else None,
                        change=s.get("change") if s.get("change") else None,
                        change_pct=s.get("change_pct") if s.get("change_pct") else None,
                        volume=s.get("volume") if s.get("volume") else None,
                    )
                    for s in sorted_stocks
                ]
                
                if stock_data:
                    results.append(SectorTopMoversData(
                        sector=sector_name,
                        sector_vi=sector_name,
                        stocks=stock_data,
                    ))
            
            # Sort sectors by their top stock's performance
            results.sort(
                key=lambda x: x.stocks[0].change_pct if x.stocks and x.stocks[0].change_pct else 0,
                reverse=(type == "gainers")
            )
            
            logger.info(f"Returning {len(results)} sectors for {type}")
            return results
            
        except Exception as e:
            logger.error(f"Sector top movers fetch failed: {e}", exc_info=True)
            return []
