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
    "parkinson_volatility",
    "ema_respect",
    "drawdown_recovery",
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
    histogram = macd - signal

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
        "current_macd": _safe_float(macd.iloc[-1] if not macd.empty else None, 4),
        "current_signal": _safe_float(signal.iloc[-1] if not signal.empty else None, 4),
        "current_histogram": _safe_float(
            histogram.iloc[-1] if not histogram.empty else None,
            4,
        ),
        "avg_return_after_bullish_1m_pct": _safe_float(
            np.mean(bullish_1m) if bullish_1m else None, 2
        ),
        "avg_return_after_bullish_3m_pct": _safe_float(
            np.mean(bullish_3m) if bullish_3m else None, 2
        ),
        "macd_series": [
            {
                "date": row.time.strftime("%Y-%m-%d"),
                "macd": _safe_float(row.macd, 4),
                "signal": _safe_float(row.signal, 4),
                "histogram": _safe_float(row.histogram, 4),
            }
            for row in enriched.assign(macd=macd, signal=signal, histogram=histogram)
            .tail(252)
            .itertuples(index=False)
        ],
        "crossovers": crossover_rows[-80:],
    }


def _classify_volatility_regime(z_score: float | None) -> str:
    if z_score is None:
        return "normal"
    if z_score <= -1:
        return "low"
    if z_score < 1:
        return "normal"
    if z_score < 2:
        return "high"
    return "extreme"


def _compute_parkinson_volatility(frame: pd.DataFrame) -> Dict[str, Any]:
    enriched = frame.copy()
    valid_hl = (
        (enriched["high"] > 0) & (enriched["low"] > 0) & (enriched["high"] >= enriched["low"])
    )
    hl_log = pd.Series(np.nan, index=enriched.index, dtype=float)
    hl_log.loc[valid_hl] = np.log(enriched.loc[valid_hl, "high"] / enriched.loc[valid_hl, "low"])

    parkinson_var = (hl_log.pow(2)) / (4 * np.log(2))
    parkinson_30 = np.sqrt(parkinson_var.rolling(30).mean() * 252) * 100

    returns = enriched["close"].pct_change()
    close_close_vol_30 = returns.rolling(30).std(ddof=0) * np.sqrt(252) * 100

    parkinson_mean_252 = parkinson_30.rolling(252).mean()
    parkinson_std_252 = parkinson_30.rolling(252).std(ddof=0).replace(0, np.nan)
    z_score_series = (parkinson_30 - parkinson_mean_252) / parkinson_std_252

    current_parkinson = parkinson_30.dropna().iloc[-1] if not parkinson_30.dropna().empty else None
    current_close_close = (
        close_close_vol_30.dropna().iloc[-1] if not close_close_vol_30.dropna().empty else None
    )
    current_ratio = (
        (current_close_close / current_parkinson)
        if current_close_close is not None and current_parkinson and current_parkinson > 0
        else None
    )
    current_z_score = (
        z_score_series.dropna().iloc[-1] if not z_score_series.dropna().empty else None
    )
    current_regime = _classify_volatility_regime(
        float(current_z_score) if current_z_score is not None else None
    )

    regime_counts = {"low": 0, "normal": 0, "high": 0, "extreme": 0}
    for z_value in z_score_series.dropna().tolist():
        regime_counts[_classify_volatility_regime(float(z_value))] += 1

    return {
        "current_parkinson_vol_30d_pct": _safe_float(current_parkinson, 2),
        "current_close_close_vol_30d_pct": _safe_float(current_close_close, 2),
        "close_to_park_ratio": _safe_float(current_ratio, 3),
        "current_regime": current_regime,
        "current_regime_z_score": _safe_float(current_z_score, 3),
        "regime_counts": regime_counts,
        "series": [
            {
                "date": row.time.strftime("%Y-%m-%d"),
                "parkinson_vol_pct": _safe_float(row.parkinson_vol, 3),
                "close_close_vol_pct": _safe_float(row.close_close_vol, 3),
                "z_score": _safe_float(row.z_score, 3),
                "regime": _classify_volatility_regime(row.z_score)
                if row.z_score is not None and not np.isnan(row.z_score)
                else None,
            }
            for row in enriched.assign(
                parkinson_vol=parkinson_30,
                close_close_vol=close_close_vol_30,
                z_score=z_score_series,
            )
            .tail(400)
            .itertuples(index=False)
        ],
    }


