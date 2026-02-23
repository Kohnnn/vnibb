"""
Market API Endpoints

Provides endpoints for:
- Market heatmap data (treemap visualization)
- Sector aggregations
- Market overview statistics
"""

import asyncio
import logging
from datetime import datetime, date, timedelta
from typing import Any, Dict, List, Optional
from collections import defaultdict

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func

from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.core.vn_sectors import VN_SECTORS
from vnibb.providers.vnstock.equity_screener import (
    VnstockScreenerFetcher,
    StockScreenerParams,
    ScreenerData,
)
from vnibb.providers.vnstock.market_overview import (
    VnstockMarketOverviewFetcher,
    MarketOverviewQueryParams,
)
from vnibb.providers.vnstock.top_movers import VnstockTopMoversFetcher
from vnibb.core.cache import cached
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
from vnibb.services.cache_manager import CacheManager
from vnibb.services.sector_service import SectorService
from vnibb.providers.vnstock import get_vnstock

try:
    from vnstock.explorer.misc import vcb_exchange_rate, btmc_goldprice, sjc_gold_price
except Exception:  # pragma: no cover - defensive import guard
    vcb_exchange_rate = None
    btmc_goldprice = None
    sjc_gold_price = None

router = APIRouter()
logger = logging.getLogger(__name__)


class HeatmapStock(BaseModel):
    """Individual stock data for heatmap visualization."""

    symbol: str
    name: str
    sector: str
    industry: Optional[str] = None
    market_cap: float
    price: float
    change: float  # Absolute price change
    change_pct: float  # Percentage change
    volume: Optional[float] = None


class SectorGroup(BaseModel):
    """Aggregated sector data for heatmap."""

    sector: str
    stocks: List[HeatmapStock]
    total_market_cap: float
    avg_change_pct: float
    stock_count: int


class HeatmapResponse(BaseModel):
    """API response for heatmap data."""

    count: int
    group_by: str
    color_metric: str
    size_metric: str
    sectors: List[SectorGroup]
    cached: bool = False


class MarketIndicesResponse(BaseModel):
    count: int
    data: List[dict[str, Any]]
    error: Optional[str] = None


class MarketTopMoversResponse(BaseModel):
    type: str
    index: str
    count: int
    data: List[dict[str, Any]]
    error: Optional[str] = None


class MarketSectorPerformanceResponse(BaseModel):
    count: int
    data: List[dict[str, Any]]
    error: Optional[str] = None


class WorldIndicesResponse(BaseModel):
    count: int
    data: List[dict[str, Any]]
    source: str
    error: Optional[str] = None


class ForexRatesResponse(BaseModel):
    count: int
    data: List[dict[str, Any]]
    source: str
    error: Optional[str] = None


class CommoditiesResponse(BaseModel):
    count: int
    data: List[dict[str, Any]]
    source: str
    error: Optional[str] = None


class ResearchRssItem(BaseModel):
    title: str
    url: str
    published_at: Optional[str] = None
    description: Optional[str] = None


class ResearchRssFeedResponse(BaseModel):
    source: str
    count: int
    data: List[ResearchRssItem]
    fetched_at: str
    error: Optional[str] = None


RSS_FEED_URLS: dict[str, list[str]] = {
    # CafeF frequently challenges bots/crawlers with a captcha page.
    # Keep multiple candidates and fail gracefully when blocked.
    "cafef": [
        "https://cafef.vn/rss/chung-khoan.rss",
        "https://cafef.vn/Ajax/RssLinkNew.ashx?CatID=18831",
    ],
    "vietstock": ["https://vietstock.vn/rss/chung-khoan.rss"],
    "vnexpress": ["https://vnexpress.net/rss/kinh-doanh/chung-khoan.rss"],
}

WORLD_INDEX_POINT_TIMEOUT_SECONDS = 5
WORLD_INDEX_FALLBACK_TIMEOUT_SECONDS = 5
HEATMAP_FETCH_TIMEOUT_SECONDS = 20
SECTOR_CLASSIFICATION_IDS = [
    sector_id for sector_id in VN_SECTORS.keys() if sector_id not in {"vn30"}
]


async def _fetch_rss_content(url: str) -> str:
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.text


def _is_probably_rss_payload(payload: str) -> bool:
    content = payload.lstrip().lower()
    return content.startswith("<?xml") or "<rss" in content or "<feed" in content


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)

    text = str(value).strip()
    if not text:
        return None

    normalized = text.replace(",", "")
    try:
        return float(normalized)
    except ValueError:
        return None


