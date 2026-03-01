import logging
from typing import List, Dict, Any, Optional
from vnibb.services.cache_manager import CacheManager
from vnibb.core.config import settings

logger = logging.getLogger(__name__)


async def get_stock_prices(symbols: List[str]) -> List[Dict[str, Any]]:
    """
    Get current prices and performance for a list of symbols.
    Uses database cache (ScreenerSnapshot) for bulk retrieval.
    """
    cache_manager = CacheManager()
    results = []

    # Try to get from screener cache first
    try:
        # get_screener_data returns List[ScreenerSnapshot]
        cache_results = await cache_manager.get_screener_data(allow_stale=True)
        all_data = {s.symbol: s for s in cache_results.data} if cache_results.data else {}

        for symbol in symbols:
            symbol = symbol.upper()
            if symbol in all_data:
                item = all_data[symbol]
                results.append(
                    {
                        "symbol": symbol,
                        "price": item.price or 0,
                        "change_percent": (
                            getattr(item, "change_1d", None)
                            or (item.extended_metrics or {}).get("change_1d")
                            or (item.extended_metrics or {}).get("price_change_1d_pct")
                            or 0
                        ),
                        "volume": item.volume or 0,
                    }
                )
            else:
                # Fallback to single fetch if not in bulk cache
                # For simplicity in this sprint, we'll just skip or return empty
                pass
    except Exception as e:
        logger.error(f"Failed to get stock prices for comparison: {e}")

    return results
