"""
Market API Endpoints

Provides endpoints for:
- Market heatmap data (treemap visualization)
- Sector aggregations
- Market overview statistics
"""

import asyncio
import logging
import re
import unicodedata
from datetime import datetime, date, timedelta
from typing import Any, Dict, List, Optional
from collections import defaultdict

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from vnibb.core.config import settings
from vnibb.core.database import async_session_maker, get_db
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
from vnibb.models.company import Company
from vnibb.models.financials import IncomeStatement
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockIndex, StockPrice
from vnibb.models.trading import FinancialRatio
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
    updated_at: Optional[str] = None


class IndustryBubblePoint(BaseModel):
    symbol: str
    name: str
    sector: str
    industry: Optional[str] = None
    x: float
    y: float
    size: float
    price: Optional[float] = None
    change_pct: Optional[float] = None
    color: str
    is_reference: bool = False


class IndustryBubbleSectorAverage(BaseModel):
    x: Optional[float] = None
    y: Optional[float] = None


class IndustryBubbleResponse(BaseModel):
    sector: str
    reference_symbol: str
    x_metric: str
    y_metric: str
    size_metric: str
    top_n: int
    sector_average: IndustryBubbleSectorAverage
    data: List[IndustryBubblePoint]
    updated_at: Optional[str] = None


class SectorBoardStock(BaseModel):
    symbol: str
    price: Optional[float] = None
    change_pct: Optional[float] = None
    volume: Optional[float] = None
    market_cap: Optional[float] = None
    color: str


class SectorBoardSector(BaseModel):
    name: str
    change_pct: float
    stocks: List[SectorBoardStock]


class SectorBoardResponse(BaseModel):
    market_summary: Dict[str, dict[str, Any]]
    sectors: List[SectorBoardSector]
    sort_by: str
    limit_per_sector: int
    updated_at: Optional[str] = None


class MarketIndicesResponse(BaseModel):
    count: int
    data: List[dict[str, Any]]
    updated_at: Optional[str] = None
    error: Optional[str] = None


class MarketTopMoversResponse(BaseModel):
    type: str
    index: str
    count: int
    data: List[dict[str, Any]]
    updated_at: Optional[str] = None
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
TOP_MOVER_TYPES = {"gainer", "loser", "volume", "value"}
MARKET_INDEX_ORDER = ("VNINDEX", "VN30", "HNX", "UPCOM")
MARKET_INDEX_ALIASES = {
    "VNINDEX": "VNINDEX",
    "VN-INDEX": "VNINDEX",
    "VN30": "VN30",
    "HNX": "HNX",
    "HNXINDEX": "HNX",
    "HNX-INDEX": "HNX",
    "UPCOM": "UPCOM",
    "UPCOMINDEX": "UPCOM",
    "UPCOM-INDEX": "UPCOM",
}
MARKET_INDEX_MIN_EXPECTED_VALUE = {
    "VNINDEX": 100.0,
    "VN30": 100.0,
    "HNX": 10.0,
    "UPCOM": 10.0,
}
TOP_MOVER_TYPE_ALIASES = {
    "gainers": "gainer",
    "losers": "loser",
}
TOP_MOVER_INDEX_EXCHANGE = {
    "VNINDEX": {"HOSE", "HSX"},
    "HNX": {"HNX"},
}
SECTOR_CLASSIFICATION_IDS = [
    sector_id for sector_id in VN_SECTORS.keys() if sector_id not in {"vn30"}
]

INDUSTRY_TO_SECTOR_ID: dict[str, str] = {
    "Ngân hàng": "banking",
    "Chứng khoán": "securities",
    "Bất động sản": "real_estate",
    "Vật liệu xây dựng": "construction_materials",
    "Bán lẻ": "retail",
    "Thực phẩm - Đồ uống": "food",
    "Sản xuất thực phẩm": "food",
    "Bia và đồ uống": "food",
    "Công nghệ và thông tin": "technology",
    "Bảo hiểm": "insurance",
    "SX Nhựa - Hóa chất": "chemicals_fertilizer",
    "Hóa chất": "chemicals_fertilizer",
    "Thiết bị điện": "power_energy",
    "Vận tải - kho bãi": "port_logistics",
    "Vận tải": "port_logistics",
    "Chế biến Thủy sản": "seafood",
    "Xây dựng": "public_investment",
    "Tiện ích": "power_energy",
    "SX Phụ trợ": "construction_materials",
    "Khai khoáng": "oil_gas",
    "Dịch vụ lưu trú, ăn uống, giải trí": "aviation_tourism",
    "Du lịch & Giải trí": "aviation_tourism",
    "SX Hàng gia dụng": "textile",
    "Hàng cá nhân": "textile",
    "Kim loại": "steel",
    "Bán buôn": "retail",
    "Tư vấn & Hỗ trợ Kinh doanh": "public_investment",
    "Xây dựng và Vật liệu": "construction_materials",
    "Nước & Khí đốt": "water_plastic",
    "Viễn thông cố định": "technology",
    "Viễn thông di động": "technology",
    "Dược phẩm": "pharma_healthcare",
    "Chăm sóc sức khỏe": "pharma_healthcare",
    "Thiết bị và Dịch vụ Y tế": "pharma_healthcare",
    "Sản xuất & Phân phối Điện": "power_energy",
    "Thiết bị, Dịch vụ và Phân phối Dầu khí": "oil_gas",
    "Điện tử & Thiết bị điện": "power_energy",
    "Lâm nghiệp và Giấy": "sugar_wood_paper",
    "Ô tô và phụ tùng": "auto_parts",
    "SX Thiết bị, máy móc": "power_energy",
    "Công nghiệp nặng": "steel",
    "Tài chính khác": "securities",
    "Bảo hiểm phi nhân thọ": "insurance",
    "Truyền thông": "technology",
}


def _normalize_lookup_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    normalized = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


INDUSTRY_TO_SECTOR_ID_LOOKUP: dict[str, str] = {
    _normalize_lookup_text(industry): sector_id
    for industry, sector_id in INDUSTRY_TO_SECTOR_ID.items()
}

INDUSTRY_BUBBLE_COLORS = [
    "#f97316",
    "#22c55e",
    "#38bdf8",
    "#eab308",
    "#a855f7",
    "#ef4444",
    "#14b8a6",
    "#f472b6",
]


def _resolve_board_color(change_pct: Optional[float]) -> str:
    if change_pct is None:
        return "yellow"
    if change_pct >= 6.8:
        return "purple"
    if change_pct <= -6.8:
        return "blue"
    if change_pct > 0:
        return "green"
    if change_pct < 0:
        return "red"
    return "yellow"


def _map_text_to_sector_name(value: Optional[str]) -> Optional[str]:
    normalized_value = _normalize_lookup_text(value)
    if not normalized_value:
        return None

    sector_id = INDUSTRY_TO_SECTOR_ID_LOOKUP.get(normalized_value)
    if sector_id is None:
        for known_industry, mapped_sector in INDUSTRY_TO_SECTOR_ID_LOOKUP.items():
            if not known_industry:
                continue
            if known_industry in normalized_value or normalized_value in known_industry:
                sector_id = mapped_sector
                break

    if sector_id is None:
        return None

    sector_config = VN_SECTORS.get(sector_id)
    return sector_config.name if sector_config else None