def _extract_close_from_row(row: dict[str, Any]) -> Optional[float]:
    for key in ("close", "Close", "value", "price", "last"):
        parsed = _to_float(row.get(key))
        if parsed is not None:
            return parsed
    return None


def _first_non_none(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _normalize_symbol(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().upper()


def _normalize_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_screener_row(item: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if hasattr(item, "model_dump"):
        payload = item.model_dump(mode="json", by_alias=False)
    elif isinstance(item, dict):
        payload = item

    symbol = _normalize_symbol(_first_non_none(payload.get("symbol"), payload.get("ticker")))
    if not symbol:
        return {}

    industry = _normalize_text(
        _first_non_none(
            payload.get("industry"),
            payload.get("industry_name"),
            payload.get("industryName"),
            payload.get("icb_name4"),
            payload.get("icb_name3"),
            payload.get("icb_name2"),
        )
    )
    sector = _normalize_text(_first_non_none(payload.get("sector"), payload.get("sector_name")))

    return {
        "symbol": symbol,
        "name": _normalize_text(
            _first_non_none(
                payload.get("organ_name"), payload.get("organName"), payload.get("company_name")
            )
        )
        or symbol,
        "exchange": _normalize_text(payload.get("exchange")),
        "industry": industry,
        "sector": sector,
        "price": _to_float(_first_non_none(payload.get("price"), payload.get("close"))),
        "volume": _to_float(payload.get("volume")),
        "market_cap": _to_float(
            _first_non_none(payload.get("market_cap"), payload.get("marketCap"))
        ),
        "shares_outstanding": _to_float(
            _first_non_none(payload.get("shares_outstanding"), payload.get("sharesOutstanding"))
        ),
        "change_pct": _to_float(
            _first_non_none(
                payload.get("price_change_1d_pct"),
                payload.get("change_pct"),
                payload.get("changePct"),
                payload.get("price_change_pct"),
                payload.get("priceChangePct"),
            )
        ),
        "weekly_pct": _to_float(
            _first_non_none(
                payload.get("price_change_1w_pct"),
                payload.get("weekly_pct"),
                payload.get("weeklyPct"),
            )
        ),
        "monthly_pct": _to_float(
            _first_non_none(
                payload.get("price_change_1m_pct"),
                payload.get("monthly_pct"),
                payload.get("monthlyPct"),
            )
        ),
        "ytd_pct": _to_float(
            _first_non_none(
                payload.get("price_change_ytd_pct"),
                payload.get("ytd_pct"),
                payload.get("ytdPct"),
            )
        ),
        "value_traded": _to_float(
            _first_non_none(
                payload.get("value_traded"),
                payload.get("valueTraded"),
                payload.get("trading_value"),
            )
        ),
    }


def _resolve_sector_name(symbol: str, industry: Optional[str], sector_hint: Optional[str]) -> str:
    if sector_hint:
        return sector_hint

    symbol_upper = _normalize_symbol(symbol)
    for sector_id in SECTOR_CLASSIFICATION_IDS:
        config = VN_SECTORS.get(sector_id)
        if not config:
            continue
        if symbol_upper in {s.upper() for s in config.symbols}:
            return config.name

    industry_text = (industry or "").strip().lower()
    if industry_text:
        for sector_id in SECTOR_CLASSIFICATION_IDS:
            config = VN_SECTORS.get(sector_id)
            if not config:
                continue
            for keyword in config.keywords:
                if keyword.lower() in industry_text:
                    return config.name

    return "Other"


async def _load_stock_metadata(symbols: List[str]) -> Dict[str, Dict[str, Optional[str]]]:
    unique_symbols = sorted({_normalize_symbol(symbol) for symbol in symbols if symbol})
    if not unique_symbols:
        return {}

    async with async_session_maker() as session:
        rows = (
            await session.execute(
                select(Stock.symbol, Stock.exchange, Stock.industry, Stock.sector).where(
                    Stock.symbol.in_(unique_symbols)
                )
            )
        ).all()

    return {
        _normalize_symbol(symbol): {
            "exchange": _normalize_text(exchange),
            "industry": _normalize_text(industry),
            "sector": _normalize_text(sector),
        }
        for symbol, exchange, industry, sector in rows
    }


async def _load_change_pct_map(symbols: List[str]) -> Dict[str, float]:
    unique_symbols = sorted({_normalize_symbol(symbol) for symbol in symbols if symbol})
    if not unique_symbols:
        return {}

    change_map: Dict[str, float] = {}

    async with async_session_maker() as session:
        ranked_prices = (
            select(
                StockPrice.symbol.label("symbol"),
                StockPrice.close.label("close"),
                func.row_number()
                .over(partition_by=StockPrice.symbol, order_by=StockPrice.time.desc())
                .label("rn"),
            )
            .where(StockPrice.interval == "1D", StockPrice.symbol.in_(unique_symbols))
            .subquery()
        )
        price_rows = (
            await session.execute(
                select(ranked_prices.c.symbol, ranked_prices.c.close, ranked_prices.c.rn).where(
                    ranked_prices.c.rn <= 2
                )
            )
        ).all()

        price_lookup: Dict[str, Dict[int, float]] = defaultdict(dict)
        for symbol, close, rn in price_rows:
            close_value = _to_float(close)
            if close_value is None:
                continue
            price_lookup[_normalize_symbol(symbol)][int(rn)] = close_value

        for symbol, data in price_lookup.items():
            latest = data.get(1)
            previous = data.get(2)
            if latest is not None and previous not in (None, 0):
                change_map[symbol] = ((latest - previous) / previous) * 100.0

        missing_symbols = [symbol for symbol in unique_symbols if symbol not in change_map]
        if missing_symbols:
            ranked_snapshots = (
                select(
                    ScreenerSnapshot.symbol.label("symbol"),
                    ScreenerSnapshot.price.label("price"),
                    func.row_number()
                    .over(
                        partition_by=ScreenerSnapshot.symbol,
                        order_by=ScreenerSnapshot.snapshot_date.desc(),
                    )
                    .label("rn"),
                )
                .where(
                    ScreenerSnapshot.symbol.in_(missing_symbols),
                    ScreenerSnapshot.price.is_not(None),
                )
                .subquery()
            )
            snapshot_rows = (
                await session.execute(
                    select(
                        ranked_snapshots.c.symbol,
                        ranked_snapshots.c.price,
                        ranked_snapshots.c.rn,
                    ).where(ranked_snapshots.c.rn <= 2)
                )
            ).all()

            snapshot_lookup: Dict[str, Dict[int, float]] = defaultdict(dict)
            for symbol, price, rn in snapshot_rows:
                price_value = _to_float(price)
                if price_value is None:
                    continue
                snapshot_lookup[_normalize_symbol(symbol)][int(rn)] = price_value

            for symbol, data in snapshot_lookup.items():
                latest = data.get(1)
                previous = data.get(2)
                if latest is not None and previous not in (None, 0):
                    change_map[symbol] = ((latest - previous) / previous) * 100.0

    return change_map


def _resolve_hnx30_symbols(rows: List[dict[str, Any]]) -> set[str]:
    hnx_rows = [
        row
        for row in rows
        if (row.get("exchange") or "").strip().upper() == "HNX" and (row.get("symbol") or "")
    ]
    hnx_rows.sort(key=lambda row: row.get("market_cap") or 0.0, reverse=True)
    return {_normalize_symbol(row.get("symbol")) for row in hnx_rows[:30]}


def _resolve_color_value(row: dict[str, Any], metric: str) -> float:
    preferred = _to_float(row.get(metric))
    if preferred is not None:
        return preferred

    fallback = _to_float(row.get("change_pct"))
    return fallback if fallback is not None else 0.0


def _resolve_size_value(row: dict[str, Any], metric: str) -> Optional[float]:
    preferred = _to_float(row.get(metric))
    if preferred is not None and preferred > 0:
        return preferred

    market_cap = _to_float(row.get("market_cap"))
    if market_cap is not None and market_cap > 0:
        return market_cap

    price = _to_float(row.get("price"))
    shares_outstanding = _to_float(row.get("shares_outstanding"))
    if price not in (None, 0) and shares_outstanding not in (None, 0):
        derived_market_cap = price * shares_outstanding
        if derived_market_cap > 0:
            return derived_market_cap

    volume = _to_float(row.get("volume"))
    if price not in (None, 0) and volume not in (None, 0):
        traded_value = price * volume
        if traded_value > 0:
            return traded_value

    return None


def _clean_rss_description(raw_description: Optional[str]) -> Optional[str]:
    if not raw_description:
        return None

    plain_text = BeautifulSoup(raw_description, "html.parser").get_text(" ", strip=True)
    if not plain_text:
        return None

    return plain_text[:280]


async def _fetch_world_index_point(symbol: str, name: str) -> Optional[dict[str, Any]]:
    def _sync_fetch() -> Optional[dict[str, Any]]:
        vn = get_vnstock()
        idx = vn.world_index(symbol=symbol, source="MSN")
        end_date = date.today()
        start_date = end_date - timedelta(days=14)
        frame = idx.quote.history(
            start=start_date.isoformat(), end=end_date.isoformat(), interval="1D"
        )
        if frame is None or len(frame.index) == 0:
            return None

        rows = frame.to_dict(orient="records")
        if not rows:
            return None

        latest = rows[-1]
        latest_value = _extract_close_from_row(latest)
        if latest_value is None:
            return None

        previous_value: Optional[float] = None
        if len(rows) > 1:
            previous_value = _extract_close_from_row(rows[-2])

        change = latest_value - previous_value if previous_value is not None else 0.0
        change_pct = (change / previous_value * 100.0) if previous_value not in (None, 0) else 0.0

        return {
            "symbol": symbol,
            "name": name,
            "value": latest_value,
            "change": change,
            "change_pct": change_pct,
            "updated_at": latest.get("time") or latest.get("date"),
        }

    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_sync_fetch), timeout=WORLD_INDEX_POINT_TIMEOUT_SECONDS
        )
    except Exception as e:
        logger.debug(f"World index fetch failed for {symbol}: {e}")
        return None


@router.get(
    "/heatmap",
    response_model=HeatmapResponse,
    summary="Get Market Heatmap Data",
    description="Get aggregated market data for treemap visualization. Supports grouping by sector/industry.",
)
@cached(ttl=120, key_prefix="market_heatmap")
async def get_heatmap_data(
    group_by: str = Query(
        default="sector",
        pattern=r"^(sector|industry|vn30|hnx30)$",
        description="Group stocks by: sector, industry, vn30, or hnx30",
    ),
    color_metric: str = Query(
        default="change_pct",
        pattern=r"^(change_pct|weekly_pct|monthly_pct|ytd_pct)$",
        description="Metric for color intensity: change_pct, weekly_pct, monthly_pct, ytd_pct",
    ),
    size_metric: str = Query(
        default="market_cap",
        pattern=r"^(market_cap|volume|value_traded)$",
        description="Metric for rectangle size: market_cap, volume, value_traded",
    ),
    exchange: str = Query(
        default="HOSE",
        pattern=r"^(HOSE|HNX|UPCOM|ALL)$",
        description="Exchange filter: HOSE, HNX, UPCOM, or ALL",
    ),
    limit: int = Query(
        default=200,
        ge=1,
        le=2000,
        description="Maximum stocks to include",
    ),
    use_cache: bool = Query(
        default=True,
        description="Use cached data if available",
    ),
) -> HeatmapResponse:
    """
    Fetch market heatmap data with sector/industry grouping.

    ## Features
    - **Treemap Visualization**: Rectangle size by market cap, color by price change
    - **Grouping**: By sector, industry, or index (VN30, HNX30)
    - **Metrics**: Customizable color and size metrics

    ## Use Cases
    - Market overview dashboard
    - Sector performance analysis
    - Visual stock screening
    """
    cache_manager = CacheManager()

    # Step 1: Fetch screener data (with cache support)
    try:
        params = StockScreenerParams(
            symbol=None,
            exchange=exchange,
            limit=limit,
            source=settings.vnstock_source,
        )

        # Try cache first
        screener_data: List[ScreenerData] = []
        cached = False

        if use_cache:
            try:
                cache_result = await cache_manager.get_screener_data(
                    symbol=None,
                    source=settings.vnstock_source,
                    allow_stale=True,
                )

                if cache_result.data:
                    freshness = "fresh" if cache_result.is_fresh else "stale"
                    logger.info(
                        "Using %s cached screener data for heatmap (%d records)",
                        freshness,
                        len(cache_result.data),
                    )
                    # Convert ORM to Pydantic
                    screener_data = [
                        ScreenerData(
                            symbol=s.symbol,
                            organ_name=s.company_name,
                            exchange=s.exchange,
                            industry_name=s.industry,
                            price=s.price,
                            volume=s.volume,
                            market_cap=s.market_cap,
                            pe=s.pe,
                            pb=s.pb,
                        )
                        for s in cache_result.data
                    ]
                    cached = True
            except Exception as e:
                logger.warning(f"Cache lookup failed for heatmap: {e}")

        # Fetch from API if no cache
        if not screener_data:
            try:
                screener_data = await asyncio.wait_for(
                    VnstockScreenerFetcher.fetch(params),
                    timeout=HEATMAP_FETCH_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError as exc:
                raise ProviderTimeoutError("vnstock", HEATMAP_FETCH_TIMEOUT_SECONDS) from exc
            logger.info(f"Fetched {len(screener_data)} stocks from API for heatmap")

        # Step 2: Normalize input rows and enrich missing metadata/returns from DB snapshots.
        normalized_rows = [_normalize_screener_row(item) for item in screener_data]
        normalized_rows = [row for row in normalized_rows if row.get("symbol")]

        if exchange != "ALL":
            exchange_upper = exchange.upper()
            normalized_rows = [
                row
                for row in normalized_rows
                if not row.get("exchange") or (row.get("exchange") or "").upper() == exchange_upper
            ]

        symbols = [row["symbol"] for row in normalized_rows]
        metadata_map = await _load_stock_metadata(symbols)
        change_map = await _load_change_pct_map(symbols)

        for row in normalized_rows:
            symbol = row["symbol"]
            metadata = metadata_map.get(symbol) or {}
            if not row.get("exchange") and metadata.get("exchange"):
                row["exchange"] = metadata.get("exchange")
            if not row.get("industry") and metadata.get("industry"):
                row["industry"] = metadata.get("industry")
            if not row.get("sector") and metadata.get("sector"):
                row["sector"] = metadata.get("sector")
            if row.get("change_pct") is None and symbol in change_map:
                row["change_pct"] = change_map[symbol]

        hnx30_symbols = _resolve_hnx30_symbols(normalized_rows) if group_by == "hnx30" else set()
        vn30_symbols = {
            symbol.upper()
            for symbol in (VN_SECTORS.get("vn30").symbols if VN_SECTORS.get("vn30") else [])
        }

        def _build_groups(rows: List[dict[str, Any]]) -> Dict[str, List[HeatmapStock]]:
            groups: Dict[str, List[HeatmapStock]] = defaultdict(list)

            for row in rows:
                symbol = _normalize_symbol(row.get("symbol"))
                if not symbol:
                    continue

                price = _to_float(row.get("price"))
                if price is None or price <= 0:
                    continue

                if group_by == "vn30" and symbol not in vn30_symbols:
                    continue
                if group_by == "hnx30" and symbol not in hnx30_symbols:
                    continue

                size_value = _resolve_size_value(row, size_metric)
                if size_value is None or size_value <= 0:
                    continue

                industry = _normalize_text(row.get("industry"))
                sector_hint = _normalize_text(row.get("sector"))

                if group_by == "sector":
                    group_key = _resolve_sector_name(symbol, industry, sector_hint)
                elif group_by == "industry":
                    group_key = industry or _resolve_sector_name(symbol, industry, sector_hint)
                elif group_by == "vn30":
                    group_key = "VN30"
                elif group_by == "hnx30":
                    group_key = "HNX30"
                else:
                    group_key = "Other"

                change_pct = _resolve_color_value(row, color_metric)
                change = price * (change_pct / 100.0)

                heatmap_stock = HeatmapStock(
                    symbol=symbol,
                    name=_normalize_text(row.get("name")) or symbol,
                    sector=group_key,
                    industry=industry,
                    market_cap=size_value,
                    price=price,
                    change=change,
                    change_pct=change_pct,
                    volume=_to_float(row.get("volume")),
                )
                groups[group_key].append(heatmap_stock)

            return groups

        # Step 3: Group stocks by selected view
        groups = _build_groups(normalized_rows)

        # If cached payload is stale/sparse enough to produce an empty heatmap,
        # fall back to a fresh provider fetch once before returning empty data.
        if cached and not groups:
            logger.info("Cached screener data produced empty heatmap; retrying with fresh fetch")
            try:
                screener_data = await asyncio.wait_for(
                    VnstockScreenerFetcher.fetch(params),
                    timeout=HEATMAP_FETCH_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError as exc:
                raise ProviderTimeoutError("vnstock", HEATMAP_FETCH_TIMEOUT_SECONDS) from exc

            refreshed_rows = [_normalize_screener_row(item) for item in screener_data]
            refreshed_rows = [row for row in refreshed_rows if row.get("symbol")]
            if exchange != "ALL":
                exchange_upper = exchange.upper()
                refreshed_rows = [
                    row
                    for row in refreshed_rows
                    if not row.get("exchange")
                    or (row.get("exchange") or "").upper() == exchange_upper
                ]

            refreshed_symbols = [row["symbol"] for row in refreshed_rows]
            refreshed_metadata = await _load_stock_metadata(refreshed_symbols)
            refreshed_change_map = await _load_change_pct_map(refreshed_symbols)
            for row in refreshed_rows:
                symbol = row["symbol"]
                metadata = refreshed_metadata.get(symbol) or {}
                if not row.get("exchange") and metadata.get("exchange"):
                    row["exchange"] = metadata.get("exchange")
                if not row.get("industry") and metadata.get("industry"):
                    row["industry"] = metadata.get("industry")
                if not row.get("sector") and metadata.get("sector"):
                    row["sector"] = metadata.get("sector")
                if row.get("change_pct") is None and symbol in refreshed_change_map:
                    row["change_pct"] = refreshed_change_map[symbol]

            if group_by == "hnx30":
                hnx30_symbols = _resolve_hnx30_symbols(refreshed_rows)

            groups = _build_groups(refreshed_rows)
            cached = False

        # Step 5: Create sector aggregations
        sectors: List[SectorGroup] = []
        for sector_name, stocks in groups.items():
            total_market_cap = sum(s.market_cap for s in stocks)
            # Weighted average change by market cap
            if total_market_cap > 0:
                avg_change_pct = sum(s.change_pct * s.market_cap for s in stocks) / total_market_cap
            else:
                avg_change_pct = 0

            sectors.append(
                SectorGroup(
                    sector=sector_name,
                    stocks=stocks,
                    total_market_cap=total_market_cap,
                    avg_change_pct=avg_change_pct,
                    stock_count=len(stocks),
                )
            )

        # Sort sectors by total market cap (largest first)
        sectors.sort(key=lambda s: s.total_market_cap, reverse=True)

        total_stocks = sum(len(s.stocks) for s in sectors)

        return HeatmapResponse(
            count=total_stocks,
            group_by=group_by,
            color_metric=color_metric,
            size_metric=size_metric,
            sectors=sectors,
            cached=cached,
        )

    except ProviderTimeoutError as e:
        logger.warning("Heatmap provider timeout, returning empty payload: %s", e.message)
        return HeatmapResponse(
            count=0,
            group_by=group_by,
            color_metric=color_metric,
            size_metric=size_metric,
            sectors=[],
            cached=False,
        )
    except ProviderError as e:
        logger.warning("Heatmap provider error, returning empty payload: %s", e.message)
        return HeatmapResponse(
            count=0,
            group_by=group_by,
            color_metric=color_metric,
            size_metric=size_metric,
            sectors=[],
            cached=False,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/indices", response_model=MarketIndicesResponse)
@cached(ttl=60, key_prefix="market_indices")
async def get_market_indices(
    limit: int = Query(default=10, ge=1, le=20),
) -> MarketIndicesResponse:
    try:
        indices = await asyncio.wait_for(
            VnstockMarketOverviewFetcher.fetch(MarketOverviewQueryParams()),
            timeout=30,
        )
        normalized = [
            item.model_dump(mode="json", by_alias=True) if hasattr(item, "model_dump") else item
            for item in indices
        ]
        return MarketIndicesResponse(count=len(normalized[:limit]), data=normalized[:limit])
    except Exception as e:
        logger.warning(f"Market indices fetch failed: {e}")
        return MarketIndicesResponse(count=0, data=[], error=str(e))


@router.get("/top-movers", response_model=MarketTopMoversResponse)
async def get_market_top_movers(
    type: str = Query(default="gainer", pattern=r"^(gainer|loser|volume|value)$"),
    index: str = Query(default="VNINDEX", pattern=r"^(VNINDEX|HNX|VN30)$"),
    limit: int = Query(default=10, ge=1, le=50),
) -> MarketTopMoversResponse:
    try:
        movers = await asyncio.wait_for(
            VnstockTopMoversFetcher.fetch(type=type, index=index, limit=limit),
            timeout=30,
        )
        payload = [
            item.model_dump(mode="json", by_alias=True) if hasattr(item, "model_dump") else item
            for item in movers
        ]

        if not payload and type in {"gainer", "loser"}:
            # Graceful fallback: volume movers are generally the most stable upstream feed.
            fallback = await asyncio.wait_for(
                VnstockTopMoversFetcher.fetch(type="volume", index=index, limit=limit),
                timeout=30,
            )
            payload = [
                item.model_dump(mode="json", by_alias=True) if hasattr(item, "model_dump") else item
                for item in fallback
            ]

            if payload:
                return MarketTopMoversResponse(
                    type=type,
                    index=index,
                    count=len(payload),
                    data=payload,
                    error=f"Requested '{type}' movers unavailable, returned volume movers fallback",
                )

        return MarketTopMoversResponse(type=type, index=index, count=len(payload), data=payload)
    except Exception as e:
        logger.warning(f"Market top movers fetch failed: {e}")
        return MarketTopMoversResponse(type=type, index=index, count=0, data=[], error=str(e))


@router.get("/sector-performance", response_model=MarketSectorPerformanceResponse)
async def get_market_sector_performance() -> MarketSectorPerformanceResponse:
    try:
        params = StockScreenerParams(
            symbol=None,
            exchange="ALL",
            limit=1500,
            source=settings.vnstock_source,
        )
        screener_data = await asyncio.wait_for(VnstockScreenerFetcher.fetch(params), timeout=30)
        rows = [
            item.model_dump(mode="json", by_alias=True) if hasattr(item, "model_dump") else item
            for item in screener_data
        ]
        sectors = await SectorService.calculate_sector_performance(rows)
        payload = [item.model_dump(mode="json", by_alias=True) for item in sectors]
        return MarketSectorPerformanceResponse(count=len(payload), data=payload)
    except Exception as e:
        logger.warning(f"Market sector performance fetch failed: {e}")
        return MarketSectorPerformanceResponse(count=0, data=[], error=str(e))


@router.get("/world-indices", response_model=WorldIndicesResponse)
@cached(ttl=300, key_prefix="world_indices")
async def get_world_indices(limit: int = Query(default=8, ge=1, le=16)) -> WorldIndicesResponse:
    symbols: list[tuple[str, str]] = [
        ("DJI", "Dow Jones"),
        ("SPX", "S&P 500"),
        ("IXIC", "NASDAQ"),
        ("N225", "Nikkei 225"),
        ("HSI", "Hang Seng"),
        ("FTSE", "FTSE 100"),
        ("GDAXI", "DAX"),
        ("STOXX50E", "Euro Stoxx 50"),
    ]

    try:
        tasks = [_fetch_world_index_point(symbol, name) for symbol, name in symbols[:limit]]
        fetched = await asyncio.gather(*tasks)
        rows = [item for item in fetched if item is not None]

        if rows:
            return WorldIndicesResponse(count=len(rows), data=rows, source="vnstock:world_index")

        # Fallback to Vietnam market indices so widget still remains data-backed.
        vn_indices = await asyncio.wait_for(
            VnstockMarketOverviewFetcher.fetch(MarketOverviewQueryParams()),
            timeout=WORLD_INDEX_FALLBACK_TIMEOUT_SECONDS,
        )
        fallback = []
        for item in vn_indices[:limit]:
            payload = item.model_dump(mode="json", by_alias=True)
            fallback.append(
                {
                    "symbol": payload.get("index_code") or payload.get("index_name"),
                    "name": payload.get("index_name") or payload.get("index_code"),
                    "value": payload.get("current_value"),
                    "change": payload.get("change"),
                    "change_pct": payload.get("change_pct"),
                    "updated_at": payload.get("updated_at"),
                }
            )

        return WorldIndicesResponse(
            count=len(fallback),
            data=fallback,
            source="vnstock:market_overview_fallback",
            error="Global index feed unavailable, using VN market index fallback",
        )
    except Exception as e:
        logger.warning(f"World indices fetch failed: {e}")
        return WorldIndicesResponse(count=0, data=[], source="vnstock", error=str(e))


@router.get("/forex-rates", response_model=ForexRatesResponse)
async def get_forex_rates(limit: int = Query(default=12, ge=1, le=30)) -> ForexRatesResponse:
    if vcb_exchange_rate is None:
        return ForexRatesResponse(
            count=0,
            data=[],
            source="vnstock:vcb_exchange_rate",
            error="vcb_exchange_rate helper unavailable",
        )

    def _sync_fetch() -> list[dict[str, Any]]:
        frame = vcb_exchange_rate()
        if frame is None or len(frame.index) == 0:
            return []

        rows = frame.to_dict(orient="records")
        normalized: list[dict[str, Any]] = []
        for row in rows[:limit]:
            normalized.append(
                {
                    "currency_code": row.get("currency_code"),
                    "currency_name": row.get("currency_name"),
                    "buy_cash": _to_float(row.get("buy _cash")),
                    "buy_transfer": _to_float(row.get("buy _transfer")),
                    "sell": _to_float(row.get("sell")),
                    "date": row.get("date"),
                }
            )

        return normalized

    try:
        data = await asyncio.wait_for(asyncio.to_thread(_sync_fetch), timeout=15)
        return ForexRatesResponse(count=len(data), data=data, source="vnstock:vcb_exchange_rate")
    except Exception as e:
        logger.warning(f"Forex rates fetch failed: {e}")
        return ForexRatesResponse(
            count=0, data=[], source="vnstock:vcb_exchange_rate", error=str(e)
        )


@router.get("/commodities", response_model=CommoditiesResponse)
async def get_commodities(limit: int = Query(default=20, ge=1, le=40)) -> CommoditiesResponse:
    if btmc_goldprice is None and sjc_gold_price is None:
        return CommoditiesResponse(
            count=0,
            data=[],
            source="vnstock:gold_price",
            error="gold price helpers unavailable",
        )

    def _sync_fetch() -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []

        if btmc_goldprice is not None:
            btmc = btmc_goldprice()
            if btmc is not None and len(btmc.index) > 0:
                for item in btmc.to_dict(orient="records"):
                    rows.append(
                        {
                            "source": "BTMC",
                            "name": item.get("name"),
                            "symbol": item.get("karat"),
                            "buy_price": _to_float(item.get("buy_price")),
                            "sell_price": _to_float(item.get("sell_price")),
                            "reference_price": _to_float(item.get("world_price")),
                            "time": item.get("time"),
                        }
                    )

        if sjc_gold_price is not None:
            sjc = sjc_gold_price()
            if sjc is not None and len(sjc.index) > 0:
                for item in sjc.to_dict(orient="records"):
                    rows.append(
                        {
                            "source": "SJC",
                            "name": item.get("gold_type") or item.get("name") or "SJC Gold",
                            "symbol": item.get("brand") or item.get("type") or "SJC",
                            "buy_price": _to_float(item.get("buy_price") or item.get("buy")),
                            "sell_price": _to_float(item.get("sell_price") or item.get("sell")),
                            "reference_price": None,
                            "time": item.get("updated_at") or item.get("time"),
                        }
                    )

        return rows[:limit]

    try:
        data = await asyncio.wait_for(asyncio.to_thread(_sync_fetch), timeout=20)
        return CommoditiesResponse(count=len(data), data=data, source="vnstock:gold_price")
    except Exception as e:
        logger.warning(f"Commodities fetch failed: {e}")
        return CommoditiesResponse(count=0, data=[], source="vnstock:gold_price", error=str(e))


@router.get("/research/rss-feed", response_model=ResearchRssFeedResponse)
async def get_research_rss_feed(
    source: str = Query(default="cafef", pattern=r"^(cafef|vietstock|vnexpress)$"),
    limit: int = Query(default=10, ge=1, le=30),
) -> ResearchRssFeedResponse:
    feed_urls = RSS_FEED_URLS.get(source)
    fetched_at = datetime.utcnow().isoformat()

    if not feed_urls:
        return ResearchRssFeedResponse(
            source=source,
            count=0,
            data=[],
            fetched_at=fetched_at,
            error="Unsupported source",
        )

    errors: list[str] = []

    try:
        for feed_url in feed_urls:
            try:
                rss_text = await _fetch_rss_content(feed_url)
                if not _is_probably_rss_payload(rss_text):
                    errors.append(f"{feed_url}: non-rss payload")
                    continue

                parsed = BeautifulSoup(rss_text, "xml")
                entries: list[ResearchRssItem] = []

                for item in parsed.find_all("item")[:limit]:
                    title = item.find("title")
                    link = item.find("link")
                    published = item.find("pubDate") or item.find("published")
                    description = item.find("description")

                    url = link.get_text(strip=True) if link else ""
                    if not url:
                        continue

                    entries.append(
                        ResearchRssItem(
                            title=title.get_text(strip=True) if title else "Untitled",
                            url=url,
                            published_at=published.get_text(strip=True) if published else None,
                            description=_clean_rss_description(
                                description.decode_contents() if description else None
                            ),
                        )
                    )

                if entries:
                    return ResearchRssFeedResponse(
                        source=source,
                        count=len(entries),
                        data=entries,
                        fetched_at=fetched_at,
                    )

                errors.append(f"{feed_url}: parsed but empty")
            except Exception as feed_error:
                errors.append(f"{feed_url}: {feed_error}")

        return ResearchRssFeedResponse(
            source=source,
            count=0,
            data=[],
            fetched_at=fetched_at,
            error="; ".join(errors)[:500] if errors else "No feed data available",
        )
    except Exception as e:
        logger.warning(f"Research RSS fetch failed for {source}: {e}")
        return ResearchRssFeedResponse(
            source=source,
            count=0,
            data=[],
            fetched_at=fetched_at,
            error=str(e),
        )
