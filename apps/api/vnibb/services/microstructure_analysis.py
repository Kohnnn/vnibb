"""Mongo-backed microstructure analytics for technical widgets."""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import UTC, datetime
from functools import lru_cache
from math import isfinite, sqrt
from typing import Any
from zoneinfo import ZoneInfo

from vnibb.core.config import settings
from vnibb.core.price_units import normalize_price_record
from vnibb.services.intraday_availability import (
    FEED_ERROR_COPY,
    IntradayFeed,
    intraday_feed,
    observation_time,
    provider_feed_failure,
    retained_tick_feed,
    retained_trade_time,
)
from vnibb.services.mongo_market_data_service import MongoReadError, get_mongo_market_data_service

logger = logging.getLogger(__name__)
TRADE_FEATURES = {"deep_trades", "volume_profile", "vwap", "footprint"}


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if isfinite(parsed) else default


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError, OverflowError):
        return default


def _interval_seconds(interval: str) -> int:
    normalized = (interval or "5m").lower().strip()
    if normalized.endswith("m"):
        return max(60, _to_int(normalized[:-1], 5) * 60)
    if normalized.endswith("h"):
        return max(3600, _to_int(normalized[:-1], 1) * 3600)
    return 5 * 60


def _bar_key(ts: datetime, interval: str) -> str:
    seconds = _interval_seconds(interval)
    epoch = int(ts.timestamp())
    floored = epoch - (epoch % seconds)
    return datetime.fromtimestamp(floored, tz=ts.tzinfo).isoformat()


def _normalize_trade(row: dict[str, Any], market_tz: ZoneInfo, now: datetime) -> dict[str, Any] | None:
    raw = row.get("raw")
    if not isinstance(raw, dict):
        return None
    trade_time = observation_time(retained_trade_time(row), naive_tz=market_tz)
    admitted = normalize_price_record(
        {"price": raw.get("price"), "price_unit": row.get("price_unit", row.get("priceUnit", "unknown"))},
        symbol=str(row.get("symbol") or ""), source=row.get("price_source") or row.get("source"),
    )
    if admitted["price_unit"] != "VND":
        return None
    price = _to_float(admitted.get("price"))
    volume = _to_int(raw.get("volume"))
    if trade_time is None or trade_time > now or price <= 0 or volume <= 0:
        return None
    return {
        "time": trade_time.astimezone(market_tz).isoformat(),
        "timestamp": trade_time.astimezone(market_tz),
        "price": price,
        "volume": volume,
        "match_type": str(raw.get("match_type") or "Unknown"),
        "trade_id": raw.get("id"),
    }


def _match_side(match_type: str) -> str:
    normalized = match_type.strip().lower()
    if normalized == "buy":
        return "buy"
    if normalized == "sell":
        return "sell"
    return "unknown"


