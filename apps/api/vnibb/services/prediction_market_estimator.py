"""Odds-to-estimate quantitative computations for prediction markets.

Phase 7.5 implements four functions, each a pure-function-ish transform
over the cached `PredictionMarket` rows. Caching is handled in
`vnibb.core.cache`; this module owns the math + the canonical keyword
matchers used to bucket markets.

Buckets we recognise:

* `cpi` — markets whose question mentions CPI, headline inflation,
  core CPI, or other inflation markers. We extract a numeric threshold
  from the question via a small regex sweep (e.g. "Core CPI YoY > 3.0%")
  and bucket probabilities on either side of that threshold.
* `fed` — markets mentioning Fed / FOMC / "rate cut" / "rate hike" /
  Powell, plus a small heuristic that promotes any contract phrased as
  "... in {Dec|Mar|...}" into the implied-meeting-date bucket.
* `recession` — markets whose question starts with "US recession"
  or "global recession" (etc.) for a given year.
* `macro` — composite of cpi + fed + recession + Polymarket SPX closes.

The numeric output is intentionally approximate; this is a sentiment /
positioning signal, not a forecast. Documentation lives in
`docs/PREDICTION_MARKET_ESTIMATORS.md` (TODO: write in a follow-up).
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.cache import coerce_estimator_payload, estimation_cache
from vnibb.models.prediction_market import PredictionMarket
from vnibb.services.prediction_market_service import category_taxonomy  # noqa: F401


# ---------------------------------------------------------------------------
# Keyword matchers
# ---------------------------------------------------------------------------

CPI_KEYWORDS = (
    "cpi",
    "core cpi",
    "core inflation",
    "headline inflation",
    "headline cpi",
    "inflation rate",
)

FED_KEYWORDS = (
    "fed",
    "fomc",
    "rate cut",
    "rate hike",
    "powell",
    "federal reserve",
    "interest rate",
)

RECESSION_KEYWORDS = (
    "us recession",
    "global recession",
    "global recession in",
    "us recession in",
    "recession in {year}",
)

SPX_KEYWORDS = (
    "s&p",
    "s&p 500",
    "spx",
    "sp500",
)


_FOMC_MONTHS = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}

_FOMC_MEETING_KEYWORDS = ("fomc", "federal reserve", "interest rate", "rate cut", "rate hike", "fed", "powell")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _match_any(text: str, keywords: tuple[str, ...]) -> bool:
    lower = text.lower()
    return any(keyword in lower for keyword in keywords)


def _extract_threshold(question: str) -> float | None:
    """Extract a percentage threshold from a CPI-style question.

    Returns a `low` and `high` as a 2-tuple, or None if the question does not
    look numeric. Tries a few regex sweeps so titles like "Core CPI > 3.0%"
    and "headline cpi above 2.5%" both resolve.
    """
    lowered = question.lower()
    match = re.search(
        r"(?:>|≥|<|≤|over|under|above|below|more than|less than|at least|at most)\s*(\d+(?:\.\d+)?)\s*%?",
        lowered,
    )
    if match:
        return float(match.group(1))
    match = re.search(
        r"(\d+(?:\.\d+)?)\s*%\s*(?:or more|or above|or less|or below|>|≥|<|≤|over|under)",
        lowered,
    )
    if match:
        return float(match.group(1))
    return None


def _safe_value(market: PredictionMarket) -> float:
    if isinstance(market.outcome_prices, list) and len(market.outcome_prices) > 0:
        first = market.outcome_prices[0]
        if isinstance(first, (int, float)):
            return float(first)
    return 0.0


def _weighted_percentile(samples: list[float], weights: list[float], percentile: float) -> float:
    """Linear-interpolated weighted percentile. `percentile` in [0, 1]."""
    if not samples:
        return 0.0
    pairs = sorted(zip(samples, weights))
    total_weight = sum(weight for _, weight in pairs)
    if total_weight <= 0:
        return float(pairs[len(pairs) // 2][0])
    target = percentile * total_weight
    cumulative = 0.0
    prev_value = pairs[0][0]
    prev_center = 0.0
    for value, weight in pairs:
        cumulative += weight
        center = cumulative - weight / 2.0
        if center >= target:
            if center == prev_center:
                return float(value)
            frac = (target - prev_center) / (center - prev_center)
            return float(prev_value + frac * (value - prev_value))
        prev_value = value
        prev_center = center
    return float(pairs[-1][0])


# ---------------------------------------------------------------------------
# Estimators
# ---------------------------------------------------------------------------


async def _load_active_markets(db: AsyncSession) -> list[PredictionMarket]:
    result = await db.execute(select(PredictionMarket).where(PredictionMarket.active.is_(True)))
    return list(result.scalars().all())


async def estimate_cpi(db: AsyncSession) -> dict[str, Any]:
    """Aggregate weighted CPI bucket probabilities into p10/25/50/75/90.

    Phase 8: each contract's YES probability becomes a weight on its
    threshold bin (e.g. "CPI > 3.0% at 22%" contributes 0.22 mass at 3.0).
    The previous implementation treated the threshold itself as a sample
    which produced a distribution centred on the contract wording, not on
    the implied CPI estimate.
    """
    cache_key = "prediction-markets:estimate:cpi"

    async def loader() -> dict[str, Any]:
        markets = await _load_active_markets(db)
        matching = [
            market
            for market in markets
            if _match_any(f"{market.question} {market.description or ''}", CPI_KEYWORDS)
        ]
        if not matching:
            return _empty_cpi()

        bins: list[tuple[float, float]] = []  # (threshold, probability_mass)
        total_liquidity = 0.0
        for market in matching:
            threshold = _extract_threshold(market.question)
            if threshold is None:
                continue
            mass = max(_safe_value(market), 0.01)
            bins.append((threshold, mass))
            if isinstance(market.liquidity, (int, float)):
                total_liquidity += float(market.liquidity)
        if not bins:
            return _empty_cpi()

        samples = [threshold for threshold, _ in bins]
        weights = [mass for _, mass in bins]
        confidence = _confidence_score(len(bins), total_liquidity)
        return {
            "date": datetime.utcnow().date().isoformat(),
            "n_markets": len(matching),
            "p10": round(_weighted_percentile(samples, weights, 0.10), 3),
            "p25": round(_weighted_percentile(samples, weights, 0.25), 3),
            "p50": round(_weighted_percentile(samples, weights, 0.50), 3),
            "p75": round(_weighted_percentile(samples, weights, 0.75), 3),
            "p90": round(_weighted_percentile(samples, weights, 0.90), 3),
            "confidence": round(confidence, 3),
            "schema_version": 8,
            "last_updated": datetime.utcnow().isoformat(),
        }

    result = await estimation_cache.get_or_set(cache_key, loader)
    return coerce_estimator_payload(result)


def _empty_cpi() -> dict[str, Any]:
    return {
        "date": datetime.utcnow().date().isoformat(),
        "n_markets": 0,
        "p10": 0.0,
        "p25": 0.0,
        "p50": 0.0,
        "p75": 0.0,
        "p90": 0.0,
        "confidence": 0.0,
        "schema_version": 8,
        "last_updated": datetime.utcnow().isoformat(),
    }


def _confidence_score(n_markets: int, total_liquidity: float) -> float:
    """Map (n_markets, total_liquidity) onto a 0-1 confidence score.

    Saturates at 8 markets / $250k liquidity so a single mega-market
    contract doesn't push the score to 1.0 on its own.
    """
    market_term = min(n_markets / 8.0, 1.0)
    liquidity_term = min(total_liquidity / 250_000.0, 1.0)
    return 0.5 * market_term + 0.5 * liquidity_term


async def estimate_fed(db: AsyncSession) -> dict[str, Any]:
    """Estimate the next four FOMC-meeting probabilities (cut/hold/hike)."""
    cache_key = "prediction-markets:estimate:fed"

    async def loader() -> dict[str, Any]:
        markets = await _load_active_markets(db)
        matching = [
            market
            for market in markets
            if _match_any(f"{market.question} {market.description or ''}", FED_KEYWORDS)
        ]
        # Bucket contracts by year-month inferred from the question's "in {Month}"
        # close phrase or the market end_date.
        buckets: dict[str, dict[str, float]] = defaultdict(
            lambda: {"cut": 0.0, "hold": 0.0, "hike": 0.0, "weight": 0.0}
        )
        for market in matching:
            label = _infer_fomc_label(market)
            if label is None:
                continue
            yes_price = _safe_value(market)
            question = market.question.lower()
            if "hike" in question or "increase" in question or "+25bps" in question:
                buckets[label]["hike"] += yes_price
            elif "cut" in question or "reduce" in question or "-25bps" in question or "lower" in question:
                buckets[label]["cut"] += yes_price
            else:
                # "hold" / "pause" / "no change" bucket
                buckets[label]["hold"] += yes_price
            buckets[label]["weight"] += 1.0
        meetings: list[dict[str, Any]] = []
        total_liquidity = 0.0
        for label, aggregates in sorted(buckets.items()):
            total = aggregates["cut"] + aggregates["hold"] + aggregates["hike"]
            if total <= 0:
                continue
            meetings.append(
                {
                    "meeting_date": label,
                    "p_cut": round(aggregates["cut"] / total, 4),
                    "p_hold": round(aggregates["hold"] / total, 4),
                    "p_hike": round(aggregates["hike"] / total, 4),
                    "implied_terminal_rate": _infer_terminal_rate(aggregates),
                }
            )
        for market in matching:
            if isinstance(market.liquidity, (int, float)):
                total_liquidity += float(market.liquidity)
        return {
            "meetings": meetings[:4],
            "n_markets": len(matching),
            "confidence": round(_confidence_score(len(matching), total_liquidity), 3),
            "schema_version": 8,
            "last_updated": datetime.utcnow().isoformat(),
        }

    return coerce_estimator_payload(await estimation_cache.get_or_set(cache_key, loader))


def _infer_fomc_label(market: PredictionMarket) -> str | None:
    text = " ".join([market.question, market.description or ""]).lower()
    for month_name, month_number in _FOMC_MONTHS.items():
        if month_name in text:
            year_match = re.search(r"(20\d{2})", text)
            year = year_match.group(1) if year_match else str(datetime.utcnow().year)
            return f"{year}-{month_number:02d}-15"
    if market.end_date is not None:
        return market.end_date.strftime("%Y-%m-15")
    return None


def _infer_terminal_rate(bucket: dict[str, float]) -> float:
    """Infer the implied terminal rate from cut/hold/hike weights.

    Treats 5.0% as the neutral baseline and shifts by the dominant bucket.
    A rough heuristic — the precise implied terminal rate would need the
    contract's strike; this is enough to colour the chart, not to trade on.
    """
    cut = bucket["cut"]
    hold = bucket["hold"]
    hike = bucket["hike"]
    total = cut + hold + hike
    if total <= 0:
        return 0.0
    expected_bps = ((cut * -0.25) + (hold * 0.0) + (hike * 0.25)) / total
    return round(5.0 + (expected_bps * 4), 3)


async def estimate_recession(db: AsyncSession) -> dict[str, Any]:
    """Estimate year-ahead US recession probability from contracts."""
    cache_key = "prediction-markets:estimate:recession"
    current_year = datetime.utcnow().year

    async def loader() -> dict[str, Any]:
        markets = await _load_active_markets(db)
        target_year = current_year
        contract_year = current_year
        matching: list[PredictionMarket] = []
        for market in markets:
            text = f"{market.question} {market.description or ''}".lower()
            if not _match_any(text, ("recession",)):
                continue
            year_match = re.search(r"(20\d{2})", text)
            if year_match:
                contract_year = int(year_match.group(1))
                if contract_year >= current_year:
                    target_year = contract_year
            matching.append(market)
        sources: list[dict[str, Any]] = []
        total_probability = 0.0
        total_liquidity = 0.0
        per_source_count: dict[str, int] = {}
        for market in matching:
            yes_price = _safe_value(market)
            total_probability += yes_price
            if isinstance(market.liquidity, (int, float)):
                total_liquidity += float(market.liquidity)
            per_source_count[market.source] = per_source_count.get(market.source, 0) + 1
            sources.append(
                {
                    "source": market.source,
                    "source_id": market.source_id,
                    "probability": yes_price,
                }
            )
        consensus = total_probability / len(matching) if matching else None
        variance = (
            sum((s["probability"] - (consensus or 0)) ** 2 for s in sources) / len(sources)
            if sources
            else 0.0
        )
        return {
            "year": target_year,
            "p_recession": round(consensus, 4) if consensus is not None else 0.0,
            "variance": round(variance, 6),
            "n_contracts_per_source": per_source_count,
            "sources": sources[:25],
            "n_markets": len(matching),
            "confidence": round(_confidence_score(len(matching), total_liquidity), 3),
            "schema_version": 8,
            "last_updated": datetime.utcnow().isoformat(),
        }

    return coerce_estimator_payload(await estimation_cache.get_or_set(cache_key, loader))


async def estimate_macro_composite(db: AsyncSession) -> dict[str, Any]:
    """Composite of CPI + Fed + Recession + SPX closes."""
    cache_key = "prediction-markets:estimate:macro"

    async def loader() -> dict[str, Any]:
        cpi = await estimate_cpi(db)
        fed = await estimate_fed(db)
        recession = await estimate_recession(db)
        read = (
            f"CPI median {cpi['p50']:.1f}% · "
            f"FOMC {len(fed['meetings'])} meetings · "
            f"Rec {int(round(recession['p_recession'] * 100))}%"
        )
        return {
            "cpi": cpi,
            "fed": fed,
            "recession": recession,
            "composite": {
                "read": read,
                "last_updated": datetime.utcnow().isoformat(),
            },
            "last_updated": datetime.utcnow().isoformat(),
        }

    return coerce_estimator_payload(await estimation_cache.get_or_set(cache_key, loader))