def _normalize_market_index_code(value: Any) -> str:
    normalized = str(value or "").strip().upper().replace(" ", "")
    if not normalized:
        return ""
    return MARKET_INDEX_ALIASES.get(normalized, normalized.replace("-", ""))


def _coerce_market_number(value: Any) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _is_suspicious_market_index_value(index_code: str, value: Optional[float]) -> bool:
    if value is None:
        return False
    min_expected = MARKET_INDEX_MIN_EXPECTED_VALUE.get(index_code)
    return min_expected is not None and value < min_expected


async def _load_latest_market_indices_from_db(db: AsyncSession) -> list[dict[str, Any]]:
    ranked_indices = (
        select(
            StockIndex.index_code.label("index_code"),
            StockIndex.time.label("time"),
            StockIndex.open.label("open"),
            StockIndex.high.label("high"),
            StockIndex.low.label("low"),
            StockIndex.close.label("close"),
            StockIndex.volume.label("volume"),
            StockIndex.change.label("change"),
            StockIndex.change_pct.label("change_pct"),
            func.row_number()
            .over(partition_by=StockIndex.index_code, order_by=StockIndex.time.desc())
            .label("row_num"),
        )
        .where(StockIndex.index_code.in_(MARKET_INDEX_ORDER))
        .subquery()
    )

    rows = (
        await db.execute(
            select(
                ranked_indices.c.index_code,
                ranked_indices.c.time,
                ranked_indices.c.open,
                ranked_indices.c.high,
                ranked_indices.c.low,
                ranked_indices.c.close,
                ranked_indices.c.volume,
                ranked_indices.c.change,
                ranked_indices.c.change_pct,
            )
            .where(ranked_indices.c.row_num <= 2)
            .order_by(ranked_indices.c.index_code.asc(), ranked_indices.c.time.desc())
        )
    ).all()

    history_by_code: dict[str, list[Any]] = {code: [] for code in MARKET_INDEX_ORDER}
    for row in rows:
        code = _normalize_market_index_code(row.index_code)
        if code:
            history_by_code.setdefault(code, []).append(row)

    results: list[dict[str, Any]] = []
    for code in MARKET_INDEX_ORDER:
        history = history_by_code.get(code) or []
        if not history:
            continue

        latest = history[0]
        previous = history[1] if len(history) > 1 else None
        current_value = _coerce_market_number(latest.close)
        if _is_suspicious_market_index_value(code, current_value):
            continue

        change = _coerce_market_number(latest.change)
        previous_close = _coerce_market_number(previous.close) if previous else None
        if change is None and current_value is not None and previous_close is not None:
            change = current_value - previous_close

        change_pct = _coerce_market_number(latest.change_pct)
        if change_pct is None and change is not None and previous_close not in (None, 0):
            change_pct = (change / previous_close) * 100

        results.append(
            {
                "index_name": code,
                "current_value": current_value,
                "change": change,
                "change_pct": change_pct,
                "volume": _coerce_market_number(latest.volume),
                "high": _coerce_market_number(latest.high),
                "low": _coerce_market_number(latest.low),
                "time": latest.time,
            }
        )

    return results


def _merge_market_index_rows(
    db_rows: list[dict[str, Any]],
    provider_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}

    for row in provider_rows:
        code = _normalize_market_index_code(row.get("index_name") or row.get("index_code"))
        current_value = _coerce_market_number(row.get("current_value"))
        if not code or _is_suspicious_market_index_value(code, current_value):
            continue
        merged[code] = {**row, "index_name": code}

    for row in db_rows:
        code = _normalize_market_index_code(row.get("index_name"))
        if code:
            merged[code] = {**row, "index_name": code}

    ordered_codes = [code for code in MARKET_INDEX_ORDER if code in merged]
    extra_codes = sorted(code for code in merged.keys() if code not in ordered_codes)
    return [merged[code] for code in [*ordered_codes, *extra_codes]]


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


def _pick_optional_float(*values: Any) -> Optional[float]:
    for value in values:
        parsed = _to_float(value)
        if parsed is not None:
            return parsed
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


def _parse_datetime_like(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return None
    return None


def _serialize_datetime_like(value: Any) -> Optional[str]:
    parsed = _parse_datetime_like(value)
    return parsed.isoformat() if parsed else None


def _latest_timestamp(values: List[Any]) -> Optional[str]:
    parsed_values = [
        parsed for parsed in (_parse_datetime_like(value) for value in values) if parsed
    ]
    if not parsed_values:
        return None
    return max(parsed_values).isoformat()


def _normalize_mover_type(value: Optional[str]) -> str:
    if value is None:
        return "gainer"

    normalized = str(value).strip().lower()
    if normalized in TOP_MOVER_TYPE_ALIASES:
        return TOP_MOVER_TYPE_ALIASES[normalized]
    if normalized in TOP_MOVER_TYPES:
        return normalized
    return "gainer"


def _extract_snapshot_change_pct(extended_metrics: dict[str, Any]) -> Optional[float]:
    return _to_float(
        _first_non_none(
            extended_metrics.get("change_1d"),
            extended_metrics.get("price_change_1d_pct"),
            extended_metrics.get("change_pct"),
            extended_metrics.get("price_change_pct"),
        )
    )


def _extract_snapshot_value_traded(extended_metrics: dict[str, Any]) -> Optional[float]:
    return _to_float(
        _first_non_none(
            extended_metrics.get("value_traded"),
            extended_metrics.get("valueTraded"),
            extended_metrics.get("trading_value"),
            extended_metrics.get("value"),
        )
    )


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
        "updated_at": _first_non_none(
            payload.get("updated_at"),
            payload.get("snapshot_date"),
            payload.get("time"),
        ),
    }


def _resolve_sector_name(symbol: str, industry: Optional[str], sector_hint: Optional[str]) -> str:
    mapped_sector_hint = _map_text_to_sector_name(sector_hint)
    if mapped_sector_hint:
        return mapped_sector_hint

    symbol_upper = _normalize_symbol(symbol)
    for sector_id in SECTOR_CLASSIFICATION_IDS:
        config = VN_SECTORS.get(sector_id)
        if not config:
            continue
        if symbol_upper in {s.upper() for s in config.symbols}:
            return config.name

    mapped_industry = _map_text_to_sector_name(industry)
    if mapped_industry:
        return mapped_industry

    industry_text = (industry or "").strip().lower()
    if industry_text:
        for sector_id in SECTOR_CLASSIFICATION_IDS:
            config = VN_SECTORS.get(sector_id)
            if not config:
                continue
            for keyword in config.keywords:
                if keyword.lower() in industry_text:
                    return config.name

    if sector_hint:
        return sector_hint

    return "Other"


