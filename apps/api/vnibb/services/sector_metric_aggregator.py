"""
Sector metric snapshot aggregator.

QA-v3 A2: Aggregate per-sector valuation/profitability medians from the
latest screener snapshot + financial_ratios so VniAgent can include
"sector average P/E = 17.34" style facts in its grounded context.

Usage::

    from vnibb.services.sector_metric_aggregator import (
        aggregate_sector_metrics,
        store_sector_metric_snapshots,
    )

    snapshots = await aggregate_sector_metrics()
    await store_sector_metric_snapshots(snapshots)
"""

from __future__ import annotations

import logging
import statistics
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from vnibb.core.database import async_session_maker
from vnibb.models.market import SectorMetricSnapshot
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock
from vnibb.models.trading import FinancialRatio

logger = logging.getLogger(__name__)


@dataclass
class SectorAggregate:
    industry_name: str
    sector_code: str | None
    snapshot_date: date
    sample_size: int
    avg_pe: float | None
    median_pe: float | None
    avg_pb: float | None
    median_pb: float | None
    avg_ps: float | None
    avg_roe: float | None
    avg_roa: float | None
    avg_net_margin: float | None
    avg_dividend_yield: float | None
    avg_market_cap: float | None

    def to_db_dict(self) -> dict[str, Any]:
        return {
            "industry_name": self.industry_name,
            "sector_code": self.sector_code,
            "snapshot_date": self.snapshot_date,
            "sample_size": self.sample_size,
            "avg_pe": self.avg_pe,
            "median_pe": self.median_pe,
            "avg_pb": self.avg_pb,
            "median_pb": self.median_pb,
            "avg_ps": self.avg_ps,
            "avg_roe": self.avg_roe,
            "avg_roa": self.avg_roa,
            "avg_net_margin": self.avg_net_margin,
            "avg_dividend_yield": self.avg_dividend_yield,
            "avg_market_cap": self.avg_market_cap,
            "created_at": datetime.utcnow(),
        }


def _safe_mean(values: Iterable[float]) -> float | None:
    cleaned = [v for v in values if isinstance(v, (int, float)) and v == v]
    if not cleaned:
        return None
    return float(statistics.fmean(cleaned))


def _safe_median(values: Iterable[float]) -> float | None:
    cleaned = [v for v in values if isinstance(v, (int, float)) and v == v]
    if not cleaned:
        return None
    return float(statistics.median(cleaned))


async def aggregate_sector_metrics(
    snapshot_date: date | None = None,
) -> list[SectorAggregate]:
    """Compute per-sector aggregates from the latest screener + financial_ratios.

    Returns one SectorAggregate per industry_name with at least 3 samples.
    """

    target_date = snapshot_date or date.today()

    async with async_session_maker() as session:
        # Pull the latest financial_ratios per symbol (period_type='year')
        stmt = (
            select(
                FinancialRatio.symbol,
                FinancialRatio.pe_ratio,
                FinancialRatio.pb_ratio,
                FinancialRatio.ps_ratio,
                FinancialRatio.roe,
                FinancialRatio.roa,
                FinancialRatio.net_margin,
                FinancialRatio.fiscal_year,
            )
            .where(FinancialRatio.period_type == "year")
            .order_by(FinancialRatio.symbol.asc(), FinancialRatio.fiscal_year.desc())
        )
        ratio_rows = (await session.execute(stmt)).all()

        latest_ratios: dict[str, dict[str, Any]] = {}
        for row in ratio_rows:
            sym = (row.symbol or "").upper()
            if not sym or sym in latest_ratios:
                continue
            latest_ratios[sym] = {
                "pe": row.pe_ratio,
                "pb": row.pb_ratio,
                "ps": row.ps_ratio,
                "roe": row.roe,
                "roa": row.roa,
                "net_margin": row.net_margin,
            }

        # Pull industry mapping
        stocks_result = await session.execute(
            select(Stock.symbol, Stock.industry, Stock.sector)
        )
        industry_by_symbol: dict[str, tuple[str, str | None]] = {}
        for symbol, industry, sector in stocks_result.all():
            if not symbol or not industry:
                continue
            industry_by_symbol[symbol.upper()] = (industry, sector)

        # Pull screener snapshot for market_cap and dividend_yield
        snap_result = await session.execute(
            select(
                ScreenerSnapshot.symbol,
                ScreenerSnapshot.market_cap,
                ScreenerSnapshot.dividend_yield,
            )
        )
        screener_by_symbol: dict[str, dict[str, Any]] = {}
        for symbol, market_cap, dividend_yield in snap_result.all():
            if not symbol:
                continue
            screener_by_symbol[symbol.upper()] = {
                "market_cap": market_cap,
                "dividend_yield": dividend_yield,
            }

    # Bucket by industry
    buckets: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "sector_code": None,
            "pe": [],
            "pb": [],
            "ps": [],
            "roe": [],
            "roa": [],
            "net_margin": [],
            "dividend_yield": [],
            "market_cap": [],
        }
    )

    for symbol, (industry, sector) in industry_by_symbol.items():
        if not industry:
            continue
        ratio = latest_ratios.get(symbol) or {}
        snap = screener_by_symbol.get(symbol) or {}

        bucket = buckets[industry]
        bucket["sector_code"] = sector or bucket["sector_code"]
        for key, source in (
            ("pe", ratio.get("pe")),
            ("pb", ratio.get("pb")),
            ("ps", ratio.get("ps")),
            ("roe", ratio.get("roe")),
            ("roa", ratio.get("roa")),
            ("net_margin", ratio.get("net_margin")),
            ("dividend_yield", snap.get("dividend_yield")),
            ("market_cap", snap.get("market_cap")),
        ):
            if isinstance(source, (int, float)) and source == source:
                bucket[key].append(float(source))

    aggregates: list[SectorAggregate] = []
    for industry, bucket in buckets.items():
        n = max(
            len(bucket["pe"]),
            len(bucket["pb"]),
            len(bucket["roe"]),
            len(bucket["market_cap"]),
        )
        if n < 3:
            continue
        aggregates.append(
            SectorAggregate(
                industry_name=industry,
                sector_code=bucket["sector_code"],
                snapshot_date=target_date,
                sample_size=n,
                avg_pe=_safe_mean(bucket["pe"]),
                median_pe=_safe_median(bucket["pe"]),
                avg_pb=_safe_mean(bucket["pb"]),
                median_pb=_safe_median(bucket["pb"]),
                avg_ps=_safe_mean(bucket["ps"]),
                avg_roe=_safe_mean(bucket["roe"]),
                avg_roa=_safe_mean(bucket["roa"]),
                avg_net_margin=_safe_mean(bucket["net_margin"]),
                avg_dividend_yield=_safe_mean(bucket["dividend_yield"]),
                avg_market_cap=_safe_mean(bucket["market_cap"]),
            )
        )

    return aggregates


async def store_sector_metric_snapshots(
    aggregates: list[SectorAggregate],
) -> int:
    if not aggregates:
        return 0

    async with async_session_maker() as session:
        rows = [agg.to_db_dict() for agg in aggregates]
        for row in rows:
            stmt = (
                pg_insert(SectorMetricSnapshot)
                .values(**row)
                .on_conflict_do_update(
                    index_elements=["industry_name", "snapshot_date"],
                    set_={k: row[k] for k in row if k not in {"created_at"}},
                )
            )
            await session.execute(stmt)
        await session.commit()

    logger.info("Stored %d sector_metric_snapshots", len(rows))
    return len(rows)


async def run_full_aggregation() -> int:
    aggregates = await aggregate_sector_metrics()
    return await store_sector_metric_snapshots(aggregates)