class MicrostructureAnalysisService:
    def __init__(self) -> None:
        self.mongo = get_mongo_market_data_service()

    async def analyze(
        self,
        symbol: str,
        *,
        features: set[str] | None = None,
        interval: str = "5m",
        lookback_days: int = 7,
        value_area_pct: float = 0.7,
        fractal_window: int = 2,
        imbalance_ratio: float = 3.0,
    ) -> dict[str, Any]:
        symbol_upper = symbol.upper()
        requested = self._normalize_features(features)
        raw_trades, raw_depth, eod_prices, trade_feed, input_errors = await self._load_inputs(
            symbol_upper, lookback_days, requested,
        )
        now = datetime.now(UTC)
        market_tz = ZoneInfo(settings.vn_timezone)
        trades = [trade for row in raw_trades if (trade := _normalize_trade(row, market_tz, now))]
        if trade_feed is None:
            trade_feed = retained_tick_feed(
                raw_trades, symbol_upper, lookback_days=lookback_days, now=now,
                admitted_times=[trade["timestamp"] for trade in trades],
            )
            if trade_feed["status"] == "unusable":
                input_errors.append(FEED_ERROR_COPY["unusable"])

        deep_trades = self._calculate_deep_trades(trades, interval) if "deep_trades" in requested else self._empty_deep_trades()
        volume_profile = self._calculate_volume_profile(raw_depth, trades, value_area_pct) if "volume_profile" in requested else self._empty_volume_profile()
        vwap = self._calculate_vwap(trades, interval) if "vwap" in requested else self._empty_vwap()
        price_action = self._calculate_price_action(eod_prices, fractal_window) if "price_action" in requested else self._empty_price_action()
        footprint = self._calculate_footprint(trades, interval, imbalance_ratio) if "footprint" in requested else self._empty_footprint()

        unsupported = []
        if requested & TRADE_FEATURES and trade_feed["status"] == "empty":
            unsupported.append("No retained trade ticks returned for this symbol and lookback.")
        if "volume_profile" in requested and not raw_depth:
            unsupported.append("No retained price-depth rows returned for this symbol.")
        unsupported.append("True liquidity heat maps require time-stamped Level 2 snapshots.")

        return {
            "symbol": symbol_upper,
            "source": "mongodb:frb",
            "trade_feed": trade_feed,
            "input_errors": input_errors,
            "data_quality": {
                "deep_trades": "match_type_proxy" if trades else "unavailable",
                "volume_profile": volume_profile["quality"],
                "vwap": "trade_ticks" if trades else "unavailable",
                "price_action": "eod_ohlc" if eod_prices else "unavailable",
                "footprint": "match_type_proxy" if trades else "unavailable",
                "liquidity_heatmap": "unsupported",
            },
            "unsupported_reasons": unsupported,
            "deep_trades": deep_trades,
            "volume_profile": volume_profile,
            "vwap": vwap,
            "price_action": price_action,
            "footprint": footprint,
        }

    def _normalize_features(self, features: set[str] | None) -> set[str]:
        aliases = {
            "cvd": "deep_trades",
            "delta": "deep_trades",
            "profile": "volume_profile",
            "volume": "volume_profile",
            "pa": "price_action",
            "price": "price_action",
        }
        all_features = {"deep_trades", "volume_profile", "vwap", "price_action", "footprint"}
        if not features:
            return all_features
        normalized = {aliases.get(feature, feature) for feature in features}
        selected = normalized & all_features
        return selected or all_features

    async def _load_inputs(
        self,
        symbol: str,
        lookback_days: int,
        features: set[str],
    ) -> tuple[list[dict], list[dict], list[dict], IntradayFeed | None, list[str]]:
        trades, depth, eod = await asyncio.gather(
            self.mongo.get_intraday_trades(symbol, lookback_days=lookback_days) if features & TRADE_FEATURES else self._not_requested(),
            self.mongo.get_price_depth(symbol) if "volume_profile" in features else self._not_requested(),
            self.mongo.get_eod_prices(symbol, lookback_days=max(lookback_days, 365)) if "price_action" in features else self._not_requested(),
            return_exceptions=True,
        )
        now = datetime.now(UTC)
        errors = []
        for label, result in (("Trade ticks", trades), ("Price depth", depth), ("Daily prices", eod)):
            if isinstance(result, asyncio.CancelledError):
                raise result
            if isinstance(result, Exception):
                logger.warning("Microstructure %s read failed for %s: %s", label, symbol, type(result).__name__)
                errors.append(f"{label}: {self._input_failure(result)[1]}")

        feed = None
        if not features & TRADE_FEATURES or isinstance(trades, Exception):
            feed = intraday_feed(
                self._input_failure(trades)[0] if isinstance(trades, Exception) else "not_requested",
                source="mongodb" if isinstance(trades, Exception) else None,
                delivery="retained", fetched_at=now,
            )
        return (
            trades if isinstance(trades, list) else [], depth if isinstance(depth, list) else [],
            eod if isinstance(eod, list) else [], feed, errors,
        )

    @staticmethod
    def _input_failure(exc: Exception):
        if isinstance(exc, MongoReadError) and exc.state == "timeout":
            return "timeout", FEED_ERROR_COPY["timeout"]
        return provider_feed_failure(exc)

    @staticmethod
    async def _not_requested() -> list[dict[str, Any]]:
        return []

    def _empty_deep_trades(self) -> dict[str, Any]:
        return {"quality": "not_requested", "bars": [], "latest_cvd": 0, "total_aggressive_buy_volume": 0, "total_aggressive_sell_volume": 0}

    def _empty_volume_profile(self) -> dict[str, Any]:
        return {"quality": "not_requested", "bins": [], "poc_price": None, "vah_price": None, "val_price": None, "total_volume": 0}

    def _empty_vwap(self) -> dict[str, Any]:
        return {"quality": "not_requested", "points": []}

    def _empty_price_action(self) -> dict[str, Any]:
        return {"quality": "not_requested", "trend": "neutral", "candles": [], "swings": []}

    def _empty_footprint(self) -> dict[str, Any]:
        return {"quality": "not_requested", "bars": []}

    def _calculate_deep_trades(self, trades: list[dict[str, Any]], interval: str) -> dict[str, Any]:
        bars: dict[str, dict[str, Any]] = {}
        cumulative_delta = 0

        for trade in trades:
            key = _bar_key(trade["timestamp"], interval)
            bar = bars.setdefault(
                key,
                {
                    "time": key,
                    "aggressive_buy_volume": 0,
                    "aggressive_sell_volume": 0,
                    "unknown_volume": 0,
                    "delta": 0,
                    "cumulative_delta": 0,
                    "trade_count": 0,
                },
            )
            side = _match_side(trade["match_type"])
            if side == "buy":
                bar["aggressive_buy_volume"] += trade["volume"]
            elif side == "sell":
                bar["aggressive_sell_volume"] += trade["volume"]
            else:
                bar["unknown_volume"] += trade["volume"]
            bar["trade_count"] += 1

        ordered = [bars[key] for key in sorted(bars)]
        for bar in ordered:
            bar["delta"] = bar["aggressive_buy_volume"] - bar["aggressive_sell_volume"]
            cumulative_delta += bar["delta"]
            bar["cumulative_delta"] = cumulative_delta

        return {
            "quality": "match_type_proxy" if ordered else "unavailable",
            "bars": ordered,
            "latest_cvd": cumulative_delta,
            "total_aggressive_buy_volume": sum(bar["aggressive_buy_volume"] for bar in ordered),
            "total_aggressive_sell_volume": sum(bar["aggressive_sell_volume"] for bar in ordered),
        }

    def _calculate_volume_profile(
        self,
        raw_depth: list[dict[str, Any]],
        trades: list[dict[str, Any]],
        value_area_pct: float,
    ) -> dict[str, Any]:
        bins: dict[float, dict[str, Any]] = {}
        quality = "unavailable"

        for row in raw_depth:
            raw = row.get("raw") or {}
            admitted = normalize_price_record(
                {"price": raw.get("price"), "price_unit": row.get("price_unit", row.get("priceUnit", "unknown"))},
                symbol=str(row.get("symbol") or ""), source=row.get("price_source") or row.get("source"),
            )
            if admitted["price_unit"] != "VND":
                continue
            price = _to_float(admitted.get("price"))
            volume = _to_float(raw.get("volume"))
            if price <= 0 or volume <= 0:
                continue
            bins[price] = {
                "price": price,
                "volume": volume,
                "buy_volume": _to_float(raw.get("buy_volume")),
                "sell_volume": _to_float(raw.get("sell_volume")),
            }
            quality = "volume_at_price"

        if not bins and trades:
            for trade in trades:
                price = trade["price"]
                current = bins.setdefault(price, {"price": price, "volume": 0, "buy_volume": 0, "sell_volume": 0})
                current["volume"] += trade["volume"]
                side = _match_side(trade["match_type"])
                if side == "buy":
                    current["buy_volume"] += trade["volume"]
                elif side == "sell":
                    current["sell_volume"] += trade["volume"]
            quality = "trade_ticks"

        profile = sorted(bins.values(), key=lambda item: item["price"])
        if not profile:
            return {"quality": quality, "bins": [], "poc_price": None, "vah_price": None, "val_price": None, "total_volume": 0}

        total_volume = sum(item["volume"] for item in profile)
        poc_index = max(range(len(profile)), key=lambda idx: profile[idx]["volume"])
        target = total_volume * min(0.95, max(0.5, value_area_pct))
        included = {poc_index}
        covered = profile[poc_index]["volume"]
        left = poc_index - 1
        right = poc_index + 1

        while covered < target and (left >= 0 or right < len(profile)):
            left_volume = profile[left]["volume"] if left >= 0 else -1
            right_volume = profile[right]["volume"] if right < len(profile) else -1
            if left_volume >= right_volume and left >= 0:
                included.add(left)
                covered += left_volume
                left -= 1
            elif right < len(profile):
                included.add(right)
                covered += right_volume
                right += 1
            else:
                break

        selected = sorted(included)
        return {
            "quality": quality,
            "bins": profile,
            "poc_price": profile[poc_index]["price"],
            "vah_price": profile[selected[-1]]["price"],
            "val_price": profile[selected[0]]["price"],
            "total_volume": total_volume,
        }

    def _calculate_vwap(self, trades: list[dict[str, Any]], interval: str) -> dict[str, Any]:
        bars: dict[str, dict[str, Any]] = {}
        for trade in trades:
            key = _bar_key(trade["timestamp"], interval)
            bar = bars.setdefault(
                key,
                {"time": key, "volume": 0, "notional": 0.0, "prices": []},
            )
            bar["volume"] += trade["volume"]
            bar["notional"] += trade["price"] * trade["volume"]
            bar["prices"].append((trade["price"], trade["volume"]))

        cumulative_volume = 0
        cumulative_notional = 0.0
        weighted_prices: list[tuple[float, int]] = []
        points = []
        for key in sorted(bars):
            bar = bars[key]
            cumulative_volume += bar["volume"]
            cumulative_notional += bar["notional"]
            weighted_prices.extend(bar["prices"])
            vwap = cumulative_notional / cumulative_volume if cumulative_volume > 0 else None
            variance = 0.0
            if vwap is not None and cumulative_volume > 0:
                variance = sum(volume * ((price - vwap) ** 2) for price, volume in weighted_prices) / cumulative_volume
            sd = sqrt(variance)
            points.append(
                {
                    "time": key,
                    "volume": bar["volume"],
                    "vwap": vwap,
                    "upper1": vwap + sd if vwap is not None else None,
                    "lower1": vwap - sd if vwap is not None else None,
                    "upper2": vwap + (2 * sd) if vwap is not None else None,
                    "lower2": vwap - (2 * sd) if vwap is not None else None,
                }
            )
        return {"quality": "trade_ticks" if points else "unavailable", "points": points}

    def _calculate_price_action(self, eod_prices: list[dict[str, Any]], fractal_window: int) -> dict[str, Any]:
        candles = []
        for row in eod_prices:
            open_price = _to_float(row.get("open"))
            high = _to_float(row.get("high"))
            low = _to_float(row.get("low"))
            close = _to_float(row.get("close"))
            if high <= 0 or low <= 0 or close <= 0:
                continue
            candles.append(
                {
                    "time": row.get("tradeDate").isoformat() if isinstance(row.get("tradeDate"), datetime) else str(row.get("tradeDate")),
                    "open": open_price,
                    "high": high,
                    "low": low,
                    "close": close,
                    "body_size": abs(open_price - close),
                    "upper_wick": high - max(open_price, close),
                    "lower_wick": min(open_price, close) - low,
                }
            )

        window = max(1, min(fractal_window, 10))
        swings = []
        for index in range(window, len(candles) - window):
            candle = candles[index]
            before = candles[index - window : index]
            after = candles[index + 1 : index + window + 1]
            if all(candle["high"] > item["high"] for item in before + after):
                swings.append({"type": "high", "time": candle["time"], "price": candle["high"]})
            if all(candle["low"] < item["low"] for item in before + after):
                swings.append({"type": "low", "time": candle["time"], "price": candle["low"]})

        recent_highs = [item for item in swings if item["type"] == "high"][-2:]
        recent_lows = [item for item in swings if item["type"] == "low"][-2:]
        trend = "neutral"
        if len(recent_highs) == 2 and len(recent_lows) == 2:
            if recent_highs[-1]["price"] > recent_highs[-2]["price"] and recent_lows[-1]["price"] > recent_lows[-2]["price"]:
                trend = "uptrend"
            elif recent_highs[-1]["price"] < recent_highs[-2]["price"] and recent_lows[-1]["price"] < recent_lows[-2]["price"]:
                trend = "downtrend"

        return {"quality": "eod_ohlc" if candles else "unavailable", "trend": trend, "candles": candles[-60:], "swings": swings[-20:]}

    def _calculate_footprint(self, trades: list[dict[str, Any]], interval: str, imbalance_ratio: float) -> dict[str, Any]:
        bars: dict[str, dict[float, dict[str, Any]]] = defaultdict(dict)
        for trade in trades:
            key = _bar_key(trade["timestamp"], interval)
            level = bars[key].setdefault(trade["price"], {"price": trade["price"], "bid_volume": 0, "ask_volume": 0})
            side = _match_side(trade["match_type"])
            if side == "buy":
                level["ask_volume"] += trade["volume"]
            elif side == "sell":
                level["bid_volume"] += trade["volume"]

        output = []
        ratio = max(1.0, imbalance_ratio)
        cumulative_delta = 0
        for key in sorted(bars):
            levels = sorted(bars[key].values(), key=lambda item: item["price"])
            if not levels:
                continue
            bar_delta = sum(item["ask_volume"] - item["bid_volume"] for item in levels)
            cumulative_delta += bar_delta
            max_level = max(levels, key=lambda item: item["ask_volume"] + item["bid_volume"])
            for index, level in enumerate(levels):
                diagonal_bid = levels[index - 1]["bid_volume"] if index > 0 else 0
                diagonal_ask = levels[index + 1]["ask_volume"] if index + 1 < len(levels) else 0
                level["imbalance"] = None
                if diagonal_bid > 0 and level["ask_volume"] >= diagonal_bid * ratio:
                    level["imbalance"] = "buy"
                elif diagonal_ask > 0 and level["bid_volume"] >= diagonal_ask * ratio:
                    level["imbalance"] = "sell"
            output.append(
                {
                    "time": key,
                    "delta": bar_delta,
                    "cumulative_delta": cumulative_delta,
                    "bar_poc_price": max_level["price"],
                    "levels": levels,
                }
            )

        return {"quality": "match_type_proxy" if output else "unavailable", "bars": output[-24:]}


@lru_cache(maxsize=1)
def get_microstructure_analysis_service() -> MicrostructureAnalysisService:
    return MicrostructureAnalysisService()