async def _load_stock_metadata(symbols: List[str]) -> Dict[str, Dict[str, Optional[str]]]:
    unique_symbols = sorted({_normalize_symbol(symbol) for symbol in symbols if symbol})
    if not unique_symbols:
        return {}

    async with async_session_maker() as session:
        stock_rows = (
            await session.execute(
                select(Stock.symbol, Stock.exchange, Stock.industry, Stock.sector).where(
                    Stock.symbol.in_(unique_symbols)
                )
            )
        ).all()

        company_rows = (
            await session.execute(
                select(Company.symbol, Company.exchange, Company.industry, Company.sector).where(
                    Company.symbol.in_(unique_symbols)
                )
            )
        ).all()

        ranked_snapshots = (
            select(
                ScreenerSnapshot.symbol.label("symbol"),
                ScreenerSnapshot.exchange.label("exchange"),
                ScreenerSnapshot.industry.label("industry"),
                func.row_number()
                .over(
                    partition_by=ScreenerSnapshot.symbol,
                    order_by=ScreenerSnapshot.snapshot_date.desc(),
                )
                .label("rn"),
            )
            .where(ScreenerSnapshot.symbol.in_(unique_symbols))
            .subquery()
        )
        latest_snapshot_rows = (
            await session.execute(
                select(
                    ranked_snapshots.c.symbol,
                    ranked_snapshots.c.exchange,
                    ranked_snapshots.c.industry,
                ).where(ranked_snapshots.c.rn == 1)
            )
        ).all()

    metadata: Dict[str, Dict[str, Optional[str]]] = {
        _normalize_symbol(symbol): {
            "exchange": _normalize_text(exchange),
            "industry": _normalize_text(industry),
            "sector": _normalize_text(sector),
        }
        for symbol, exchange, industry, sector in stock_rows
    }

    for symbol, exchange, industry, sector in company_rows:
        symbol_key = _normalize_symbol(symbol)
        if not symbol_key:
            continue
        payload = metadata.setdefault(
            symbol_key, {"exchange": None, "industry": None, "sector": None}
        )
        if not payload.get("exchange") and _normalize_text(exchange):
            payload["exchange"] = _normalize_text(exchange)
        if not payload.get("industry") and _normalize_text(industry):
            payload["industry"] = _normalize_text(industry)
        if not payload.get("sector") and _normalize_text(sector):
            payload["sector"] = _normalize_text(sector)

    for symbol, exchange, industry in latest_snapshot_rows:
        symbol_key = _normalize_symbol(symbol)
        if not symbol_key:
            continue
        payload = metadata.setdefault(
            symbol_key, {"exchange": None, "industry": None, "sector": None}
        )
        if not payload.get("exchange") and _normalize_text(exchange):
            payload["exchange"] = _normalize_text(exchange)
        if not payload.get("industry") and _normalize_text(industry):
            payload["industry"] = _normalize_text(industry)

    return metadata


async def _load_change_pct_map(symbols: List[str]) -> Dict[str, float]:
    unique_symbols = sorted({_normalize_symbol(symbol) for symbol in symbols if symbol})
    if not unique_symbols:
        return {}

    change_map: Dict[str, float] = {}

    try:
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
    except Exception as exc:
        logger.warning("Failed to build change map from DB fallback: %s", exc)
        return {}

    return change_map


async def _load_latest_snapshot_metrics(
    symbols: List[str],
) -> Dict[str, dict[str, Any]]:
    unique_symbols = sorted({_normalize_symbol(symbol) for symbol in symbols if symbol})
    if not unique_symbols:
        return {}

    metrics_map: Dict[str, dict[str, Any]] = {}

    try:
        async with async_session_maker() as session:
            ranked_snapshots = (
                select(
                    ScreenerSnapshot.symbol.label("symbol"),
                    ScreenerSnapshot.price.label("price"),
                    ScreenerSnapshot.volume.label("volume"),
                    ScreenerSnapshot.snapshot_date.label("snapshot_date"),
                    ScreenerSnapshot.created_at.label("created_at"),
                    ScreenerSnapshot.extended_metrics.label("extended_metrics"),
                    func.row_number()
                    .over(
                        partition_by=ScreenerSnapshot.symbol,
                        order_by=(
                            ScreenerSnapshot.snapshot_date.desc(),
                            ScreenerSnapshot.created_at.desc(),
                        ),
                    )
                    .label("rn"),
                )
                .where(ScreenerSnapshot.symbol.in_(unique_symbols))
                .subquery()
            )

            rows = (
                await session.execute(
                    select(
                        ranked_snapshots.c.symbol,
                        ranked_snapshots.c.price,
                        ranked_snapshots.c.volume,
                        ranked_snapshots.c.snapshot_date,
                        ranked_snapshots.c.created_at,
                        ranked_snapshots.c.extended_metrics,
                    ).where(ranked_snapshots.c.rn == 1)
                )
            ).all()

            for symbol, price, volume, snapshot_date, created_at, extended_metrics in rows:
                symbol_key = _normalize_symbol(symbol)
                payload = extended_metrics if isinstance(extended_metrics, dict) else {}
                metrics_map[symbol_key] = {
                    "price": _to_float(price),
                    "volume": _to_float(volume),
                    "change_pct": _extract_snapshot_change_pct(payload),
                    "value": _extract_snapshot_value_traded(payload),
                    "updated_at": _serialize_datetime_like(
                        _first_non_none(payload.get("updated_at"), snapshot_date, created_at)
                    ),
                }
    except Exception as exc:
        logger.warning("Failed to load latest snapshot metrics: %s", exc)
        return {}

    return metrics_map


async def _load_latest_ratio_metrics(symbols: List[str]) -> Dict[str, dict[str, Optional[float]]]:
    unique_symbols = sorted({_normalize_symbol(symbol) for symbol in symbols if symbol})
    if not unique_symbols:
        return {}

    async with async_session_maker() as session:
        ranked_ratios = (
            select(
                FinancialRatio.symbol.label("symbol"),
                FinancialRatio.pe_ratio.label("pe_ratio"),
                FinancialRatio.pb_ratio.label("pb_ratio"),
                FinancialRatio.ps_ratio.label("ps_ratio"),
                FinancialRatio.roe.label("roe"),
                FinancialRatio.roa.label("roa"),
                FinancialRatio.roic.label("roic"),
                FinancialRatio.debt_to_equity.label("debt_to_equity"),
                FinancialRatio.revenue_growth.label("revenue_growth"),
                FinancialRatio.earnings_growth.label("earnings_growth"),
                func.row_number()
                .over(
                    partition_by=FinancialRatio.symbol,
                    order_by=(
                        FinancialRatio.fiscal_year.desc(),
                        FinancialRatio.fiscal_quarter.desc(),
                        FinancialRatio.updated_at.desc(),
                    ),
                )
                .label("rn"),
            )
            .where(FinancialRatio.symbol.in_(unique_symbols))
            .subquery()
        )

        rows = (
            (await session.execute(select(ranked_ratios).where(ranked_ratios.c.rn == 1)))
            .mappings()
            .all()
        )

    return {
        _normalize_symbol(row["symbol"]): {
            "pe_ratio": _to_float(row.get("pe_ratio")),
            "pb_ratio": _to_float(row.get("pb_ratio")),
            "ps_ratio": _to_float(row.get("ps_ratio")),
            "roe": _to_float(row.get("roe")),
            "roa": _to_float(row.get("roa")),
            "roic": _to_float(row.get("roic")),
            "debt_to_equity": _to_float(row.get("debt_to_equity")),
            "revenue_growth": _to_float(row.get("revenue_growth")),
            "earnings_growth": _to_float(row.get("earnings_growth")),
        }
        for row in rows
    }


