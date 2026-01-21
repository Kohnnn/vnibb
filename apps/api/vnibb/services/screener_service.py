"""
Screener Service - Dedicated service for screener data synchronization.

Extracts logic from DataPipeline to avoid circular dependency issues.
"""

import logging
from datetime import date
from typing import List, Optional

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy import select

from vnibb.core.database import async_session_maker
from vnibb.core.config import settings
from vnibb.models.screener import ScreenerSnapshot
from vnibb.providers.vnstock.equity_screener import VnstockScreenerFetcher, StockScreenerParams

logger = logging.getLogger(__name__)


class ScreenerService:
    """
    Dedicated service for syncing screener data.
    """
    
    async def sync_screener_data(
        self,
        exchanges: List[str] = None,
        limit: int = 1700,
    ) -> int:
        """
        Sync stock screener data using robust VCI source logic.
        
        Returns: Number of screener records synced
        """
        logger.info(f"Starting screener data sync ({settings.vnstock_source}) via ScreenerService...")
        
        try:
            if exchanges is None:
                exchanges = ['HOSE', 'HNX', 'UPCOM']
            
            total_count = 0
            # We process exchanges one by one or collectively depends on fetcher
            # Here we loop to ensure we get data from all requested exchanges
            for exchange in exchanges:
                params = StockScreenerParams(
                    exchange=exchange,
                    limit=limit,
                    source=settings.vnstock_source
                )
                
                # Fetch data using the robust sym-by-sym logic in VnstockScreenerFetcher
                data = await VnstockScreenerFetcher.fetch(params)
                
                if not data:
                    logger.warning(f"No screener data found for exchange: {exchange}")
                    continue
                
                
                async with async_session_maker() as session:
                    count = 0
                    for item in data:
                        # Use upsert logic
                        # We map all available fields from the fetcher's model to our DB model.
                        # Note: We need to ensure we map fields correctly.
                        
                        values = {
                            "symbol": item.symbol,
                            "snapshot_date": date.today(),
                            "market_cap": item.market_cap,
                            "pe": item.pe,
                            "pb": item.pb,
                            "roe": item.roe,
                            "exchange": item.exchange or exchange,
                            "industry": item.industry_name,
                            # Map other fields if available in item (ScreenerData)
                            # For now, sticking to the DataPipeline logic + verified fields
                        }
                        
                        # Add optional fields if they exist in the source item
                        if hasattr(item, 'price'): values['price'] = item.price
                        if hasattr(item, 'volume'): values['volume'] = item.volume
                        if hasattr(item, 'roa'): values['roa'] = item.roa
                        # if hasattr(item, 'eps'): values['eps'] = item.eps
                        
                        stmt = pg_insert(ScreenerSnapshot).values(
                            **values
                        ).on_conflict_do_update(
                            constraint='uq_screener_snapshot_symbol_date',
                            set_={k: v for k, v in values.items() if k not in ['symbol', 'snapshot_date']}
                        )
                        
                        await session.execute(stmt)
                        count += 1
                    
                    await session.commit()
                    total_count += count
                    logger.info(f"Synced {count} screener records for {exchange}")
            
            logger.info(f"Total synced {total_count} screener records")
            return total_count
            
        except Exception as e:
            logger.error(f"Screener sync failed: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return 0

# Global instance
screener_service = ScreenerService()
