"""
Bulk Operations for Screener Data.

Provides efficient batch insert/update operations:
- Bulk upsert (INSERT ON CONFLICT UPDATE)
- Batch size optimization (500 records)
- Transaction management
- Progress reporting
"""

import logging
from typing import List, Dict, Any, Optional
from datetime import date, datetime

from sqlalchemy import insert
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from vnibb.models.screener import ScreenerSnapshot

logger = logging.getLogger(__name__)


class BulkScreenerOperations:
    """
    Efficient bulk operations for screener data.
    
    Uses PostgreSQL INSERT ON CONFLICT for upsert operations.
    Optimized for handling 1600+ stocks with batch processing.
    """
    
    DEFAULT_BATCH_SIZE = 500
    
    @staticmethod
    async def bulk_upsert_screener_data(
        session: AsyncSession,
        records: List[Dict[str, Any]],
        batch_size: int = DEFAULT_BATCH_SIZE,
        snapshot_date: Optional[date] = None,
    ) -> Dict[str, int]:
        """
        Bulk upsert screener data with conflict resolution.
        
        Args:
            session: Async database session
            records: List of screener data dictionaries
            batch_size: Number of records per batch
            snapshot_date: Date for the snapshot (defaults to today)
        
        Returns:
            Dictionary with statistics: {
                "total": 1600,
                "inserted": 100,
                "updated": 1500,
                "errors": 0
            }
        """
        if not records:
            logger.warning("bulk_upsert_screener_data called with empty records")
            return {"total": 0, "inserted": 0, "updated": 0, "errors": 0}
        
        snapshot_date = snapshot_date or date.today()
        stats = {"total": len(records), "inserted": 0, "updated": 0, "errors": 0}
        
        try:
            # Process in batches
            for i in range(0, len(records), batch_size):
                batch = records[i:i + batch_size]
                batch_num = (i // batch_size) + 1
                total_batches = (len(records) + batch_size - 1) // batch_size
                
                logger.info(
                    f"Processing batch {batch_num}/{total_batches} "
                    f"({len(batch)} records)"
                )
                
                # Prepare batch data
                batch_data = []
                for record in batch:
                    # Ensure snapshot_date is set
                    record["snapshot_date"] = snapshot_date
                    
                    # Set created_at if not present
                    if "created_at" not in record:
                        record["created_at"] = datetime.utcnow()
                    
                    batch_data.append(record)
                
                try:
                    # PostgreSQL INSERT ON CONFLICT
                    stmt = pg_insert(ScreenerSnapshot).values(batch_data)
                    
                    # On conflict (symbol, snapshot_date), update all fields
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["symbol", "snapshot_date"],
                        set_={
                            column.name: stmt.excluded[column.name]
                            for column in ScreenerSnapshot.__table__.columns
                            if column.name not in ("id", "symbol", "snapshot_date")
                        }
                    )
                    
                    result = await session.execute(stmt)
                    await session.commit()
                    
                    # PostgreSQL doesn't directly tell us inserted vs updated
                    # but we can estimate from row count
                    rows_affected = result.rowcount
                    stats["inserted"] += min(rows_affected, len(batch))
                    
                    logger.info(
                        f"Batch {batch_num} completed: {rows_affected} rows affected"
                    )
                    
                except IntegrityError as e:
                    logger.error(f"Integrity error in batch {batch_num}: {e}")
                    await session.rollback()
                    stats["errors"] += len(batch)
                    
                except Exception as e:
                    logger.error(f"Error processing batch {batch_num}: {e}")
                    await session.rollback()
                    stats["errors"] += len(batch)
            
            logger.info(
                f"Bulk upsert completed: {stats['total']} total, "
                f"{stats['inserted']} inserted/updated, {stats['errors']} errors"
            )
            
            return stats
            
        except Exception as e:
            logger.error(f"Fatal error in bulk_upsert_screener_data: {e}")
            await session.rollback()
            raise
    
    @staticmethod
    async def bulk_insert_screener_data(
        session: AsyncSession,
        records: List[Dict[str, Any]],
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> int:
        """
        Bulk insert screener data (fails on duplicate).
        
        Faster than upsert but will fail if records already exist.
        Use for initial data load or when you're sure there are no conflicts.
        
        Args:
            session: Async database session
            records: List of screener data dictionaries
            batch_size: Number of records per batch
        
        Returns:
            Number of records inserted
        """
        if not records:
            return 0
        
        total_inserted = 0
        
        try:
            # Process in batches
            for i in range(0, len(records), batch_size):
                batch = records[i:i + batch_size]
                
                stmt = insert(ScreenerSnapshot).values(batch)
                result = await session.execute(stmt)
                total_inserted += result.rowcount
            
            await session.commit()
            logger.info(f"Bulk insert completed: {total_inserted} records inserted")
            
            return total_inserted
            
        except Exception as e:
            logger.error(f"Error in bulk_insert_screener_data: {e}")
            await session.rollback()
            raise
    
    @staticmethod
    async def delete_old_snapshots(
        session: AsyncSession,
        days_to_keep: int = 365,
    ) -> int:
        """
        Delete screener snapshots older than specified days.
        
        Args:
            session: Async database session
            days_to_keep: Number of days of history to retain
        
        Returns:
            Number of records deleted
        """
        from sqlalchemy import delete
        from datetime import timedelta
        
        cutoff_date = date.today() - timedelta(days=days_to_keep)
        
        try:
            stmt = delete(ScreenerSnapshot).where(
                ScreenerSnapshot.snapshot_date < cutoff_date
            )
            result = await session.execute(stmt)
            await session.commit()
            
            deleted = result.rowcount
            logger.info(
                f"Deleted {deleted} screener snapshots older than {cutoff_date}"
            )
            
            return deleted
            
        except Exception as e:
            logger.error(f"Error in delete_old_snapshots: {e}")
            await session.rollback()
            raise
    
    @staticmethod
    async def get_snapshot_stats(
        session: AsyncSession,
        snapshot_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        """
        Get statistics about a screener snapshot.
        
        Args:
            session: Async database session
            snapshot_date: Date to check (defaults to today)
        
        Returns:
            Statistics dictionary with counts and metrics
        """
        from sqlalchemy import select, func
        
        snapshot_date = snapshot_date or date.today()
        
        try:
            # Total count
            stmt = select(func.count()).select_from(ScreenerSnapshot).where(
                ScreenerSnapshot.snapshot_date == snapshot_date
            )
            result = await session.execute(stmt)
            total_count = result.scalar() or 0
            
            # Count by exchange
            stmt = select(
                ScreenerSnapshot.exchange,
                func.count()
            ).where(
                ScreenerSnapshot.snapshot_date == snapshot_date
            ).group_by(ScreenerSnapshot.exchange)
            
            result = await session.execute(stmt)
            exchange_counts = dict(result.all())
            
            return {
                "snapshot_date": snapshot_date,
                "total_stocks": total_count,
                "by_exchange": exchange_counts,
            }
            
        except Exception as e:
            logger.error(f"Error in get_snapshot_stats: {e}")
            raise


# Convenience functions

async def upsert_screener_batch(
    session: AsyncSession,
    records: List[Dict[str, Any]],
    snapshot_date: Optional[date] = None,
) -> Dict[str, int]:
    """
    Convenience function for upserting screener data.
    
    Args:
        session: Async database session
        records: List of screener data dictionaries
        snapshot_date: Date for the snapshot
    
    Returns:
        Statistics dictionary
    """
    return await BulkScreenerOperations.bulk_upsert_screener_data(
        session=session,
        records=records,
        snapshot_date=snapshot_date,
    )
