"""Quant analytics API endpoints."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any, Callable, Dict, List

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.api.v1.schemas import MetaData, StandardResponse
from vnibb.core.config import settings
from vnibb.core.database import get_db
from vnibb.models.stock import StockPrice
from vnibb.providers.vnstock.equity_historical import (
    EquityHistoricalQueryParams,
    VnstockEquityHistoricalFetcher,
)

logger = logging.getLogger(__name__)
router = APIRouter()

SUPPORTED_METRICS = (
    "volume_delta",
    "rsi_seasonal",
    "gap_stats",
    "bollinger",
    "atr",
    "sortino",
    "calmar",
    "macd_crossovers",
)
DEFAULT_METRICS = ",".join(SUPPORTED_METRICS)
PERIOD_PATTERN = r"^(1M|3M|6M|1Y|3Y|5Y|YTD|ALL)$"
MONTH_LABELS = {
    1: "Jan",
    2: "Feb",
    3: "Mar",
    4: "Apr",
    5: "May",
    6: "Jun",
    7: "Jul",
    8: "Aug",
    9: "Sep",
    10: "Oct",
    11: "Nov",
    12: "Dec",
}


class QuantResponseData(BaseModel):
    symbol: str
    period: str
    computed_at: datetime
    metrics: Dict[str, Any]


def _safe_float(value: Any, decimals: int = 4) -> float | None:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if np.isnan(numeric) or np.isinf(numeric):
        return None
    return round(numeric, decimals)


def _resolve_start_date(period: str, end_date: date) -> date:
    if period == "1M":
        return end_date - timedelta(days=31)
    if period == "3M":
        return end_date - timedelta(days=93)
    if period == "6M":
        return end_date - timedelta(days=186)
    if period == "1Y":
        return end_date - timedelta(days=365)
    if period == "3Y":
        return end_date - timedelta(days=365 * 3)
    if period == "5Y":
        return end_date - timedelta(days=365 * 5)
    if period == "YTD":
        return date(end_date.year, 1, 1)
    if period == "ALL":
        return date(2000, 1, 1)
    return end_date - timedelta(days=365 * 5)


def _build_month_map(series: pd.Series, decimals: int = 2) -> Dict[str, float | None]:
    payload: Dict[str, float | None] = {}
    for month, label in MONTH_LABELS.items():
        payload[label] = _safe_float(series.get(month), decimals=decimals)
    return payload


async def _load_price_frame(
    db: AsyncSession,
    symbol: str,
    start_date: date,
    end_date: date,
    source: str,
) -> pd.DataFrame:
    stmt = (
        select(
            StockPrice.time,
            StockPrice.open,
            StockPrice.high,
            StockPrice.low,
            StockPrice.close,
            StockPrice.volume,
        )
        .where(
            StockPrice.symbol == symbol,
            StockPrice.interval == "1D",
            StockPrice.time >= start_date,
            StockPrice.time <= end_date,
        )
        .order_by(StockPrice.time.asc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    if rows:
        frame = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close", "volume"])
    else:
        try:
            provider_rows = await VnstockEquityHistoricalFetcher.fetch(
                EquityHistoricalQueryParams(
                    symbol=symbol,
                    start_date=start_date,
                    end_date=end_date,
                    interval="1D",
                    source=source,
                )
            )
        except Exception as exc:
            logger.warning("Quant fallback fetch failed for %s: %s", symbol, exc)
            provider_rows = []

        frame = pd.DataFrame(
            [
                {
                    "time": row.time,
                    "open": row.open,
                    "high": row.high,
                    "low": row.low,
                    "close": row.close,
                    "volume": row.volume,
                }
                for row in provider_rows
            ]
        )

    if frame.empty:
        return frame

    frame["time"] = pd.to_datetime(frame["time"], errors="coerce")
    if frame["time"].dt.tz is not None:
        frame["time"] = frame["time"].dt.tz_localize(None)
    for col in ["open", "high", "low", "close", "volume"]:
        frame[col] = pd.to_numeric(frame[col], errors="coerce")

    frame = frame.dropna(subset=["time", "close"]).sort_values("time")
    frame = frame.drop_duplicates(subset=["time"], keep="last")
    return frame.reset_index(drop=True)


def _compute_volume_delta(frame: pd.DataFrame) -> Dict[str, Any]:
    enriched = frame.copy()
    price_range = (enriched["high"] - enriched["low"]).replace(0, np.nan)
    close_pos = ((enriched["close"] - enriched["low"]) / price_range).clip(0, 1).fillna(0.5)

    enriched["delta"] = enriched["volume"] * (2 * close_pos - 1)
    enriched["cumulative_delta"] = enriched["delta"].cumsum()
    enriched["month"] = enriched["time"].dt.month

    monthly_avg = enriched.groupby("month")["delta"].mean()
    monthly_rollup = (
        enriched.assign(month_key=enriched["time"].dt.to_period("M"))
        .groupby("month_key", as_index=False)
        .agg(delta=("delta", "sum"), close=("close", "last"))
    )
    monthly_rollup["close_change"] = monthly_rollup["close"].pct_change()
    monthly_rollup["divergence"] = (monthly_rollup["close_change"] > 0) & (
        monthly_rollup["delta"] < 0
    )

    strongest_buy_month = monthly_avg.idxmax() if not monthly_avg.empty else None
    strongest_sell_month = monthly_avg.idxmin() if not monthly_avg.empty else None

    return {
        "monthly_avg": _build_month_map(monthly_avg, decimals=2),
        "cumulative": [
            {
                "date": row.time.strftime("%Y-%m-%d"),
                "delta": _safe_float(row.delta, decimals=2),
                "cumulative_delta": _safe_float(row.cumulative_delta, decimals=2),
                "close": _safe_float(row.close, decimals=2),
            }
            for row in enriched.tail(252).itertuples(index=False)
        ],
        "current_20d_cumulative_delta": _safe_float(enriched["delta"].tail(20).sum(), decimals=2),
        "divergence_months": int(monthly_rollup["divergence"].sum()),
        "strongest_buy_month": MONTH_LABELS.get(int(strongest_buy_month), None)
        if strongest_buy_month is not None
        else None,
        "strongest_sell_month": MONTH_LABELS.get(int(strongest_sell_month), None)
        if strongest_sell_month is not None
        else None,
    }


def _compute_rsi_seasonal(frame: pd.DataFrame) -> Dict[str, Any]:
    enriched = frame.copy()
    delta = enriched["close"].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.ewm(alpha=1 / 14, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / 14, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    enriched["rsi"] = 100 - (100 / (1 + rs))
    enriched["month"] = enriched["time"].dt.month

    grouped = enriched.groupby("month")["rsi"]
    avg_rsi = grouped.mean()
    overbought_pct = grouped.apply(lambda s: (s > 70).mean() * 100 if len(s) else np.nan)
    oversold_pct = grouped.apply(lambda s: (s < 30).mean() * 100 if len(s) else np.nan)
    current_rsi = enriched["rsi"].dropna().iloc[-1] if not enriched["rsi"].dropna().empty else None

    return {
        "current_rsi": _safe_float(current_rsi, decimals=2),
        "monthly_avg_rsi": _build_month_map(avg_rsi, decimals=2),
        "overbought_pct": _build_month_map(overbought_pct, decimals=2),
        "oversold_pct": _build_month_map(oversold_pct, decimals=2),
    }


def _compute_gap_stats(frame: pd.DataFrame) -> Dict[str, Any]:
    enriched = frame.copy()
    enriched["prev_close"] = enriched["close"].shift(1)
    enriched["gap_pct"] = (
        (enriched["open"] - enriched["prev_close"]) / enriched["prev_close"]
    ) * 100
    enriched["month"] = enriched["time"].dt.month

    enriched["gap_type"] = np.select(
        [enriched["gap_pct"] > 0.5, enriched["gap_pct"] < -0.5],
        ["gap_up", "gap_down"],
        default="no_gap",
    )
    enriched["gap_filled"] = (
        (enriched["gap_type"] == "gap_up") & (enriched["low"] <= enriched["prev_close"])
    ) | ((enriched["gap_type"] == "gap_down") & (enriched["high"] >= enriched["prev_close"]))
    enriched["next_day_return_pct"] = (enriched["close"].shift(-1) / enriched["close"] - 1) * 100

    valid_rows = enriched[enriched["prev_close"].notna()]
    total_valid = len(valid_rows)
    gap_events = valid_rows[valid_rows["gap_type"] != "no_gap"]

    monthly_avg_gap = valid_rows.groupby("month")["gap_pct"].mean()
    top_gap_rows = (
        valid_rows.assign(abs_gap=valid_rows["gap_pct"].abs()).nlargest(10, "abs_gap").copy()
    )

    return {
        "gap_up_frequency_pct": _safe_float(
            (len(valid_rows[valid_rows["gap_type"] == "gap_up"]) / total_valid) * 100
            if total_valid
            else None,
            decimals=2,
        ),
        "gap_down_frequency_pct": _safe_float(
            (len(valid_rows[valid_rows["gap_type"] == "gap_down"]) / total_valid) * 100
            if total_valid
            else None,
            decimals=2,
        ),
        "gap_fill_rate_pct": _safe_float(
            (float(gap_events["gap_filled"].mean()) * 100) if len(gap_events) else None,
            decimals=2,
        ),
        "monthly_avg_gap_pct": _build_month_map(monthly_avg_gap, decimals=2),
        "top_gaps": [
            {
                "date": row.time.strftime("%Y-%m-%d"),
                "type": row.gap_type,
                "gap_pct": _safe_float(row.gap_pct, decimals=2),
                "filled": bool(row.gap_filled),
                "next_day_return_pct": _safe_float(row.next_day_return_pct, decimals=2),
            }
            for row in top_gap_rows.itertuples(index=False)
        ],
    }


def _compute_bollinger(frame: pd.DataFrame) -> Dict[str, Any]:
    enriched = frame.copy()
    middle = enriched["close"].rolling(20).mean()
    std = enriched["close"].rolling(20).std(ddof=0)
    upper = middle + 2 * std
    lower = middle - 2 * std

    width = ((upper - lower) / middle.replace(0, np.nan)) * 100
    bb_pct = (enriched["close"] - lower) / (upper - lower).replace(0, np.nan)

    valid_width = width.dropna()
    squeeze_threshold = valid_width.quantile(0.2) if not valid_width.empty else None
    current_width = valid_width.iloc[-1] if not valid_width.empty else None
    squeeze_active = (
        bool(current_width <= squeeze_threshold)
        if current_width is not None and squeeze_threshold is not None
        else False
    )

    return {
        "current_bb_pct": _safe_float(
            bb_pct.dropna().iloc[-1] if not bb_pct.dropna().empty else None, 4
        ),
        "current_bb_width_pct": _safe_float(current_width, 4),
        "squeeze_threshold_pct": _safe_float(squeeze_threshold, 4),
        "squeeze_active": squeeze_active,
        "bb_width_series": [
            {
                "date": row.time.strftime("%Y-%m-%d"),
                "bb_width_pct": _safe_float(row.bb_width, 4),
                "close": _safe_float(row.close, 2),
            }
            for row in enriched.assign(bb_width=width).tail(252).itertuples(index=False)
        ],
    }


def _compute_atr(frame: pd.DataFrame) -> Dict[str, Any]:
    enriched = frame.copy()
    prev_close = enriched["close"].shift(1)
    true_range = pd.concat(
        [
            (enriched["high"] - enriched["low"]),
            (enriched["high"] - prev_close).abs(),
            (enriched["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)

    atr_14 = true_range.rolling(14).mean()
    current_atr = atr_14.dropna().iloc[-1] if not atr_14.dropna().empty else None
    latest_close = enriched["close"].iloc[-1] if not enriched.empty else None

    return {
        "current_atr_14": _safe_float(current_atr, 4),
        "atr_pct_of_price": _safe_float(
            (current_atr / latest_close) * 100 if current_atr and latest_close else None,
            4,
        ),
        "atr_series": [
            {
                "date": row.time.strftime("%Y-%m-%d"),
                "atr_14": _safe_float(row.atr_14, 4),
            }
            for row in enriched.assign(atr_14=atr_14).tail(252).itertuples(index=False)
        ],
    }


def _compute_sortino(frame: pd.DataFrame) -> Dict[str, Any]:
    enriched = frame.copy()
    enriched["returns"] = enriched["close"].pct_change()
    enriched["month"] = enriched["time"].dt.month

    sortino_map: Dict[str, float | None] = {}
    sharpe_map: Dict[str, float | None] = {}

    for month, label in MONTH_LABELS.items():
        monthly_returns = enriched.loc[enriched["month"] == month, "returns"].dropna()
        if monthly_returns.empty:
            sortino_map[label] = None
            sharpe_map[label] = None
            continue

        mean_return = monthly_returns.mean()
        downside = monthly_returns[monthly_returns < 0]
        downside_std = downside.std(ddof=0)
        monthly_std = monthly_returns.std(ddof=0)

        sortino = None
        if downside_std and not np.isnan(downside_std):
            sortino = (mean_return * 252) / (downside_std * np.sqrt(252))

        sharpe = None
        if monthly_std and not np.isnan(monthly_std):
            sharpe = (mean_return * 252) / (monthly_std * np.sqrt(252))

        sortino_map[label] = _safe_float(sortino, 3)
        sharpe_map[label] = _safe_float(sharpe, 3)

    best_months = [month for month, value in sortino_map.items() if value is not None and value > 3]
    avoid_months = [
        month for month, value in sortino_map.items() if value is not None and value < 0
    ]

    return {
        "monthly_sortino": sortino_map,
        "monthly_sharpe": sharpe_map,
        "best_months": best_months,
        "avoid_months": avoid_months,
    }


def _compute_calmar(frame: pd.DataFrame) -> Dict[str, Any]:
    if len(frame) < 2:
        return {
            "annualized_return_pct": None,
            "max_drawdown_pct": None,
            "calmar_ratio": None,
        }

    close = frame["close"]
    first_close = close.iloc[0]
    last_close = close.iloc[-1]
    years = max((frame["time"].iloc[-1] - frame["time"].iloc[0]).days / 365.25, 1 / 365.25)

    annualized_return = (last_close / first_close) ** (1 / years) - 1 if first_close else None

    returns = close.pct_change().fillna(0)
    cumulative = (1 + returns).cumprod()
    running_max = cumulative.cummax()
    drawdown = (cumulative - running_max) / running_max
    max_drawdown = drawdown.min() if not drawdown.empty else None

    calmar_ratio = None
    if annualized_return is not None and max_drawdown is not None and max_drawdown < 0:
        calmar_ratio = annualized_return / abs(max_drawdown)

    return {
        "annualized_return_pct": _safe_float(
            annualized_return * 100 if annualized_return is not None else None,
            2,
        ),
        "max_drawdown_pct": _safe_float(
            max_drawdown * 100 if max_drawdown is not None else None, 2
        ),
        "calmar_ratio": _safe_float(calmar_ratio, 3),
    }


def _compute_macd_crossovers(frame: pd.DataFrame) -> Dict[str, Any]:
    enriched = frame.copy()
    ema_fast = enriched["close"].ewm(span=12, adjust=False).mean()
    ema_slow = enriched["close"].ewm(span=26, adjust=False).mean()
    macd = ema_fast - ema_slow
    signal = macd.ewm(span=9, adjust=False).mean()

    bullish = (macd > signal) & (macd.shift(1) <= signal.shift(1))
    bearish = (macd < signal) & (macd.shift(1) >= signal.shift(1))

    forward_1m = (enriched["close"].shift(-21) / enriched["close"] - 1) * 100
    forward_3m = (enriched["close"].shift(-63) / enriched["close"] - 1) * 100

    crossover_rows: List[Dict[str, Any]] = []
    for idx in np.where((bullish | bearish).to_numpy())[0].tolist():
        crossover_type = "bullish" if bool(bullish.iloc[idx]) else "bearish"
        crossover_rows.append(
            {
                "date": enriched["time"].iloc[idx].strftime("%Y-%m-%d"),
                "type": crossover_type,
                "price": _safe_float(enriched["close"].iloc[idx], 2),
                "return_1m_pct": _safe_float(forward_1m.iloc[idx], 2),
                "return_3m_pct": _safe_float(forward_3m.iloc[idx], 2),
            }
        )

    bullish_1m = [
        row["return_1m_pct"]
        for row in crossover_rows
        if row["type"] == "bullish" and row["return_1m_pct"] is not None
    ]
    bullish_3m = [
        row["return_3m_pct"]
        for row in crossover_rows
        if row["type"] == "bullish" and row["return_3m_pct"] is not None
    ]

    current_state = "neutral"
    if not macd.empty and not signal.empty:
        if macd.iloc[-1] > signal.iloc[-1]:
            current_state = "bullish"
        elif macd.iloc[-1] < signal.iloc[-1]:
            current_state = "bearish"

    return {
        "current_state": current_state,
        "avg_return_after_bullish_1m_pct": _safe_float(
            np.mean(bullish_1m) if bullish_1m else None, 2
        ),
        "avg_return_after_bullish_3m_pct": _safe_float(
            np.mean(bullish_3m) if bullish_3m else None, 2
        ),
        "crossovers": crossover_rows[-80:],
    }


@router.get("/{symbol}", response_model=StandardResponse[QuantResponseData])
async def get_quant_metrics(
    symbol: str,
    metrics: str = Query(
        default=DEFAULT_METRICS,
        description="Comma-separated metrics (volume_delta,rsi_seasonal,gap_stats,bollinger,atr,sortino,calmar,macd_crossovers)",
    ),
    period: str = Query(default="5Y", pattern=PERIOD_PATTERN),
    source: str = Query(default=settings.vnstock_source, pattern=r"^(KBS|VCI|DNSE)$"),
    db: AsyncSession = Depends(get_db),
):
    symbol_upper = symbol.upper().strip()
    if not symbol_upper:
        raise HTTPException(status_code=400, detail="Symbol is required")

    requested_metrics = [item.strip().lower() for item in metrics.split(",") if item.strip()]
    if not requested_metrics:
        requested_metrics = list(SUPPORTED_METRICS)

    unique_metrics = list(dict.fromkeys(requested_metrics))
    invalid_metrics = sorted(set(unique_metrics) - set(SUPPORTED_METRICS))
    if invalid_metrics:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Unsupported quant metrics requested",
                "invalid_metrics": invalid_metrics,
                "supported_metrics": list(SUPPORTED_METRICS),
            },
        )

    period_upper = period.upper()
    end_date = date.today()
    start_date = _resolve_start_date(period_upper, end_date)

    frame = await _load_price_frame(
        db=db,
        symbol=symbol_upper,
        start_date=start_date,
        end_date=end_date,
        source=source,
    )

    if frame.empty or len(frame) < 30:
        payload = QuantResponseData(
            symbol=symbol_upper,
            period=period_upper,
            computed_at=datetime.utcnow(),
            metrics={},
        )
        return StandardResponse(
            data=payload,
            meta=MetaData(count=0),
            error="Insufficient historical price data for quant calculations",
        )

    calculators: Dict[str, Callable[[pd.DataFrame], Dict[str, Any]]] = {
        "volume_delta": _compute_volume_delta,
        "rsi_seasonal": _compute_rsi_seasonal,
        "gap_stats": _compute_gap_stats,
        "bollinger": _compute_bollinger,
        "atr": _compute_atr,
        "sortino": _compute_sortino,
        "calmar": _compute_calmar,
        "macd_crossovers": _compute_macd_crossovers,
    }

    computed_metrics: Dict[str, Any] = {}
    for metric_name in unique_metrics:
        calculator = calculators.get(metric_name)
        if calculator is None:
            continue
        try:
            computed_metrics[metric_name] = calculator(frame.copy())
        except Exception as exc:
            logger.warning("Quant metric %s failed for %s: %s", metric_name, symbol_upper, exc)
            computed_metrics[metric_name] = {"error": str(exc)}

    payload = QuantResponseData(
        symbol=symbol_upper,
        period=period_upper,
        computed_at=datetime.utcnow(),
        metrics=computed_metrics,
    )
    return StandardResponse(data=payload, meta=MetaData(count=len(computed_metrics)))