def _support_strength_label(rate: float | None) -> str:
    if rate is None:
        return "insufficient"
    if rate >= 75:
        return "strong"
    if rate >= 60:
        return "moderate"
    if rate >= 45:
        return "weak"
    return "fragile"


def _compute_ema_respect(frame: pd.DataFrame) -> Dict[str, Any]:
    enriched = frame.copy()
    ema_periods = (20, 50, 200)
    interaction_tolerance_pct = 1.0
    lookahead_sessions = 5

    rows: List[Dict[str, Any]] = []
    best_support: tuple[int, float] | None = None

    for period in ema_periods:
        ema_col = f"ema_{period}"
        enriched[ema_col] = enriched["close"].ewm(span=period, adjust=False).mean()

        base = enriched[["close", "time", ema_col]].copy()
        base["distance_pct"] = (
            (base["close"] - base[ema_col]) / base[ema_col].replace(0, np.nan)
        ) * 100
        base["interacts"] = base["distance_pct"].abs() <= interaction_tolerance_pct
        base["from_above"] = base["close"] >= base[ema_col]
        base = base.reset_index(drop=True)

        support_tests = 0
        support_successes = 0
        support_returns: List[float] = []
        resistance_tests = 0
        resistance_successes = 0

        for idx in range(len(base) - lookahead_sessions):
            row = base.iloc[idx]
            if not bool(row["interacts"]):
                continue

            ema_level = row[ema_col]
            future_slice = base.iloc[idx + 1 : idx + 1 + lookahead_sessions]
            if future_slice.empty or ema_level is None or np.isnan(ema_level):
                continue

            current_close = float(row["close"])
            future_close = float(base.iloc[idx + lookahead_sessions]["close"])

            if bool(row["from_above"]):
                support_tests += 1
                if float(future_slice["close"].min()) >= float(ema_level):
                    support_successes += 1
                support_returns.append(((future_close / current_close) - 1) * 100)
            else:
                resistance_tests += 1
                if float(future_slice["close"].max()) <= float(ema_level):
                    resistance_successes += 1

        support_rate = (support_successes / support_tests) * 100 if support_tests else None
        support_breakdown_rate = (100 - support_rate) if support_rate is not None else None
        resistance_rate = (
            (resistance_successes / resistance_tests) * 100 if resistance_tests else None
        )

        avg_bounce_5d = np.mean(support_returns) if support_returns else None
        current_ema = base[ema_col].dropna().iloc[-1] if not base[ema_col].dropna().empty else None
        current_distance = (
            base["distance_pct"].dropna().iloc[-1]
            if not base["distance_pct"].dropna().empty
            else None
        )

        if support_rate is not None and (best_support is None or support_rate > best_support[1]):
            best_support = (period, support_rate)

        rows.append(
            {
                "ema_period": period,
                "current_ema": _safe_float(current_ema, 2),
                "current_distance_pct": _safe_float(current_distance, 2),
                "interaction_count": int(base["interacts"].sum()),
                "support_tests": support_tests,
                "support_bounce_rate_pct": _safe_float(support_rate, 2),
                "support_breakdown_rate_pct": _safe_float(support_breakdown_rate, 2),
                "avg_5d_return_after_support_test_pct": _safe_float(avg_bounce_5d, 2),
                "resistance_tests": resistance_tests,
                "resistance_rejection_rate_pct": _safe_float(resistance_rate, 2),
                "support_strength": _support_strength_label(
                    float(support_rate) if support_rate is not None else None
                ),
            }
        )

    return {
        "interaction_tolerance_pct": interaction_tolerance_pct,
        "lookahead_sessions": lookahead_sessions,
        "best_support_ema": f"EMA{best_support[0]}" if best_support is not None else None,
        "ema_levels": rows,
    }


