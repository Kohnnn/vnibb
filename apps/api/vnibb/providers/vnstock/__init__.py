import logging
import threading
import concurrent.futures
from vnibb.core.config import settings

logger = logging.getLogger(__name__)

_vnstock_instance = None
_vnstock_lock = threading.Lock()
_init_timeout = 10  # seconds

def get_vnstock():
    """Lazy initialization with timeout to avoid deadlock."""
    global _vnstock_instance
    if _vnstock_instance is None:
        with _vnstock_lock:
            if _vnstock_instance is None:
                def _init():
                    from vnstock import Vnstock
                    # Use Golden Sponsor API key from settings if available
                    api_key = getattr(settings, 'vnstock_api_key', None)
                    if api_key:
                        logger.info("Initializing vnstock with Golden Sponsor API key")
                        return Vnstock(api_key=api_key)
                    else:
                        logger.warning("No vnstock API key found, using default rate limits")
                        return Vnstock()
                
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(_init)
                    try:
                        _vnstock_instance = future.result(timeout=_init_timeout)
                    except concurrent.futures.TimeoutError:
                        logger.error("vnstock initialization timed out - check vnai auth")
                        raise RuntimeError("vnstock initialization timed out - check vnai auth")
    return _vnstock_instance


