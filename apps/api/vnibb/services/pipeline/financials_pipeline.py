"""
Financials Pipeline

Legacy financial synchronization entrypoints.
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from vnibb.core.database import async_session_maker
from vnibb.models.stock import Stock
from vnibb.services.pipeline.base import BasePipeline

logger = logging.getLogger(__name__)


class FinancialsPipeline(BasePipeline):
    """Legacy financial synchronization entrypoints."""

    async def sync_financials(
        self,
        symbols: Optional[List[str]] = None,
        period: str = "quarter",
        limit: Optional[int] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Refuse legacy statement synchronization without provenance admission."""
        raise RuntimeError(
            "legacy financial statement sync is unavailable: it cannot preserve source, "
            "unit, and basis evidence; use the admitted DataPipeline.sync_financials path"
        )

    async def sync_financial_ratios(
        self,
        symbols: Optional[List[str]] = None,
        limit: Optional[int] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync financial ratios."""
        from vnibb.providers.vnstock.financial_ratios import (
            FinancialRatiosQueryParams,
            VnstockFinancialRatiosFetcher,
        )

        logger.info("Syncing financial ratios...")

        if not symbols:
            async with self._get_session() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        if limit:
            symbols = symbols[:limit]

        total_synced = 0

        for idx, symbol in enumerate(symbols):
            try:
                await self._wait_for_rate_limit("financials")

                params = FinancialRatiosQueryParams(symbol=symbol)

                def _fetch_sync():
                    fetcher = VnstockFinancialRatiosFetcher()
                    return asyncio.run(fetcher.fetch(params))

                data = await asyncio.wait_for(
                    asyncio.to_thread(_fetch_sync),
                    timeout=30,
                )

                if data:
                    # Store ratios - simplified implementation
                    logger.debug(f"Synced ratios for {symbol}")
                    total_synced += 1

                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1

            except Exception as e:
                logger.debug(f"Failed to sync ratios for {symbol}: {e}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1

        logger.info(f"Synced ratios for {total_synced} symbols")
        return total_synced

    async def _get_session(self):
        """Get a database session."""
        return self._session_factory() if hasattr(self, '_session_factory') else async_session_maker()
