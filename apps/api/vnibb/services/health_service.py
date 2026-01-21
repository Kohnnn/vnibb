"""
Health Check Service

Provides comprehensive database and system health information:
- Stock count and sync status
- Missing data warnings
- Component health checks
"""

import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import async_session_maker
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.sync_status import SyncStatus

logger = logging.getLogger(__name__)


class HealthService:
    """Service for database health checks and status reporting."""
    
    async def get_database_health(self) -> Dict[str, Any]:
        """
        Get comprehensive database health status.
        
        Returns:
            Dict with status, counts, warnings, and recommendations
        """
        async with async_session_maker() as session:
            # Stock counts
            stock_count = await self._get_stock_count(session)
            active_stock_count = await self._get_active_stock_count(session)
            
            # Price data status
            price_stats = await self._get_price_stats(session)
            
            # Screener data status
            screener_stats = await self._get_screener_stats(session)
            
            # Last sync info
            last_sync = await self._get_last_sync(session)
            
            # Generate warnings
            warnings = self._generate_warnings(
                stock_count, price_stats, screener_stats, last_sync
            )
            
            # Determine overall status
            if stock_count == 0:
                status = "needs_seed"
            elif warnings:
                status = "degraded"
            else:
                status = "healthy"
            
            return {
                "status": status,
                "timestamp": datetime.utcnow().isoformat(),
                "database": {
                    "stock_count": stock_count,
                    "active_stocks": active_stock_count,
                    "price_records": price_stats.get("total", 0),
                    "latest_price_date": price_stats.get("latest_date"),
                    "screener_records": screener_stats.get("total", 0),
                    "latest_screener_date": screener_stats.get("latest_date"),
                },
                "sync": {
                    "last_sync_at": last_sync.get("completed_at") if last_sync else None,
                    "last_sync_type": last_sync.get("sync_type") if last_sync else None,
                    "last_sync_status": last_sync.get("status") if last_sync else None,
                    "last_sync_count": last_sync.get("success_count") if last_sync else None,
                },
                "warnings": warnings,
                "recommendations": self._generate_recommendations(status, warnings),
            }
    
    async def _get_stock_count(self, session: AsyncSession) -> int:
        """Get total stock count."""
        result = await session.execute(select(func.count(Stock.id)))
        return result.scalar() or 0
    
    async def _get_active_stock_count(self, session: AsyncSession) -> int:
        """Get active stock count."""
        result = await session.execute(
            select(func.count(Stock.id)).where(Stock.is_active == 1)
        )
        return result.scalar() or 0
    
    async def _get_price_stats(self, session: AsyncSession) -> Dict[str, Any]:
        """Get price data statistics."""
        try:
            # Total count
            count_result = await session.execute(select(func.count(StockPrice.id)))
            total = count_result.scalar() or 0
            
            # Latest date
            date_result = await session.execute(
                select(func.max(StockPrice.time))
            )
            latest_date = date_result.scalar()
            
            return {
                "total": total,
                "latest_date": latest_date.isoformat() if latest_date else None,
            }
        except Exception as e:
            logger.warning(f"Failed to get price stats: {e}")
            return {"total": 0, "latest_date": None}
    
    async def _get_screener_stats(self, session: AsyncSession) -> Dict[str, Any]:
        """Get screener data statistics."""
        try:
            # Total count
            count_result = await session.execute(
                select(func.count(ScreenerSnapshot.id))
            )
            total = count_result.scalar() or 0
            
            # Latest date
            date_result = await session.execute(
                select(func.max(ScreenerSnapshot.snapshot_date))
            )
            latest_date = date_result.scalar()
            
            return {
                "total": total,
                "latest_date": latest_date.isoformat() if latest_date else None,
            }
        except Exception as e:
            logger.warning(f"Failed to get screener stats: {e}")
            return {"total": 0, "latest_date": None}
    
    async def _get_last_sync(self, session: AsyncSession) -> Optional[Dict[str, Any]]:
        """Get last successful sync info."""
        try:
            result = await session.execute(
                select(SyncStatus)
                .where(SyncStatus.status.in_(["completed", "partial"]))
                .order_by(desc(SyncStatus.completed_at))
                .limit(1)
            )
            sync = result.scalar_one_or_none()
            
            if sync:
                return {
                    "sync_type": sync.sync_type,
                    "status": sync.status,
                    "completed_at": sync.completed_at.isoformat() if sync.completed_at else None,
                    "success_count": sync.success_count,
                    "error_count": sync.error_count,
                }
            return None
        except Exception as e:
            logger.warning(f"Failed to get last sync: {e}")
            return None
    
    def _generate_warnings(
        self,
        stock_count: int,
        price_stats: Dict[str, Any],
        screener_stats: Dict[str, Any],
        last_sync: Optional[Dict[str, Any]],
    ) -> List[str]:
        """Generate warning messages based on data status."""
        warnings = []
        
        if stock_count == 0:
            warnings.append("Database is empty. Run seed command to populate.")
        elif stock_count < 100:
            warnings.append(f"Only {stock_count} stocks in database. Expected 1500+.")
        
        if price_stats.get("total", 0) == 0:
            warnings.append("No price data available.")
        elif price_stats.get("latest_date"):
            from datetime import date
            latest = date.fromisoformat(price_stats["latest_date"])
            days_old = (date.today() - latest).days
            if days_old > 3:
                warnings.append(f"Price data is {days_old} days old.")
        
        if screener_stats.get("total", 0) == 0:
            warnings.append("No screener data available.")
        
        if last_sync:
            if last_sync.get("status") == "partial":
                warnings.append("Last sync completed with errors.")
            if last_sync.get("completed_at"):
                from datetime import datetime
                completed = datetime.fromisoformat(last_sync["completed_at"])
                hours_ago = (datetime.utcnow() - completed).total_seconds() / 3600
                if hours_ago > 24:
                    warnings.append(f"Last sync was {int(hours_ago)} hours ago.")
        else:
            warnings.append("No sync history found.")
        
        return warnings
    
    def _generate_recommendations(
        self,
        status: str,
        warnings: List[str],
    ) -> List[str]:
        """Generate actionable recommendations."""
        recommendations = []
        
        if status == "needs_seed":
            recommendations.append("Run: python -m vnibb.cli.seed")
            recommendations.append("Or call POST /api/v1/data/seed/stocks")
        
        if any("price data" in w.lower() for w in warnings):
            recommendations.append("Run: POST /api/v1/data/sync/prices")
        
        if any("screener" in w.lower() for w in warnings):
            recommendations.append("Run: POST /api/v1/data/sync/full-market")
        
        if any("sync" in w.lower() and "hours" in w.lower() for w in warnings):
            recommendations.append("Consider running a full sync: POST /api/v1/data/sync/all")
        
        return recommendations
    
    async def get_sync_history(
        self,
        limit: int = 10,
        sync_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Get recent sync history."""
        async with async_session_maker() as session:
            query = select(SyncStatus).order_by(desc(SyncStatus.started_at)).limit(limit)
            
            if sync_type:
                query = query.where(SyncStatus.sync_type == sync_type)
            
            result = await session.execute(query)
            syncs = result.scalars().all()
            
            return [
                {
                    "id": s.id,
                    "sync_type": s.sync_type,
                    "status": s.status,
                    "started_at": s.started_at.isoformat() if s.started_at else None,
                    "completed_at": s.completed_at.isoformat() if s.completed_at else None,
                    "duration_seconds": s.duration_seconds,
                    "success_count": s.success_count,
                    "error_count": s.error_count,
                }
                for s in syncs
            ]


# Global instance placeholder
_health_service: Optional[HealthService] = None

def get_health_service() -> HealthService:
    """Lazy-load the health service."""
    global _health_service
    if _health_service is None:
        _health_service = HealthService()
    return _health_service

