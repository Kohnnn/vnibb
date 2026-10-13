import logging
import threading
import concurrent.futures
from vnibb.providers.vnstock.runtime import get_vnstock_class, validate_source

logger = logging.getLogger(__name__)

_vnstock_instance = None
_vnstock_lock = threading.Lock()
_init_timeout = 10  # seconds

def get_vnstock():
    """Initialize the community vnstock client lazily with a timeout."""
    global _vnstock_instance
    if _vnstock_instance is None:
        with _vnstock_lock:
            if _vnstock_instance is None:
                def _init():
                    Vnstock = get_vnstock_class()
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
        source: Free VCI data source. Defaults to VCI.
    
    Returns:
        Stock object for data retrieval
    """
    source = validate_source(source)
    vn = get_vnstock()
    return vn.stock(symbol=symbol, source=source)
