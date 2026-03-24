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
import pandas as pd

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


class IchimokuPoint(BaseModel):
    date: date
    close: float
    tenkan_sen: Optional[float] = None
    kijun_sen: Optional[float] = None
    senkou_span_a: Optional[float] = None
    senkou_span_b: Optional[float] = None
    chikou_span: Optional[float] = None


class IchimokuSignalResponse(BaseModel):
    cloud_trend: str
    tk_cross: str
    cloud_twist: Optional[date] = None
    strength: str


class IchimokuSeriesResponse(BaseModel):
    symbol: str
    period: str
    data: List[IchimokuPoint]
    signal: IchimokuSignalResponse


class PricePoint(BaseModel):
    date: date
    close: float
    high: Optional[float] = None
    low: Optional[float] = None


class SwingPoint(BaseModel):
    price: float
    date: date


class NearestLevelResponse(BaseModel):
    level: str
    price: float
    distance_pct: float


class FibonacciRetracementResponse(BaseModel):
    symbol: str
    lookback_days: int
    direction: str
    swing_high: SwingPoint
    swing_low: SwingPoint
    levels: Dict[str, float]
    current_price: float
    nearest_level: NearestLevelResponse
    price_data: List[PricePoint]


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


PERIOD_LOOKBACK_MAP: Dict[str, int] = {
    "1M": 31,
    "3M": 93,
    "6M": 180,
    "1Y": 365,
    "3Y": 365 * 3,
    "5Y": 365 * 5,
}


def _normalize_price_frame(df: pd.DataFrame) -> pd.DataFrame:
    frame = df.copy()
    if "time" in frame.columns:
        frame["time"] = pd.to_datetime(frame["time"], errors="coerce")
    elif "date" in frame.columns:
        frame["time"] = pd.to_datetime(frame["date"], errors="coerce")
    else:
        raise ValueError("Price frame missing time/date column")

    frame = (
        frame.dropna(subset=["time", "close", "high", "low"])
        .sort_values("time")
        .reset_index(drop=True)
    )
    return frame


def _safe_float(value: Any) -> Optional[float]:
    if value is None or pd.isna(value):
        return None
    return round(float(value), 2)


def _build_ichimoku_payload(df: pd.DataFrame) -> List[IchimokuPoint]:
    high = df["high"]
    low = df["low"]
    close = df["close"]

    tenkan_sen = (high.rolling(window=9).max() + low.rolling(window=9).min()) / 2
    kijun_sen = (high.rolling(window=26).max() + low.rolling(window=26).min()) / 2
    senkou_span_a = ((tenkan_sen + kijun_sen) / 2).shift(26)
    senkou_span_b = ((high.rolling(window=52).max() + low.rolling(window=52).min()) / 2).shift(26)
    chikou_span = close.shift(-26)

    payload: List[IchimokuPoint] = []
    for index, row in df.iterrows():
        if pd.isna(row["time"]) or pd.isna(row["close"]):
            continue
        payload.append(
            IchimokuPoint(
                date=row["time"].date(),
                close=round(float(row["close"]), 2),
                tenkan_sen=_safe_float(tenkan_sen.iloc[index]),
                kijun_sen=_safe_float(kijun_sen.iloc[index]),
                senkou_span_a=_safe_float(senkou_span_a.iloc[index]),
                senkou_span_b=_safe_float(senkou_span_b.iloc[index]),
                chikou_span=_safe_float(chikou_span.iloc[index]),
            )
        )
    return payload


