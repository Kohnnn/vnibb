"""VNStock startup and diagnostic lifecycle, without provider requests."""

import logging

from vnibb.providers.vnstock import runtime

logger = logging.getLogger(__name__)


def validate_startup_policy() -> None:
    runtime.validate_runtime_policy()


def validate_acquisition_runtime() -> None:
    runtime.validate_runtime()


def warmup() -> None:
    try:
        for name in ("Company", "Finance", "Listing"):
            runtime.import_vnstock_symbol(name)
        logger.info("vnstock modules pre-loaded successfully.")
    except Exception:
        logger.warning("vnstock pre-initialization failed")


def diagnostic_version() -> str:
    return runtime.import_vnstock_symbol("__version__")[0]


def diagnostic_facade(name: str) -> None:
    runtime.import_vnstock_symbol(name)
