"""Quant analytics API endpoints."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any, Callable, Dict, List

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.api.v1.equity import (
    _apply_corporate_action_adjustments,
    _load_corporate_actions_for_adjustment,
    _load_historical_from_appwrite,
    _load_historical_from_db,
    _load_historical_from_recent_cache,
)
from vnibb.api.v1.schemas import MetaData, StandardResponse
from vnibb.core.config import settings
from vnibb.core.database import get_db
from vnibb.core.vn_sectors import VN_SECTORS
from vnibb.models.alerts import BlockTrade
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.stock import Stock, StockIndex, StockPrice
from vnibb.models.trading import ForeignTrading
from vnibb.providers.vnstock.equity_historical import (
    EquityHistoricalData,
    EquityHistoricalQueryParams,
    VnstockEquityHistoricalFetcher,
)
from vnibb.providers.vnstock.stock_quote import VnstockStockQuoteFetcher

logger = logging.getLogger(__name__)
router = APIRouter()

SUPPORTED_METRICS = (
    "seasonality",
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
ALLOWED_QUANT_PERIODS = ("1M", "6M", "1Y", "3Y", "5Y", "ALL")
QUANT_STALE_DAYS_THRESHOLD = 7
ALL_HISTORY_START_DATE = date(1970, 1, 1)
METRIC_ALIASES = {
    "seasonality": "seasonality",
    "seasonality_heatmap": "seasonality",
    "seasonality-heatmap": "seasonality",
    "volume_flow": "volume_delta",
    "volume-flow": "volume_delta",
    "rsi_seasonal": "rsi_seasonal",
    "rsi-seasonal": "rsi_seasonal",
    "gap_stats": "gap_stats",
    "gap-analysis": "gap_stats",
    "gap_analysis": "gap_stats",
    "bollinger_squeeze": "bollinger",
    "bollinger-squeeze": "bollinger",
    "bollinger": "bollinger",
    "atr": "atr",
    "atr_regime": "atr",
    "atr-regime": "atr",
    "sortino": "sortino",
    "sortino_monthly": "sortino",
    "sortino-monthly": "sortino",
    "calmar": "calmar",
    "macd_crossovers": "macd_crossovers",
    "macd-crossover": "macd_crossovers",
    "macd_crossover": "macd_crossovers",
    "parkinson_volatility": "parkinson_volatility",
    "parkinson-volatility": "parkinson_volatility",
    "ema_respect": "ema_respect",
    "ema-respect": "ema_respect",
    "drawdown_recovery": "drawdown_recovery",
    "drawdown-recovery": "drawdown_recovery",
}
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
VN30_SYMBOLS = tuple(
    symbol.upper() for symbol in (VN_SECTORS.get("vn30").symbols if VN_SECTORS.get("vn30") else [])
)


class QuantResponseData(BaseModel):
    symbol: str
    period: str
    adjustment_mode: str = "raw"
    computed_at: datetime
    last_data_date: datetime | None = None
    metrics: Dict[str, Any]
    warning: str | None = None


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
    if period == "6M":
        return end_date - timedelta(days=186)
    if period == "1Y":
        return end_date - timedelta(days=365)
    if period == "3Y":
        return end_date - timedelta(days=365 * 3)
    if period == "5Y":
        return end_date - timedelta(days=365 * 5)
    if period == "ALL":
        return ALL_HISTORY_START_DATE
    return end_date - timedelta(days=365 * 5)


def _normalize_quant_period(period: str) -> str:
    normalized = str(period or "").strip().upper()
    if normalized in ALLOWED_QUANT_PERIODS:
        return normalized

    allowed = ", ".join(ALLOWED_QUANT_PERIODS)
    raise HTTPException(
        status_code=400,
        detail={
            "code": "INVALID_PERIOD",
            "message": f"Quant period must be one of {allowed}.",
            "allowed_periods": list(ALLOWED_QUANT_PERIODS),
            "requested_period": normalized or None,
        },
    )


def _normalize_metric_name(value: str) -> str:
    normalized = value.strip().lower()
    return METRIC_ALIASES.get(normalized, normalized.replace("-", "_"))


def _get_quant_calculators() -> Dict[str, Callable[[pd.DataFrame], Dict[str, Any]]]:
    return {
        "seasonality": _compute_seasonality,
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


def _build_period_warning(
    frame: pd.DataFrame, requested_start_date: date, period: str
) -> str | None:
    if frame.empty:
        return None

    earliest_value = pd.to_datetime(frame["time"].iloc[0], errors="coerce")
    if pd.isna(earliest_value):
        return None

    earliest_date = earliest_value.date()
    if earliest_date <= requested_start_date:
        return None

    return f"Data only available from {earliest_date.isoformat()} ({period} requested)."


def _format_date_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.isoformat()

    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return None
    return parsed.strftime("%Y-%m-%d")


def _resolve_frame_last_timestamp(frame: pd.DataFrame) -> datetime | None:
    if frame.empty or "time" not in frame.columns:
        return None

    parsed = pd.to_datetime(frame["time"], errors="coerce").dropna()
    if parsed.empty:
        return None

    latest = parsed.max()
    if pd.isna(latest):
        return None
    resolved = latest.to_pydatetime()
    if resolved > datetime.utcnow() + timedelta(days=1):
        return None
    return resolved


def _build_staleness_warning(frame: pd.DataFrame, end_date: date) -> str | None:
    latest = _resolve_frame_last_timestamp(frame)
    if latest is None:
        return None

    latest_date = latest.date()
    if (end_date - latest_date).days < QUANT_STALE_DAYS_THRESHOLD:
        return None

    return f"Latest price data is from {latest_date.isoformat()}."


def _merge_warnings(*warnings: str | None) -> str | None:
    parts: list[str] = []
    seen: set[str] = set()
    for warning in warnings:
        text = str(warning or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        parts.append(text)
    return " ".join(parts) if parts else None


def _normalize_adjustment_mode(value: str | None) -> str:
    normalized = str(value or "raw").strip().lower() or "raw"
    return "adjusted" if normalized == "adjusted" else "raw"


def _normalize_provider_history_rows(
    rows: list[EquityHistoricalData],
    *,
    adjustment_mode: str,
) -> list[EquityHistoricalData]:
    normalized_mode = _normalize_adjustment_mode(adjustment_mode)
    normalized_rows: list[EquityHistoricalData] = []

    for row in rows:
        if hasattr(row, "model_copy"):
            normalized_rows.append(
                row.model_copy(
                    update={
                        "raw_close": row.raw_close if row.raw_close is not None else row.close,
                        "adjustment_mode": normalized_mode,
                        "adjustment_applied": bool(
                            normalized_mode == "adjusted" and row.adjusted_close not in (None, 0)
                        ),
                    }
                )
            )
            continue

        raw_close = getattr(row, "raw_close", None)
        close = getattr(row, "close", None)
        adjusted_close = getattr(row, "adjusted_close", None)
        normalized_rows.append(
            EquityHistoricalData(
                symbol=str(getattr(row, "symbol", "") or "").upper(),
                time=getattr(row, "time"),
                open=float(getattr(row, "open")),
                high=float(getattr(row, "high")),
                low=float(getattr(row, "low")),
                close=float(close),
                volume=int(getattr(row, "volume") or 0),
                value=getattr(row, "value", None),
                raw_close=float(raw_close) if raw_close is not None else float(close),
                adjusted_close=float(adjusted_close) if adjusted_close is not None else None,
                adjustment_mode=normalized_mode,
                adjustment_applied=bool(
                    normalized_mode == "adjusted" and adjusted_close not in (None, 0)
                ),
            )
        )

    return normalized_rows


def _merge_historical_rows(*collections: list[EquityHistoricalData]) -> list[EquityHistoricalData]:
    by_time: dict[date, EquityHistoricalData] = {}
    for collection in collections:
        for row in collection:
            by_time[row.time] = row
    return [by_time[key] for key in sorted(by_time)]


def _historical_rows_to_frame(rows: list[EquityHistoricalData]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])

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
            for row in rows
        ]
    )
    frame["time"] = pd.to_datetime(frame["time"], errors="coerce")
    if frame["time"].dt.tz is not None:
        frame["time"] = frame["time"].dt.tz_localize(None)
    for col in ["open", "high", "low", "close", "volume"]:
        frame[col] = pd.to_numeric(frame[col], errors="coerce")
    frame = frame.dropna(subset=["time", "close"]).sort_values("time")
    frame = frame.drop_duplicates(subset=["time"], keep="last")
    return frame.reset_index(drop=True)


async def _merge_latest_quote_into_frame(
    frame: pd.DataFrame,
    *,
    symbol: str,
    source: str,
) -> tuple[pd.DataFrame, str | None]:
    if frame.empty:
        return frame, None

    try:
        quote, _ = await VnstockStockQuoteFetcher.fetch(symbol=symbol, source=source)
    except Exception as exc:
        logger.debug("Quant latest quote merge skipped for %s: %s", symbol, exc)
        return frame, None

    quote_price = getattr(quote, "price", None)
    quote_time = getattr(quote, "updated_at", None)
    if quote_price is None or quote_time is None:
        return frame, None

    quote_timestamp = pd.to_datetime(quote_time, errors="coerce")
    if pd.isna(quote_timestamp):
        return frame, None
    if getattr(quote_timestamp, "tzinfo", None) is not None:
        quote_timestamp = quote_timestamp.tz_localize(None)

    merged = frame.copy().sort_values("time").reset_index(drop=True)
    last_row = merged.iloc[-1]
    quote_date = quote_timestamp.normalize()
    last_date = pd.to_datetime(last_row["time"], errors="coerce")
    if pd.isna(last_date):
        return frame, None
    last_date = last_date.normalize()

    if quote_date < last_date:
        return frame, None

    fallback_open = float(last_row.get("close") or quote_price)
    latest_row = {
        "time": quote_timestamp,
        "open": float(getattr(quote, "open", None) or fallback_open),
        "high": float(
            getattr(quote, "high", None)
            or max(float(last_row.get("high") or quote_price), float(quote_price))
        ),
        "low": float(
            getattr(quote, "low", None)
            or min(float(last_row.get("low") or quote_price), float(quote_price))
        ),
        "close": float(quote_price),
        "volume": float(getattr(quote, "volume", None) or last_row.get("volume") or 0),
    }

    if quote_date == last_date:
        merged.loc[merged.index[-1], list(latest_row.keys())] = list(latest_row.values())
        return merged, "Merged latest quote into current session calculations."

    merged = pd.concat([merged, pd.DataFrame([latest_row])], ignore_index=True)
    return merged, "Appended latest quote snapshot to quant calculations."


async def _load_quant_frame_with_warning(
    *,
    db: AsyncSession,
    symbol: str,
    start_date: date,
    end_date: date,
    source: str,
    period: str,
    adjustment_mode: str,
) -> tuple[pd.DataFrame, str | None]:
    frame = await _load_price_frame(
        db=db,
        symbol=symbol,
        start_date=start_date,
        end_date=end_date,
        source=source,
        adjustment_mode=adjustment_mode,
    )
    frame, latest_quote_warning = await _merge_latest_quote_into_frame(
        frame,
        symbol=symbol,
        source=source,
    )
    return frame, _merge_warnings(
        _build_period_warning(frame, start_date, period),
        _build_staleness_warning(frame, end_date),
        latest_quote_warning,
    )


def _compute_seasonality(frame: pd.DataFrame) -> Dict[str, Any]:
    enriched = frame.copy()
    enriched["time"] = pd.to_datetime(enriched["time"], errors="coerce")
    enriched = enriched.dropna(subset=["time", "close"]).sort_values("time")

    monthly_returns: List[Dict[str, Any]] = []
    for period_key, period_frame in enriched.groupby(enriched["time"].dt.to_period("M")):
        closes = period_frame["close"].astype(float)
        if closes.empty:
            continue
        first_close = closes.iloc[0]
        last_close = closes.iloc[-1]
        if not first_close or np.isnan(first_close):
            continue
        monthly_returns.append(
            {
                "year": int(period_key.year),
                "month": int(period_key.month),
                "label": MONTH_LABELS.get(int(period_key.month), str(period_key.month)),
                "return_pct": _safe_float(((last_close - first_close) / first_close) * 100, 2),
            }
        )

    monthly_df = pd.DataFrame(monthly_returns)
    if monthly_df.empty:
        return {
            "monthly_returns": [],
            "monthly_average_return_pct": _build_month_map(pd.Series(dtype=float), decimals=2),
            "best_month": None,
            "worst_month": None,
            "hit_rate_pct": None,
            "current_month": None,
        }

    avg_by_month = monthly_df.groupby("month")["return_pct"].mean()
    hit_rate = (
        float((monthly_df["return_pct"] > 0).sum()) / float(len(monthly_df)) * 100
        if len(monthly_df)
        else None
    )
    best_idx = avg_by_month.idxmax() if not avg_by_month.empty else None
    worst_idx = avg_by_month.idxmin() if not avg_by_month.empty else None

    return {
        "monthly_returns": monthly_returns,
        "monthly_average_return_pct": _build_month_map(avg_by_month, decimals=2),
        "best_month": MONTH_LABELS.get(int(best_idx), None) if best_idx is not None else None,
        "worst_month": MONTH_LABELS.get(int(worst_idx), None) if worst_idx is not None else None,
        "hit_rate_pct": _safe_float(hit_rate, 2),
        "current_month": monthly_returns[-1] if monthly_returns else None,
    }


async def _get_quant_metric_alias_response(
    *,
    symbol: str,
    metric_name: str,
    period: str,
    source: str,
    adjustment_mode: str,
    db: AsyncSession,
) -> StandardResponse[Dict[str, Any]]:
    symbol_upper = symbol.upper().strip()
    if not symbol_upper:
        raise HTTPException(status_code=400, detail="Symbol is required")

    canonical_metric = _normalize_metric_name(metric_name)
    calculators = _get_quant_calculators()
    calculator = calculators.get(canonical_metric)
    if calculator is None:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Unsupported quant metric requested",
                "invalid_metric": metric_name,
                "supported_metrics": list(SUPPORTED_METRICS),
            },
        )

    period_upper = _normalize_quant_period(period)
    end_date = date.today()
    start_date = _resolve_start_date(period_upper, end_date)
    frame, warning = await _load_quant_frame_with_warning(
        db=db,
        symbol=symbol_upper,
        start_date=start_date,
        end_date=end_date,
        source=source,
        period=period_upper,
        adjustment_mode=adjustment_mode,
    )
    last_data_timestamp = _resolve_frame_last_timestamp(frame)

    min_points_required = 30
    observed_points = int(len(frame))
    if frame.empty or observed_points < min_points_required:
        return StandardResponse(
            data={
                "symbol": symbol_upper,
                "period": period_upper,
                "adjustment_mode": _normalize_adjustment_mode(adjustment_mode),
                "metric": canonical_metric,
                "computed_at": last_data_timestamp or datetime.utcnow(),
                "last_data_date": last_data_timestamp,
                "warning": warning,
            },
            meta=MetaData(
                count=0,
                symbol=symbol_upper,
                data_points=observed_points,
                last_data_date=last_data_timestamp.isoformat() if last_data_timestamp else None,
            ),
            error=(
                f"Insufficient Data: Expected at least {min_points_required} sessions, "
                f"got {observed_points}."
            ),
        )

    try:
        metric_payload = calculator(frame.copy())
    except Exception as exc:
        logger.warning(
            "Quant metric alias %s failed for %s: %s", canonical_metric, symbol_upper, exc
        )
        return StandardResponse(
            data={
                "symbol": symbol_upper,
                "period": period_upper,
                "adjustment_mode": _normalize_adjustment_mode(adjustment_mode),
                "metric": canonical_metric,
                "computed_at": last_data_timestamp or datetime.utcnow(),
                "last_data_date": last_data_timestamp,
                "warning": warning,
            },
            meta=MetaData(
                count=0,
                symbol=symbol_upper,
                data_points=observed_points,
                last_data_date=last_data_timestamp.isoformat() if last_data_timestamp else None,
            ),
            error=str(exc),
        )

    response_payload: Dict[str, Any] = {
        "symbol": symbol_upper,
        "period": period_upper,
        "adjustment_mode": _normalize_adjustment_mode(adjustment_mode),
        "metric": canonical_metric,
        "computed_at": last_data_timestamp or datetime.utcnow(),
        "last_data_date": last_data_timestamp,
    }
    if warning:
        response_payload["warning"] = warning
    response_payload.update(metric_payload)
    return StandardResponse(
        data=response_payload,
        meta=MetaData(
            count=1,
            symbol=symbol_upper,
            data_points=observed_points,
            last_data_date=last_data_timestamp.isoformat() if last_data_timestamp else None,
        ),
    )


def _build_month_map(series: pd.Series, decimals: int = 2) -> Dict[str, float | None]:
    payload: Dict[str, float | None] = {}
    for month, label in MONTH_LABELS.items():
        payload[label] = _safe_float(series.get(month), decimals=decimals)
    return payload


def _safe_divide(
    numerator: float | int | None,
    denominator: float | int | None,
    *,
    scale: float = 1.0,
    decimals: int = 4,
) -> float | None:
    if numerator is None or denominator is None:
        return None
    try:
        num = float(numerator)
        den = float(denominator)
    except (TypeError, ValueError):
        return None

    if den == 0 or np.isnan(num) or np.isnan(den) or np.isinf(num) or np.isinf(den):
        return None

    return _safe_float((num / den) * scale, decimals=decimals)


def _classify_gamma_regime(net_gamma_proxy: float | None) -> str:
    if net_gamma_proxy is None:
        return "unknown"
    if net_gamma_proxy >= 12:
        return "long_gamma"
    if net_gamma_proxy <= -12:
        return "short_gamma"
    return "neutral"


def _label_gamma_regime(regime: str) -> str:
    if regime == "long_gamma":
        return "Dealer Long Gamma"
    if regime == "short_gamma":
        return "Dealer Short Gamma"
    if regime == "neutral":
        return "Balanced"
    return "Unknown"


def _classify_rrg_quadrant(rs_ratio: float | None, rs_momentum: float | None) -> str:
    if rs_ratio is None or rs_momentum is None:
        return "Unknown"
    if rs_ratio >= 100 and rs_momentum >= 100:
        return "Leading"
    if rs_ratio >= 100 and rs_momentum < 100:
        return "Weakening"
    if rs_ratio < 100 and rs_momentum < 100:
        return "Lagging"
    return "Improving"


def _compute_rrg_metrics(
    rs_series: pd.Series,
    *,
    ratio_lookback: int = 60,
    momentum_lookback: int = 10,
) -> tuple[float | None, float | None]:
    series = pd.to_numeric(rs_series, errors="coerce").dropna()
    if series.empty:
        return None, None

    ratio_window = series.tail(ratio_lookback)
    ratio_mean = ratio_window.mean()
    ratio_std = ratio_window.std(ddof=0)

    if ratio_std and not np.isnan(ratio_std):
        rs_ratio = 100 + ((series.iloc[-1] - ratio_mean) / ratio_std) * 10
    else:
        rs_ratio = 100.0

    momentum_base = series.pct_change(momentum_lookback) * 100
    momentum_window = momentum_base.dropna().tail(ratio_lookback)
    if momentum_window.empty:
        return _safe_float(rs_ratio, decimals=2), None

    momentum_std = momentum_window.std(ddof=0)
    if momentum_std and not np.isnan(momentum_std):
        rs_momentum = (
            100 + ((momentum_window.iloc[-1] - momentum_window.mean()) / momentum_std) * 10
        )
    else:
        rs_momentum = 100.0

    return _safe_float(rs_ratio, decimals=2), _safe_float(rs_momentum, decimals=2)


def _normalize_trade_side(value: Any) -> str | None:
    if value is None:
        return None

    raw = value.value if hasattr(value, "value") else str(value)
    normalized = raw.upper().replace("TRADESIDE.", "").strip()

    if normalized.endswith("BUY"):
        return "BUY"
    if normalized.endswith("SELL"):
        return "SELL"
    return None


def _is_missing_column_error(exc: Exception, column_name: str) -> bool:
    message = str(exc).lower()
    return column_name.lower() in message and (
        "does not exist" in message or "undefinedcolumnerror" in message
    )


def _is_failed_transaction_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "current transaction is aborted" in message or "infailedsqltransactionerror" in message


async def _rollback_after_query_error(db: AsyncSession, context: str) -> None:
    try:
        await db.rollback()
    except Exception as rollback_exc:
        logger.warning("%s rollback failed: %s", context, rollback_exc)


async def _load_block_trade_rows(
    db: AsyncSession,
    symbol: str,
    limit: int = 60,
) -> list[tuple[Any, str | None, Any, Any]]:
    stmt = (
        select(
            BlockTrade.trade_time,
            BlockTrade.side,
            BlockTrade.quantity,
            BlockTrade.value,
        )
        .where(BlockTrade.symbol == symbol)
        .order_by(BlockTrade.trade_time.desc())
        .limit(limit)
    )

    try:
        result = await db.execute(stmt)
        return [(row[0], _normalize_trade_side(row[1]), row[2], row[3]) for row in result.all()]
    except Exception as exc:
        await _rollback_after_query_error(db, f"Smart money block trade query for {symbol}")

        if not _is_missing_column_error(exc, "block_trades.side"):
            logger.warning("Smart money block trade query failed for %s: %s", symbol, exc)
            return []

        logger.warning(
            "Smart money block trade query fell back to legacy schema for %s: %s",
            symbol,
            exc,
        )

    fallback_stmt = (
        select(
            BlockTrade.trade_time,
            BlockTrade.quantity,
            BlockTrade.value,
        )
        .where(BlockTrade.symbol == symbol)
        .order_by(BlockTrade.trade_time.desc())
        .limit(limit)
    )

    try:
        result = await db.execute(fallback_stmt)
        return [(row[0], None, row[1], row[2]) for row in result.all()]
    except Exception as exc:
        await _rollback_after_query_error(
            db, f"Smart money legacy block trade fallback for {symbol}"
        )
        logger.warning("Smart money legacy block trade fallback failed for %s: %s", symbol, exc)
        return []


async def _load_price_frame(
    db: AsyncSession,
    symbol: str,
    start_date: date,
    end_date: date,
    source: str,
    adjustment_mode: str = "raw",
) -> pd.DataFrame:
    normalized_mode = _normalize_adjustment_mode(adjustment_mode)
    corporate_actions = (
        await _load_corporate_actions_for_adjustment(db, symbol, start_date, end_date)
        if normalized_mode == "adjusted"
        else []
    )

    try:
        rows = await _load_historical_from_db(
            db=db,
            symbol=symbol,
            start_date=start_date,
            end_date=end_date,
            interval="1D",
            adjustment_mode="raw",
        )
    except Exception as exc:
        await _rollback_after_query_error(db, f"Quant price frame query for {symbol}")
        if _is_failed_transaction_error(exc):
            logger.warning(
                "Quant price frame query hit an aborted transaction for %s; falling back to cached/provider data: %s",
                symbol,
                exc,
            )
        else:
            logger.warning("Quant price frame query failed for %s: %s", symbol, exc)
        rows = []

    use_appwrite_data = settings.is_appwrite_configured and settings.resolved_data_backend in {
        "appwrite",
        "hybrid",
    }
    if not rows:
        recent_cache_rows = await _load_historical_from_recent_cache(
            symbol=symbol,
            start_date=start_date,
            end_date=end_date,
            interval="1D",
            adjustment_mode="raw",
        )
        rows = _merge_historical_rows(rows, recent_cache_rows)

    if not rows and use_appwrite_data:
        appwrite_rows = await _load_historical_from_appwrite(
            symbol=symbol,
            start_date=start_date,
            end_date=end_date,
            interval="1D",
            adjustment_mode="raw",
        )
        rows = _merge_historical_rows(rows, appwrite_rows)

    frame = _historical_rows_to_frame(rows)
    latest_db_timestamp = _resolve_frame_last_timestamp(frame)
    needs_provider_refresh = frame.empty
    provider_start_date = start_date

    if latest_db_timestamp is not None:
        latest_db_date = latest_db_timestamp.date()
        if (end_date - latest_db_date).days >= QUANT_STALE_DAYS_THRESHOLD:
            needs_provider_refresh = True
            provider_start_date = max(start_date, latest_db_date - timedelta(days=30))

    if needs_provider_refresh:
        try:
            provider_rows = await VnstockEquityHistoricalFetcher.fetch(
                EquityHistoricalQueryParams(
                    symbol=symbol,
                    start_date=provider_start_date,
                    end_date=end_date,
                    interval="1D",
                    source=source,
                )
            )
        except Exception as exc:
            logger.warning("Quant fallback fetch failed for %s: %s", symbol, exc)
            provider_rows = []

        normalized_provider_rows = _normalize_provider_history_rows(
            provider_rows,
            adjustment_mode="raw",
        )
        rows = _merge_historical_rows(rows, normalized_provider_rows)

    if not rows:
        return _historical_rows_to_frame(rows)

    rows = _apply_corporate_action_adjustments(rows, corporate_actions, normalized_mode)
    return _historical_rows_to_frame(rows)


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
    enriched["time"] = pd.to_datetime(enriched["time"], errors="coerce")
    enriched = enriched.dropna(subset=["time", "close"]).sort_values("time")
    if len(enriched) < 2:
        empty_map = _build_month_map(pd.Series(dtype=float), decimals=3)
        return {
            "monthly_sortino": empty_map,
            "monthly_sharpe": empty_map.copy(),
            "best_months": [],
            "avoid_months": [],
        }

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
        downside_std = 0.0 if downside.empty else downside.std(ddof=0)
        monthly_std = monthly_returns.std(ddof=0)

        sortino = None
        if not np.isnan(downside_std):
            if downside_std <= 1e-8:
                if mean_return > 0:
                    sortino = 99.0
                elif mean_return < 0:
                    sortino = -99.0
                else:
                    sortino = 0.0
            else:
                sortino = (mean_return * 252) / (downside_std * np.sqrt(252))

        sharpe = None
        if monthly_std and not np.isnan(monthly_std):
            sharpe = (mean_return * 252) / (monthly_std * np.sqrt(252))

        if sortino is not None:
            sortino = float(np.clip(sortino, -99.0, 99.0))

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


def _grade_from_quality_score(score: float | None) -> str:
    if score is None:
        return "N/A"
    if score >= 80:
        return "A"
    if score >= 65:
        return "B"
    if score >= 50:
        return "C"
    return "D"


@router.get("/{symbol}/gamma-exposure", response_model=StandardResponse[Dict[str, Any]])
async def get_gamma_exposure_proxy(
    symbol: str,
    period: str = Query(default="3Y"),
    source: str = Query(default=settings.vnstock_source, pattern=r"^(KBS|VCI|DNSE)$"),
    db: AsyncSession = Depends(get_db),
):
    """Gamma exposure proxy using volatility regime until warrant OI feed is integrated."""
    symbol_upper = symbol.upper().strip()
    if not symbol_upper:
        raise HTTPException(status_code=400, detail="Symbol is required")

    end_date = date.today()
    period_upper = _normalize_quant_period(period)
    frame, warning = await _load_quant_frame_with_warning(
        db=db,
        symbol=symbol_upper,
        start_date=_resolve_start_date(period_upper, end_date),
        end_date=end_date,
        source=source,
        period=period_upper,
    )
    last_data_timestamp = _resolve_frame_last_timestamp(frame)

    if frame.empty or len(frame) < 40:
        return StandardResponse(
            data={
                "symbol": symbol_upper,
                "period": period_upper,
                "computed_at": datetime.utcnow(),
                "bands": [],
                "data_quality_note": warning,
            },
            meta=MetaData(count=0),
            error="Insufficient historical data for gamma proxy.",
        )

    volatility = _compute_parkinson_volatility(frame.copy())
    z_score = _safe_float(volatility.get("current_regime_z_score"), decimals=3)
    current_close = _safe_float(frame["close"].iloc[-1], decimals=2)
    current_vol_30 = _safe_float(volatility.get("current_parkinson_vol_30d_pct"), decimals=2)

    net_gamma_proxy = _safe_float((-z_score * 20) if z_score is not None else 0, decimals=2)
    regime = _classify_gamma_regime(net_gamma_proxy)
    regime_label = _label_gamma_regime(regime)

    band_rows: List[Dict[str, Any]] = []
    if current_close is not None:
        for offset in (-0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15):
            strike = current_close * (1 + offset)
            curve_shape = float(np.exp(-((offset / 0.075) ** 2)))
            gamma_at_strike = (
                (net_gamma_proxy or 0.0) * curve_shape if net_gamma_proxy is not None else 0.0
            )

            band_rows.append(
                {
                    "strike": _safe_float(strike, decimals=2),
                    "offset_pct": _safe_float(offset * 100, decimals=2),
                    "net_gamma": _safe_float(gamma_at_strike, decimals=2),
                }
            )

    payload: Dict[str, Any] = {
        "symbol": symbol_upper,
        "period": period_upper,
        "adjustment_mode": _normalize_adjustment_mode(adjustment_mode),
        "computed_at": datetime.utcnow(),
        "last_data_date": last_data_timestamp,
        "current_close": current_close,
        "current_realized_vol_30d_pct": current_vol_30,
        "regime_z_score": z_score,
        "net_gamma_proxy": net_gamma_proxy,
        "dealer_position_proxy": regime,
        "regime_label": regime_label,
        "bands": band_rows,
        "data_quality_note": "Proxy derived from volatility regime; listed warrant OI pending.",
    }
    if warning:
        payload["data_quality_note"] = f"{payload['data_quality_note']} {warning}".strip()
    return StandardResponse(data=payload, meta=MetaData(count=len(band_rows)))


@router.get("/{symbol}/momentum", response_model=StandardResponse[Dict[str, Any]])
async def get_momentum_profile(
    symbol: str,
    period: str = Query(default="3Y"),
    source: str = Query(default=settings.vnstock_source, pattern=r"^(KBS|VCI|DNSE)$"),
    adjustment_mode: str = Query(default="raw", pattern=r"^(raw|adjusted)$"),
    db: AsyncSession = Depends(get_db),
):
    """Classic 12-1 momentum profile with peer ranking snapshot."""
    symbol_upper = symbol.upper().strip()
    if not symbol_upper:
        raise HTTPException(status_code=400, detail="Symbol is required")

    period_upper = _normalize_quant_period(period)
    end_date = date.today()
    start_date = _resolve_start_date(period_upper, end_date)
    frame, warning = await _load_quant_frame_with_warning(
        db=db,
        symbol=symbol_upper,
        start_date=start_date,
        end_date=end_date,
        source=source,
        period=period_upper,
        adjustment_mode=adjustment_mode,
    )

    closes = pd.to_numeric(frame.get("close"), errors="coerce").dropna().tolist()
    last_data_timestamp = _resolve_frame_last_timestamp(frame)

    def calc_return(lookback: int) -> float | None:
        if len(closes) <= lookback:
            return None
        baseline = closes[-1 - lookback]
        latest = closes[-1]
        if baseline == 0:
            return None
        return _safe_float(((latest / baseline) - 1) * 100, decimals=2)

    r1m = calc_return(21)
    r3m = calc_return(63)
    r6m = calc_return(126)
    r12m = calc_return(252)
    momentum_12_1 = _safe_float((r12m - r1m) if r12m is not None and r1m is not None else None, 2)

    score = 0
    for value in (r1m, r3m, r6m, r12m):
        if value is None:
            continue
        if value > 0:
            score += 1
        elif value < 0:
            score -= 1

    trend_label = "Sideways"
    if score >= 3:
        trend_label = "Strong Uptrend"
    elif score >= 1:
        trend_label = "Uptrend"
    elif score <= -3:
        trend_label = "Strong Downtrend"
    elif score <= -1:
        trend_label = "Downtrend"

    has_data = len(closes) >= 80
    if not has_data:
        return StandardResponse(
            data={
                "symbol": symbol_upper,
                "period": period_upper,
                "adjustment_mode": _normalize_adjustment_mode(adjustment_mode),
                "computed_at": datetime.utcnow(),
                "last_data_date": last_data_timestamp,
                "returns_pct": {},
                "peer_distribution": [],
            },
            meta=MetaData(count=0),
            error="Insufficient historical data for momentum profile.",
        )

    sector_result = await db.execute(
        select(Stock.sector).where(Stock.symbol == symbol_upper).limit(1)
    )
    sector = sector_result.scalar_one_or_none()

    peer_distribution: List[Dict[str, Any]] = []
    sector_rank: int | None = None
    sector_total: int | None = None
    sector_percentile: float | None = None

    if sector:
        peers_result = await db.execute(
            select(Stock.symbol).where(
                Stock.sector == sector,
                Stock.is_active == 1,
            )
        )
        peer_symbols = [row[0] for row in peers_result.all() if row[0]]
        if symbol_upper not in peer_symbols:
            peer_symbols.append(symbol_upper)

        if peer_symbols:
            peer_prices_result = await db.execute(
                select(StockPrice.symbol, StockPrice.time, StockPrice.close)
                .where(
                    and_(
                        StockPrice.symbol.in_(peer_symbols),
                        StockPrice.interval == "1D",
                        StockPrice.time >= start_date,
                        StockPrice.time <= end_date,
                    )
                )
                .order_by(StockPrice.symbol, StockPrice.time)
            )

            peer_frame = pd.DataFrame(
                peer_prices_result.all(),
                columns=["symbol", "time", "close"],
            )
            if not peer_frame.empty:
                peer_frame["close"] = pd.to_numeric(peer_frame["close"], errors="coerce")
                peer_frame = peer_frame.dropna(subset=["close"])

                momentum_map: Dict[str, float] = {}
                for peer_symbol, group in peer_frame.groupby("symbol"):
                    peer_closes = group.sort_values("time")["close"].tolist()
                    if len(peer_closes) <= 252 or peer_closes[-253] == 0 or peer_closes[-22] == 0:
                        continue

                    peer_r12 = ((peer_closes[-1] / peer_closes[-253]) - 1) * 100
                    peer_r1 = ((peer_closes[-1] / peer_closes[-22]) - 1) * 100
                    peer_momentum = peer_r12 - peer_r1
                    momentum_map[peer_symbol] = float(peer_momentum)

                ranked = sorted(
                    momentum_map.items(),
                    key=lambda item: item[1],
                    reverse=True,
                )

                if ranked:
                    sector_total = len(ranked)
                    for rank_index, (peer_symbol, _value) in enumerate(ranked, start=1):
                        if peer_symbol == symbol_upper:
                            sector_rank = rank_index
                            break

                    if sector_rank is not None and sector_total and sector_total > 0:
                        sector_percentile = _safe_float(
                            (1 - ((sector_rank - 1) / sector_total)) * 100,
                            decimals=1,
                        )

                    peer_distribution = [
                        {
                            "symbol": peer_symbol,
                            "momentum_12_1_pct": _safe_float(value, decimals=2),
                        }
                        for peer_symbol, value in ranked[:15]
                    ]

    payload: Dict[str, Any] = {
        "symbol": symbol_upper,
        "period": period_upper,
        "computed_at": datetime.utcnow(),
        "last_data_date": last_data_timestamp,
        "returns_pct": {
            "r1m": r1m,
            "r3m": r3m,
            "r6m": r6m,
            "r12m": r12m,
            "momentum_12_1": momentum_12_1,
        },
        "momentum_score": score,
        "trend_label": trend_label,
        "sector": sector,
        "sector_rank": sector_rank,
        "sector_total": sector_total,
        "sector_percentile": sector_percentile,
        "peer_distribution": peer_distribution,
    }
    if warning:
        payload["data_quality_note"] = warning
    return StandardResponse(data=payload, meta=MetaData(count=len(peer_distribution)))


@router.get("/{symbol}/earnings-quality", response_model=StandardResponse[Dict[str, Any]])
async def get_earnings_quality(
    symbol: str,
    db: AsyncSession = Depends(get_db),
):
    """Earnings quality scorecard from quarterly accruals/cash conversion/persistence."""
    symbol_upper = symbol.upper().strip()
    if not symbol_upper:
        raise HTTPException(status_code=400, detail="Symbol is required")

    income_result = await db.execute(
        select(
            IncomeStatement.fiscal_year,
            IncomeStatement.fiscal_quarter,
            IncomeStatement.revenue,
            IncomeStatement.net_income,
            IncomeStatement.eps,
        )
        .where(
            IncomeStatement.symbol == symbol_upper,
            IncomeStatement.fiscal_quarter.isnot(None),
        )
        .order_by(IncomeStatement.fiscal_year.desc(), IncomeStatement.fiscal_quarter.desc())
        .limit(12)
    )
    cash_result = await db.execute(
        select(
            CashFlow.fiscal_year,
            CashFlow.fiscal_quarter,
            CashFlow.operating_cash_flow,
        )
        .where(
            CashFlow.symbol == symbol_upper,
            CashFlow.fiscal_quarter.isnot(None),
        )
        .order_by(CashFlow.fiscal_year.desc(), CashFlow.fiscal_quarter.desc())
        .limit(12)
    )
    balance_result = await db.execute(
        select(
            BalanceSheet.fiscal_year,
            BalanceSheet.fiscal_quarter,
            BalanceSheet.total_assets,
        )
        .where(
            BalanceSheet.symbol == symbol_upper,
            BalanceSheet.fiscal_quarter.isnot(None),
        )
        .order_by(BalanceSheet.fiscal_year.desc(), BalanceSheet.fiscal_quarter.desc())
        .limit(12)
    )

    income_rows = income_result.all()
    cash_map = {
        (row[0], row[1]): row[2]
        for row in cash_result.all()
        if row[0] is not None and row[1] is not None
    }
    asset_map = {
        (row[0], row[1]): row[2]
        for row in balance_result.all()
        if row[0] is not None and row[1] is not None
    }

    period_rows: List[Dict[str, Any]] = []
    for fiscal_year, fiscal_quarter, revenue, net_income, eps in income_rows:
        if fiscal_year is None or fiscal_quarter is None:
            continue

        key = (fiscal_year, fiscal_quarter)
        if key not in cash_map or key not in asset_map:
            continue

        operating_cash_flow = cash_map.get(key)
        total_assets = asset_map.get(key)
        accruals_ratio = _safe_divide(
            (net_income - operating_cash_flow)
            if net_income is not None and operating_cash_flow is not None
            else None,
            total_assets,
            scale=100,
            decimals=2,
        )
        revenue_quality = _safe_divide(
            operating_cash_flow,
            revenue,
            scale=100,
            decimals=2,
        )

        period_rows.append(
            {
                "period": f"Q{fiscal_quarter}-{fiscal_year}",
                "fiscal_year": fiscal_year,
                "fiscal_quarter": fiscal_quarter,
                "revenue": _safe_float(revenue, 2),
                "net_income": _safe_float(net_income, 2),
                "operating_cash_flow": _safe_float(operating_cash_flow, 2),
                "total_assets": _safe_float(total_assets, 2),
                "eps": _safe_float(eps, 4),
                "accruals_ratio_pct": accruals_ratio,
                "revenue_quality_pct": revenue_quality,
            }
        )

    if not period_rows:
        return StandardResponse(
            data={
                "symbol": symbol_upper,
                "computed_at": datetime.utcnow(),
                "series": [],
                "checks": [],
            },
            meta=MetaData(count=0),
            error="Insufficient quarterly statement coverage for earnings quality.",
        )

    latest = period_rows[0]
    previous = period_rows[1] if len(period_rows) > 1 else None

    eps_values = [row["eps"] for row in reversed(period_rows) if row.get("eps") is not None]
    earnings_persistence = None
    if len(eps_values) >= 4:
        eps_prev = np.array(eps_values[:-1], dtype=float)
        eps_curr = np.array(eps_values[1:], dtype=float)
        if np.std(eps_prev) > 0 and np.std(eps_curr) > 0:
            earnings_persistence = _safe_float(np.corrcoef(eps_prev, eps_curr)[0][1], 3)

    accrual_score = (
        _safe_float(max(0.0, 100 - min(abs(latest["accruals_ratio_pct"]) * 8, 100)), 2)
        if latest.get("accruals_ratio_pct") is not None
        else None
    )
    revenue_score = (
        _safe_float(max(0.0, min(latest["revenue_quality_pct"], 120) / 1.2), 2)
        if latest.get("revenue_quality_pct") is not None
        else None
    )
    persistence_score = (
        _safe_float(((earnings_persistence + 1) / 2) * 100, 2)
        if earnings_persistence is not None
        else None
    )

    component_scores = [
        item for item in (accrual_score, revenue_score, persistence_score) if item is not None
    ]
    quality_score = _safe_float(float(np.mean(component_scores)), 2) if component_scores else None
    grade = _grade_from_quality_score(quality_score)

    def _blend_score(row: Dict[str, Any]) -> float | None:
        parts: List[float] = []
        accrual_value = row.get("accruals_ratio_pct")
        revenue_value = row.get("revenue_quality_pct")
        if accrual_value is not None:
            parts.append(max(0.0, 100 - min(abs(float(accrual_value)) * 8, 100)))
        if revenue_value is not None:
            parts.append(max(0.0, min(float(revenue_value), 120) / 1.2))
        return float(np.mean(parts)) if parts else None

    trend = "Stable"
    latest_blend = _blend_score(latest)
    previous_blend = _blend_score(previous) if previous else None
    if latest_blend is not None and previous_blend is not None:
        delta = latest_blend - previous_blend
        if delta >= 5:
            trend = "Improving"
        elif delta <= -5:
            trend = "Declining"

    checks: List[str] = []
    if latest.get("accruals_ratio_pct") is not None and abs(latest["accruals_ratio_pct"]) <= 5:
        checks.append("Accruals ratio within ±5%")
    if latest.get("revenue_quality_pct") is not None and latest["revenue_quality_pct"] >= 80:
        checks.append("Cash conversion >= 80% of revenue")
    if earnings_persistence is not None and earnings_persistence >= 0.5:
        checks.append("EPS persistence correlation >= 0.5")

    payload: Dict[str, Any] = {
        "symbol": symbol_upper,
        "computed_at": datetime.utcnow(),
        "grade": grade,
        "quality_score": quality_score,
        "trend": trend,
        "accruals_ratio_pct": latest.get("accruals_ratio_pct"),
        "revenue_quality_pct": latest.get("revenue_quality_pct"),
        "earnings_persistence": earnings_persistence,
        "component_scores": {
            "accrual": accrual_score,
            "revenue_quality": revenue_score,
            "persistence": persistence_score,
        },
        "checks": checks,
        "series": period_rows[:8],
    }
    return StandardResponse(data=payload, meta=MetaData(count=len(period_rows[:8])))


@router.get("/{symbol}/smart-money", response_model=StandardResponse[Dict[str, Any]])
async def get_smart_money_flow(
    symbol: str,
    db: AsyncSession = Depends(get_db),
):
    """Institutional pressure proxy from foreign flow + block trade + volume spikes."""
    symbol_upper = symbol.upper().strip()
    if not symbol_upper:
        raise HTTPException(status_code=400, detail="Symbol is required")

    try:
        foreign_result = await db.execute(
            select(
                ForeignTrading.trade_date,
                ForeignTrading.buy_value,
                ForeignTrading.sell_value,
                ForeignTrading.net_value,
            )
            .where(ForeignTrading.symbol == symbol_upper)
            .order_by(ForeignTrading.trade_date.desc())
            .limit(60)
        )
        foreign_rows = foreign_result.all()
    except Exception as exc:
        await _rollback_after_query_error(db, f"Smart money foreign flow query for {symbol_upper}")
        logger.warning("Smart money foreign flow query failed for %s: %s", symbol_upper, exc)
        foreign_rows = []

    block_rows = await _load_block_trade_rows(db, symbol_upper, limit=60)

    end_date = date.today()
    start_date = end_date - timedelta(days=200)
    try:
        price_frame = await _load_price_frame(
            db=db,
            symbol=symbol_upper,
            start_date=start_date,
            end_date=end_date,
            source=settings.vnstock_source,
        )
    except Exception as exc:
        await _rollback_after_query_error(db, f"Smart money price frame load for {symbol_upper}")
        logger.warning("Smart money price frame load failed for %s: %s", symbol_upper, exc)
        price_frame = pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])

    synthetic_events: List[Dict[str, Any]] = []
    if not price_frame.empty and len(price_frame) > 40:
        enriched = price_frame.copy()
        enriched["avg_vol_20"] = enriched["volume"].rolling(20).mean()
        enriched["vol_ratio"] = enriched["volume"] / enriched["avg_vol_20"].replace(0, np.nan)
        enriched["prev_close"] = enriched["close"].shift(1)
        enriched["price_change_pct"] = (
            (enriched["close"] - enriched["prev_close"]) / enriched["prev_close"].replace(0, np.nan)
        ) * 100

        for row in enriched[enriched["vol_ratio"] >= 3].tail(25).itertuples(index=False):
            event_type = "accumulation" if (row.price_change_pct or 0) >= 0 else "distribution"
            synthetic_events.append(
                {
                    "date": row.time.strftime("%Y-%m-%d"),
                    "volume": int(row.volume) if row.volume is not None else None,
                    "value": _safe_float((row.close or 0) * (row.volume or 0), 2),
                    "type": event_type,
                    "source": "volume_spike_proxy",
                }
            )

    block_events: List[Dict[str, Any]] = []
    for row in block_rows[:25]:
        block_date = _format_date_value(row[0])
        if block_date is None:
            continue
        side = row[1]
        if side == "BUY":
            event_type = "accumulation"
        elif side == "SELL":
            event_type = "distribution"
        else:
            event_type = "unknown"
        block_events.append(
            {
                "date": block_date,
                "volume": int(row[2]) if row[2] is not None else None,
                "value": _safe_float(row[3], 2),
                "type": event_type,
                "source": "block_trade_table" if side else "block_trade_table_legacy_schema",
            }
        )

    merged_events = sorted(
        block_events + synthetic_events,
        key=lambda item: item["date"],
        reverse=True,
    )[:25]

    net_foreign_20d = _safe_float(
        sum(float(row[3] or 0) for row in foreign_rows[:20]),
        decimals=2,
    )
    block_buy_20d = _safe_float(
        sum(float(row[3] or 0) for row in block_rows[:20] if row[1] == "BUY"),
        decimals=2,
    )
    block_sell_20d = _safe_float(
        sum(float(row[3] or 0) for row in block_rows[:20] if row[1] == "SELL"),
        decimals=2,
    )

    spike_bias = sum(1 if item["type"] == "accumulation" else -1 for item in synthetic_events)
    flow_score = 0
    if (net_foreign_20d or 0) > 0:
        flow_score += 1
    elif (net_foreign_20d or 0) < 0:
        flow_score -= 1

    block_net_20d = (block_buy_20d or 0) - (block_sell_20d or 0)
    if block_net_20d > 0:
        flow_score += 1
    elif block_net_20d < 0:
        flow_score -= 1

    if spike_bias > 0:
        flow_score += 1
    elif spike_bias < 0:
        flow_score -= 1

    if flow_score >= 2:
        net_institutional = "buying"
    elif flow_score <= -2:
        net_institutional = "selling"
    else:
        net_institutional = "neutral"

    payload: Dict[str, Any] = {
        "symbol": symbol_upper,
        "computed_at": datetime.utcnow(),
        "net_institutional": net_institutional,
        "flow_score": flow_score,
        "net_foreign_20d_value": net_foreign_20d,
        "block_buy_20d_value": block_buy_20d,
        "block_sell_20d_value": block_sell_20d,
        "synthetic_block_bias": spike_bias,
        "block_trades": merged_events,
    }
    return StandardResponse(data=payload, meta=MetaData(count=len(merged_events)))


@router.get("/{symbol}/relative-rotation", response_model=StandardResponse[Dict[str, Any]])
async def get_relative_rotation(
    symbol: str,
    lookback_days: int = Query(default=260, ge=120, le=520),
    db: AsyncSession = Depends(get_db),
):
    """Relative Rotation Graph (RRG) snapshot for VN30 versus VNINDEX."""
    symbol_upper = symbol.upper().strip()
    if not symbol_upper:
        raise HTTPException(status_code=400, detail="Symbol is required")

    end_date = date.today()
    start_date = end_date - timedelta(days=max(lookback_days * 2, 320))
    universe_symbols = set(VN30_SYMBOLS)
    universe_symbols.add(symbol_upper)

    prices_result = await db.execute(
        select(StockPrice.symbol, StockPrice.time, StockPrice.close)
        .where(
            and_(
                StockPrice.symbol.in_(sorted(universe_symbols)),
                StockPrice.interval == "1D",
                StockPrice.time >= start_date,
                StockPrice.time <= end_date,
            )
        )
        .order_by(StockPrice.symbol, StockPrice.time)
    )
    index_result = await db.execute(
        select(StockIndex.time, StockIndex.close)
        .where(
            and_(
                StockIndex.index_code == "VNINDEX",
                StockIndex.time >= start_date,
                StockIndex.time <= end_date,
            )
        )
        .order_by(StockIndex.time)
    )

    price_frame = pd.DataFrame(prices_result.all(), columns=["symbol", "time", "close"])
    index_frame = pd.DataFrame(index_result.all(), columns=["time", "close_index"])

    if price_frame.empty or index_frame.empty:
        return StandardResponse(
            data={
                "symbol": symbol_upper,
                "benchmark": "VNINDEX",
                "computed_at": datetime.utcnow(),
                "selected": None,
                "universe": [],
            },
            meta=MetaData(count=0),
            error="Insufficient data for relative rotation.",
        )

    price_frame["close"] = pd.to_numeric(price_frame["close"], errors="coerce")
    price_frame = price_frame.dropna(subset=["close"])
    index_frame["close_index"] = pd.to_numeric(index_frame["close_index"], errors="coerce")
    index_frame = index_frame.dropna(subset=["close_index"])

    universe_points: List[Dict[str, Any]] = []
    for stock_symbol, group in price_frame.groupby("symbol"):
        merged = group.merge(index_frame, on="time", how="inner")
        if len(merged) < 80:
            continue

        rs_series = (merged["close"] / merged["close_index"]).replace([np.inf, -np.inf], np.nan)
        rs_series = rs_series.dropna() * 100
        if len(rs_series) < 80:
            continue

        rs_ratio, rs_momentum = _compute_rrg_metrics(rs_series)
        if rs_ratio is None or rs_momentum is None:
            continue

        trail_count = min(5, len(rs_series))
        trail: List[Dict[str, float | None]] = []
        for offset in range(trail_count):
            idx = len(rs_series) - trail_count + offset
            trail_ratio, trail_momentum = _compute_rrg_metrics(rs_series.iloc[: idx + 1])
            trail.append(
                {
                    "rs_ratio": trail_ratio,
                    "rs_momentum": trail_momentum,
                }
            )

        universe_points.append(
            {
                "symbol": stock_symbol,
                "rs_ratio": rs_ratio,
                "rs_momentum": rs_momentum,
                "quadrant": _classify_rrg_quadrant(rs_ratio, rs_momentum),
                "trail": trail,
            }
        )

    universe_points = sorted(
        universe_points,
        key=lambda item: (item.get("rs_ratio") is not None, item.get("rs_ratio")),
        reverse=True,
    )
    selected = next((item for item in universe_points if item["symbol"] == symbol_upper), None)

    payload: Dict[str, Any] = {
        "symbol": symbol_upper,
        "benchmark": "VNINDEX",
        "computed_at": datetime.utcnow(),
        "selected": selected,
        "universe": universe_points,
    }
    return StandardResponse(data=payload, meta=MetaData(count=len(universe_points)))


@router.get("/{symbol}/volume-flow", response_model=StandardResponse[Dict[str, Any]])
async def get_volume_flow_metric(
    symbol: str,
    period: str = Query(default="5Y"),
    source: str = Query(default=settings.vnstock_source, pattern=r"^(KBS|VCI|DNSE)$"),
    adjustment_mode: str = Query(default="raw", pattern=r"^(raw|adjusted)$"),
    db: AsyncSession = Depends(get_db),
):
    return await _get_quant_metric_alias_response(
        symbol=symbol,
        metric_name="volume-flow",
        period=period,
        source=source,
        adjustment_mode=adjustment_mode,
        db=db,
    )


@router.get("/{symbol}/seasonality", response_model=StandardResponse[Dict[str, Any]])
async def get_seasonality_metric(
    symbol: str,
    period: str = Query(default="5Y"),
    source: str = Query(default=settings.vnstock_source, pattern=r"^(KBS|VCI|DNSE)$"),
    adjustment_mode: str = Query(default="raw", pattern=r"^(raw|adjusted)$"),
    db: AsyncSession = Depends(get_db),
):
    return await _get_quant_metric_alias_response(
        symbol=symbol,
        metric_name="seasonality",
        period=period,
        source=source,
        adjustment_mode=adjustment_mode,
        db=db,
    )


@router.get("/{symbol}/rsi-seasonal", response_model=StandardResponse[Dict[str, Any]])
async def get_rsi_seasonal_metric(
    symbol: str,
    period: str = Query(default="5Y"),
    source: str = Query(default=settings.vnstock_source, pattern=r"^(KBS|VCI|DNSE)$"),
    adjustment_mode: str = Query(default="raw", pattern=r"^(raw|adjusted)$"),
    db: AsyncSession = Depends(get_db),
):
    return await _get_quant_metric_alias_response(
        symbol=symbol,
        metric_name="rsi-seasonal",
        period=period,
        source=source,
        adjustment_mode=adjustment_mode,
        db=db,
    )


@router.get("/{symbol}/bollinger-squeeze", response_model=StandardResponse[Dict[str, Any]])
async def get_bollinger_squeeze_metric(
    symbol: str,
    period: str = Query(default="5Y"),
    source: str = Query(default=settings.vnstock_source, pattern=r"^(KBS|VCI|DNSE)$"),
    adjustment_mode: str = Query(default="raw", pattern=r"^(raw|adjusted)$"),
    db: AsyncSession = Depends(get_db),
):
    return await _get_quant_metric_alias_response(
        symbol=symbol,
        metric_name="bollinger-squeeze",
        period=period,
        source=source,
        adjustment_mode=adjustment_mode,
        db=db,
    )


@router.get("/{symbol}/atr-regime", response_model=StandardResponse[Dict[str, Any]])
async def get_atr_regime_metric(
    symbol: str,
    period: str = Query(default="5Y"),
    source: str = Query(default=settings.vnstock_source, pattern=r"^(KBS|VCI|DNSE)$"),
    adjustment_mode: str = Query(default="raw", pattern=r"^(raw|adjusted)$"),
    db: AsyncSession = Depends(get_db),
):
    return await _get_quant_metric_alias_response(
        symbol=symbol,
        metric_name="atr-regime",
        period=period,
        source=source,
        adjustment_mode=adjustment_mode,
        db=db,
    )


@router.get("/{symbol}/sortino-monthly", response_model=StandardResponse[Dict[str, Any]])
async def get_sortino_monthly_metric(
    symbol: str,
    period: str = Query(default="5Y"),
    source: str = Query(default=settings.vnstock_source, pattern=r"^(KBS|VCI|DNSE)$"),
    adjustment_mode: str = Query(default="raw", pattern=r"^(raw|adjusted)$"),
    db: AsyncSession = Depends(get_db),
):
    return await _get_quant_metric_alias_response(
        symbol=symbol,
        metric_name="sortino-monthly",
        period=period,
        source=source,
        adjustment_mode=adjustment_mode,
        db=db,
    )


@router.get("/{symbol}/macd-crossover", response_model=StandardResponse[Dict[str, Any]])
async def get_macd_crossover_metric(
    symbol: str,
    period: str = Query(default="5Y"),
    source: str = Query(default=settings.vnstock_source, pattern=r"^(KBS|VCI|DNSE)$"),
    adjustment_mode: str = Query(default="raw", pattern=r"^(raw|adjusted)$"),
    db: AsyncSession = Depends(get_db),
):
    return await _get_quant_metric_alias_response(
        symbol=symbol,
        metric_name="macd-crossover",
        period=period,
        source=source,
        adjustment_mode=adjustment_mode,
        db=db,
    )


@router.get("/{symbol}/parkinson-volatility", response_model=StandardResponse[Dict[str, Any]])
async def get_parkinson_volatility_metric(
    symbol: str,
    period: str = Query(default="5Y"),
    source: str = Query(default=settings.vnstock_source, pattern=r"^(KBS|VCI|DNSE)$"),
    adjustment_mode: str = Query(default="raw", pattern=r"^(raw|adjusted)$"),
    db: AsyncSession = Depends(get_db),
):
    return await _get_quant_metric_alias_response(
        symbol=symbol,
        metric_name="parkinson-volatility",
        period=period,
        source=source,
        adjustment_mode=adjustment_mode,
        db=db,
    )


@router.get("/{symbol}/ema-respect", response_model=StandardResponse[Dict[str, Any]])
async def get_ema_respect_metric(
    symbol: str,
    period: str = Query(default="5Y"),
    source: str = Query(default=settings.vnstock_source, pattern=r"^(KBS|VCI|DNSE)$"),
    adjustment_mode: str = Query(default="raw", pattern=r"^(raw|adjusted)$"),
    db: AsyncSession = Depends(get_db),
):
    return await _get_quant_metric_alias_response(
        symbol=symbol,
        metric_name="ema-respect",
        period=period,
        source=source,
        adjustment_mode=adjustment_mode,
        db=db,
    )


@router.get("/{symbol}/drawdown-recovery", response_model=StandardResponse[Dict[str, Any]])
async def get_drawdown_recovery_metric(
    symbol: str,
    period: str = Query(default="5Y"),
    source: str = Query(default=settings.vnstock_source, pattern=r"^(KBS|VCI|DNSE)$"),
    adjustment_mode: str = Query(default="raw", pattern=r"^(raw|adjusted)$"),
    db: AsyncSession = Depends(get_db),
):
    return await _get_quant_metric_alias_response(
        symbol=symbol,
        metric_name="drawdown-recovery",
        period=period,
        source=source,
        adjustment_mode=adjustment_mode,
        db=db,
    )


@router.get("/{symbol}/gap-analysis", response_model=StandardResponse[Dict[str, Any]])
async def get_gap_analysis_metric(
    symbol: str,
    period: str = Query(default="5Y"),
    source: str = Query(default=settings.vnstock_source, pattern=r"^(KBS|VCI|DNSE)$"),
    adjustment_mode: str = Query(default="raw", pattern=r"^(raw|adjusted)$"),
    db: AsyncSession = Depends(get_db),
):
    return await _get_quant_metric_alias_response(
        symbol=symbol,
        metric_name="gap-analysis",
        period=period,
        source=source,
        adjustment_mode=adjustment_mode,
        db=db,
    )


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
    period: str = Query(default="5Y"),
    source: str = Query(default=settings.vnstock_source, pattern=r"^(KBS|VCI|DNSE)$"),
    adjustment_mode: str = Query(default="raw", pattern=r"^(raw|adjusted)$"),
    db: AsyncSession = Depends(get_db),
):
    symbol_upper = symbol.upper().strip()
    if not symbol_upper:
        raise HTTPException(status_code=400, detail="Symbol is required")

    requested_metrics = [
        _normalize_metric_name(item) for item in metrics.split(",") if item.strip()
    ]
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

    period_upper = _normalize_quant_period(period)
    end_date = date.today()
    start_date = _resolve_start_date(period_upper, end_date)

    frame, warning = await _load_quant_frame_with_warning(
        db=db,
        symbol=symbol_upper,
        start_date=start_date,
        end_date=end_date,
        source=source,
        period=period_upper,
        adjustment_mode=adjustment_mode,
    )
    last_data_timestamp = _resolve_frame_last_timestamp(frame)

    min_points_required = 30
    observed_points = int(len(frame))

    if frame.empty or observed_points < min_points_required:
        payload = QuantResponseData(
            symbol=symbol_upper,
            period=period_upper,
            adjustment_mode=_normalize_adjustment_mode(adjustment_mode),
            computed_at=last_data_timestamp or datetime.utcnow(),
            last_data_date=last_data_timestamp,
            metrics={},
            warning=warning,
        )
        return StandardResponse(
            data=payload,
            meta=MetaData(
                count=0,
                symbol=symbol_upper,
                data_points=observed_points,
                last_data_date=last_data_timestamp.isoformat() if last_data_timestamp else None,
            ),
            error=(
                f"Insufficient Data: Expected at least {min_points_required} sessions, "
                f"got {observed_points}."
            ),
        )

    calculators = _get_quant_calculators()

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
        adjustment_mode=_normalize_adjustment_mode(adjustment_mode),
        computed_at=last_data_timestamp or datetime.utcnow(),
        last_data_date=last_data_timestamp,
        metrics=computed_metrics,
        warning=warning,
    )
    return StandardResponse(
        data=payload,
        meta=MetaData(
            count=len(computed_metrics),
            symbol=symbol_upper,
            data_points=observed_points,
            last_data_date=last_data_timestamp.isoformat() if last_data_timestamp else None,
        ),
    )