def _compute_drawdown_recovery(frame: pd.DataFrame) -> Dict[str, Any]:
    enriched = frame.copy()
    close = enriched["close"].astype(float)
    running_peak = close.cummax()
    drawdown = ((close / running_peak.replace(0, np.nan)) - 1) * 100

    rolling_52w_high = close.rolling(252, min_periods=20).max()
    drawdown_52w = ((close / rolling_52w_high.replace(0, np.nan)) - 1) * 100

    episodes: List[Dict[str, Any]] = []
    start_index: int | None = None
    trough_index: int | None = None

    for idx, value in enumerate(drawdown.tolist()):
        if value < 0:
            if start_index is None:
                start_index = max(0, idx - 1)
                trough_index = idx
            elif trough_index is None or value < drawdown.iloc[trough_index]:
                trough_index = idx
            continue

        if start_index is not None and trough_index is not None:
            episode = {
                "peak_date": enriched["time"].iloc[start_index].strftime("%Y-%m-%d"),
                "trough_date": enriched["time"].iloc[trough_index].strftime("%Y-%m-%d"),
                "recovery_date": enriched["time"].iloc[idx].strftime("%Y-%m-%d"),
                "depth_pct": _safe_float(drawdown.iloc[trough_index], 2),
                "days_to_trough": int(trough_index - start_index),
                "days_to_recovery": int(idx - trough_index),
            }
            episodes.append(episode)
            start_index = None
            trough_index = None

    if start_index is not None and trough_index is not None:
        episodes.append(
            {
                "peak_date": enriched["time"].iloc[start_index].strftime("%Y-%m-%d"),
                "trough_date": enriched["time"].iloc[trough_index].strftime("%Y-%m-%d"),
                "recovery_date": None,
                "depth_pct": _safe_float(drawdown.iloc[trough_index], 2),
                "days_to_trough": int(trough_index - start_index),
                "days_to_recovery": None,
            }
        )

    recovered_days = [
        int(episode["days_to_recovery"])
        for episode in episodes
        if episode.get("days_to_recovery") is not None
    ]

    current_drawdown = drawdown.dropna().iloc[-1] if not drawdown.dropna().empty else None
    current_52w_drawdown = (
        drawdown_52w.dropna().iloc[-1] if not drawdown_52w.dropna().empty else None
    )
    max_52w_drawdown = drawdown_52w.min() if not drawdown_52w.dropna().empty else None

    return {
        "current_drawdown_pct": _safe_float(current_drawdown, 2),
        "current_drawdown_from_52w_high_pct": _safe_float(current_52w_drawdown, 2),
        "max_drawdown_from_52w_high_pct": _safe_float(max_52w_drawdown, 2),
        "avg_days_to_recovery": _safe_float(np.mean(recovered_days) if recovered_days else None, 1),
        "median_days_to_recovery": _safe_float(
            np.median(recovered_days) if recovered_days else None, 1
        ),
        "episodes": episodes[-40:],
        "underwater_series": [
            {
                "date": row.time.strftime("%Y-%m-%d"),
                "drawdown_pct": _safe_float(row.drawdown, 2),
                "drawdown_52w_pct": _safe_float(row.drawdown_52w, 2),
            }
            for row in enriched.assign(drawdown=drawdown, drawdown_52w=drawdown_52w)
            .tail(400)
            .itertuples(index=False)
        ],
    }


@router.get("/{symbol}", response_model=StandardResponse[QuantResponseData])
async def get_quant_metrics(
    symbol: str,
    metrics: str = Query(
        default=DEFAULT_METRICS,
        description=(
            "Comma-separated metrics (volume_delta,rsi_seasonal,gap_stats,bollinger,"
            "atr,sortino,calmar,macd_crossovers,parkinson_volatility,ema_respect,"
            "drawdown_recovery)"
        ),
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

    min_points_required = 30
    observed_points = int(len(frame))

    if frame.empty or observed_points < min_points_required:
        payload = QuantResponseData(
            symbol=symbol_upper,
            period=period_upper,
            computed_at=datetime.utcnow(),
            metrics={},
        )
        return StandardResponse(
            data=payload,
            meta=MetaData(count=0),
            error=(
                f"Insufficient Data: Expected at least {min_points_required} sessions, "
                f"got {observed_points}."
            ),
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
        "parkinson_volatility": _compute_parkinson_volatility,
        "ema_respect": _compute_ema_respect,
        "drawdown_recovery": _compute_drawdown_recovery,
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
