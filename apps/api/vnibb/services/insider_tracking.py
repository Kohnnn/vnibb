"""
Insider Trading & Block Trade Tracking Service

Handles:
- Syncing insider deals from vnstock
- Detecting large block trades
- Generating alerts for insider activity
- Managing alert thresholds and user preferences
"""

import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.insider_units import admitted_deal_value, normalize_deal_action
from vnibb.models.alerts import (
    AlertSettings,
    AlertSeverity,
    AlertType,
    BlockTrade,
    InsiderAlert,
    TradeSide,
)
from vnibb.models.news import InsiderDeal
from vnibb.models.trading import IntradayTrade
from vnibb.services.websocket_service import manager

logger = logging.getLogger(__name__)


def _is_missing_block_trade_column_error(exc: Exception) -> bool:
    message = str(exc).lower()
    missing_column_markers = (
        "does not exist",
        "undefinedcolumnerror",
        "no such column",
    )
    modern_columns = (
        "block_trades.side",
        "block_trades.volume_ratio",
        "block_trades.is_foreign",
        "block_trades.is_proprietary",
    )
    return any(column in message for column in modern_columns) and any(
        marker in message for marker in missing_column_markers
    )


async def _rollback_after_query_error(db: AsyncSession, context: str) -> None:
    try:
        await db.rollback()
    except Exception as rollback_exc:
        logger.warning("%s rollback failed: %s", context, rollback_exc)


