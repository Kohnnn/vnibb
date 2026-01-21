"""
Insider Trading & Block Trade Tracking Service

Handles:
- Syncing insider deals from vnstock
- Detecting large block trades
- Generating alerts for insider activity
- Managing alert thresholds and user preferences
"""

import logging
from datetime import datetime, timedelta, date
from typing import List, Optional, Dict, Any
from sqlalchemy import select, and_, desc, func
from sqlalchemy.ext.asyncio import AsyncSession


from vnibb.core.config import settings
from vnibb.models.news import InsiderDeal

from vnibb.models.trading import IntradayTrade
from vnibb.models.alerts import (
    BlockTrade, InsiderAlert, AlertSettings,
    AlertType, AlertSeverity, TradeSide
)
from vnibb.core.database import get_db
from vnibb.services.websocket_service import manager

logger = logging.getLogger(__name__)


class InsiderTrackingService:
    """Service for tracking insider trading and block trades"""
    
    def __init__(self, db: AsyncSession):
        self.db = db
        self._vnstock = None
    
    @property
    def vnstock(self):
        if self._vnstock is None:
            from vnstock import Vnstock
            self._vnstock = Vnstock()
        return self._vnstock

    
    async def sync_insider_deals(self, symbols: List[str]) -> Dict[str, int]:
        """
        Sync insider deals for given symbols from vnstock.
        
        Args:
            symbols: List of stock symbols to sync
            
        Returns:
            Dict with sync statistics
        """
        stats = {"total": 0, "new": 0, "errors": 0}
        
        for symbol in symbols:
            try:
                # Fetch insider deals from vnstock
                stock = self.vnstock.stock(symbol=symbol, source=settings.vnstock_source)

                deals_df = stock.finance.insider_deals()
                
                if deals_df is None or deals_df.empty:
                    logger.debug(f"No insider deals for {symbol}")
                    continue
                
                # Process each deal
                for _, row in deals_df.iterrows():
                    stats["total"] += 1
                    
                    # Check if deal already exists
                    existing = await self.db.execute(
                        select(InsiderDeal).where(
                            and_(
                                InsiderDeal.symbol == symbol,
                                InsiderDeal.announce_date == row.get("announce_date"),
                                InsiderDeal.insider_name == row.get("insider_name")
                            )
                        )
                    )
                    
                    if existing.scalar_one_or_none():
                        continue
                    
                    # Create new insider deal
                    deal = InsiderDeal(
                        symbol=symbol,
                        announce_date=row.get("announce_date"),
                        deal_method=row.get("deal_method"),
                        deal_action=row.get("deal_action"),
                        deal_quantity=row.get("deal_quantity"),
                        deal_price=row.get("deal_price"),
                        deal_value=row.get("deal_value"),
                        deal_ratio=row.get("deal_ratio"),
                        insider_name=row.get("insider_name"),
                        insider_position=row.get("insider_position"),
                        raw_data=row.to_dict()
                    )
                    
                    self.db.add(deal)
                    stats["new"] += 1
                    
                    # Generate alert for new deal
                    await self._generate_insider_alert(deal)
                
                await self.db.commit()
                logger.info(f"Synced {stats['new']} new insider deals for {symbol}")
                
            except Exception as e:
                logger.error(f"Error syncing insider deals for {symbol}: {e}")
                stats["errors"] += 1
                await self.db.rollback()
        
        return stats
    
    async def detect_block_trades(
        self, 
        symbol: str, 
        threshold: Optional[float] = None
    ) -> List[BlockTrade]:
        """
        Detect block trades exceeding threshold.
        
        Args:
            symbol: Stock symbol to analyze
            threshold: Value threshold in VND (default: 10 billion)
            
        Returns:
            List of detected block trades
        """
        if threshold is None:
            threshold = 10_000_000_000  # VND 10 billion
        
        # Get recent intraday trades
        today = datetime.now().date()
        result = await self.db.execute(
            select(IntradayTrade)
            .where(
                and_(
                    IntradayTrade.symbol == symbol,
                    func.date(IntradayTrade.trade_time) == today
                )
            )
            .order_by(desc(IntradayTrade.trade_time))
        )
        
        trades = result.scalars().all()
        block_trades = []
        
        # Calculate average volume for comparison
        avg_volume = await self._get_average_volume(symbol, days=20)
        
        for trade in trades:
            trade_value = trade.price * trade.volume
            
            if trade_value >= threshold:
                # Check if already recorded
                existing = await self.db.execute(
                    select(BlockTrade).where(
                        and_(
                            BlockTrade.symbol == symbol,
                            BlockTrade.trade_time == trade.trade_time,
                            BlockTrade.price == trade.price
                        )
                    )
                )
                
                if existing.scalar_one_or_none():
                    continue
                
                # Determine trade side (simplified - could be enhanced)
                side = TradeSide.BUY if trade.match_type == "BUY" else TradeSide.SELL
                
                # Create block trade record
                block_trade = BlockTrade(
                    symbol=symbol,
                    side=side,
                    quantity=trade.volume,
                    price=trade.price,
                    value=trade_value,
                    trade_time=trade.trade_time,
                    avg_volume_20d=avg_volume,
                    volume_ratio=trade.volume / avg_volume if avg_volume > 0 else None
                )
                
                self.db.add(block_trade)
                block_trades.append(block_trade)
                
                # Generate alert
                await self._generate_block_trade_alert(block_trade)
        
        if block_trades:
            await self.db.commit()
            logger.info(f"Detected {len(block_trades)} block trades for {symbol}")
        
        return block_trades
    
    async def _generate_insider_alert(self, deal: InsiderDeal) -> InsiderAlert:
        """Generate alert for insider deal"""
        
        # Determine alert type and severity
        is_buy = deal.deal_action and "mua" in deal.deal_action.lower()
        alert_type = AlertType.INSIDER_BUY if is_buy else AlertType.INSIDER_SELL
        
        # Calculate severity based on deal value
        severity = AlertSeverity.LOW
        if deal.deal_value:
            if deal.deal_value >= 10_000_000_000:  # VND 10bn
                severity = AlertSeverity.HIGH
            elif deal.deal_value >= 1_000_000_000:  # VND 1bn
                severity = AlertSeverity.MEDIUM
        
        # Format title and description
        action = "bought" if is_buy else "sold"
        title = f"{deal.insider_name} {action} {deal.symbol}"
        
        value_str = f"VND {deal.deal_value:,.0f}" if deal.deal_value else "N/A"
        description = (
            f"{deal.insider_position or 'Insider'} {deal.insider_name} "
            f"{action} {deal.deal_quantity:,.0f} shares of {deal.symbol} "
            f"at {deal.deal_price:,.0f} VND/share (Total: {value_str})"
        )
        
        # Create alert
        alert = InsiderAlert(
            alert_type=alert_type,
            severity=severity,
            symbol=deal.symbol,
            title=title,
            description=description,
            insider_deal_id=deal.id,
            timestamp=datetime.utcnow()
        )
        
        self.db.add(alert)
        logger.info(f"Generated insider alert: {title}")
        
        # Broadcast via WebSocket
        await manager.broadcast_alert(alert.to_dict() if hasattr(alert, 'to_dict') else {
            "id": alert.id,
            "type": "insider_alert",
            "alert_type": alert.alert_type,
            "severity": alert.severity,
            "symbol": alert.symbol,
            "title": alert.title,
            "description": alert.description,
            "timestamp": alert.timestamp.isoformat()
        })
        
        return alert
    
    async def _generate_block_trade_alert(self, trade: BlockTrade) -> InsiderAlert:
        """Generate alert for block trade"""
        
        # Determine severity based on value
        severity = AlertSeverity.MEDIUM
        if trade.value >= 50_000_000_000:  # VND 50bn
            severity = AlertSeverity.HIGH
        elif trade.value >= 20_000_000_000:  # VND 20bn
            severity = AlertSeverity.MEDIUM
        
        # Format title and description
        side_str = "Buy" if trade.side == TradeSide.BUY else "Sell"
        title = f"Large {side_str} Block: {trade.symbol}"
        
        value_bn = trade.value / 1_000_000_000
        description = (
            f"Block {side_str.lower()} of {trade.quantity:,} shares at "
            f"{trade.price:,.0f} VND/share (Total: VND {value_bn:.2f}bn)"
        )
        
        if trade.volume_ratio:
            description += f" - {trade.volume_ratio:.1f}x average volume"
        
        # Create alert
        alert = InsiderAlert(
            alert_type=AlertType.BLOCK_TRADE,
            severity=severity,
            symbol=trade.symbol,
            title=title,
            description=description,
            block_trade_id=trade.id,
            timestamp=datetime.utcnow()
        )
        
        self.db.add(alert)
        logger.info(f"Generated block trade alert: {title}")
        
        # Broadcast via WebSocket
        await manager.broadcast_alert(alert.to_dict() if hasattr(alert, 'to_dict') else {
            "id": alert.id,
            "type": "block_trade_alert",
            "alert_type": alert.alert_type,
            "severity": alert.severity,
            "symbol": alert.symbol,
            "title": alert.title,
            "description": alert.description,
            "timestamp": alert.timestamp.isoformat()
        })
        
        return alert
    
    async def _get_average_volume(self, symbol: str, days: int = 20) -> int:
        """Calculate average daily volume for a symbol"""
        
        cutoff_date = datetime.now() - timedelta(days=days)
        
        result = await self.db.execute(
            select(func.avg(IntradayTrade.volume))
            .where(
                and_(
                    IntradayTrade.symbol == symbol,
                    IntradayTrade.trade_time >= cutoff_date
                )
            )
        )
        
        avg = result.scalar()
        return int(avg) if avg else 0
    
    async def get_recent_insider_deals(
        self, 
        symbol: Optional[str] = None,
        limit: int = 50
    ) -> List[InsiderDeal]:
        """Get recent insider deals, optionally filtered by symbol"""
        
        query = select(InsiderDeal).order_by(desc(InsiderDeal.announce_date))
        
        if symbol:
            query = query.where(InsiderDeal.symbol == symbol)
        
        query = query.limit(limit)
        
        result = await self.db.execute(query)
        return list(result.scalars().all())
    
    async def get_recent_block_trades(
        self,
        symbol: Optional[str] = None,
        limit: int = 50
    ) -> List[BlockTrade]:
        """Get recent block trades, optionally filtered by symbol"""
        
        query = select(BlockTrade).order_by(desc(BlockTrade.trade_time))
        
        if symbol:
            query = query.where(BlockTrade.symbol == symbol)
        
        query = query.limit(limit)
        
        result = await self.db.execute(query)
        return list(result.scalars().all())
    
    async def get_user_alerts(
        self,
        user_id: Optional[int] = None,
        unread_only: bool = False,
        limit: int = 100
    ) -> List[InsiderAlert]:
        """Get alerts for a user"""
        
        query = select(InsiderAlert).order_by(desc(InsiderAlert.timestamp))
        
        if user_id:
            query = query.where(InsiderAlert.user_id == user_id)
        
        if unread_only:
            query = query.where(InsiderAlert.read == False)
        
        query = query.limit(limit)
        
        result = await self.db.execute(query)
        return list(result.scalars().all())
    
    async def mark_alert_read(self, alert_id: int) -> Optional[InsiderAlert]:
        """Mark an alert as read"""
        
        result = await self.db.execute(
            select(InsiderAlert).where(InsiderAlert.id == alert_id)
        )
        
        alert = result.scalar_one_or_none()
        
        if alert:
            alert.read = True
            alert.read_at = datetime.utcnow()
            await self.db.commit()
            logger.info(f"Marked alert {alert_id} as read")
        
        return alert
    
    async def get_or_create_alert_settings(
        self, 
        user_id: int
    ) -> AlertSettings:
        """Get or create alert settings for a user"""
        
        result = await self.db.execute(
            select(AlertSettings).where(AlertSettings.user_id == user_id)
        )
        
        settings = result.scalar_one_or_none()
        
        if not settings:
            settings = AlertSettings(user_id=user_id)
            self.db.add(settings)
            await self.db.commit()
            logger.info(f"Created default alert settings for user {user_id}")
        
        return settings
    
    async def update_alert_settings(
        self,
        user_id: int,
        **kwargs
    ) -> AlertSettings:
        """Update alert settings for a user"""
        
        settings = await self.get_or_create_alert_settings(user_id)
        
        for key, value in kwargs.items():
            if hasattr(settings, key):
                setattr(settings, key, value)
        
        await self.db.commit()
        logger.info(f"Updated alert settings for user {user_id}")
        
        return settings
    
    async def calculate_insider_sentiment(
        self, 
        symbol: str, 
        days: int = 90
    ) -> Dict[str, Any]:
        """
        Calculate insider sentiment score for a symbol.
        
        Returns:
            Dict with buy/sell counts, net value, and sentiment score
        """
        cutoff_date = datetime.now().date() - timedelta(days=days)
        
        result = await self.db.execute(
            select(InsiderDeal)
            .where(
                and_(
                    InsiderDeal.symbol == symbol,
                    InsiderDeal.announce_date >= cutoff_date
                )
            )
        )
        
        deals = result.scalars().all()
        
        buy_count = 0
        sell_count = 0
        buy_value = 0.0
        sell_value = 0.0
        
        for deal in deals:
            is_buy = deal.deal_action and "mua" in deal.deal_action.lower()
            
            if is_buy:
                buy_count += 1
                buy_value += deal.deal_value or 0
            else:
                sell_count += 1
                sell_value += deal.deal_value or 0
        
        net_value = buy_value - sell_value
        total_value = buy_value + sell_value
        
        # Calculate sentiment score (-100 to +100)
        if total_value > 0:
            sentiment_score = (net_value / total_value) * 100
        else:
            sentiment_score = 0
        
        return {
            "symbol": symbol,
            "period_days": days,
            "buy_count": buy_count,
            "sell_count": sell_count,
            "buy_value": buy_value,
            "sell_value": sell_value,
            "net_value": net_value,
            "sentiment_score": sentiment_score,
            "total_deals": len(deals)
        }
