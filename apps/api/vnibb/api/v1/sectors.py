import logging
import re
import unicodedata
from collections import defaultdict
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Query, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.cache import cached
from vnibb.core.database import get_db
from vnibb.core.vn_sectors import get_all_sectors, get_sector_by_id
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock
from vnibb.providers.vnstock.top_movers import (
    SectorTopMoversData as ProviderSectorData,
)
from vnibb.providers.vnstock.top_movers import (
    VnstockTopMoversFetcher,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Sectors"])


INDUSTRY_TO_SECTOR_ID: dict[str, str] = {
    "ngan hang": "banking",
    "chung khoan": "securities",
    "bat dong san": "real_estate",
    "vat lieu xay dung": "construction_materials",
    "xay dung va vat lieu": "construction_materials",
    "ban le": "retail",
    "ban buon": "retail",
    "thuc pham do uong": "food",
    "san xuat thuc pham": "food",
    "bia va do uong": "food",
    "cong nghe va thong tin": "technology",
    "truyen thong": "technology",
    "vien thong co dinh": "technology",
    "vien thong di dong": "technology",
    "bao hiem": "insurance",
    "bao hiem phi nhan tho": "insurance",
    "sx nhua hoa chat": "chemicals_fertilizer",
    "hoa chat": "chemicals_fertilizer",
    "thiet bi dien": "power_energy",
    "san xuat phan phoi dien": "power_energy",
    "dien tu thiet bi dien": "power_energy",
    "sx thiet bi may moc": "power_energy",
    "tien ich": "power_energy",
    "van tai kho bai": "port_logistics",
    "van tai": "port_logistics",
    "che bien thuy san": "seafood",
    "xay dung": "public_investment",
    "tu van ho tro kinh doanh": "public_investment",
    "sx phu tro": "construction_materials",
    "khai khoang": "oil_gas",
    "thiet bi dich vu va phan phoi dau khi": "oil_gas",
    "dich vu luu tru an uong giai tri": "aviation_tourism",
    "du lich giai tri": "aviation_tourism",
    "sx hang gia dung": "textile",
    "hang ca nhan": "textile",
    "det may": "textile",
    "kim loai": "steel",
    "cong nghiep nang": "steel",
    "lam nghiep va giay": "sugar_wood_paper",
    "duong": "sugar_wood_paper",
    "go": "sugar_wood_paper",
    "o to va phu tung": "auto_parts",
    "duoc pham": "pharma_healthcare",
    "cham soc suc khoe": "pharma_healthcare",
    "thiet bi va dich vu y te": "pharma_healthcare",
    "tai chinh khac": "securities",
    "nuoc khi dot": "water_plastic",
}


def _normalize_text(value: str | None) -> str:
    return (value or "").strip().lower()


def _normalize_lookup_text(value: str | None) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    normalized = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def _map_industry_to_sector_id(value: str | None) -> str | None:
    normalized = _normalize_lookup_text(value)
    if not normalized:
        return None

    direct = INDUSTRY_TO_SECTOR_ID.get(normalized)
    if direct:
        return direct

    for industry_key, sector_id in INDUSTRY_TO_SECTOR_ID.items():
        if industry_key in normalized or normalized in industry_key:
            return sector_id

    return None


def _coerce_optional_float(value) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _build_sector_symbol_list(
    sector_id: str,
    sector_cfg,
    stock_rows: list[tuple[str, str | None, str | None]],
    market_cap_by_symbol: dict[str, float],
    symbol_limit: int,
) -> list[str]:
    manual_symbols = [str(symbol).strip().upper() for symbol in sector_cfg.symbols if symbol]
    manual_symbol_set = set(manual_symbols)

    if sector_id == "vn30":
        return manual_symbols[:symbol_limit]

    keyword_terms = [term.strip().lower() for term in sector_cfg.keywords if term]
    sector_name_terms = [
        _normalize_text(sector_cfg.name),
        _normalize_text(sector_cfg.name_en),
    ]

    dynamic_matches: list[str] = []
    seen_symbols: set[str] = set(manual_symbols)
    for symbol, industry, sector in stock_rows:
        symbol_upper = str(symbol or "").strip().upper()
        if not symbol_upper:
            continue

        if symbol_upper in manual_symbol_set:
            continue

        industry_text = _normalize_text(industry)
        sector_text = _normalize_text(sector)
        haystack = f"{industry_text} {sector_text}".strip()

        keyword_hit = any(term in haystack for term in keyword_terms) if keyword_terms else False
        sector_name_hit = any(term and term in sector_text for term in sector_name_terms)
        mapped_sector_hit = (
            _map_industry_to_sector_id(industry) == sector_id
            or _map_industry_to_sector_id(sector) == sector_id
        )

        if not keyword_hit and not sector_name_hit and not mapped_sector_hit:
            continue

        if symbol_upper in seen_symbols:
            continue

        dynamic_matches.append(symbol_upper)
        seen_symbols.add(symbol_upper)

    dynamic_matches.sort(
        key=lambda symbol: (market_cap_by_symbol.get(symbol, 0.0), symbol),
        reverse=True,
    )

    merged = manual_symbols + dynamic_matches
    return merged[:symbol_limit]


class SectorTopMoversResponse(BaseModel):
    count: int
    type: str
    sectors: list[ProviderSectorData]
    updated_at: str


@router.get("/top-movers", response_model=SectorTopMoversResponse)
@cached(ttl=120, key_prefix="sector_top_movers")
async def get_sector_top_movers(
    type: Literal["gainers", "losers"] = Query(default="gainers"),
    limit: int = Query(5, ge=1, le=10),
):
    """
    Get top gainers and losers grouped by sector/industry using vnstock.
    """
    try:
        data = await VnstockTopMoversFetcher.fetch_sector_top_movers(
            type=type,
            limit_per_sector=limit,
        )
    except Exception as error:
        logger.warning(
            "Sector top movers fetch failed",
            extra={"type": type, "limit": limit, "error": str(error)},
        )
        data = []

    return SectorTopMoversResponse(
        count=len(data),
        type=type,
        sectors=data,
        updated_at=datetime.now().isoformat(),
    )


@router.get("")
@cached(ttl=300, key_prefix="sector_catalog")
async def list_sectors(
    symbol_limit: int = Query(default=50, ge=5, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List all available sectors with dynamic symbol membership from DB metadata."""
    sectors = get_all_sectors()
    if not sectors:
        return {}

    latest_snapshot_date = (
        await db.execute(select(func.max(ScreenerSnapshot.snapshot_date)))
    ).scalar()

    stock_rows = (
        await db.execute(
            select(Stock.symbol, Stock.industry, Stock.sector).where(Stock.is_active == 1)
        )
    ).all()

    snapshot_industry_rows: list[tuple[str, str | None, str | None]] = []

    market_cap_by_symbol: dict[str, float] = {}
    if latest_snapshot_date is not None:
        snapshot_rows = (
            await db.execute(
                select(ScreenerSnapshot.symbol, ScreenerSnapshot.market_cap).where(
                    ScreenerSnapshot.snapshot_date == latest_snapshot_date,
                    ScreenerSnapshot.market_cap.is_not(None),
                )
            )
        ).all()
        for symbol, market_cap in snapshot_rows:
            market_cap_value = _coerce_optional_float(market_cap)
            if market_cap_value is not None:
                market_cap_by_symbol[str(symbol).strip().upper()] = market_cap_value

        snapshot_industry_rows = (
            await db.execute(
                select(ScreenerSnapshot.symbol, ScreenerSnapshot.industry).where(
                    ScreenerSnapshot.snapshot_date == latest_snapshot_date,
                    ScreenerSnapshot.industry.is_not(None),
                )
            )
        ).all()

    combined_rows = list(stock_rows)
    combined_rows.extend((symbol, industry, None) for symbol, industry in snapshot_industry_rows)

    payload: dict[str, dict] = {}
    for sector_id, sector_cfg in sectors.items():
        dynamic_symbols = _build_sector_symbol_list(
            sector_id=sector_id,
            sector_cfg=sector_cfg,
            stock_rows=combined_rows,
            market_cap_by_symbol=market_cap_by_symbol,
            symbol_limit=symbol_limit,
        )

        payload[sector_id] = {
            "name": sector_cfg.name,
            "name_en": sector_cfg.name_en,
            "icb_codes": sector_cfg.icb_codes,
            "keywords": sector_cfg.keywords,
            "symbols": dynamic_symbols,
        }

    return payload


@router.get("/{sector}/stocks")
@cached(ttl=300, key_prefix="sector_stocks")
async def get_sector_stocks(
    sector: str,
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    sector_cfg = get_sector_by_id(sector)
    if not sector_cfg:
        raise HTTPException(status_code=404, detail=f"Unknown sector: {sector}")

    latest_snapshot_date = (
        await db.execute(select(func.max(ScreenerSnapshot.snapshot_date)))
    ).scalar()
    if latest_snapshot_date is None:
        return {"sector": sector, "count": 0, "data": []}

    stmt = (
        select(
            Stock.symbol,
            Stock.company_name,
            Stock.exchange,
            Stock.industry,
            Stock.sector,
            ScreenerSnapshot.price,
            ScreenerSnapshot.market_cap,
            ScreenerSnapshot.pe,
            ScreenerSnapshot.pb,
            ScreenerSnapshot.roe,
            ScreenerSnapshot.revenue_growth,
        )
        .join(
            ScreenerSnapshot,
            (ScreenerSnapshot.symbol == Stock.symbol)
            & (ScreenerSnapshot.snapshot_date == latest_snapshot_date),
        )
        .order_by(desc(ScreenerSnapshot.market_cap))
        .limit(limit)
    )

    filters = []
    if sector_cfg.symbols:
        filters.append(Stock.symbol.in_(sector_cfg.symbols))

    for keyword in sector_cfg.keywords:
        keyword_term = str(keyword).strip()
        if not keyword_term:
            continue
        filters.append(Stock.industry.ilike(f"%{keyword_term}%"))
        filters.append(Stock.sector.ilike(f"%{keyword_term}%"))

    if not filters:
        filters.append(Stock.sector.ilike(f"%{sector_cfg.name}%"))
        filters.append(Stock.sector.ilike(f"%{sector_cfg.name_en}%"))

    stmt = stmt.where(or_(*filters))

    rows = (await db.execute(stmt)).all()

    symbols = [row.symbol for row in rows]
    change_pct_map: dict[str, float] = {}
    if symbols:
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
                ScreenerSnapshot.symbol.in_(symbols),
                ScreenerSnapshot.price.is_not(None),
            )
            .subquery()
        )
        snapshot_rows = (
            await db.execute(
                select(
                    ranked_snapshots.c.symbol,
                    ranked_snapshots.c.price,
                    ranked_snapshots.c.rn,
                ).where(ranked_snapshots.c.rn <= 2)
            )
        ).all()

        price_lookup: dict[str, dict[int, float]] = defaultdict(dict)
        for symbol_value, price, rank in snapshot_rows:
            numeric_price = _coerce_optional_float(price)
            if numeric_price is None:
                continue
            price_lookup[str(symbol_value).strip().upper()][int(rank)] = numeric_price

        for symbol_key, rank_map in price_lookup.items():
            latest_price = rank_map.get(1)
            previous_price = rank_map.get(2)
            if latest_price is None or previous_price in (None, 0):
                continue
            change_pct_map[symbol_key] = ((latest_price - previous_price) / previous_price) * 100.0

    data = [
        {
            "symbol": row.symbol,
            "name": row.company_name,
            "exchange": row.exchange,
            "industry": row.industry,
            "sector": row.sector,
            "price": row.price,
            "market_cap": row.market_cap,
            "pe": row.pe,
            "pb": row.pb,
            "roe": row.roe,
            "revenue_growth": row.revenue_growth,
            "change_pct": change_pct_map.get(str(row.symbol).strip().upper()),
        }
        for row in rows
    ]
    return {"sector": sector, "count": len(data), "data": data}