def _build_ichimoku_signal(data: List[IchimokuPoint]) -> IchimokuSignalResponse:
    latest = next(
        (
            point
            for point in reversed(data)
            if point.tenkan_sen is not None
            and point.kijun_sen is not None
            and point.senkou_span_a is not None
            and point.senkou_span_b is not None
        ),
        None,
    )
    if latest is None:
        return IchimokuSignalResponse(
            cloud_trend="neutral",
            tk_cross="neutral",
            cloud_twist=None,
            strength="insufficient_data",
        )

    cloud_upper = max(latest.senkou_span_a, latest.senkou_span_b)
    cloud_lower = min(latest.senkou_span_a, latest.senkou_span_b)
    if latest.close > cloud_upper:
        cloud_trend = "bullish"
    elif latest.close < cloud_lower:
        cloud_trend = "bearish"
    else:
        cloud_trend = "neutral"

    if latest.tenkan_sen > latest.kijun_sen:
        tk_cross = "bullish"
    elif latest.tenkan_sen < latest.kijun_sen:
        tk_cross = "bearish"
    else:
        tk_cross = "neutral"

    cloud_twist = None
    for previous, current in zip(data, data[1:]):
        if (
            previous.senkou_span_a is None
            or previous.senkou_span_b is None
            or current.senkou_span_a is None
            or current.senkou_span_b is None
        ):
            continue
        previous_state = previous.senkou_span_a >= previous.senkou_span_b
        current_state = current.senkou_span_a >= current.senkou_span_b
        if previous_state != current_state:
            cloud_twist = current.date

    bullish_votes = sum(
        [
            cloud_trend == "bullish",
            tk_cross == "bullish",
            latest.senkou_span_a >= latest.senkou_span_b,
        ]
    )
    bearish_votes = sum(
        [
            cloud_trend == "bearish",
            tk_cross == "bearish",
            latest.senkou_span_a < latest.senkou_span_b,
        ]
    )
    if bullish_votes >= 3:
        strength = "strong"
    elif bearish_votes >= 3:
        strength = "strong_bearish"
    elif bullish_votes > bearish_votes:
        strength = "bullish"
    elif bearish_votes > bullish_votes:
        strength = "bearish"
    else:
        strength = "neutral"

    return IchimokuSignalResponse(
        cloud_trend=cloud_trend,
        tk_cross=tk_cross,
        cloud_twist=cloud_twist,
        strength=strength,
    )


def _build_fibonacci_payload(
    df: pd.DataFrame, lookback_days: int, direction: str
) -> FibonacciRetracementResponse:
    highest_index = int(df["high"].idxmax())
    lowest_index = int(df["low"].idxmin())

    high_row = df.iloc[highest_index]
    low_row = df.iloc[lowest_index]
    swing_high_price = round(float(high_row["high"]), 2)
    swing_low_price = round(float(low_row["low"]), 2)
    current_price = round(float(df.iloc[-1]["close"]), 2)

    if direction == "auto":
        direction = "down" if highest_index > lowest_index else "up"

    fib_ratios = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.618]
    labels = {
        0.0: "0.0%",
        0.236: "23.6%",
        0.382: "38.2%",
        0.5: "50.0%",
        0.618: "61.8%",
        0.786: "78.6%",
        1.0: "100.0%",
        1.272: "127.2%",
        1.618: "161.8%",
    }
    diff = swing_high_price - swing_low_price

    if direction == "down":
        computed_levels = {
            labels[ratio]: round(swing_high_price - (diff * ratio), 2) for ratio in fib_ratios
        }
        direction_label = "retracement_from_high"
    else:
        computed_levels = {
            labels[ratio]: round(swing_low_price + (diff * ratio), 2) for ratio in fib_ratios
        }
        direction_label = "retracement_from_low"

    nearest_label, nearest_price = min(
        computed_levels.items(),
        key=lambda item: abs(current_price - item[1]),
    )
    distance_pct = (
        round(((current_price - nearest_price) / nearest_price) * 100, 2) if nearest_price else 0.0
    )

    price_data = [
        PricePoint(
            date=row["time"].date(),
            close=round(float(row["close"]), 2),
            high=_safe_float(row["high"]),
            low=_safe_float(row["low"]),
        )
        for _, row in df.iterrows()
        if not pd.isna(row["time"]) and not pd.isna(row["close"])
    ]

    return FibonacciRetracementResponse(
        symbol="",
        lookback_days=lookback_days,
        direction=direction_label,
        swing_high=SwingPoint(price=swing_high_price, date=high_row["time"].date()),
        swing_low=SwingPoint(price=swing_low_price, date=low_row["time"].date()),
        levels=computed_levels,
        current_price=current_price,
        nearest_level=NearestLevelResponse(
            level=nearest_label,
            price=nearest_price,
            distance_pct=distance_pct,
        ),
        price_data=price_data,
    )


