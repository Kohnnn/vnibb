"""
VnStock Market Overview Fetcher

Fetches market indices and overview data for Vietnam stock market.
"""

import asyncio
import logging
from typing import Any, List, Optional

from pydantic import BaseModel, Field

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

from vnibb.providers.vnstock import get_vnstock
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# Shared thread pool for parallel fetching across requests
# This avoids the blocking behavior of 'with ThreadPoolExecutor' on timeout
_executor = ThreadPoolExecutor(max_workers=10)


class MarketOverviewQueryParams(BaseModel):
    """Query parameters for market overview."""
    pass


class MarketIndexData(BaseModel):
    """Standardized market index data."""
    
    index_name: str
    current_value: Optional[float] = None
    change: Optional[float] = None
    change_pct: Optional[float] = None
    volume: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    time: Optional[Any] = None  # Could be datetime or string
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "index_name": "VN-INDEX",
                "current_value": 1250.5,
                "change": 12.3,
                "change_pct": 0.99,
            }
        }
    }


class VnstockMarketOverviewFetcher(BaseFetcher[MarketOverviewQueryParams, MarketIndexData]):
    """Fetcher for market overview via vnstock."""
    
    provider_name = "vnstock"
    requires_credentials = False
    
    @staticmethod
    def transform_query(params: MarketOverviewQueryParams) -> dict[str, Any]:
        return {}
    
    @staticmethod
    async def extract_data(
        query: dict[str, Any],
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:
        loop = asyncio.get_running_loop()
        
        def _fetch_single_index(idx: str) -> Optional[dict[str, Any]]:
            """Fetch a single market index with timeout handling."""
            try:
                stock_manager = get_vnstock()
                # stock_manager.stock is the way to get a specific stock instance in vnstock 3.x
                stock = stock_manager.stock(symbol=idx, source=settings.vnstock_source)
                # Fetch last 5 days to ensure we get some data
                from datetime import datetime, timedelta
                end_date = datetime.now()
                start_date = end_date - timedelta(days=5)
                
                df = stock.quote.history(
                    start=start_date.strftime("%Y-%m-%d"),
                    end=end_date.strftime("%Y-%m-%d"),
                    show_log=False
                )
                if df is not None and not df.empty:
                    latest = df.iloc[-1].to_dict()
                    latest["index_name"] = idx
                    return latest
            except Exception as e:
                logger.warning(f"Failed to fetch {idx}: {e}")
            return None
        
        async def _fetch_index_async(pool, idx: str, timeout: int = 8) -> Optional[dict[str, Any]]:
            """Fetch a single index with timeout."""
            try:
                return await asyncio.wait_for(
                    loop.run_in_executor(pool, _fetch_single_index, idx),
                    timeout=timeout
                )
            except asyncio.TimeoutError:
                logger.warning(f"Timeout fetching {idx} after {timeout}s")
                return None
            except Exception as e:
                logger.warning(f"Error fetching {idx}: {e}")
                return None
        
        try:
            indices = []
            
            # Fetch indices in parallel with per-index timeout of 8 seconds
            tasks = [
                _fetch_index_async(_executor, idx, timeout=8)
                for idx in ["VNINDEX", "VN30", "HNX", "UPCOM", "VN-INDEX", "HNX-INDEX"]
            ]
            
            # Total timeout of 15 seconds for all parallel requests
            results = await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                timeout=15
            )
            
            for result in results:
                if isinstance(result, dict):
                    indices.append(result)
                
            return indices
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(provider="vnstock", timeout=15)
        except Exception as e:
            logger.error(f"vnstock market overview fetch error: {e}")
            raise ProviderError(message=str(e), provider="vnstock", details={})

    
    @staticmethod
    def transform_data(
        params: MarketOverviewQueryParams,
        data: List[dict[str, Any]],
    ) -> List[MarketIndexData]:
        results = []
        for row in data:
            try:
                # Handle different column names from different sources (VCI, TCBS, KBS)
                # VCI: close, change, pctChange
                # TCBS: price, change, percent_change
                # KBS: close, change, pct_change
                current_value = row.get("current_value") or row.get("close") or row.get("price") or row.get("index_value")
                change = row.get("change") or row.get("index_change")
                change_pct = row.get("change_pct") or row.get("pctChange") or row.get("percent_change") or row.get("pct_change")
                volume = row.get("volume") or row.get("total_volume")
                high = row.get("high") or row.get("highest")
                low = row.get("low") or row.get("lowest")
                time_val = row.get("time") or row.get("trading_date") or row.get("date")

                results.append(MarketIndexData(
                    index_name=row.get("index_name") or row.get("symbol") or "Unknown",
                    current_value=float(current_value) if current_value is not None else None,
                    change=float(change) if change is not None else None,
                    change_pct=float(change_pct) if change_pct is not None else None,
                    volume=float(volume) if volume is not None else None,
                    high=float(high) if high is not None else None,
                    low=float(low) if low is not None else None,
                    time=time_val,
                ))
            except Exception as e:
                logger.warning(f"Skipping invalid market index row: {e}")
        return results

