"""
Technical Analysis Service using vnstock_ta

Calculates and stores technical indicators for stocks.
Supports: SMA, EMA, RSI, MACD, Bollinger Bands, Stochastic, ATR, Fibonacci, Support/Resistance.

Uses vnstock_ta premium package when available, falls back to pandas calculations.
"""

import logging
from datetime import date, datetime, timedelta
from typing import Optional, Dict, Any, List, Literal

import numpy as np
import pandas as pd
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.config import settings
from vnibb.core.database import async_session_maker

from vnibb.models.technical_indicator import TechnicalIndicator

logger = logging.getLogger(__name__)

# Type aliases
Timeframe = Literal["D", "W", "M"]
Signal = Literal["strong_buy", "buy", "neutral", "sell", "strong_sell"]


class TechnicalAnalysisService:
    """
    Technical analysis calculations using vnstock_ta.

    Provides methods for calculating and storing technical indicators.
    Falls back to pandas-based calculations if vnstock_ta is not available.
    """

    def __init__(self):
        self._ta_available = False
        self._check_vnstock_ta()

    def _check_vnstock_ta(self):
        """Check if vnstock_ta is available."""
        try:
            from vnstock_ta import DataSource, Indicator

            self._ta_available = True
            logger.info("vnstock_ta premium package detected")
        except Exception as exc:
            self._ta_available = False
            logger.warning(
                "vnstock_ta unavailable (%s). Using fallback calculations.",
                exc,
            )

    async def calculate_indicators(
        self,
        symbol: str,
        start_date: date,
        end_date: date,
    ) -> Dict[str, Any]:
        """
        Calculate all technical indicators for a symbol.

        Args:
            symbol: Stock symbol
            start_date: Start date for historical data
            end_date: End date for historical data

        Returns:
            Dictionary of indicator values
        """
        if self._ta_available:
            return await self._calculate_with_vnstock_ta(symbol, start_date, end_date)
        else:
            return await self._calculate_fallback(symbol, start_date, end_date)

    async def _calculate_with_vnstock_ta(
        self,
        symbol: str,
        start_date: date,
        end_date: date,
    ) -> Dict[str, Any]:
        """Calculate using vnstock_ta premium package."""
        import asyncio

        def _sync_calculate():
            from vnstock_ta import DataSource, Indicator

            # Get OHLCV data
            data = DataSource(
                symbol=symbol,
                start=start_date.strftime("%Y-%m-%d"),
                end=end_date.strftime("%Y-%m-%d"),
                interval="1D",
                source=settings.vnstock_source,
            ).get_data()

            if data is None or data.empty:
                return {}

            # Initialize indicator calculator
            ta = Indicator(data)

            indicators = {}

            # Moving Averages
            try:
                if len(data) >= 20:
                    indicators["sma_20"] = float(ta.sma(length=20).iloc[-1])
                if len(data) >= 50:
                    indicators["sma_50"] = float(ta.sma(length=50).iloc[-1])
                if len(data) >= 200:
                    indicators["sma_200"] = float(ta.sma(length=200).iloc[-1])
                if len(data) >= 12:
                    indicators["ema_12"] = float(ta.ema(length=12).iloc[-1])
                if len(data) >= 26:
                    indicators["ema_26"] = float(ta.ema(length=26).iloc[-1])
            except Exception as e:
                logger.warning(f"MA calculation error for {symbol}: {e}")

            # RSI
            try:
                if len(data) >= 14:
                    rsi = ta.rsi(length=14)
                    if rsi is not None and len(rsi) > 0:
                        indicators["rsi_14"] = float(rsi.iloc[-1])
            except Exception as e:
                logger.warning(f"RSI calculation error for {symbol}: {e}")

            # MACD
            try:
                if len(data) >= 26:
                    macd_df = ta.macd(fast=12, slow=26, signal=9)
                    if isinstance(macd_df, pd.DataFrame) and len(macd_df) > 0:
                        indicators["macd"] = float(macd_df["MACD_12_26_9"].iloc[-1])
                        indicators["macd_signal"] = float(macd_df["MACDs_12_26_9"].iloc[-1])
                        indicators["macd_hist"] = float(macd_df["MACDh_12_26_9"].iloc[-1])
            except Exception as e:
                logger.warning(f"MACD calculation error for {symbol}: {e}")

            # Bollinger Bands
            try:
                if len(data) >= 20:
                    bb_df = ta.bbands(length=20, std=2)
                    if isinstance(bb_df, pd.DataFrame) and len(bb_df) > 0:
                        indicators["bb_upper"] = float(bb_df["BBU_20_2.0"].iloc[-1])
                        indicators["bb_middle"] = float(bb_df["BBM_20_2.0"].iloc[-1])
                        indicators["bb_lower"] = float(bb_df["BBL_20_2.0"].iloc[-1])
            except Exception as e:
                logger.warning(f"Bollinger Bands calculation error for {symbol}: {e}")

            # ATR
            try:
                if len(data) >= 14:
                    atr = ta.atr(length=14)
                    if atr is not None and len(atr) > 0:
                        indicators["atr_14"] = float(atr.iloc[-1])
            except Exception as e:
                logger.warning(f"ATR calculation error for {symbol}: {e}")

            return indicators

        # Run in thread pool to avoid blocking
        return await asyncio.to_thread(_sync_calculate)

    async def _calculate_fallback(
        self,
        symbol: str,
        start_date: date,
        end_date: date,
    ) -> Dict[str, Any]:
        """Fallback calculations using basic vnstock and pandas."""
        import asyncio

        def _sync_calculate():
            from vnstock import Vnstock

            stock = Vnstock().stock(symbol=symbol, source=settings.vnstock_source)

            df = stock.quote.history(
                start=start_date.strftime("%Y-%m-%d"),
                end=end_date.strftime("%Y-%m-%d"),
            )

            if df is None or df.empty:
                return {}

            close = df["close"]
            high = df["high"]
            low = df["low"]
            volume = df["volume"]

            indicators = {}

            # SMA
            if len(close) >= 20:
                indicators["sma_20"] = float(close.rolling(20).mean().iloc[-1])
            if len(close) >= 50:
                indicators["sma_50"] = float(close.rolling(50).mean().iloc[-1])
            if len(close) >= 200:
                indicators["sma_200"] = float(close.rolling(200).mean().iloc[-1])

            # EMA
            if len(close) >= 12:
                indicators["ema_12"] = float(close.ewm(span=12, adjust=False).mean().iloc[-1])
            if len(close) >= 26:
                indicators["ema_26"] = float(close.ewm(span=26, adjust=False).mean().iloc[-1])

            # RSI
            if len(close) >= 14:
                delta = close.diff()
                gain = delta.where(delta > 0, 0).rolling(14).mean()
                loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
                rs = gain / loss
                rsi = 100 - (100 / (1 + rs))
                indicators["rsi_14"] = float(rsi.iloc[-1])

            # MACD
            if len(close) >= 26:
                ema_12 = close.ewm(span=12, adjust=False).mean()
                ema_26 = close.ewm(span=26, adjust=False).mean()
                macd_line = ema_12 - ema_26
                signal_line = macd_line.ewm(span=9, adjust=False).mean()
                indicators["macd"] = float(macd_line.iloc[-1])
                indicators["macd_signal"] = float(signal_line.iloc[-1])
                indicators["macd_hist"] = float((macd_line - signal_line).iloc[-1])

            # Bollinger Bands
            if len(close) >= 20:
                sma_20 = close.rolling(20).mean()
                std_20 = close.rolling(20).std()
                indicators["bb_upper"] = float((sma_20 + 2 * std_20).iloc[-1])
                indicators["bb_middle"] = float(sma_20.iloc[-1])
                indicators["bb_lower"] = float((sma_20 - 2 * std_20).iloc[-1])

            # ATR (Average True Range)
            if len(close) >= 14:
                tr1 = high - low
                tr2 = abs(high - close.shift())
                tr3 = abs(low - close.shift())
                tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
                atr = tr.rolling(14).mean()
                indicators["atr_14"] = float(atr.iloc[-1])

            return indicators

        # Run in thread pool
        import asyncio

        return await asyncio.to_thread(_sync_calculate)

    async def store_indicators(
        self,
        symbol: str,
        calc_date: date,
        indicators: Dict[str, Any],
    ):
        """Store calculated indicators in database."""
        if not indicators:
            return

        async with async_session_maker() as session:
            # Clean NaN values
            clean_indicators = {
                k: v
                for k, v in indicators.items()
                if v is not None and not (isinstance(v, float) and pd.isna(v))
            }

            stmt = (
                pg_insert(TechnicalIndicator)
                .values(
                    symbol=symbol,
                    calc_date=calc_date,
                    **clean_indicators,
                )
                .on_conflict_do_update(
                    constraint="uq_technical_indicator_symbol_date",
                    set_=clean_indicators,
                )
            )

            await session.execute(stmt)
            await session.commit()
            logger.debug(f"Stored TA indicators for {symbol}")

    async def get_indicators(
        self,
        symbol: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> List[Dict[str, Any]]:
        """Get stored indicators from database."""
        async with async_session_maker() as session:
            query = select(TechnicalIndicator).where(TechnicalIndicator.symbol == symbol.upper())

            if start_date:
                query = query.where(TechnicalIndicator.calc_date >= start_date)
            if end_date:
                query = query.where(TechnicalIndicator.calc_date <= end_date)

            query = query.order_by(TechnicalIndicator.calc_date.desc())

            result = await session.execute(query)
            indicators = result.scalars().all()

            return [ind.to_dict() for ind in indicators]

    # =========================================================================
    # NEW: Full Technical Analysis Methods
    # =========================================================================

    async def get_ohlcv_data(
        self,
        symbol: str,
        start_date: date,
        end_date: date,
        interval: str = "1D",
    ) -> Optional[pd.DataFrame]:
        """Fetch OHLCV data for a symbol. Returns None if no data."""
        import asyncio

        def _fetch():
            try:
                from vnstock import Vnstock

                stock = Vnstock().stock(symbol=symbol, source=settings.vnstock_source)

                df = stock.quote.history(
                    start=start_date.strftime("%Y-%m-%d"),
                    end=end_date.strftime("%Y-%m-%d"),
                    interval=interval,
                )
                return df if df is not None and not df.empty else None
            except Exception as e:
                logger.error(f"Failed to fetch OHLCV for {symbol}: {e}")
                return None

        return await asyncio.to_thread(_fetch)

    async def get_moving_averages(
        self,
        symbol: str,
        periods: List[int] = [10, 20, 50, 200],
        lookback_days: int = 250,
    ) -> Dict[str, Any]:
        """Calculate SMA and EMA for multiple periods."""
        end_date = date.today()
        start_date = end_date - timedelta(days=lookback_days)

        df = await self.get_ohlcv_data(symbol, start_date, end_date)
        if df is None:
            return {"sma": {}, "ema": {}, "signals": {}}

        close = df["close"]
        current_price = float(close.iloc[-1])

        result = {"sma": {}, "ema": {}, "signals": {}}

        for period in periods:
            if len(close) >= period:
                sma_val = float(close.rolling(period).mean().iloc[-1])
                ema_val = float(close.ewm(span=period, adjust=False).mean().iloc[-1])

                result["sma"][f"sma_{period}"] = sma_val
                result["ema"][f"ema_{period}"] = ema_val

                # Signal: price above MA = buy, below = sell
                sma_signal = "buy" if current_price > sma_val else "sell"
                ema_signal = "buy" if current_price > ema_val else "sell"
                result["signals"][f"sma_{period}"] = sma_signal
                result["signals"][f"ema_{period}"] = ema_signal

        result["current_price"] = current_price
        return result

    async def get_rsi(
        self,
        symbol: str,
        period: int = 14,
        lookback_days: int = 100,
    ) -> Dict[str, Any]:
        """Calculate RSI with overbought/oversold zones."""
        end_date = date.today()
        start_date = end_date - timedelta(days=lookback_days)

        df = await self.get_ohlcv_data(symbol, start_date, end_date)
        if df is None or len(df) < period + 1:
            return {"value": None, "signal": "neutral", "zone": "neutral"}

        close = df["close"]
        delta = close.diff()
        gain = delta.where(delta > 0, 0).rolling(period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(period).mean()

        rs = gain / loss.replace(0, np.nan)
        rsi = 100 - (100 / (1 + rs))
        rsi_value = float(rsi.iloc[-1]) if not pd.isna(rsi.iloc[-1]) else None

        if rsi_value is None:
            return {"value": None, "signal": "neutral", "zone": "neutral"}

        # Determine zone and signal
        if rsi_value >= 70:
            zone = "overbought"
            signal = "sell"
        elif rsi_value <= 30:
            zone = "oversold"
            signal = "buy"
        elif rsi_value >= 60:
            zone = "bullish"
            signal = "neutral"
        elif rsi_value <= 40:
            zone = "bearish"
            signal = "neutral"
        else:
            zone = "neutral"
            signal = "neutral"

        return {
            "value": round(rsi_value, 2),
            "signal": signal,
            "zone": zone,
            "period": period,
        }

    async def get_macd(
        self,
        symbol: str,
        fast: int = 12,
        slow: int = 26,
        signal_period: int = 9,
        lookback_days: int = 100,
    ) -> Dict[str, Any]:
        """Calculate MACD with histogram."""
        end_date = date.today()
        start_date = end_date - timedelta(days=lookback_days)

        df = await self.get_ohlcv_data(symbol, start_date, end_date)
        if df is None or len(df) < slow:
            return {"macd": None, "signal_line": None, "histogram": None, "signal": "neutral"}

        close = df["close"]
        ema_fast = close.ewm(span=fast, adjust=False).mean()
        ema_slow = close.ewm(span=slow, adjust=False).mean()
        macd_line = ema_fast - ema_slow
        signal_line = macd_line.ewm(span=signal_period, adjust=False).mean()
        histogram = macd_line - signal_line

        macd_val = float(macd_line.iloc[-1])
        signal_val = float(signal_line.iloc[-1])
        hist_val = float(histogram.iloc[-1])

        # Previous values for crossover detection
        prev_macd = float(macd_line.iloc[-2]) if len(macd_line) > 1 else macd_val
        prev_signal = float(signal_line.iloc[-2]) if len(signal_line) > 1 else signal_val

        # Signal logic
        if macd_val > signal_val and prev_macd <= prev_signal:
            signal = "buy"  # Bullish crossover
        elif macd_val < signal_val and prev_macd >= prev_signal:
            signal = "sell"  # Bearish crossover
        elif macd_val > signal_val:
            signal = "buy"
        elif macd_val < signal_val:
            signal = "sell"
        else:
            signal = "neutral"

        return {
            "macd": round(macd_val, 4),
            "signal_line": round(signal_val, 4),
            "histogram": round(hist_val, 4),
            "signal": signal,
            "params": {"fast": fast, "slow": slow, "signal": signal_period},
        }

    async def get_bollinger_bands(
        self,
        symbol: str,
        period: int = 20,
        std_dev: int = 2,
        lookback_days: int = 100,
    ) -> Dict[str, Any]:
        """Calculate Bollinger Bands."""
        end_date = date.today()
        start_date = end_date - timedelta(days=lookback_days)

        df = await self.get_ohlcv_data(symbol, start_date, end_date)
        if df is None or len(df) < period:
            return {"upper": None, "middle": None, "lower": None, "signal": "neutral"}

        close = df["close"]
        current_price = float(close.iloc[-1])

        sma = close.rolling(period).mean()
        std = close.rolling(period).std()

        upper = sma + (std_dev * std)
        lower = sma - (std_dev * std)

        upper_val = float(upper.iloc[-1])
        middle_val = float(sma.iloc[-1])
        lower_val = float(lower.iloc[-1])

        # Calculate %B (position within bands)
        percent_b = (
            (current_price - lower_val) / (upper_val - lower_val) if upper_val != lower_val else 0.5
        )

        # Signal logic
        if current_price >= upper_val:
            signal = "sell"  # Price at upper band - overbought
        elif current_price <= lower_val:
            signal = "buy"  # Price at lower band - oversold
        else:
            signal = "neutral"

        return {
            "upper": round(upper_val, 2),
            "middle": round(middle_val, 2),
            "lower": round(lower_val, 2),
            "current_price": round(current_price, 2),
            "percent_b": round(percent_b, 4),
            "signal": signal,
            "params": {"period": period, "std_dev": std_dev},
        }

    async def get_stochastic(
        self,
        symbol: str,
        k_period: int = 14,
        d_period: int = 3,
        lookback_days: int = 100,
    ) -> Dict[str, Any]:
        """Calculate Stochastic Oscillator (%K and %D)."""
        end_date = date.today()
        start_date = end_date - timedelta(days=lookback_days)

        df = await self.get_ohlcv_data(symbol, start_date, end_date)
        if df is None or len(df) < k_period:
            return {"k": None, "d": None, "signal": "neutral"}

        high = df["high"]
        low = df["low"]
        close = df["close"]

        lowest_low = low.rolling(k_period).min()
        highest_high = high.rolling(k_period).max()

        k = 100 * (close - lowest_low) / (highest_high - lowest_low)
        d = k.rolling(d_period).mean()

        k_val = float(k.iloc[-1]) if not pd.isna(k.iloc[-1]) else None
        d_val = float(d.iloc[-1]) if not pd.isna(d.iloc[-1]) else None

        if k_val is None:
            return {"k": None, "d": None, "signal": "neutral"}

        # Signal logic
        if k_val >= 80:
            signal = "sell"  # Overbought
        elif k_val <= 20:
            signal = "buy"  # Oversold
        elif k_val > d_val:
            signal = "buy"
        elif k_val < d_val:
            signal = "sell"
        else:
            signal = "neutral"

        return {
            "k": round(k_val, 2),
            "d": round(d_val, 2) if d_val else None,
            "signal": signal,
            "params": {"k_period": k_period, "d_period": d_period},
        }

    async def get_support_resistance(
        self,
        symbol: str,
        lookback_days: int = 100,
        num_levels: int = 3,
    ) -> Dict[str, Any]:
        """Auto-detect support and resistance levels using pivot points."""
        end_date = date.today()
        start_date = end_date - timedelta(days=lookback_days)

        df = await self.get_ohlcv_data(symbol, start_date, end_date)
        if df is None or len(df) < 20:
            return {"support": [], "resistance": [], "current_price": None}

        high = df["high"]
        low = df["low"]
        close = df["close"]
        current_price = float(close.iloc[-1])

        # Find local minima (support) and maxima (resistance)
        window = 5
        supports = []
        resistances = []

        for i in range(window, len(df) - window):
            # Local minimum (support)
            if low.iloc[i] == low.iloc[i - window : i + window + 1].min():
                supports.append(float(low.iloc[i]))
            # Local maximum (resistance)
            if high.iloc[i] == high.iloc[i - window : i + window + 1].max():
                resistances.append(float(high.iloc[i]))

        # Cluster nearby levels and take the most significant ones
        def cluster_levels(levels: List[float], threshold: float = 0.02) -> List[float]:
            if not levels:
                return []
            levels = sorted(set(levels))
            clustered = []
            current_cluster = [levels[0]]

            for level in levels[1:]:
                if (level - current_cluster[-1]) / current_cluster[-1] < threshold:
                    current_cluster.append(level)
                else:
                    clustered.append(sum(current_cluster) / len(current_cluster))
                    current_cluster = [level]
            clustered.append(sum(current_cluster) / len(current_cluster))
            return clustered

        support_levels = cluster_levels(supports)
        resistance_levels = cluster_levels(resistances)

        # Filter: supports below current price, resistances above
        support_levels = sorted([s for s in support_levels if s < current_price], reverse=True)[
            :num_levels
        ]
        resistance_levels = sorted([r for r in resistance_levels if r > current_price])[:num_levels]

        # Calculate proximity to nearest levels
        nearest_support = support_levels[0] if support_levels else None
        nearest_resistance = resistance_levels[0] if resistance_levels else None

        support_proximity = (
            ((current_price - nearest_support) / current_price * 100) if nearest_support else None
        )
        resistance_proximity = (
            ((nearest_resistance - current_price) / current_price * 100)
            if nearest_resistance
            else None
        )

        return {
            "support": [round(s, 2) for s in support_levels],
            "resistance": [round(r, 2) for r in resistance_levels],
            "current_price": round(current_price, 2),
            "nearest_support": round(nearest_support, 2) if nearest_support else None,
            "nearest_resistance": round(nearest_resistance, 2) if nearest_resistance else None,
            "support_proximity_pct": round(support_proximity, 2) if support_proximity else None,
            "resistance_proximity_pct": round(resistance_proximity, 2)
            if resistance_proximity
            else None,
        }

    async def get_fibonacci_levels(
        self,
        symbol: str,
        lookback_days: int = 100,
    ) -> Dict[str, Any]:
        """Calculate Fibonacci retracement levels."""
        end_date = date.today()
        start_date = end_date - timedelta(days=lookback_days)

        df = await self.get_ohlcv_data(symbol, start_date, end_date)
        if df is None or len(df) < 10:
            return {"levels": {}, "trend": "unknown"}

        high = df["high"]
        low = df["low"]
        close = df["close"]

        period_high = float(high.max())
        period_low = float(low.min())
        current_price = float(close.iloc[-1])

        # Determine trend direction
        mid_point = len(df) // 2
        first_half_avg = float(close.iloc[:mid_point].mean())
        second_half_avg = float(close.iloc[mid_point:].mean())
        trend = "uptrend" if second_half_avg > first_half_avg else "downtrend"

        diff = period_high - period_low

        # Fibonacci ratios
        fib_ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

        if trend == "uptrend":
            # Retracement from high
            levels = {f"{int(r * 100)}%": round(period_high - (diff * r), 2) for r in fib_ratios}
        else:
            # Retracement from low
            levels = {f"{int(r * 100)}%": round(period_low + (diff * r), 2) for r in fib_ratios}

        return {
            "levels": levels,
            "period_high": round(period_high, 2),
            "period_low": round(period_low, 2),
            "current_price": round(current_price, 2),
            "trend": trend,
            "lookback_days": lookback_days,
        }

    async def get_adx(
        self,
        symbol: str,
        period: int = 14,
        lookback_days: int = 100,
    ) -> Dict[str, Any]:
        """Calculate ADX (Average Directional Index) for trend strength."""
        end_date = date.today()
        start_date = end_date - timedelta(days=lookback_days)

        df = await self.get_ohlcv_data(symbol, start_date, end_date)
        if df is None or len(df) < period * 2:
            return {"adx": None, "plus_di": None, "minus_di": None, "trend_strength": "unknown"}

        high = df["high"]
        low = df["low"]
        close = df["close"]

        # True Range
        tr1 = high - low
        tr2 = abs(high - close.shift())
        tr3 = abs(low - close.shift())
        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
        atr = tr.rolling(period).mean()

        # Directional Movement
        plus_dm = high.diff()
        minus_dm = -low.diff()
        plus_dm = plus_dm.where((plus_dm > minus_dm) & (plus_dm > 0), 0)
        minus_dm = minus_dm.where((minus_dm > plus_dm) & (minus_dm > 0), 0)

        # Smoothed DI
        plus_di = 100 * (plus_dm.rolling(period).mean() / atr)
        minus_di = 100 * (minus_dm.rolling(period).mean() / atr)

        # DX and ADX
        dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di)
        adx = dx.rolling(period).mean()

        adx_val = float(adx.iloc[-1]) if not pd.isna(adx.iloc[-1]) else None
        plus_di_val = float(plus_di.iloc[-1]) if not pd.isna(plus_di.iloc[-1]) else None
        minus_di_val = float(minus_di.iloc[-1]) if not pd.isna(minus_di.iloc[-1]) else None

        # Trend strength interpretation
        if adx_val is None:
            trend_strength = "unknown"
        elif adx_val >= 50:
            trend_strength = "very_strong"
        elif adx_val >= 25:
            trend_strength = "strong"
        elif adx_val >= 20:
            trend_strength = "moderate"
        else:
            trend_strength = "weak"

        # Signal based on DI crossover
        if plus_di_val and minus_di_val:
            if plus_di_val > minus_di_val:
                signal = "buy"
            elif minus_di_val > plus_di_val:
                signal = "sell"
            else:
                signal = "neutral"
        else:
            signal = "neutral"

        return {
            "adx": round(adx_val, 2) if adx_val else None,
            "plus_di": round(plus_di_val, 2) if plus_di_val else None,
            "minus_di": round(minus_di_val, 2) if minus_di_val else None,
            "trend_strength": trend_strength,
            "signal": signal,
        }

    async def get_volume_analysis(
        self,
        symbol: str,
        period: int = 20,
        lookback_days: int = 100,
    ) -> Dict[str, Any]:
        """Analyze volume patterns and moving averages."""
        end_date = date.today()
        start_date = end_date - timedelta(days=lookback_days)

        df = await self.get_ohlcv_data(symbol, start_date, end_date)
        if df is None or len(df) < period:
            return {"volume": None, "volume_ma": None, "relative_volume": None, "signal": "neutral"}

        volume = df["volume"]
        current_volume = float(volume.iloc[-1])
        volume_ma = volume.rolling(period).mean()
        current_ma = float(volume_ma.iloc[-1])

        # Relative Volume (ratio of current volume to MA)
        relative_volume = current_volume / current_ma if current_ma > 0 else 1.0

        # Volume Trend (current volume vs previous few days)
        # Signal logic
        if relative_volume > 2.0:
            volume_desc = "unusually_high"
            signal = "buy"  # High volume often precedes/confirms moves
        elif relative_volume > 1.5:
            volume_desc = "high"
            signal = "buy"
        elif relative_volume < 0.5:
            volume_desc = "low"
            signal = "neutral"
        else:
            volume_desc = "normal"
            signal = "neutral"

        return {
            "volume": int(current_volume),
            "volume_ma": int(current_ma),
            "relative_volume": round(relative_volume, 2),
            "volume_desc": volume_desc,
            "signal": signal,
            "params": {"period": period},
        }

    async def get_ichimoku_cloud(
        self,
        symbol: str,
        tenkan_period: int = 9,
        kijun_period: int = 26,
        senkou_b_period: int = 52,
        displacement: int = 26,
        lookback_days: int = 200,
    ) -> Dict[str, Any]:
        """Calculate Ichimoku Cloud levels."""
        end_date = date.today()
        start_date = end_date - timedelta(days=lookback_days + displacement)

        df = await self.get_ohlcv_data(symbol, start_date, end_date)
        if df is None or len(df) < senkou_b_period:
            return {
                "tenkan_sen": None,
                "kijun_sen": None,
                "senkou_span_a": None,
                "senkou_span_b": None,
                "chikou_span": None,
            }

        high = df["high"]
        low = df["low"]
        close = df["close"]

        # Tenkan-sen (Conversion Line): (9-period high + 9-period low) / 2
        nine_period_high = high.rolling(window=tenkan_period).max()
        nine_period_low = low.rolling(window=tenkan_period).min()
        tenkan_sen = (nine_period_high + nine_period_low) / 2

        # Kijun-sen (Base Line): (26-period high + 26-period low) / 2
        period26_high = high.rolling(window=kijun_period).max()
        period26_low = low.rolling(window=kijun_period).min()
        kijun_sen = (period26_high + period26_low) / 2

        # Senkou Span A (Leading Span A): (Conversion Line + Base Line) / 2
        senkou_span_a = ((tenkan_sen + kijun_sen) / 2).shift(displacement)

        # Senkou Span B (Leading Span B): (52-period high + 52-period low) / 2
        period52_high = high.rolling(window=senkou_b_period).max()
        period52_low = low.rolling(window=senkou_b_period).min()
        senkou_span_b = ((period52_high + period52_low) / 2).shift(displacement)

        # Chikou Span (Lagging Span): Current close shifted back 26 periods
        chikou_span = close.shift(-displacement)

        return {
            "tenkan_sen": round(float(tenkan_sen.iloc[-1]), 2)
            if not pd.isna(tenkan_sen.iloc[-1])
            else None,
            "kijun_sen": round(float(kijun_sen.iloc[-1]), 2)
            if not pd.isna(kijun_sen.iloc[-1])
            else None,
            "senkou_span_a": round(float(senkou_span_a.iloc[-1]), 2)
            if not pd.isna(senkou_span_a.iloc[-1])
            else None,
            "senkou_span_b": round(float(senkou_span_b.iloc[-1]), 2)
            if not pd.isna(senkou_span_b.iloc[-1])
            else None,
            "chikou_span": round(float(chikou_span.iloc[-displacement - 1]), 2)
            if len(chikou_span) > displacement
            else None,
            "params": {
                "tenkan": tenkan_period,
                "kijun": kijun_period,
                "senkou_b": senkou_b_period,
                "displacement": displacement,
            },
        }

    async def get_signal_summary(
        self,
        symbol: str,
        lookback_days: int = 200,
    ) -> Dict[str, Any]:
        """Aggregate all indicators into a buy/sell signal summary."""
        # Fetch all indicators in parallel
        import asyncio

        ma_task = self.get_moving_averages(symbol, [10, 20, 50, 200], lookback_days)
        rsi_task = self.get_rsi(symbol, 14, lookback_days)
        macd_task = self.get_macd(symbol, 12, 26, 9, lookback_days)
        bb_task = self.get_bollinger_bands(symbol, 20, 2, lookback_days)
        stoch_task = self.get_stochastic(symbol, 14, 3, lookback_days)
        adx_task = self.get_adx(symbol, 14, lookback_days)
        volume_task = self.get_volume_analysis(symbol, 20, lookback_days)

        ma, rsi, macd, bb, stoch, adx, vol = await asyncio.gather(
            ma_task, rsi_task, macd_task, bb_task, stoch_task, adx_task, volume_task
        )

        # Collect all signals
        signals = []
        indicator_details = []

        # Moving Average signals
        for key, signal in ma.get("signals", {}).items():
            signals.append(signal)
            indicator_details.append(
                {
                    "name": key.upper().replace("_", " "),
                    "value": ma.get("sma" if "sma" in key else "ema", {}).get(key),
                    "signal": signal,
                }
            )

        # RSI
        if rsi.get("value"):
            signals.append(rsi["signal"])
            indicator_details.append(
                {
                    "name": f"RSI ({rsi.get('period', 14)})",
                    "value": rsi["value"],
                    "signal": rsi["signal"],
                }
            )

        # MACD
        if macd.get("macd"):
            signals.append(macd["signal"])
            indicator_details.append(
                {
                    "name": "MACD",
                    "value": macd["histogram"],
                    "signal": macd["signal"],
                }
            )

        # Bollinger Bands
        if bb.get("upper"):
            signals.append(bb["signal"])
            indicator_details.append(
                {
                    "name": "Bollinger Bands",
                    "value": f"{bb['percent_b']:.2%}",
                    "signal": bb["signal"],
                }
            )

        # Stochastic
        if stoch.get("k"):
            signals.append(stoch["signal"])
            indicator_details.append(
                {
                    "name": "Stochastic",
                    "value": stoch["k"],
                    "signal": stoch["signal"],
                }
            )

        # ADX
        if adx.get("adx"):
            signals.append(adx["signal"])
            indicator_details.append(
                {
                    "name": "ADX",
                    "value": adx["adx"],
                    "signal": adx["signal"],
                }
            )

        # Volume
        if vol.get("volume"):
            signals.append(vol["signal"])
            indicator_details.append(
                {
                    "name": "Volume",
                    "value": f"{vol['relative_volume']}x",
                    "signal": vol["signal"],
                }
            )

        # Aggregate signals
        buy_count = signals.count("buy")
        sell_count = signals.count("sell")
        neutral_count = signals.count("neutral")
        total = len(signals)

        # Determine overall signal
        if total == 0:
            overall_signal = "neutral"
        elif buy_count >= total * 0.7:
            overall_signal = "strong_buy"
        elif buy_count > sell_count:
            overall_signal = "buy"
        elif sell_count >= total * 0.7:
            overall_signal = "strong_sell"
        elif sell_count > buy_count:
            overall_signal = "sell"
        else:
            overall_signal = "neutral"

        return {
            "symbol": symbol.upper(),
            "overall_signal": overall_signal,
            "buy_count": buy_count,
            "sell_count": sell_count,
            "neutral_count": neutral_count,
            "total_indicators": total,
            "indicators": indicator_details,
            "trend_strength": adx.get("trend_strength", "unknown"),
        }

    async def get_full_technical_analysis(
        self,
        symbol: str,
        timeframe: Timeframe = "D",
        lookback_days: int = 200,
    ) -> Dict[str, Any]:
        """Get comprehensive technical analysis for a symbol."""
        import asyncio

        # Adjust lookback based on timeframe
        if timeframe == "W":
            lookback_days = lookback_days * 5  # ~5 years of weekly data
        elif timeframe == "M":
            lookback_days = lookback_days * 20  # ~16 years of monthly data

        # Fetch all data in parallel
        ma_task = self.get_moving_averages(symbol, [10, 20, 50, 200], lookback_days)
        rsi_task = self.get_rsi(symbol, 14, lookback_days)
        macd_task = self.get_macd(symbol, 12, 26, 9, lookback_days)
        bb_task = self.get_bollinger_bands(symbol, 20, 2, lookback_days)
        stoch_task = self.get_stochastic(symbol, 14, 3, lookback_days)
        adx_task = self.get_adx(symbol, 14, lookback_days)
        sr_task = self.get_support_resistance(symbol, lookback_days)
        fib_task = self.get_fibonacci_levels(symbol, lookback_days)
        ichimoku_task = self.get_ichimoku_cloud(symbol, lookback_days=lookback_days)
        signal_task = self.get_signal_summary(symbol, lookback_days)
        volume_full_task = self.get_volume_analysis(symbol, 20, lookback_days)

        ma, rsi, macd, bb, stoch, adx, sr, fib, ichimoku, signals, vol = await asyncio.gather(
            ma_task,
            rsi_task,
            macd_task,
            bb_task,
            stoch_task,
            adx_task,
            sr_task,
            fib_task,
            ichimoku_task,
            signal_task,
            volume_full_task,
        )

        return {
            "symbol": symbol.upper(),
            "timeframe": timeframe,
            "moving_averages": ma,
            "oscillators": {
                "rsi": rsi,
                "macd": macd,
                "stochastic": stoch,
            },
            "volatility": {
                "bollinger_bands": bb,
                "adx": adx,
                "volume": vol,
                "ichimoku_cloud": ichimoku,
            },
            "levels": {
                "support_resistance": sr,
                "fibonacci": fib,
            },
            "signals": signals,
            "generated_at": datetime.now().isoformat(),
        }


# Global instance placeholder
_ta_service: Optional[TechnicalAnalysisService] = None


def get_ta_service() -> TechnicalAnalysisService:
    """Lazy-load the TA service to avoid import-time blocking."""
    global _ta_service
    if _ta_service is None:
        _ta_service = TechnicalAnalysisService()
    return _ta_service
