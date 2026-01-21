"""
Technical Analysis API Endpoints

Provides technical indicators for stocks.
Uses vnstock_ta premium package with pandas fallback.
"""

import logging
from datetime import date, timedelta
from typing import Optional, List, Dict, Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from vnibb.services.technical_analysis import get_ta_service


router = APIRouter()
logger = logging.getLogger(__name__)

# Type aliases
Timeframe = Literal["D", "W", "M"]
Signal = Literal["strong_buy", "buy", "neutral", "sell", "strong_sell"]


class TechnicalIndicators(BaseModel):
    """Technical indicator values."""
    symbol: str
    date: date
    # Moving Averages
    sma_20: Optional[float] = None
    sma_50: Optional[float] = None
    sma_200: Optional[float] = None
    ema_12: Optional[float] = None
    ema_26: Optional[float] = None
    # Momentum
    rsi_14: Optional[float] = None
    # MACD
    macd: Optional[float] = None
    macd_signal: Optional[float] = None
    macd_hist: Optional[float] = None
    # Bollinger Bands
    bb_upper: Optional[float] = None
    bb_middle: Optional[float] = None
    bb_lower: Optional[float] = None
    # Volatility
    atr_14: Optional[float] = None


class TechnicalHistory(BaseModel):
    """Historical technical indicators."""
    symbol: str
    indicators: List[Dict[str, Any]]


class IndicatorDetail(BaseModel):
    """Individual indicator with signal."""
    name: str
    value: Optional[Any] = None
    signal: str


class SignalSummary(BaseModel):
    """Aggregated signal summary."""
    symbol: str
    overall_signal: Signal
    buy_count: int
    sell_count: int
    neutral_count: int
    total_indicators: int
    indicators: List[IndicatorDetail]
    trend_strength: str


class MovingAveragesResponse(BaseModel):
    """Moving averages response."""
    sma: Dict[str, float]
    ema: Dict[str, float]
    signals: Dict[str, str]
    current_price: Optional[float] = None


class RSIResponse(BaseModel):
    """RSI response."""
    value: Optional[float] = None
    signal: str
    zone: str
    period: int = 14


class MACDResponse(BaseModel):
    """MACD response."""
    macd: Optional[float] = None
    signal_line: Optional[float] = None
    histogram: Optional[float] = None
    signal: str
    params: Dict[str, int]


class BollingerBandsResponse(BaseModel):
    """Bollinger Bands response."""
    upper: Optional[float] = None
    middle: Optional[float] = None
    lower: Optional[float] = None
    current_price: Optional[float] = None
    percent_b: Optional[float] = None
    signal: str
    params: Dict[str, int]


class StochasticResponse(BaseModel):
    """Stochastic response."""
    k: Optional[float] = None
    d: Optional[float] = None
    signal: str
    params: Dict[str, int]


class ADXResponse(BaseModel):
    """ADX response."""
    adx: Optional[float] = None
    plus_di: Optional[float] = None
    minus_di: Optional[float] = None
    trend_strength: str
    signal: str


class VolumeResponse(BaseModel):
    """Volume analysis response."""
    volume: Optional[int] = None
    volume_ma: Optional[int] = None
    relative_volume: Optional[float] = None
    volume_desc: str
    signal: str
    params: Dict[str, int]


class SupportResistanceResponse(BaseModel):
    """Support/Resistance levels response."""
    support: List[float]
    resistance: List[float]
    current_price: Optional[float] = None
    nearest_support: Optional[float] = None
    nearest_resistance: Optional[float] = None
    support_proximity_pct: Optional[float] = None
    resistance_proximity_pct: Optional[float] = None


class FibonacciResponse(BaseModel):
    """Fibonacci levels response."""
    levels: Dict[str, float]
    period_high: Optional[float] = None
    period_low: Optional[float] = None
    current_price: Optional[float] = None
    trend: str
    lookback_days: int


class OscillatorsResponse(BaseModel):
    """Oscillators group response."""
    rsi: RSIResponse
    macd: MACDResponse
    stochastic: StochasticResponse


class VolatilityResponse(BaseModel):
    """Volatility indicators response."""
    bollinger_bands: BollingerBandsResponse
    adx: ADXResponse
    volume: Optional[VolumeResponse] = None
    ichimoku_cloud: Optional[Dict[str, Any]] = None


class LevelsResponse(BaseModel):
    """Price levels response."""
    support_resistance: SupportResistanceResponse
    fibonacci: FibonacciResponse


class FullTechnicalAnalysis(BaseModel):
    """Complete technical analysis response."""
    symbol: str
    timeframe: Timeframe
    moving_averages: MovingAveragesResponse
    oscillators: OscillatorsResponse
    volatility: VolatilityResponse
    levels: LevelsResponse
    signals: SignalSummary
    generated_at: str


