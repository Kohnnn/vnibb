import logging
import os
import threading
import concurrent.futures
from vnibb.core.config import settings

logger = logging.getLogger(__name__)

_vnstock_instance = None
_vnstock_lock = threading.Lock()
_init_timeout = 10  # seconds

def get_vnstock():
    """
    Lazy initialization with timeout to avoid deadlock.
    
    Golden Sponsor Configuration:
    - VNSTOCK_API_KEY env var provides 10x rate limit
    - Source: KBS (default in vnstock 3.4+)
    - Rate limit: 600 req/min with Golden Sponsor (vs 60 req/min default)
    """
    global _vnstock_instance
    if _vnstock_instance is None:
        with _vnstock_lock:
            if _vnstock_instance is None:
                def _init():
                    # Ensure VNSTOCK_API_KEY is in environment before importing vnstock
                    # vnstock reads this automatically on import
                    api_key = getattr(settings, 'vnstock_api_key', None)
                    if api_key:
                        os.environ['VNSTOCK_API_KEY'] = api_key
                        logger.info(f"Golden Sponsor API key configured (10x rate limits)")
                        logger.info(f"Using source: {settings.vnstock_source} (KBS recommended)")
                    else:
                        logger.warning("No vnstock API key found - using default rate limits (60 req/min)")
                    
                    from vnstock import Vnstock
                    return Vnstock()
                
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(_init)
                    try:
                        _vnstock_instance = future.result(timeout=_init_timeout)
                        logger.info("vnstock instance initialized successfully")
                    except concurrent.futures.TimeoutError:
                        logger.error("vnstock initialization timed out - check vnai auth")
                        raise RuntimeError("vnstock initialization timed out - check vnai auth")
    return _vnstock_instance


def get_stock(symbol: str, source: str = None):
    """
    Get a stock object for the given symbol with configured source.
    
    Args:
        symbol: Stock ticker symbol (e.g., 'VNM', 'FPT')
        source: Data source (KBS, VCI, TCBS, DNSE). Defaults to settings.vnstock_source
    
    Returns:
        Stock object for data retrieval
    """
    if source is None:
        source = settings.vnstock_source
    
    vn = get_vnstock()
    return vn.stock(symbol=symbol, source=source)
