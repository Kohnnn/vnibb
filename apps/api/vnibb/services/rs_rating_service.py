"""
RS Rating (Relative Strength) Service

Implements IBD-style Relative Strength rating system:
- Calculates RS line (stock vs market performance)
- Computes weighted RS rating (1-99 percentile)
- Tracks RS new highs and sector rankings
- Updates screener snapshots with RS data

Calculation weights: 40% (3mo) + 25% (6mo) + 20% (9mo) + 15% (12mo)
"""

import logging
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple
import asyncio

import pandas as pd
import numpy as np
from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import get_db_context
from vnibb.models.stock import Stock, StockIndex
from vnibb.models.stock import StockPrice
from vnibb.models.screener import ScreenerSnapshot

logger = logging.getLogger(__name__)


class RSRatingService:
    """
    Calculate and manage Relative Strength (RS) ratings for stocks.
    
    RS Rating measures a stock's price performance relative to the overall market,
    using a weighted multi-period approach similar to IBD's methodology.
    """
    
    # Trading days for each period (approximate)
    PERIODS = {
        "3mo": 63,
        "6mo": 126,
        "9mo": 189,
        "12mo": 252,
    }
    
    # Weights for each period (must sum to 1.0)
    WEIGHTS = {
        "3mo": 0.40,
        "6mo": 0.25,
        "9mo": 0.20,
        "12mo": 0.15,
    }
    
    def __init__(self, db: Optional[AsyncSession] = None):
        self.db = db
        
    async def calculate_all_rs_ratings(self, calculation_date: Optional[date] = None) -> Dict[str, any]:
        """
        Calculate RS ratings for all active stocks.
        
        Args:
            calculation_date: Date to calculate for (defaults to today)
            
        Returns:
            Dictionary with calculation results and statistics
        """
        if calculation_date is None:
            calculation_date = date.today()
            
        logger.info(f"Starting RS rating calculation for {calculation_date}")
        
        try:
            async with get_db_context() as db:
                # Get all active stocks
                stocks = await self._get_active_stocks(db)
                logger.info(f"Found {len(stocks)} active stocks")
                
                # Get market (VN-INDEX) returns
                market_returns = await self._get_market_returns(db, calculation_date)
                if not market_returns:
                    logger.error("Failed to get market returns")
                    return {"success": False, "error": "No market data available"}
                
                # Get weighted returns for all stocks in batch
                stock_ratings = await self._calculate_all_weighted_returns(db, stocks, market_returns, calculation_date)
                
                logger.info(f"Calculated returns for {len(stock_ratings)} stocks")
                
                # Convert to percentile rankings (1-99)
                ranked_stocks = self._percentile_rank_all(stock_ratings)
                
                # Calculate sector rankings
                ranked_stocks = self._calculate_sector_rankings(ranked_stocks)
                
                # Detect RS new highs in batch
                ranked_stocks = await self._detect_rs_new_highs_batch(db, ranked_stocks, calculation_date)
                
                # Update screener snapshots
                await self._update_screener_snapshots(db, ranked_stocks, calculation_date)
                
                # Calculate statistics
                stats = self._calculate_statistics(ranked_stocks)
                
                logger.info(f"RS rating calculation complete: {stats}")
                
                return {
                    "success": True,
                    "calculation_date": calculation_date.isoformat(),
                    "total_stocks": len(ranked_stocks),
                    "statistics": stats,
                }
                
        except Exception as e:
            logger.error(f"RS rating calculation failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}
    
    async def _get_active_stocks(self, db: AsyncSession) -> List[Stock]:
        """Get all active stocks from database."""
        result = await db.execute(
            select(Stock).where(Stock.is_active == 1)
        )
        return result.scalars().all()
    
    async def _get_market_returns(
        self, 
        db: AsyncSession, 
        end_date: date
    ) -> Optional[Dict[str, float]]:
        """
        Calculate market (VN-INDEX) returns for all periods.
        
        Returns:
            Dictionary with period returns or None if insufficient data
        """
        try:
            # Get VN-INDEX historical data
            start_date = end_date - timedelta(days=365)  # Get 1 year of data
            
            result = await db.execute(
                select(StockIndex)
                .where(
                    and_(
                        StockIndex.index_code == "VNINDEX",
                        StockIndex.time >= start_date,
                        StockIndex.time <= end_date
                    )
                )
                .order_by(StockIndex.time)
            )
            
            index_data = result.scalars().all()
            
            if len(index_data) < self.PERIODS["12mo"]:
                logger.warning(f"Insufficient market data: {len(index_data)} days")
                return None
            
            # Convert to DataFrame for easier calculation
            df = pd.DataFrame([
                {"time": idx.time, "close": idx.close}
                for idx in index_data
            ])
            df = df.sort_values("time").reset_index(drop=True)
            
            # Calculate returns for each period
            returns = {}
            latest_price = df.iloc[-1]["close"]
            
            for period_name, days in self.PERIODS.items():
                if len(df) >= days:
                    period_price = df.iloc[-days]["close"]
                    returns[period_name] = (latest_price - period_price) / period_price
                else:
                    logger.warning(f"Insufficient data for {period_name} period")
                    returns[period_name] = 0.0
            
            return returns
            
        except Exception as e:
            logger.error(f"Failed to get market returns: {e}")
            return None
    
    async def _calculate_all_weighted_returns(
        self,
        db: AsyncSession,
        stocks: List[Stock],
        market_returns: Dict[str, float],
        end_date: date
    ) -> List[Dict]:
        """Calculate weighted relative returns for all stocks in batch."""
        symbols = [s.symbol for s in stocks]
        start_date = end_date - timedelta(days=365)
        
        # Fetch all prices for all stocks in one go
        result = await db.execute(
            select(StockPrice.symbol, StockPrice.time, StockPrice.close)
            .where(
                and_(
                    StockPrice.symbol.in_(symbols),
                    StockPrice.time >= start_date,
                    StockPrice.time <= end_date,
                    StockPrice.interval == "1D"
                )
            )
            .order_by(StockPrice.symbol, StockPrice.time)
        )
        
        # Organize prices by symbol
        stock_prices = {}
        for row in result:
            sym = row[0]
            if sym not in stock_prices:
                stock_prices[sym] = []
            stock_prices[sym].append({"time": row[1], "close": row[2]})
            
        stock_ratings = []
        stock_lookup = {s.symbol: s for s in stocks}
        
        for symbol, prices in stock_prices.items():
            if len(prices) < self.PERIODS["3mo"]:
                continue
                
            df = pd.DataFrame(prices).sort_values("time").reset_index(drop=True)
            latest_price = df.iloc[-1]["close"]
            
            # Calculate returns for each period
            returns = {}
            for period_name, days in self.PERIODS.items():
                if len(df) >= days:
                    period_price = df.iloc[-days]["close"]
                    returns[period_name] = (latest_price - period_price) / period_price if period_price != 0 else 0.0
                else:
                    returns[period_name] = 0.0
                    
            # Calculate weighted relative return
            weighted_return = self._calculate_weighted_return(returns, market_returns)
            
            stock = stock_lookup.get(symbol)
            stock_ratings.append({
                "symbol": symbol,
                "weighted_return": weighted_return,
                "sector": stock.sector if stock else None,
                "industry": stock.industry if stock else None,
            })
            
        return stock_ratings
    
    def _calculate_weighted_return(
        self, 
        stock_returns: Dict[str, float], 
        market_returns: Dict[str, float]
    ) -> float:
        """
        Calculate weighted relative return using IBD methodology.
        
        Formula: Sum of (weight * (stock_return / market_return)) for each period
        """
        weighted_sum = 0.0
        
        for period_name, weight in self.WEIGHTS.items():
            stock_ret = stock_returns.get(period_name, 0.0)
            market_ret = market_returns.get(period_name, 0.0)
            
            # Avoid division by zero
            if market_ret != 0:
                relative_return = stock_ret / market_ret
            else:
                relative_return = 1.0 if stock_ret > 0 else 0.0
            
            weighted_sum += weight * relative_return
        
        return weighted_sum
    
    def _percentile_rank_all(self, stock_ratings: List[Dict]) -> List[Dict]:
        """
        Convert weighted returns to percentile rankings (1-99).
        
        Args:
            stock_ratings: List of dicts with symbol and weighted_return
            
        Returns:
            Same list with rs_rating and rs_rank added
        """
        if not stock_ratings:
            return []
        
        # Sort by weighted return
        sorted_stocks = sorted(stock_ratings, key=lambda x: x["weighted_return"])
        
        total = len(sorted_stocks)
        
        for rank, stock in enumerate(sorted_stocks, start=1):
            # Convert rank to percentile (1-99)
            # Rank 1 (worst) -> RS Rating 1
            # Rank N (best) -> RS Rating 99
            percentile = int((rank / total) * 99)
            percentile = max(1, min(99, percentile))  # Clamp to 1-99
            
            stock["rs_rating"] = percentile
            stock["rs_rank"] = rank
        
        return sorted_stocks
    
    def _calculate_sector_rankings(self, ranked_stocks: List[Dict]) -> List[Dict]:
        """
        Calculate rank within each sector.
        
        Args:
            ranked_stocks: List with rs_rating already calculated
            
        Returns:
            Same list with sector_rs_rank added
        """
        # Group by sector
        sectors = {}
        for stock in ranked_stocks:
            sector = stock.get("sector") or "Unknown"
            if sector not in sectors:
                sectors[sector] = []
            sectors[sector].append(stock)
        
        # Rank within each sector
        for sector, stocks in sectors.items():
            sorted_sector = sorted(stocks, key=lambda x: x["rs_rating"])
            for rank, stock in enumerate(sorted_sector, start=1):
                stock["sector_rs_rank"] = rank
        
        return ranked_stocks
    
    async def _detect_rs_new_highs_batch(
        self, 
        db: AsyncSession, 
        ranked_stocks: List[Dict],
        current_date: date
    ) -> List[Dict]:
        """Detect if current RS rating is a new 52-week high using batch query."""
        lookback_date = current_date - timedelta(days=365)
        symbols = [s["symbol"] for s in ranked_stocks]
        
        # Get max historical RS rating for each symbol
        result = await db.execute(
            select(ScreenerSnapshot.symbol, func.max(ScreenerSnapshot.rs_rating))
            .where(
                and_(
                    ScreenerSnapshot.symbol.in_(symbols),
                    ScreenerSnapshot.snapshot_date >= lookback_date,
                    ScreenerSnapshot.snapshot_date < current_date,
                    ScreenerSnapshot.rs_rating.isnot(None)
                )
            )
            .group_by(ScreenerSnapshot.symbol)
        )
        
        max_ratings = {row[0]: row[1] for row in result.all()}
        
        for stock in ranked_stocks:
            max_hist = max_ratings.get(stock["symbol"])
            if max_hist is not None:
                stock["rs_new_high"] = stock["rs_rating"] > max_hist
            else:
                stock["rs_new_high"] = True  # No history, consider new high
                
        return ranked_stocks
    
    async def _update_screener_snapshots(
        self, 
        db: AsyncSession, 
        ranked_stocks: List[Dict],
        snapshot_date: date
    ) -> None:
        """
        Update screener snapshots with RS rating data.
        
        Creates new snapshots if they don't exist, updates existing ones.
        """
        for stock in ranked_stocks:
            try:
                # Check if snapshot exists
                result = await db.execute(
                    select(ScreenerSnapshot)
                    .where(
                        and_(
                            ScreenerSnapshot.symbol == stock["symbol"],
                            ScreenerSnapshot.snapshot_date == snapshot_date
                        )
                    )
                )
                
                snapshot = result.scalar_one_or_none()
                
                if snapshot:
                    # Update existing snapshot
                    snapshot.rs_rating = stock["rs_rating"]
                    snapshot.rs_rank = stock["rs_rank"]
                else:
                    # Create new snapshot with RS data only
                    snapshot = ScreenerSnapshot(
                        symbol=stock["symbol"],
                        snapshot_date=snapshot_date,
                        industry=stock.get("industry"),
                        rs_rating=stock["rs_rating"],
                        rs_rank=stock["rs_rank"],
                        source="rs_rating_service"
                    )
                    db.add(snapshot)
                
            except Exception as e:
                logger.error(f"Failed to update snapshot for {stock['symbol']}: {e}")
        
        await db.commit()
        logger.info(f"Updated {len(ranked_stocks)} screener snapshots")
    
    def _calculate_statistics(self, ranked_stocks: List[Dict]) -> Dict:
        """Calculate summary statistics for the RS rating run."""
        if not ranked_stocks:
            return {}
        
        ratings = [s["rs_rating"] for s in ranked_stocks]
        weighted_returns = [s["weighted_return"] for s in ranked_stocks]
        
        return {
            "mean_rs_rating": np.mean(ratings),
            "median_rs_rating": np.median(ratings),
            "mean_weighted_return": np.mean(weighted_returns),
            "top_10_symbols": [s["symbol"] for s in sorted(ranked_stocks, key=lambda x: x["rs_rating"], reverse=True)[:10]],
            "bottom_10_symbols": [s["symbol"] for s in sorted(ranked_stocks, key=lambda x: x["rs_rating"])[:10]],
        }
    
    async def get_rs_rating(self, symbol: str) -> Optional[Dict]:
        """
        Get current RS rating for a single stock.
        
        Returns:
            Dictionary with RS rating data or None
        """
        async with get_db() as db:
            result = await db.execute(
                select(ScreenerSnapshot)
                .where(ScreenerSnapshot.symbol == symbol)
                .order_by(desc(ScreenerSnapshot.snapshot_date))
                .limit(1)
            )
            
            snapshot = result.scalar_one_or_none()
            
            if not snapshot or snapshot.rs_rating is None:
                return None
            
            return {
                "symbol": symbol,
                "rs_rating": snapshot.rs_rating,
                "rs_rank": snapshot.rs_rank,
                "snapshot_date": snapshot.snapshot_date.isoformat(),
            }
    
    async def get_rs_leaders(self, limit: int = 50, sector: Optional[str] = None) -> List[Dict]:
        """
        Get top RS rated stocks (leaders).
        
        Args:
            limit: Number of stocks to return
            sector: Optional sector filter
            
        Returns:
            List of top RS stocks
        """
        async with get_db() as db:
            # Get latest snapshot date
            latest_date_result = await db.execute(
                select(func.max(ScreenerSnapshot.snapshot_date))
                .where(ScreenerSnapshot.rs_rating.isnot(None))
            )
            latest_date = latest_date_result.scalar()
            
            if not latest_date:
                return []
            
            # Build query
            query = (
                select(ScreenerSnapshot)
                .where(
                    and_(
                        ScreenerSnapshot.snapshot_date == latest_date,
                        ScreenerSnapshot.rs_rating.isnot(None)
                    )
                )
            )
            
            if sector:
                # Join with Stock to get sector info
                query = query.join(Stock, Stock.symbol == ScreenerSnapshot.symbol)
                query = query.where(Stock.sector == sector)
            
            query = query.order_by(desc(ScreenerSnapshot.rs_rating)).limit(limit)
            
            result = await db.execute(query)
            snapshots = result.scalars().all()
            
            return [
                {
                    "symbol": s.symbol,
                    "company_name": s.company_name,
                    "rs_rating": s.rs_rating,
                    "rs_rank": s.rs_rank,
                    "price": s.price,
                    "industry": s.industry,
                }
                for s in snapshots
            ]
    
    async def get_rs_laggards(self, limit: int = 50, sector: Optional[str] = None) -> List[Dict]:
        """
        Get bottom RS rated stocks (laggards).
        
        Args:
            limit: Number of stocks to return
            sector: Optional sector filter
            
        Returns:
            List of bottom RS stocks
        """
        async with get_db() as db:
            latest_date_result = await db.execute(
                select(func.max(ScreenerSnapshot.snapshot_date))
                .where(ScreenerSnapshot.rs_rating.isnot(None))
            )
            latest_date = latest_date_result.scalar()
            
            if not latest_date:
                return []
            
            query = (
                select(ScreenerSnapshot)
                .where(
                    and_(
                        ScreenerSnapshot.snapshot_date == latest_date,
                        ScreenerSnapshot.rs_rating.isnot(None)
                    )
                )
            )
            
            if sector:
                query = query.join(Stock, Stock.symbol == ScreenerSnapshot.symbol)
                query = query.where(Stock.sector == sector)
            
            query = query.order_by(ScreenerSnapshot.rs_rating).limit(limit)
            
            result = await db.execute(query)
            snapshots = result.scalars().all()
            
            return [
                {
                    "symbol": s.symbol,
                    "company_name": s.company_name,
                    "rs_rating": s.rs_rating,
                    "rs_rank": s.rs_rank,
                    "price": s.price,
                    "industry": s.industry,
                }
                for s in snapshots
            ]
    
    async def get_rs_gainers(self, limit: int = 50, lookback_days: int = 7) -> List[Dict]:
        """
        Get stocks with biggest RS rating improvement.
        
        Args:
            limit: Number of stocks to return
            lookback_days: Days to look back for comparison
            
        Returns:
            List of stocks with biggest RS gains
        """
        async with get_db() as db:
            # Get latest date
            latest_date_result = await db.execute(
                select(func.max(ScreenerSnapshot.snapshot_date))
                .where(ScreenerSnapshot.rs_rating.isnot(None))
            )
            latest_date = latest_date_result.scalar()
            
            if not latest_date:
                return []
            
            comparison_date = latest_date - timedelta(days=lookback_days)
            
            # Get current ratings
            current_result = await db.execute(
                select(ScreenerSnapshot)
                .where(
                    and_(
                        ScreenerSnapshot.snapshot_date == latest_date,
                        ScreenerSnapshot.rs_rating.isnot(None)
                    )
                )
            )
            current_snapshots = {s.symbol: s for s in current_result.scalars().all()}
            
            # Get previous ratings
            previous_result = await db.execute(
                select(ScreenerSnapshot)
                .where(
                    and_(
                        ScreenerSnapshot.snapshot_date >= comparison_date,
                        ScreenerSnapshot.snapshot_date < latest_date,
                        ScreenerSnapshot.rs_rating.isnot(None)
                    )
                )
                .order_by(desc(ScreenerSnapshot.snapshot_date))
            )
            previous_snapshots = {}
            for s in previous_result.scalars().all():
                if s.symbol not in previous_snapshots:
                    previous_snapshots[s.symbol] = s
            
            # Calculate changes
            gainers = []
            for symbol, current in current_snapshots.items():
                if symbol in previous_snapshots:
                    previous = previous_snapshots[symbol]
                    change = current.rs_rating - previous.rs_rating
                    
                    gainers.append({
                        "symbol": symbol,
                        "company_name": current.company_name,
                        "rs_rating": current.rs_rating,
                        "rs_rating_prev": previous.rs_rating,
                        "rs_rating_change": change,
                        "price": current.price,
                        "industry": current.industry,
                    })
            
            # Sort by change and return top gainers
            gainers.sort(key=lambda x: x["rs_rating_change"], reverse=True)
            return gainers[:limit]

    async def get_rs_rating_history(self, symbol: str, limit: int = 100) -> List[Dict]:
        """
        Get historical RS ratings for a stock.
        Used for RS line chart overlay.
        """
        async with get_db_context() as db:
            result = await db.execute(
                select(ScreenerSnapshot.snapshot_date, ScreenerSnapshot.rs_rating)
                .where(
                    and_(
                        ScreenerSnapshot.symbol == symbol,
                        ScreenerSnapshot.rs_rating.isnot(None)
                    )
                )
                .order_by(desc(ScreenerSnapshot.snapshot_date))
                .limit(limit)
            )
            
            rows = result.all()
            return [
                {
                    "time": row[0].isoformat(),
                    "value": row[1]
                }
                for row in reversed(rows)
            ]
