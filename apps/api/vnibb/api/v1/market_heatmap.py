"""Pure helpers for the market heatmap endpoint."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Generic, Protocol, TypeVar

Row = dict[str, Any]
MetadataMap = Mapping[str, Mapping[str, str | None]]
ChangePctMap = Mapping[str, float]


class HeatmapStockLike(Protocol):
    market_cap: float
    change_pct: float


class HeatmapSectorLike(Protocol):
    total_market_cap: float


StockT = TypeVar("StockT", bound=HeatmapStockLike)
SectorT = TypeVar("SectorT", bound=HeatmapSectorLike)


@dataclass(frozen=True, slots=True)
class HeatmapRowTools:
    normalize_symbol: Callable[[Any], str]
    normalize_text: Callable[[Any], str | None]
    to_float: Callable[[Any], float | None]
    resolve_sector_name: Callable[[str, str | None, str | None], str]


@dataclass(frozen=True, slots=True)
class HeatmapGroupConfig:
    group_by: str
    color_metric: str
    size_metric: str
    hnx30_symbols: frozenset[str]
    vn30_symbols: frozenset[str]


@dataclass(frozen=True, slots=True)
class HeatmapGroupBuilder(Generic[StockT]):
    config: HeatmapGroupConfig
    tools: HeatmapRowTools
    stock_factory: Callable[..., StockT]


@dataclass(frozen=True, slots=True)
class HeatmapSectorBuilder(Generic[SectorT]):
    sector_factory: Callable[..., SectorT]


def normalize_heatmap_rows(
    rows: Iterable[Any],
    normalizer: Callable[[Any], Row],
    *,
    normalize_dict_rows: bool = False,
) -> list[Row]:
    normalized = [
        normalizer(row) if normalize_dict_rows or not isinstance(row, dict) else row
        for row in rows
    ]
    return [row for row in normalized if row.get("symbol")]


def filter_heatmap_rows_by_exchange(rows: Iterable[Row], exchange: str) -> list[Row]:
    if exchange == "ALL":
        return list(rows)

    exchange_upper = exchange.upper()
    return [
        row
        for row in rows
        if (row.get("exchange") or "").upper() == exchange_upper
    ]


def heatmap_symbols(rows: Iterable[Row]) -> list[str]:
    return [row["symbol"] for row in rows]


def enrich_heatmap_rows(
    rows: Iterable[Row],
    metadata_map: MetadataMap,
    change_map: ChangePctMap,
) -> list[Row]:
    enriched_rows: list[Row] = []
    for row in rows:
        enriched = dict(row)
        symbol = enriched["symbol"]
        metadata = metadata_map.get(symbol) or {}
        if not enriched.get("exchange") and metadata.get("exchange"):
            enriched["exchange"] = metadata.get("exchange")
        if not enriched.get("industry") and metadata.get("industry"):
            enriched["industry"] = metadata.get("industry")
        if not enriched.get("sector") and metadata.get("sector"):
            enriched["sector"] = metadata.get("sector")
        if enriched.get("change_pct") is None and symbol in change_map:
            enriched["change_pct"] = change_map[symbol]
        enriched_rows.append(enriched)
    return enriched_rows


def resolve_hnx30_symbols(rows: Iterable[Row], tools: HeatmapRowTools) -> set[str]:
    hnx_rows = [
        row
        for row in rows
        if (row.get("exchange") or "").strip().upper() == "HNX" and (row.get("symbol") or "")
    ]
    hnx_rows.sort(key=lambda row: row.get("market_cap") or 0.0, reverse=True)
    return {tools.normalize_symbol(row.get("symbol")) for row in hnx_rows[:30]}


def resolve_heatmap_color_value(row: Row, metric: str, tools: HeatmapRowTools) -> float:
    preferred = tools.to_float(row.get(metric))
    if preferred is not None:
        return preferred

    fallback = tools.to_float(row.get("change_pct"))
    return fallback if fallback is not None else 0.0


def resolve_heatmap_size_value(row: Row, metric: str, tools: HeatmapRowTools) -> float | None:
    preferred = tools.to_float(row.get(metric))
    if preferred is not None and preferred > 0:
        return preferred

    market_cap = tools.to_float(row.get("market_cap"))
    if market_cap is not None and market_cap > 0:
        return market_cap

    price = tools.to_float(row.get("price"))
    shares_outstanding = tools.to_float(row.get("shares_outstanding"))
    if price not in (None, 0) and shares_outstanding not in (None, 0):
        derived_market_cap = price * shares_outstanding
        if derived_market_cap > 0:
            return derived_market_cap

    volume = tools.to_float(row.get("volume"))
    if price not in (None, 0) and volume not in (None, 0):
        traded_value = price * volume
        if traded_value > 0:
            return traded_value

    return None


def build_heatmap_groups(rows: Iterable[Row], builder: HeatmapGroupBuilder[StockT]) -> dict[str, list[StockT]]:
    groups: defaultdict[str, list[StockT]] = defaultdict(list)
    config = builder.config
    tools = builder.tools

    for row in rows:
        symbol = tools.normalize_symbol(row.get("symbol"))
        if not symbol:
            continue

        price = tools.to_float(row.get("price"))
        if price is None or price <= 0:
            continue

        if config.group_by == "vn30" and symbol not in config.vn30_symbols:
            continue
        if config.group_by == "hnx30" and symbol not in config.hnx30_symbols:
            continue

        size_value = resolve_heatmap_size_value(row, config.size_metric, tools)
        if size_value is None or size_value <= 0:
            continue

        industry = tools.normalize_text(row.get("industry"))
        sector_hint = tools.normalize_text(row.get("sector"))

        match config.group_by:
            case "sector":
                group_key = tools.resolve_sector_name(symbol, industry, sector_hint)
            case "industry":
                group_key = industry or tools.resolve_sector_name(symbol, industry, sector_hint)
            case "vn30":
                group_key = "VN30"
            case "hnx30":
                group_key = "HNX30"
            case _:
                group_key = "Other"

        change_pct = resolve_heatmap_color_value(row, config.color_metric, tools)
        change = price * (change_pct / 100.0)

        groups[group_key].append(
            builder.stock_factory(
                symbol=symbol,
                name=tools.normalize_text(row.get("name")) or symbol,
                sector=group_key,
                industry=industry,
                market_cap=size_value,
                price=price,
                change=change,
                change_pct=change_pct,
                volume=tools.to_float(row.get("volume")),
            )
        )

    return dict(groups)


def build_heatmap_sectors(
    groups: Mapping[str, Sequence[StockT]],
    builder: HeatmapSectorBuilder[SectorT],
) -> list[SectorT]:
    sectors: list[SectorT] = []
    for sector_name, stocks in groups.items():
        total_market_cap = sum(stock.market_cap for stock in stocks)
        avg_change_pct = (
            sum(stock.change_pct * stock.market_cap for stock in stocks) / total_market_cap
            if total_market_cap > 0
            else 0
        )
        sectors.append(
            builder.sector_factory(
                sector=sector_name,
                stocks=list(stocks),
                total_market_cap=total_market_cap,
                avg_change_pct=avg_change_pct,
                stock_count=len(stocks),
            )
        )

    sectors.sort(key=lambda sector: sector.total_market_cap, reverse=True)
    return sectors
