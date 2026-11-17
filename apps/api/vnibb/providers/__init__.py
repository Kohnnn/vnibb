"""
Provider framework - OpenBB-style Fetcher pattern for data sources.
"""

from importlib import import_module

__all__ = ["BaseFetcher", "QueryT", "DataT"]


def __getattr__(name: str):
    if name not in __all__:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    value = getattr(import_module("vnibb.providers.base"), name)
    globals()[name] = value
    return value


def __dir__():
    return sorted(set(globals()) | set(__all__))