@router.get(
    "/ta/{symbol}",
    response_model=TechnicalIndicators,
    summary="Get Technical Indicators",
    description="Calculate and return current technical indicators for a stock.",
)
async def get_technical_indicators(
    symbol: str,
    lookback_days: int = Query(
        default=200, ge=50, le=500, description="Days of history for calculations"
    ),
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


@router.get(
    "/ta/{symbol}/ichimoku",
    response_model=IchimokuSeriesResponse,
    summary="Get Ichimoku cloud series",
    description="Return Ichimoku Cloud components and a compact signal summary.",
)
async def get_ichimoku_series(
    symbol: str,
    period: str = Query(default="1Y", pattern=r"^(1M|3M|6M|1Y|3Y|5Y)$"),
) -> IchimokuSeriesResponse:
    upper_symbol = symbol.upper()
    lookback_days = PERIOD_LOOKBACK_MAP[period]
    end_date = date.today()
    start_date = end_date - timedelta(days=lookback_days + 60)

    try:
        df = await get_ta_service().get_ohlcv_data(upper_symbol, start_date, end_date)
        if df is None or df.empty:
            raise HTTPException(
                status_code=404, detail=f"No Ichimoku data available for {upper_symbol}"
            )

        frame = _normalize_price_frame(df)
        payload = _build_ichimoku_payload(frame)
        if not payload:
            raise HTTPException(
                status_code=404, detail=f"No Ichimoku data available for {upper_symbol}"
            )

        return IchimokuSeriesResponse(
            symbol=upper_symbol,
            period=period,
            data=payload,
            signal=_build_ichimoku_signal(payload),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "Ichimoku endpoint failed for symbol=%s period=%s error=%s", upper_symbol, period, exc
        )
        raise HTTPException(status_code=500, detail="Failed to compute Ichimoku cloud")


@router.get(
    "/ta/{symbol}/fibonacci",
    response_model=FibonacciRetracementResponse,
    summary="Get Fibonacci retracement levels",
    description="Return swing-based Fibonacci retracement levels with recent price context.",
)
async def get_fibonacci_retracement(
    symbol: str,
    lookback_days: int = Query(default=252, ge=63, le=1260),
    direction: str = Query(default="auto", pattern=r"^(auto|up|down)$"),
) -> FibonacciRetracementResponse:
    upper_symbol = symbol.upper()
    end_date = date.today()
    start_date = end_date - timedelta(days=lookback_days)

    try:
        df = await get_ta_service().get_ohlcv_data(upper_symbol, start_date, end_date)
        if df is None or df.empty:
            raise HTTPException(
                status_code=404, detail=f"No Fibonacci data available for {upper_symbol}"
            )

        frame = _normalize_price_frame(df)
        if len(frame) < 30:
            raise HTTPException(
                status_code=404, detail=f"Not enough price history for {upper_symbol}"
            )

        payload = _build_fibonacci_payload(frame, lookback_days, direction)
        return payload.model_copy(update={"symbol": upper_symbol})
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "Fibonacci endpoint failed for symbol=%s lookback_days=%s direction=%s error=%s",
            upper_symbol,
            lookback_days,
            direction,
            exc,
        )
        raise HTTPException(status_code=500, detail="Failed to compute Fibonacci retracement")


@router.get("/indicators/{symbol}")
async def get_technical_indicators_direct(
    symbol: str,
    indicators: str = Query("rsi,sma,ema", description="Comma-separated: rsi,macd,sma,ema,bb"),
    period: int = Query(14, ge=5, le=50),
    source: str = Query("KBS", description="Data source"),
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
            "indicators": {},
        }

        ind_list = [i.strip().lower() for i in indicators.split(",")]

        # Calculate SMA
        if "sma" in ind_list:
            df[f"sma_{period}"] = df["close"].rolling(window=period).mean()
            result["indicators"]["sma"] = {
                "value": round(df[f"sma_{period}"].iloc[-1], 2)
                if not df[f"sma_{period}"].empty
                else None,
                "period": period,
            }

        # Calculate EMA
        if "ema" in ind_list:
            df[f"ema_{period}"] = df["close"].ewm(span=period).mean()
            result["indicators"]["ema"] = {
                "value": round(df[f"ema_{period}"].iloc[-1], 2)
                if not df[f"ema_{period}"].empty
                else None,
                "period": period,
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
                "signal": "overbought"
                if not rsi.empty and rsi.iloc[-1] > 70
                else "oversold"
                if not rsi.empty and rsi.iloc[-1] < 30
                else "neutral",
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
                "histogram": round((macd - signal).iloc[-1], 2)
                if not (macd - signal).empty
                else None,
            }

        return result

    loop = asyncio.get_running_loop()
    with ThreadPoolExecutor() as executor:
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(executor, _calculate), timeout=settings.vnstock_timeout
            )
            return result
        except asyncio.TimeoutError:
            return {"error": "Request timed out"}
        except Exception as e:
            return {"error": str(e)}
