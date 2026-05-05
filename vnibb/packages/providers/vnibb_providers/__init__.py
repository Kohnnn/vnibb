"""
VNIBB Providers - Unified Data Interface
"""

__version__ = "0.1.0"

class VnstockProvider:
    """Wrapper for vnstock data provider."""
    def __init__(self, api_key: str = None):
        self.api_key = api_key
