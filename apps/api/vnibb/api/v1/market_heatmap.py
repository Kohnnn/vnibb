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
    market_cap: float | None
    size_value: float
    change_pct: float | None


class HeatmapSectorLike(Protocol):
    sector: str
    total_size_value: float


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
) -> list[Row]:
    normalized = [normalizer(row) for row in rows]
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
        session = enriched.get("market_session")
        if (
            enriched.get("change_pct") is None
            and not enriched.get("_session_returns_withheld")
            and not (isinstance(session, dict) and session.get("status") in {"no_trade", "suspended"})
            and symbol in change_map
        ):
            enriched["change_pct"] = change_map[symbol]
        enriched_rows.append(enriched)
    return enriched_rows


def resolve_hnx30_symbols(rows: Iterable[Row], tools: HeatmapRowTools) -> set[str]:
    hnx_rows = [
        row
        for row in rows
        if (row.get("exchange") or "").strip().upper() == "HNX"
        and row.get("symbol") and row.get("market_cap") is not None
    ]
    hnx_rows.sort(key=lambda row: (-row["market_cap"], tools.normalize_symbol(row.get("symbol"))))
    return {tools.normalize_symbol(row.get("symbol")) for row in hnx_rows[:30]}


def resolve_heatmap_color_value(row: Row, metric: str, tools: HeatmapRowTools) -> float | None:
    if row.get("_session_returns_withheld"):
        return None
    preferred = tools.to_float(row.get(metric))
    if preferred is not None:
        return preferred

    fallback = tools.to_float(row.get("change_pct"))
    return fallback


def resolve_heatmap_size_value(row: Row, metric: str, tools: HeatmapRowTools) -> float | None:
    preferred = tools.to_float(row.get(metric))
    if preferred is not None and preferred > 0:
        return preferred

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
        change = price * (change_pct / 100.0) if change_pct is not None else None
        trade_date = row.get("constituent_date")
        groups[group_key].append(
            builder.stock_factory(
                symbol=symbol,
                name=tools.normalize_text(row.get("name")) or symbol,
                sector=group_key,
                industry=industry,
                trade_date=trade_date.isoformat() if hasattr(trade_date, "isoformat") else trade_date,
                session_date=(row.get("market_session").get("session_date") if isinstance(row.get("market_session"), dict) else None),
                session_status=(row.get("market_session").get("status") if isinstance(row.get("market_session"), dict) else None),
                session_source=(row.get("market_session").get("source") if isinstance(row.get("market_session"), dict) else None),
                session_scope=(row.get("market_session").get("scope") if isinstance(row.get("market_session"), dict) else None),
                market_cap=row.get("market_cap"),
                market_cap_provenance=row["market_cap_provenance"],
                size_value=size_value,
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
        caps = [stock.market_cap for stock in stocks if stock.market_cap is not None]
        total_size_value = sum(stock.size_value for stock in stocks)
        known_changes = [stock for stock in stocks if stock.change_pct is not None]
        known_size_value = sum(stock.size_value for stock in known_changes)
        avg_change_pct = (
            sum(stock.change_pct * stock.size_value for stock in known_changes) / known_size_value
            if known_size_value > 0 else None
        )
        sectors.append(
            builder.sector_factory(
                sector=sector_name,
                stocks=list(stocks),
                total_market_cap=sum(caps) if caps else None,
                total_size_value=total_size_value,
                cap_count=len(caps),
                avg_change_pct=avg_change_pct,
                stock_count=len(stocks),
            )
        )

    sectors.sort(key=lambda sector: (-sector.total_size_value, sector.sector))
    return sectors
