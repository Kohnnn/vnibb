"""
Real-time Data Pipeline using vnstock_pipeline

Streams live market data via WebSocket and stores in database.
Supports: stockps (stock prices), index, board, boardps, etc.

Uses vnstock_pipeline premium package when available, falls back to polling.
"""

import asyncio
import logging
from datetime import datetime
from typing import Optional, List, Callable

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import async_session_maker
from vnibb.core.config import settings
from vnibb.models.trading import IntradayTrade, OrderbookSnapshot
from vnibb.models.stock import StockPrice, StockIndex

logger = logging.getLogger(__name__)


class RealtimePipeline:
    """
    Real-time data streaming manager.
    
    Uses vnstock_pipeline WebSocket for live data during market hours.
    Stores snapshots in PostgreSQL for historical analysis.
    
    Data types supported:
    - stockps: Stock price updates
    - index: Market index updates (VNINDEX, HNXINDEX, etc.)
    - board: Order board data
    - boardps: Order board price updates
    - aggregatemarket: Market aggregate data
    """
    
    # Default symbols for real-time tracking
    DEFAULT_SYMBOLS = [
        "FPT", "VNM", "VCB", "MBB", "TCB", "HPG", "VIC", "VHM",
        "MSN", "VRE", "PLX", "GAS", "SAB", "BID", "CTG", "ACB",
        "STB", "SSI", "VCI", "HCM", "VND", "SHS", "MWG", "PNJ",
    ]
    
    def __init__(self, data_path: str = "./data"):
        self.data_path = data_path
        self.is_running = False
        self._task: Optional[asyncio.Task] = None
        self._pipeline_available = False
        self._check_pipeline()
    
    def _check_pipeline(self):
        """Check if vnstock_pipeline is available."""
        try:
            from vnstock_pipeline.wss import MarketStreamClient
            self._pipeline_available = True
            logger.info("vnstock_pipeline premium package detected")
        except ImportError:
            logger.warning(
                "vnstock_pipeline not installed. Real-time will use polling fallback."
            )
    
    async def start_streaming(
        self,
        data_types: Optional[List[str]] = None,
        symbols: Optional[List[str]] = None,
    ):
        """
        Start WebSocket streaming for specified data types.
        
        Args:
            data_types: List of data types to stream
                       (stockps, index, board, boardps, aggregatemarket)
            symbols: List of symbols to track (for polling fallback)
        """
        if data_types is None:
            data_types = ["stockps", "index", "board"]
        
        if symbols is None:
            symbols = self.DEFAULT_SYMBOLS
        
        logger.info(f"Starting real-time streaming for: {data_types}")
        self.is_running = True
        
        if self._pipeline_available:
            await self._start_websocket_streaming(data_types)
        else:
            await self._polling_fallback(symbols)
    
    async def _start_websocket_streaming(self, data_types: List[str]):
        """Start streaming using vnstock_pipeline WebSocket."""
        try:
            from vnstock_pipeline.wss import MarketStreamClient
            
            def _sync_stream():
                client = MarketStreamClient(
                    data_path=self.data_path,
                    data_types=data_types,
                )
                # This is a blocking call that runs until stop
                client.start()
            
            # Run in thread pool
            self._task = asyncio.create_task(
                asyncio.to_thread(_sync_stream)
            )
            
            logger.info("WebSocket streaming started")
            
        except Exception as e:
            logger.error(f"WebSocket streaming failed: {e}")
            # Fall back to polling
            await self._polling_fallback(self.DEFAULT_SYMBOLS)
    
    async def _on_data_received(self, data_type: str, data: dict):
        """Callback for incoming WebSocket data."""
        try:
            async with async_session_maker() as session:
                if data_type == "stockps":
                    await self._store_stock_price(session, data)
                elif data_type == "index":
                    await self._store_index(session, data)
                elif data_type in ("board", "boardps"):
                    await self._store_orderbook(session, data)
                
                await session.commit()
        except Exception as e:
            logger.error(f"Failed to store {data_type} data: {e}")
    
    async def _store_stock_price(self, session: AsyncSession, data: dict):
        """Store real-time stock price snapshot."""
        symbol = data.get("symbol", data.get("code", ""))
        if not symbol:
            return
        
        stmt = pg_insert(IntradayTrade).values(
            symbol=symbol.upper(),
            trade_time=datetime.now(),
            price=float(data.get("price", data.get("close", 0))),
            volume=int(data.get("volume", data.get("vol", 0))),
            match_type=data.get("side", data.get("type", "unknown")),
        ).on_conflict_do_nothing()
        
        await session.execute(stmt)
    
    async def _store_index(self, session: AsyncSession, data: dict):
        """Store index data (VNINDEX, HNXINDEX, etc)."""
        index_code = data.get("code", data.get("symbol", ""))
        if not index_code:
            return
        
        stmt = pg_insert(StockIndex).values(
            index_code=index_code.upper(),
            time=datetime.now(),
            value=float(data.get("value", data.get("close", 0))),
            change=float(data.get("change", 0)),
            change_percent=float(data.get("changePct", data.get("change_pct", 0))),
            volume=int(data.get("volume", data.get("vol", 0))),
        ).on_conflict_do_nothing()
        
        await session.execute(stmt)
    
    async def _store_orderbook(self, session: AsyncSession, data: dict):
        """Store order book snapshot."""
        symbol = data.get("symbol", data.get("code", ""))
        if not symbol:
            return
        
        stmt = pg_insert(OrderbookSnapshot).values(
            symbol=symbol.upper(),
            snapshot_time=datetime.now(),
            bid1_price=float(data.get("bid1", data.get("bidPrice1", 0))),
            bid1_volume=int(data.get("bid1_vol", data.get("bidVol1", 0))),
            bid2_price=float(data.get("bid2", data.get("bidPrice2", 0))),
            bid2_volume=int(data.get("bid2_vol", data.get("bidVol2", 0))),
            bid3_price=float(data.get("bid3", data.get("bidPrice3", 0))),
            bid3_volume=int(data.get("bid3_vol", data.get("bidVol3", 0))),
            ask1_price=float(data.get("ask1", data.get("offerPrice1", 0))),
            ask1_volume=int(data.get("ask1_vol", data.get("offerVol1", 0))),
            ask2_price=float(data.get("ask2", data.get("offerPrice2", 0))),
            ask2_volume=int(data.get("ask2_vol", data.get("offerVol2", 0))),
            ask3_price=float(data.get("ask3", data.get("offerPrice3", 0))),
            ask3_volume=int(data.get("ask3_vol", data.get("offerVol3", 0))),
            price_depth=data,  # Store full order book as JSON
        ).on_conflict_do_nothing()
        
        await session.execute(stmt)
    
    async def _polling_fallback(self, symbols: List[str]):
        """Fallback to polling if WebSocket not available."""
        from vnstock import Trading
        
        logger.info(f"Starting polling fallback for {len(symbols)} symbols")
        
        while self.is_running:
            try:
                trading = Trading()
                df = trading.price_board(symbols_list=symbols)
                
                if df is not None and not df.empty:
                    async with async_session_maker() as session:
                        for _, row in df.iterrows():
                            await self._store_stock_price(session, row.to_dict())
                        await session.commit()
                    
                    logger.debug(f"Polled {len(df)} price updates")
                
            except Exception as e:
                logger.error(f"Polling fallback error: {e}")
            
            # 5 second interval for polling
            await asyncio.sleep(5)
    
    async def stop_streaming(self):
        """Stop real-time streaming."""
        self.is_running = False
        
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        
        logger.info("Real-time streaming stopped")
    
    def get_status(self) -> dict:
        """Get current streaming status."""
        return {
            "is_running": self.is_running,
            "pipeline_available": self._pipeline_available,
            "data_path": self.data_path,
        }


# Lazy-loaded singleton
_realtime_pipeline: Optional[RealtimePipeline] = None

def get_realtime_pipeline(data_path: str = "./data") -> RealtimePipeline:
    """Lazy-load the RealtimePipeline to avoid import-time blocking."""
    global _realtime_pipeline
    if _realtime_pipeline is None:
        _realtime_pipeline = RealtimePipeline(data_path=data_path)
    return _realtime_pipeline