class InsiderTrackingService:
    """Service for tracking insider trading and block trades"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def sync_insider_deals(self, symbols: list[str]) -> dict[str, int]:
        """
        Sync insider deals for given symbols from vnstock.

        Args:
            symbols: List of stock symbols to sync

        Returns:
            Dict with sync statistics

        QA-v4 D.4: Previously called `stock.finance.insider_deals()` which
        does not exist in vnstock>=3.5 (the method is on `stock.company`,
        not `stock.finance`). Result was that the writer raised on every
        symbol and the InsiderDeal table stayed empty since v1. Now
        delegates to the free VCI company provider with existing field-alias
        normalization. Unsupported datasets are recorded as provider errors.
        """
        from vnibb.providers.vnstock.insider_deals import VnstockInsiderDealsFetcher

        stats = {"total": 0, "new": 0, "errors": 0}

        for symbol in symbols:
            try:
                deal_records = await VnstockInsiderDealsFetcher.fetch(
                    symbol=symbol, limit=50
                )

                if not deal_records:
                    logger.debug(f"No insider deals for {symbol}")
                    continue

                for record in deal_records:
                    stats["total"] += 1
                    payload = record.model_dump() if hasattr(record, "model_dump") else dict(record)
                    announce_date = payload.get("transaction_date") or payload.get("announce_date")
                    insider_name = payload.get("insider_name") or "Unknown"
                    provider_record_id = payload.get("provider_record_id")
                    record_hash = payload.get("record_hash")

                    existing_rows = (
                        await self.db.execute(
                            select(InsiderDeal).where(
                                and_(
                                    InsiderDeal.symbol == symbol,
                                    InsiderDeal.announce_date == announce_date,
                                    InsiderDeal.insider_name == insider_name,
                                )
                            )
                        )
                    ).scalars().all()
                    already_stored = False
                    for row in existing_rows:
                        row_raw = row.raw_data or {}
                        if provider_record_id and row_raw.get("provider_record_id") == provider_record_id:
                            already_stored = True
                            break
                        if record_hash and row_raw.get("record_hash") == record_hash:
                            already_stored = True
                            break
                    if already_stored:
                        continue

                    deal = InsiderDeal(
                        symbol=symbol.upper(),
                        announce_date=announce_date,
                        # Raw provider action text is kept in deal_method; deal_action
                        # holds the normalized BUY/SELL/UNKNOWN token.
                        deal_method=(payload.get("raw_data") or {}).get("action_type_vi")
                        or payload.get("deal_method"),
                        deal_action=normalize_deal_action(payload.get("deal_action") or payload.get("transaction_type")),
                        deal_quantity=payload.get("shares_executed") or payload.get("shares_registered")
                        or payload.get("transaction_volume") or payload.get("deal_quantity"),
                        deal_price=payload.get("deal_price"),
                        deal_value=payload.get("deal_value"),
                        deal_ratio=payload.get("ownership_after") or payload.get("deal_ratio"),
                        insider_name=insider_name,
                        insider_position=payload.get("insider_position"),
                        raw_data=payload,
                    )

                    self.db.add(deal)
                    stats["new"] += 1

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
        threshold: float | None = None
    ) -> list[BlockTrade]:
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

    async def _generate_insider_alert(self, deal: InsiderDeal) -> InsiderAlert | None:
        """Generate a directional alert; None when the source states no direction."""

        action_token = normalize_deal_action(deal.deal_action)
        if action_token not in ("BUY", "SELL"):
            logger.info(
                "Skipping insider alert with undirected action for %s", deal.symbol
            )
            return None
        is_buy = action_token == "BUY"
        alert_type = AlertType.INSIDER_BUY if is_buy else AlertType.INSIDER_SELL

        # Calculate severity based on admitted deal value (VND) only.
        severity = AlertSeverity.LOW
        if deal.deal_value:
            if deal.deal_value >= 10_000_000_000:  # VND 10bn
                severity = AlertSeverity.HIGH
            elif deal.deal_value >= 1_000_000_000:  # VND 1bn
                severity = AlertSeverity.MEDIUM

        # Format title and description from admitted fields only.
        action = "bought" if is_buy else "sold"
        title = f"{deal.insider_name} {action} {deal.symbol}"

        value_str = f"VND {deal.deal_value:,.0f}" if deal.deal_value else "N/A"
        quantity_str = (
            f"{deal.deal_quantity:,.0f} shares" if deal.deal_quantity is not None else "an undisclosed volume"
        )
        price_str = (
            f" at {deal.deal_price:,.0f} VND/share" if deal.deal_price is not None else ""
        )
        description = (
            f"{deal.insider_position or 'Insider'} {deal.insider_name} "
            f"{action} {quantity_str} of {deal.symbol}{price_str} (Total: {value_str})"
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
        symbol: str | None = None,
        limit: int = 50
    ) -> list[InsiderDeal]:
        """Get recent insider deals, optionally filtered by symbol"""

        query = select(InsiderDeal).order_by(desc(InsiderDeal.announce_date))

        if symbol:
            query = query.where(InsiderDeal.symbol == symbol)

        query = query.limit(limit)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_recent_block_trades(
        self,
        symbol: str | None = None,
        limit: int = 50
    ) -> list[dict[str, Any]]:
        """Get recent block trades, optionally filtered by symbol"""

        query = select(
            BlockTrade.id.label("id"),
            BlockTrade.symbol.label("symbol"),
            BlockTrade.side.label("side"),
            BlockTrade.quantity.label("quantity"),
            BlockTrade.price.label("price"),
            BlockTrade.value.label("value"),
            BlockTrade.trade_time.label("trade_time"),
            BlockTrade.volume_ratio.label("volume_ratio"),
            BlockTrade.is_foreign.label("is_foreign"),
            BlockTrade.is_proprietary.label("is_proprietary"),
        ).order_by(desc(BlockTrade.trade_time))

        if symbol:
            query = query.where(BlockTrade.symbol == symbol)

        query = query.limit(limit)

        try:
            result = await self.db.execute(query)
            return [dict(row) for row in result.mappings().all()]
        except Exception as exc:
            await _rollback_after_query_error(self.db, "Block trades query")

            if not _is_missing_block_trade_column_error(exc):
                logger.warning("Block trades query failed: %s", exc)
                raise

            logger.warning("Block trades query fell back to legacy schema: %s", exc)

        fallback_query = select(
            BlockTrade.id.label("id"),
            BlockTrade.symbol.label("symbol"),
            BlockTrade.quantity.label("quantity"),
            BlockTrade.price.label("price"),
            BlockTrade.value.label("value"),
            BlockTrade.trade_time.label("trade_time"),
        ).order_by(desc(BlockTrade.trade_time))

        if symbol:
            fallback_query = fallback_query.where(BlockTrade.symbol == symbol)

        fallback_query = fallback_query.limit(limit)

        try:
            result = await self.db.execute(fallback_query)
            rows: list[dict[str, Any]] = []
            for row in result.mappings().all():
                item = dict(row)
                item.update(
                    {
                        "side": None,
                        "volume_ratio": None,
                        "is_foreign": False,
                        "is_proprietary": False,
                    }
                )
                rows.append(item)
            return rows
        except Exception as exc:
            await _rollback_after_query_error(self.db, "Legacy block trades fallback")
            logger.warning("Legacy block trades fallback failed: %s", exc)
            raise

    async def get_user_alerts(
        self,
        user_id: int | None = None,
        unread_only: bool = False,
        limit: int = 100
    ) -> list[InsiderAlert]:
        """Get alerts for a user"""

        query = select(InsiderAlert).order_by(desc(InsiderAlert.timestamp))

        if user_id:
            query = query.where(InsiderAlert.user_id == user_id)

        if unread_only:
            query = query.where(InsiderAlert.read == False)

        query = query.limit(limit)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def mark_alert_read(self, alert_id: int) -> InsiderAlert | None:
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
    ) -> dict[str, Any]:
        """Aggregate insider sentiment over a window.

        Direction counts cover every stored row and UNKNOWN direction stays
        neutral (never counted as a buy or a sell). Monetary aggregates are
        certified only when every classified deal in the window carries a finite
        `deal_value` and stored VND unit evidence; otherwise the affected
        aggregates and the score are None rather than an unstated partial sum.
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
        classified_have_units = True

        for deal in deals:
            action_token = normalize_deal_action(deal.deal_action)
            if action_token not in ("BUY", "SELL"):
                continue

            if action_token == "BUY":
                buy_count += 1
            else:
                sell_count += 1

            value = admitted_deal_value(deal)
            if value is None:
                classified_have_units = False
                continue
            if action_token == "BUY":
                buy_value += value
            else:
                sell_value += value

        if classified_have_units:
            net_value: float | None = buy_value - sell_value
            total_value = buy_value + sell_value
            sentiment_score: float | None = (
                (net_value / total_value) * 100 if total_value > 0 else 0.0
            )
            value_unit: str | None = "VND"
        else:
            net_value = sentiment_score = None
            value_unit = None

        return {
            "symbol": symbol,
            "period_days": days,
            "buy_count": buy_count,
            "sell_count": sell_count,
            "buy_value": buy_value if classified_have_units else None,
            "sell_value": sell_value if classified_have_units else None,
            "net_value": net_value,
            "sentiment_score": sentiment_score,
            "value_unit": value_unit,
            "total_deals": len(deals),
        }