async def _load_latest_income_revenue(symbols: List[str]) -> Dict[str, Optional[float]]:
    unique_symbols = sorted({_normalize_symbol(symbol) for symbol in symbols if symbol})
    if not unique_symbols:
        return {}

    async with async_session_maker() as session:
        ranked_income = (
            select(
                IncomeStatement.symbol.label("symbol"),
                IncomeStatement.revenue.label("revenue"),
                func.row_number()
                .over(
                    partition_by=IncomeStatement.symbol,
                    order_by=(
                        IncomeStatement.fiscal_year.desc(),
                        IncomeStatement.fiscal_quarter.desc(),
                        IncomeStatement.updated_at.desc(),
                    ),
                )
                .label("rn"),
            )
            .where(IncomeStatement.symbol.in_(unique_symbols))
            .subquery()
        )
        rows = (
            (await session.execute(select(ranked_income).where(ranked_income.c.rn == 1)))
            .mappings()
            .all()
        )

    return {_normalize_symbol(row["symbol"]): _to_float(row.get("revenue")) for row in rows}


async def _load_latest_screener_rows_from_db(limit: int = 500) -> List[dict[str, Any]]:
    async with async_session_maker() as session:
        ranked_snapshots = select(
            ScreenerSnapshot.symbol.label("symbol"),
            ScreenerSnapshot.company_name.label("company_name"),
            ScreenerSnapshot.exchange.label("exchange"),
            ScreenerSnapshot.industry.label("industry"),
            ScreenerSnapshot.price.label("price"),
            ScreenerSnapshot.volume.label("volume"),
            ScreenerSnapshot.market_cap.label("market_cap"),
            ScreenerSnapshot.pe.label("pe"),
            ScreenerSnapshot.pb.label("pb"),
            ScreenerSnapshot.ps.label("ps"),
            ScreenerSnapshot.roe.label("roe"),
            ScreenerSnapshot.roa.label("roa"),
            ScreenerSnapshot.roic.label("roic"),
            ScreenerSnapshot.revenue_growth.label("revenue_growth"),
            ScreenerSnapshot.earnings_growth.label("earnings_growth"),
            ScreenerSnapshot.debt_to_equity.label("debt_to_equity"),
            ScreenerSnapshot.snapshot_date.label("snapshot_date"),
            func.row_number()
            .over(
                partition_by=ScreenerSnapshot.symbol,
                order_by=(
                    ScreenerSnapshot.snapshot_date.desc(),
                    ScreenerSnapshot.created_at.desc(),
                ),
            )
            .label("rn"),
        ).subquery()

        rows = (
            (
                await session.execute(
                    select(ranked_snapshots)
                    .where(ranked_snapshots.c.rn == 1)
                    .order_by(ranked_snapshots.c.market_cap.desc().nullslast())
                    .limit(limit)
                )
            )
            .mappings()
            .all()
        )

    normalized_rows: List[dict[str, Any]] = []
    for row in rows:
        normalized_rows.append(
            _normalize_screener_row(
                {
                    "symbol": row.get("symbol"),
                    "company_name": row.get("company_name"),
                    "exchange": row.get("exchange"),
                    "industry_name": row.get("industry"),
                    "price": row.get("price"),
                    "volume": row.get("volume"),
                    "market_cap": row.get("market_cap"),
                    "pe": row.get("pe"),
                    "pb": row.get("pb"),
                    "ps": row.get("ps"),
                    "roe": row.get("roe"),
                    "roa": row.get("roa"),
                    "roic": row.get("roic"),
                    "revenue_growth": row.get("revenue_growth"),
                    "earnings_growth": row.get("earnings_growth"),
                    "debt_to_equity": row.get("debt_to_equity"),
                    "snapshot_date": row.get("snapshot_date"),
                }
            )
        )
    return [row for row in normalized_rows if row.get("symbol")]


def _resolve_industry_bubble_metric(
    row: dict[str, Any],
    ratio_metrics: dict[str, Optional[float]],
    revenue_map: dict[str, Optional[float]],
    metric: str,
) -> Optional[float]:
    metric = str(metric or "").strip().lower()
    if metric == "market_cap":
        return _to_float(row.get("market_cap"))
    if metric == "volume":
        return _to_float(row.get("volume"))
    if metric == "revenue":
        return _to_float(revenue_map.get(row.get("symbol", "")))

    screener_map = {
        "pe_ratio": "pe",
        "pb_ratio": "pb",
        "ps_ratio": "ps",
    }
    screener_key = screener_map.get(metric)
    if screener_key:
        return _pick_optional_float(row.get(screener_key), ratio_metrics.get(metric))
    return _to_float(ratio_metrics.get(metric))


def _apply_snapshot_metrics_to_movers(
    payload: List[dict[str, Any]],
    metrics_map: Dict[str, dict[str, Any]],
) -> List[dict[str, Any]]:
    if not payload or not metrics_map:
        return payload

    for item in payload:
        symbol = _normalize_symbol(item.get("symbol"))
        metrics = metrics_map.get(symbol)
        if not metrics:
            continue

        current_pct = _to_float(item.get("price_change_pct"))
        snapshot_pct = metrics.get("change_pct")
        if (current_pct is None or abs(current_pct) < 1e-9) and snapshot_pct is not None:
            item["price_change_pct"] = snapshot_pct
            current_pct = snapshot_pct

        price_value = _to_float(item.get("last_price"))
        snapshot_price = metrics.get("price")
        if price_value in (None, 0) and snapshot_price not in (None, 0):
            item["last_price"] = snapshot_price
            price_value = snapshot_price

        volume_value = _to_float(item.get("volume"))
        snapshot_volume = metrics.get("volume")
        if volume_value in (None, 0) and snapshot_volume not in (None, 0):
            item["volume"] = int(snapshot_volume)
            volume_value = snapshot_volume

        value_value = _to_float(item.get("value"))
        snapshot_value = metrics.get("value")
        if value_value in (None, 0) and snapshot_value not in (None, 0):
            item["value"] = snapshot_value
            value_value = snapshot_value

        if (
            value_value in (None, 0)
            and price_value not in (None, 0)
            and volume_value not in (None, 0)
        ):
            item["value"] = price_value * volume_value

        if not item.get("updated_at") and metrics.get("updated_at"):
            item["updated_at"] = metrics["updated_at"]

        current_change = _to_float(item.get("price_change"))
        if (
            (current_change is None or abs(current_change) < 1e-9)
            and current_pct is not None
            and price_value not in (None, 0)
            and abs(current_pct + 100.0) > 1e-6
        ):
            previous_price = price_value / (1.0 + (current_pct / 100.0))
            item["price_change"] = price_value - previous_price

    return payload