@router.get(
    "/ta/{symbol}",
    response_model=TechnicalIndicators,
    summary="Get Technical Indicators",
    description="Calculate and return current technical indicators for a stock.",
)
async def get_technical_indicators(
    symbol: str,
    lookback_days: int = Query(default=200, ge=50, le=500, description="Days of history for calculations"),
) -> TechnicalIndicators:
    """Calculate and return technical indicators for a stock."""
    end_date = date.today()
    start_date = end_date - timedelta(days=lookback_days)
    
    try:
        indicators = await get_ta_service().calculate_indicators(
            symbol=symbol.upper(),
            start_date=start_date,
            end_date=end_date,
        )
        
        if not indicators:
            raise HTTPException(
                status_code=404,
                detail=f"No data available for {symbol}",
            )
        
        return TechnicalIndicators(
            symbol=symbol.upper(),
            date=end_date,
            **indicators,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TA calculation failed for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/ta/{symbol}/history",
    response_model=TechnicalHistory,
    summary="Get Historical Technical Indicators",
    description="Get stored technical indicators from database.",
)
async def get_technical_history(
    symbol: str,
    days: int = Query(default=30, ge=1, le=365, description="Number of days of history"),
) -> TechnicalHistory:
    """Get historical technical indicators from database."""
    end_date = date.today()
    start_date = end_date - timedelta(days=days)
    
    try:
        indicators = await get_ta_service().get_indicators(
            symbol=symbol.upper(),
            start_date=start_date,
            end_date=end_date,
        )
        
        return TechnicalHistory(
            symbol=symbol.upper(),
            indicators=indicators,
        )
    except Exception as e:
        logger.error(f"Failed to get TA history for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/ta/{symbol}/calculate",
    response_model=TechnicalIndicators,
    summary="Calculate and Store Indicators",
    description="Calculate technical indicators and store them in database.",
)
async def calculate_and_store(
    symbol: str,
    lookback_days: int = Query(default=200, ge=50, le=500),
) -> TechnicalIndicators:
    """Calculate and store technical indicators."""
    end_date = date.today()
    start_date = end_date - timedelta(days=lookback_days)
    
    try:
        indicators = await get_ta_service().calculate_indicators(
            symbol=symbol.upper(),
            start_date=start_date,
            end_date=end_date,
        )
        
        if not indicators:
            raise HTTPException(
                status_code=404,
                detail=f"No data available for {symbol}",
            )
        
        # Store in database
        await get_ta_service().store_indicators(symbol.upper(), end_date, indicators)

        
        return TechnicalIndicators(
            symbol=symbol.upper(),
            date=end_date,
            **indicators,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TA calculation/storage failed for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/ta/{symbol}/full",
    response_model=FullTechnicalAnalysis,
    summary="Get Full Technical Analysis",
    description="Get comprehensive technical analysis including MAs, oscillators, volatility, and signals.",
)
async def get_full_analysis(
    symbol: str,
    timeframe: Timeframe = Query(default="D"),
    lookback_days: int = Query(default=200, ge=50, le=1000),
) -> FullTechnicalAnalysis:
    """Get full technical analysis for a stock."""
    try:
        analysis = await get_ta_service().get_full_technical_analysis(
            symbol=symbol.upper(),
            timeframe=timeframe,
            lookback_days=lookback_days,
        )
        return FullTechnicalAnalysis(**analysis)
    except Exception as e:
        logger.error(f"Full TA failed for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/indicators/{symbol}")

async def get_technical_indicators_direct(
    symbol: str,
    indicators: str = Query("rsi,sma,ema", description="Comma-separated: rsi,macd,sma,ema,bb"),
    period: int = Query(14, ge=5, le=50),
    source: str = Query("KBS", description="Data source")
):
    """
    Calculate technical indicators for a symbol using vnstock.
    
    Available indicators: rsi, macd, sma, ema, bb (Bollinger Bands)
    """
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    from vnibb.core.config import settings
    from datetime import datetime, timedelta
    
    def _calculate():
        from vnstock import Quote
        import pandas as pd
        
        q = Quote(symbol=symbol.upper(), source=source)
        end = datetime.now()
        start = end - timedelta(days=90)
        
        df = q.history(start=start.strftime("%Y-%m-%d"), end=end.strftime("%Y-%m-%d"))
        if df is None or df.empty:
            return {"error": "No data available"}
        
        result = {
            "symbol": symbol.upper(),
            "source": source,
            "period": period,
            "calculated_at": datetime.utcnow().isoformat(),
            "indicators": {}
        }
        
        ind_list = [i.strip().lower() for i in indicators.split(",")]
        
        # Calculate SMA
        if "sma" in ind_list:
            df[f"sma_{period}"] = df["close"].rolling(window=period).mean()
            result["indicators"]["sma"] = {
                "value": round(df[f"sma_{period}"].iloc[-1], 2) if not df[f"sma_{period}"].empty else None,
                "period": period
            }
        
        # Calculate EMA
        if "ema" in ind_list:
            df[f"ema_{period}"] = df["close"].ewm(span=period).mean()
            result["indicators"]["ema"] = {
                "value": round(df[f"ema_{period}"].iloc[-1], 2) if not df[f"ema_{period}"].empty else None,
                "period": period
            }
        
        # Calculate RSI
        if "rsi" in ind_list:
            delta = df["close"].diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
            rs = gain / loss
            rsi = 100 - (100 / (1 + rs))
            result["indicators"]["rsi"] = {
                "value": round(rsi.iloc[-1], 2) if not rsi.empty else None,
                "period": period,
                "signal": "overbought" if not rsi.empty and rsi.iloc[-1] > 70 else "oversold" if not rsi.empty and rsi.iloc[-1] < 30 else "neutral"
            }
        
        # Calculate MACD
        if "macd" in ind_list:
            ema12 = df["close"].ewm(span=12).mean()
            ema26 = df["close"].ewm(span=26).mean()
            macd = ema12 - ema26
            signal = macd.ewm(span=9).mean()
            result["indicators"]["macd"] = {
                "macd": round(macd.iloc[-1], 2) if not macd.empty else None,
                "signal": round(signal.iloc[-1], 2) if not signal.empty else None,
                "histogram": round((macd - signal).iloc[-1], 2) if not (macd - signal).empty else None
            }
        
        return result
    
    loop = asyncio.get_running_loop()
    with ThreadPoolExecutor() as executor:
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(executor, _calculate),
                timeout=settings.vnstock_timeout
            )
            return result
        except asyncio.TimeoutError:
            return {"error": "Request timed out"}
        except Exception as e:
            return {"error": str(e)}