def _sort_top_movers(
    payload: List[dict[str, Any]], mover_type: str, limit: int
) -> List[dict[str, Any]]:
    if mover_type == "gainer":
        rows = [item for item in payload if (_to_float(item.get("price_change_pct")) or 0.0) > 0]
        rows.sort(key=lambda item: _to_float(item.get("price_change_pct")) or 0.0, reverse=True)
        return rows[:limit]

    if mover_type == "loser":
        rows = [item for item in payload if (_to_float(item.get("price_change_pct")) or 0.0) < 0]
        rows.sort(key=lambda item: _to_float(item.get("price_change_pct")) or 0.0)
        return rows[:limit]

    if mover_type == "volume":
        rows = sorted(payload, key=lambda item: _to_float(item.get("volume")) or 0.0, reverse=True)
        return rows[:limit]

    if mover_type == "value":
        rows = sorted(payload, key=lambda item: _to_float(item.get("value")) or 0.0, reverse=True)
        return rows[:limit]

    return payload[:limit]


def _has_non_zero_top_mover_signal(payload: List[dict[str, Any]]) -> bool:
    for item in payload:
        change_pct = _to_float(item.get("price_change_pct"))
        if change_pct is not None and abs(change_pct) > 1e-9:
            return True
    return False


async def _build_snapshot_top_movers(
    index: str, mover_type: str, limit: int
) -> List[dict[str, Any]]:
    cache_manager = CacheManager()
    cache_result = await cache_manager.get_screener_data(
        symbol=None,
        source=settings.vnstock_source,
        allow_stale=True,
    )
    if not cache_result.data:
        return []

    vn30_symbols = {
        symbol.upper()
        for symbol in (VN_SECTORS.get("vn30").symbols if VN_SECTORS.get("vn30") else [])
    }

    rows: List[dict[str, Any]] = []
    for item in cache_result.data:
        symbol = _normalize_symbol(getattr(item, "symbol", None))
        if not symbol:
            continue

        if index == "VN30" and symbol not in vn30_symbols:
            continue

        exchange = _normalize_symbol(getattr(item, "exchange", None))
        if index in TOP_MOVER_INDEX_EXCHANGE and exchange:
            allowed_exchanges = TOP_MOVER_INDEX_EXCHANGE[index]
            if exchange not in allowed_exchanges:
                continue

        extended_metrics = (
            getattr(item, "extended_metrics", None)
            if isinstance(getattr(item, "extended_metrics", None), dict)
            else {}
        )

        price = _to_float(
            _first_non_none(getattr(item, "price", None), extended_metrics.get("price"))
        )
        volume = _to_float(
            _first_non_none(getattr(item, "volume", None), extended_metrics.get("volume"))
        )
        change_pct = _extract_snapshot_change_pct(extended_metrics)
        value = _extract_snapshot_value_traded(extended_metrics)
        if value in (None, 0) and price not in (None, 0) and volume not in (None, 0):
            value = price * volume

        rows.append(
            {
                "symbol": symbol,
                "price": price,
                "volume": volume,
                "change_pct": change_pct,
                "value": value,
                "updated_at": _serialize_datetime_like(
                    _first_non_none(
                        extended_metrics.get("updated_at"),
                        getattr(item, "updated_at", None),
                        getattr(item, "snapshot_date", None),
                    )
                ),
            }
        )

    if not rows:
        return []

    missing_change_symbols = [row["symbol"] for row in rows if row.get("change_pct") is None]
    if missing_change_symbols:
        change_map = await _load_change_pct_map(missing_change_symbols)
        for row in rows:
            if row.get("change_pct") is None and row["symbol"] in change_map:
                row["change_pct"] = change_map[row["symbol"]]

    sorted_rows = _sort_top_movers(
        [
            {
                "symbol": row["symbol"],
                "price_change_pct": row.get("change_pct"),
                "last_price": row.get("price"),
                "volume": row.get("volume"),
                "value": row.get("value"),
            }
            for row in rows
        ],
        mover_type=mover_type,
        limit=limit,
    )

    payload: List[dict[str, Any]] = []
    for row in sorted_rows:
        last_price = _to_float(row.get("last_price"))
        change_pct = _to_float(row.get("price_change_pct"))
        price_change = None
        if (
            last_price not in (None, 0)
            and change_pct is not None
            and abs(change_pct + 100.0) > 1e-6
        ):
            previous_price = last_price / (1.0 + (change_pct / 100.0))
            price_change = last_price - previous_price

        payload.append(
            {
                "symbol": row.get("symbol"),
                "index": index,
                "last_price": last_price,
                "price_change": price_change,
                "price_change_pct": change_pct,
                "volume": row.get("volume"),
                "value": row.get("value"),
                "avg_volume_20d": None,
                "volume_spike_pct": None,
                "updated_at": row.get("updated_at"),
            }
        )

    return payload[:limit]


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
                            updated_at=getattr(s, "updated_at", None)
                            or getattr(s, "snapshot_date", None),
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

        updated_at = _latest_timestamp([row.get("updated_at") for row in normalized_rows])

        return HeatmapResponse(
            count=total_stocks,
            group_by=group_by,
            color_metric=color_metric,
            size_metric=size_metric,
            sectors=sectors,
            cached=cached,
            updated_at=updated_at,
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
@cached(ttl=180, key_prefix="market_indices")
async def get_market_indices(
    limit: int = Query(default=10, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
) -> MarketIndicesResponse:
    db_rows: list[dict[str, Any]] = []
    try:
        db_rows = await _load_latest_market_indices_from_db(db)
    except Exception as db_error:
        logger.warning(f"Market indices DB fallback failed: {db_error}")

    try:
        indices = await asyncio.wait_for(
            VnstockMarketOverviewFetcher.fetch(MarketOverviewQueryParams()),
            timeout=30,
        )
        provider_rows = [
            item.model_dump(mode="json", by_alias=False) if hasattr(item, "model_dump") else item
            for item in indices
        ]
        merged = _merge_market_index_rows(db_rows, provider_rows)
        if merged:
            rows = merged[:limit]
            return MarketIndicesResponse(
                count=len(rows),
                data=rows,
                updated_at=_latest_timestamp(
                    [
                        _first_non_none(row.get("time"), row.get("updated_at"), row.get("date"))
                        for row in rows
                    ]
                ),
            )
        rows = provider_rows[:limit]
        return MarketIndicesResponse(
            count=len(rows),
            data=rows,
            updated_at=_latest_timestamp(
                [
                    _first_non_none(row.get("time"), row.get("updated_at"), row.get("date"))
                    for row in rows
                ]
            ),
        )
    except Exception as e:
        logger.warning(f"Market indices fetch failed: {e}")
        if db_rows:
            rows = db_rows[:limit]
            return MarketIndicesResponse(
                count=len(rows),
                data=rows,
                updated_at=_latest_timestamp(
                    [
                        _first_non_none(row.get("time"), row.get("updated_at"), row.get("date"))
                        for row in rows
                    ]
                ),
                error=str(e),
            )
        return MarketIndicesResponse(count=0, data=[], error=str(e))


@router.get("/industry-bubble", response_model=IndustryBubbleResponse)
@cached(ttl=300, key_prefix="industry_bubble")
async def get_industry_bubble(
    symbol: str = Query(..., description="Reference symbol used to determine sector"),
    x_metric: str = Query(
        default="pb_ratio",
        pattern=r"^(pe_ratio|pb_ratio|ps_ratio|roe|roa|roic|debt_to_equity|revenue_growth|earnings_growth|market_cap)$",
    ),
    y_metric: str = Query(
        default="pe_ratio",
        pattern=r"^(pe_ratio|pb_ratio|ps_ratio|roe|roa|roic|debt_to_equity|revenue_growth|earnings_growth|market_cap)$",
    ),
    size_metric: str = Query(
        default="market_cap",
        pattern=r"^(market_cap|volume|revenue)$",
    ),
    top_n: int = Query(default=20, ge=5, le=50),
) -> IndustryBubbleResponse:
    reference_symbol = _normalize_symbol(symbol)
    if not reference_symbol:
        raise HTTPException(status_code=400, detail="Reference symbol is required")

    cache_manager = CacheManager()
    screener_rows: List[dict[str, Any]] = []

    async def _fetch_fresh_rows() -> List[dict[str, Any]]:
        params = StockScreenerParams(
            symbol=None,
            exchange="ALL",
            limit=500,
            source=settings.vnstock_source,
        )
        try:
            screener_data = await asyncio.wait_for(
                VnstockScreenerFetcher.fetch(params),
                timeout=HEATMAP_FETCH_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError as exc:
            raise ProviderTimeoutError("vnstock", HEATMAP_FETCH_TIMEOUT_SECONDS) from exc
        return [_normalize_screener_row(item) for item in screener_data]

    try:
        cache_result = await cache_manager.get_screener_data(
            symbol=None,
            source=settings.vnstock_source,
            allow_stale=True,
        )
        if cache_result.data:
            screener_rows = [_normalize_screener_row(item) for item in cache_result.data]
    except Exception as exc:
        logger.warning("Industry bubble cache lookup failed: %s", exc)

    try:
        db_rows = await _load_latest_screener_rows_from_db(limit=500)
        if db_rows:
            merged_rows = {row["symbol"]: row for row in db_rows if row.get("symbol")}
            for row in screener_rows:
                ticker = row.get("symbol")
                if not ticker:
                    continue
                merged_rows[ticker] = {**merged_rows.get(ticker, {}), **row}
            screener_rows = list(merged_rows.values())
    except Exception as exc:
        logger.warning("Industry bubble DB screener fallback failed: %s", exc)

    if not screener_rows:
        screener_rows = await _fetch_fresh_rows()

    screener_rows = [row for row in screener_rows if row.get("symbol")]
    symbols = [row["symbol"] for row in screener_rows]
    metadata_map = await _load_stock_metadata(symbols)
    change_map = await _load_change_pct_map(symbols)
    ratio_map = await _load_latest_ratio_metrics(symbols)
    revenue_map = await _load_latest_income_revenue(symbols)

    for row in screener_rows:
        ticker = row["symbol"]
        metadata = metadata_map.get(ticker) or {}
        if not row.get("exchange") and metadata.get("exchange"):
            row["exchange"] = metadata.get("exchange")
        if not row.get("industry") and metadata.get("industry"):
            row["industry"] = metadata.get("industry")
        if not row.get("sector") and metadata.get("sector"):
            row["sector"] = metadata.get("sector")
        if row.get("change_pct") is None and ticker in change_map:
            row["change_pct"] = change_map[ticker]

    reference_row = next(
        (row for row in screener_rows if row.get("symbol") == reference_symbol), None
    )
    if reference_row is None:
        screener_rows = await _fetch_fresh_rows()
        screener_rows = [row for row in screener_rows if row.get("symbol")]
        symbols = [row["symbol"] for row in screener_rows]
        metadata_map = await _load_stock_metadata(symbols)
        change_map = await _load_change_pct_map(symbols)
        ratio_map = await _load_latest_ratio_metrics(symbols)
        revenue_map = await _load_latest_income_revenue(symbols)
        for row in screener_rows:
            ticker = row["symbol"]
            metadata = metadata_map.get(ticker) or {}
            if not row.get("exchange") and metadata.get("exchange"):
                row["exchange"] = metadata.get("exchange")
            if not row.get("industry") and metadata.get("industry"):
                row["industry"] = metadata.get("industry")
            if not row.get("sector") and metadata.get("sector"):
                row["sector"] = metadata.get("sector")
            if row.get("change_pct") is None and ticker in change_map:
                row["change_pct"] = change_map[ticker]
        reference_row = next(
            (row for row in screener_rows if row.get("symbol") == reference_symbol), None
        )
    if reference_row is None:
        raise HTTPException(
            status_code=404, detail=f"Reference symbol {reference_symbol} not found"
        )

    sector_name = _resolve_sector_name(
        reference_symbol,
        reference_row.get("industry"),
        reference_row.get("sector"),
    )
    reference_sector_match = _normalize_lookup_text(sector_name)

    def _same_sector(row: dict[str, Any]) -> bool:
        return (
            _normalize_lookup_text(
                _resolve_sector_name(
                    row.get("symbol", ""),
                    row.get("industry"),
                    row.get("sector"),
                )
            )
            == reference_sector_match
        )

    sector_rows = [row for row in screener_rows if _same_sector(row)]

    points: List[IndustryBubblePoint] = []
    for index, row in enumerate(sector_rows):
        ticker = row.get("symbol", "")
        ratio_metrics = ratio_map.get(ticker, {})
        x_value = _resolve_industry_bubble_metric(row, ratio_metrics, revenue_map, x_metric)
        y_value = _resolve_industry_bubble_metric(row, ratio_metrics, revenue_map, y_metric)
        size_value = _resolve_industry_bubble_metric(row, ratio_metrics, revenue_map, size_metric)

        if x_value in (None,) or y_value in (None,) or size_value in (None,) or size_value <= 0:
            continue

        points.append(
            IndustryBubblePoint(
                symbol=ticker,
                name=str(row.get("name") or ticker),
                sector=sector_name,
                industry=row.get("industry"),
                x=float(x_value),
                y=float(y_value),
                size=float(size_value),
                price=_to_float(row.get("price")),
                change_pct=_to_float(row.get("change_pct")),
                color=INDUSTRY_BUBBLE_COLORS[index % len(INDUSTRY_BUBBLE_COLORS)],
                is_reference=ticker == reference_symbol,
            )
        )

    if not points:
        raise HTTPException(
            status_code=404, detail="No comparable sector data available for bubble chart"
        )

    points.sort(key=lambda item: item.size, reverse=True)
    selected = points[:top_n]
    if not any(item.is_reference for item in selected):
        reference_point = next((item for item in points if item.is_reference), None)
        if reference_point is not None:
            selected = selected[:-1] + [reference_point]
            selected.sort(key=lambda item: item.size, reverse=True)

    x_values = [point.x for point in selected]
    y_values = [point.y for point in selected]
    sector_average = IndustryBubbleSectorAverage(
        x=sum(x_values) / len(x_values) if x_values else None,
        y=sum(y_values) / len(y_values) if y_values else None,
    )

    updated_at = _latest_timestamp([row.get("updated_at") for row in sector_rows])
    return IndustryBubbleResponse(
        sector=sector_name,
        reference_symbol=reference_symbol,
        x_metric=x_metric,
        y_metric=y_metric,
        size_metric=size_metric,
        top_n=top_n,
        sector_average=sector_average,
        data=selected,
        updated_at=updated_at,
    )


@router.get("/sector-board", response_model=SectorBoardResponse)
@cached(ttl=180, key_prefix="sector_board")
async def get_sector_board(
    limit_per_sector: int = Query(default=15, ge=5, le=30),
    sectors: Optional[str] = Query(default=None),
    sort_by: str = Query(default="volume", pattern=r"^(volume|market_cap|change_pct)$"),
    db: AsyncSession = Depends(get_db),
) -> SectorBoardResponse:
    screener_rows: List[dict[str, Any]] = []
    cache_manager = CacheManager()

    try:
        cache_result = await cache_manager.get_screener_data(
            symbol=None,
            source=settings.vnstock_source,
            allow_stale=True,
        )
        if cache_result.data:
            screener_rows = [_normalize_screener_row(item) for item in cache_result.data]
    except Exception as exc:
        logger.warning("Sector board cache lookup failed: %s", exc)

    try:
        db_rows = await _load_latest_screener_rows_from_db(limit=500)
        if db_rows:
            merged_rows = {row["symbol"]: row for row in db_rows if row.get("symbol")}
            for row in screener_rows:
                ticker = row.get("symbol")
                if not ticker:
                    continue
                merged_rows[ticker] = {**merged_rows.get(ticker, {}), **row}
            screener_rows = list(merged_rows.values())
    except Exception as exc:
        logger.warning("Sector board DB screener fallback failed: %s", exc)

    screener_rows = [row for row in screener_rows if row.get("symbol")]
    symbols = [row["symbol"] for row in screener_rows]
    metadata_map = await _load_stock_metadata(symbols)
    change_map = await _load_change_pct_map(symbols)

    allowed_sector_filters = {
        _normalize_lookup_text(item) for item in (sectors or "").split(",") if str(item).strip()
    }

    grouped: Dict[str, List[dict[str, Any]]] = defaultdict(list)
    for row in screener_rows:
        ticker = row["symbol"]
        metadata = metadata_map.get(ticker) or {}
        if not row.get("exchange") and metadata.get("exchange"):
            row["exchange"] = metadata.get("exchange")
        if not row.get("industry") and metadata.get("industry"):
            row["industry"] = metadata.get("industry")
        if not row.get("sector") and metadata.get("sector"):
            row["sector"] = metadata.get("sector")
        if row.get("change_pct") is None and ticker in change_map:
            row["change_pct"] = change_map[ticker]

        sector_name = _resolve_sector_name(ticker, row.get("industry"), row.get("sector"))
        if (
            allowed_sector_filters
            and _normalize_lookup_text(sector_name) not in allowed_sector_filters
        ):
            continue
        grouped[sector_name].append(row)

    def _sort_metric(row: dict[str, Any]) -> float:
        value = _to_float(row.get(sort_by))
        return value if value is not None else float("-inf")

    sector_payloads: List[SectorBoardSector] = []
    for sector_name, rows in grouped.items():
        rows.sort(key=_sort_metric, reverse=True)
        selected_rows = rows[:limit_per_sector]
        weighted_total = sum((_to_float(row.get("market_cap")) or 0.0) for row in selected_rows)
        if weighted_total > 0:
            change_pct = (
                sum(
                    (_to_float(row.get("change_pct")) or 0.0)
                    * (_to_float(row.get("market_cap")) or 0.0)
                    for row in selected_rows
                )
                / weighted_total
            )
        else:
            valid_changes = [(_to_float(row.get("change_pct")) or 0.0) for row in selected_rows]
            change_pct = sum(valid_changes) / len(valid_changes) if valid_changes else 0.0

        stocks = [
            SectorBoardStock(
                symbol=row["symbol"],
                price=_to_float(row.get("price")),
                change_pct=_to_float(row.get("change_pct")),
                volume=_to_float(row.get("volume")),
                market_cap=_to_float(row.get("market_cap")),
                color=_resolve_board_color(_to_float(row.get("change_pct"))),
            )
            for row in selected_rows
        ]
        sector_payloads.append(
            SectorBoardSector(name=sector_name, change_pct=change_pct, stocks=stocks)
        )

    sector_payloads.sort(
        key=lambda item: sum((stock.market_cap or 0.0) for stock in item.stocks),
        reverse=True,
    )

    market_summary_rows = await _load_latest_market_indices_from_db(db)
    market_summary = {
        str(row.get("index_name") or ""): {
            "value": _to_float(row.get("current_value")),
            "change_pct": _to_float(row.get("change_pct")),
            "time": row.get("time").isoformat()
            if hasattr(row.get("time"), "isoformat")
            else row.get("time"),
        }
        for row in market_summary_rows
    }

    updated_at = _latest_timestamp([row.get("updated_at") for row in screener_rows])
    return SectorBoardResponse(
        market_summary=market_summary,
        sectors=sector_payloads,
        sort_by=sort_by,
        limit_per_sector=limit_per_sector,
        updated_at=updated_at,
    )


@router.get("/top-movers", response_model=MarketTopMoversResponse)
@cached(ttl=120, key_prefix="market_top_movers")
async def get_market_top_movers(
    type: str = Query(default="gainer", pattern=r"^(gainer|loser|volume|value|gainers|losers)$"),
    mode: Optional[str] = Query(
        default=None,
        pattern=r"^(gainer|loser|volume|value|gainers|losers)$",
    ),
    index: str = Query(default="VNINDEX", pattern=r"^(VNINDEX|HNX|VN30)$"),
    limit: int = Query(default=10, ge=1, le=50),
) -> MarketTopMoversResponse:
    mover_type = _normalize_mover_type(mode or type)

    try:
        movers = await asyncio.wait_for(
            VnstockTopMoversFetcher.fetch(type=mover_type, index=index, limit=limit),
            timeout=30,
        )
        payload = [
            item.model_dump(mode="json", by_alias=False) if hasattr(item, "model_dump") else item
            for item in movers
        ]

        if payload:
            symbols = [
                str(item.get("symbol", "")).upper() for item in payload if item.get("symbol")
            ]
            change_map = await _load_change_pct_map(symbols)
            for item in payload:
                symbol = str(item.get("symbol", "")).upper()
                fallback_change_pct = change_map.get(symbol)
                current_change_pct = _to_float(item.get("price_change_pct"))

                if (current_change_pct is None or abs(current_change_pct) < 1e-9) and (
                    fallback_change_pct is not None
                ):
                    item["price_change_pct"] = fallback_change_pct
                    current_change_pct = fallback_change_pct

                if current_change_pct is None or abs(current_change_pct) < 1e-9:
                    price_change = _to_float(item.get("price_change"))
                    last_price = _to_float(item.get("last_price"))
                    if price_change not in (None, 0) and last_price not in (None, 0):
                        previous_price = last_price - price_change
                        if previous_price not in (None, 0):
                            item["price_change_pct"] = (price_change / previous_price) * 100.0

            snapshot_metrics = await _load_latest_snapshot_metrics(symbols)
            payload = _apply_snapshot_metrics_to_movers(payload, snapshot_metrics)
            payload = _sort_top_movers(payload, mover_type=mover_type, limit=limit)

        if not payload and mover_type in {"gainer", "loser"}:
            # Graceful fallback: volume movers are generally the most stable upstream feed.
            fallback = await asyncio.wait_for(
                VnstockTopMoversFetcher.fetch(type="volume", index=index, limit=limit),
                timeout=30,
            )
            payload = [
                item.model_dump(mode="json", by_alias=False)
                if hasattr(item, "model_dump")
                else item
                for item in fallback
            ]

            fallback_symbols = [
                str(item.get("symbol", "")).upper() for item in payload if item.get("symbol")
            ]
            fallback_metrics = await _load_latest_snapshot_metrics(fallback_symbols)
            payload = _apply_snapshot_metrics_to_movers(payload, fallback_metrics)
            payload = _sort_top_movers(payload, mover_type=mover_type, limit=limit)

            if not payload or not _has_non_zero_top_mover_signal(payload):
                payload = await _build_snapshot_top_movers(
                    index=index, mover_type=mover_type, limit=limit
                )

            if payload:
                return MarketTopMoversResponse(
                    type=mover_type,
                    index=index,
                    count=len(payload),
                    data=payload,
                    updated_at=_latest_timestamp(
                        [
                            _first_non_none(item.get("updated_at"), item.get("time"))
                            for item in payload
                        ]
                    ),
                    error=(
                        f"Requested '{mover_type}' movers unavailable, returned snapshot-derived "
                        "fallback"
                    ),
                )

        return MarketTopMoversResponse(
            type=mover_type,
            index=index,
            count=len(payload),
            data=payload,
            updated_at=_latest_timestamp(
                [_first_non_none(item.get("updated_at"), item.get("time")) for item in payload]
            ),
        )
    except Exception as e:
        logger.warning(f"Market top movers fetch failed: {e}")
        return MarketTopMoversResponse(type=mover_type, index=index, count=0, data=[], error=str(e))


@router.get("/sector-performance", response_model=MarketSectorPerformanceResponse)
async def get_market_sector_performance(
    include_empty: bool = Query(default=False),
) -> MarketSectorPerformanceResponse:
    cache_manager = CacheManager()

    async def _build_sector_payload(rows: List[dict[str, Any]]) -> MarketSectorPerformanceResponse:
        sectors = await SectorService.calculate_sector_performance(rows)
        if not include_empty:
            sectors = [sector for sector in sectors if sector.total_stocks > 0]
        payload = [item.model_dump(mode="json", by_alias=True) for item in sectors]
        return MarketSectorPerformanceResponse(count=len(payload), data=payload)

    async def _load_cached_sector_rows() -> List[dict[str, Any]]:
        cache_result = await cache_manager.get_screener_data(
            symbol=None,
            source=settings.vnstock_source,
            allow_stale=True,
        )
        if not cache_result.data:
            return []

        rows: List[dict[str, Any]] = []
        for item in cache_result.data:
            symbol = _normalize_symbol(getattr(item, "symbol", None))
            if not symbol:
                continue

            extended_metrics = (
                getattr(item, "extended_metrics", None)
                if isinstance(getattr(item, "extended_metrics", None), dict)
                else {}
            )

            rows.append(
                {
                    "symbol": symbol,
                    "price": _to_float(getattr(item, "price", None)),
                    "change_pct": _extract_snapshot_change_pct(extended_metrics),
                    "industry_name": _normalize_text(
                        _first_non_none(
                            getattr(item, "industry", None),
                            getattr(item, "industry_name", None),
                            extended_metrics.get("industry_name"),
                            extended_metrics.get("industryName"),
                        )
                    ),
                    "sector": _normalize_text(
                        _first_non_none(
                            extended_metrics.get("sector"),
                            extended_metrics.get("sector_name"),
                            extended_metrics.get("sectorName"),
                        )
                    ),
                }
            )

        if not rows:
            return []

        symbols = [row["symbol"] for row in rows]
        metadata_map = await _load_stock_metadata(symbols)
        for row in rows:
            metadata = metadata_map.get(row["symbol"]) or {}
            if not row.get("industry_name") and metadata.get("industry"):
                row["industry_name"] = metadata.get("industry")
            if not row.get("sector") and metadata.get("sector"):
                row["sector"] = metadata.get("sector")

        missing_change_symbols = [row["symbol"] for row in rows if row.get("change_pct") is None]
        if missing_change_symbols:
            symbol_change_map = await _load_change_pct_map(missing_change_symbols)
            for row in rows:
                if row.get("change_pct") is None:
                    row["change_pct"] = symbol_change_map.get(row["symbol"])

        return rows

    try:
        cached_rows = await _load_cached_sector_rows()
        if cached_rows:
            return await _build_sector_payload(cached_rows)

        params = StockScreenerParams(
            symbol=None,
            exchange="ALL",
            limit=1200,
            source=settings.vnstock_source,
        )
        screener_data = await asyncio.wait_for(VnstockScreenerFetcher.fetch(params), timeout=20)
        rows = [
            item.model_dump(mode="json", by_alias=True) if hasattr(item, "model_dump") else item
            for item in screener_data
        ]
        return await _build_sector_payload(rows)
    except asyncio.TimeoutError:
        logger.warning("Market sector performance live fetch timed out")
        try:
            cached_rows = await _load_cached_sector_rows()
            if cached_rows:
                return await _build_sector_payload(cached_rows)
        except Exception as cache_error:
            logger.warning("Sector performance cache fallback failed: %s", cache_error)
        return MarketSectorPerformanceResponse(count=0, data=[], error="Live fetch timeout")
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
