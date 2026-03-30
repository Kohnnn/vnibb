"""Search endpoints for command palette and ticker discovery."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import get_db
from vnibb.models.stock import Stock

router = APIRouter()


class SearchTickerResult(BaseModel):
    symbol: str
    name: str
    type: Literal["vn_stock", "crypto", "index", "us_stock"]
    exchange: str | None = None
    tv_symbol: str | None = None


class SearchTickersResponse(BaseModel):
    count: int
    results: list[SearchTickerResult]


GLOBAL_ASSET_RESULTS: list[SearchTickerResult] = [
    SearchTickerResult(
        symbol="BTC", name="Bitcoin", type="crypto", exchange="CRYPTO", tv_symbol="BINANCE:BTCUSDT"
    ),
    SearchTickerResult(
        symbol="ETH", name="Ethereum", type="crypto", exchange="CRYPTO", tv_symbol="BINANCE:ETHUSDT"
    ),
    SearchTickerResult(
        symbol="SOL", name="Solana", type="crypto", exchange="CRYPTO", tv_symbol="BINANCE:SOLUSDT"
    ),
    SearchTickerResult(
        symbol="SPX", name="S&P 500 Index", type="index", exchange="INDEX", tv_symbol="SP:SPX"
    ),
    SearchTickerResult(
        symbol="NASDAQ",
        name="Nasdaq Composite",
        type="index",
        exchange="INDEX",
        tv_symbol="NASDAQ:IXIC",
    ),
    SearchTickerResult(
        symbol="DXY", name="US Dollar Index", type="index", exchange="INDEX", tv_symbol="TVC:DXY"
    ),
    SearchTickerResult(
        symbol="AAPL",
        name="Apple Inc.",
        type="us_stock",
        exchange="NASDAQ",
        tv_symbol="NASDAQ:AAPL",
    ),
    SearchTickerResult(
        symbol="NVDA",
        name="NVIDIA Corp.",
        type="us_stock",
        exchange="NASDAQ",
        tv_symbol="NASDAQ:NVDA",
    ),
]


def _rank_text(query: str, *values: str) -> int:
    lowered_values = [value.lower() for value in values if value]
    if not query:
        return 100
    if any(value == query for value in lowered_values):
        return 0
    if any(value.startswith(query) for value in lowered_values):
        return 1
    if any(query in value for value in lowered_values):
        return 2
    return 99


@router.get("/tickers", response_model=SearchTickersResponse)
async def search_tickers(
    q: str = Query(default="", max_length=50, description="Ticker or company name query"),
    limit: int = Query(default=12, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
) -> SearchTickersResponse:
    query = q.strip().lower()

    stock_stmt = select(Stock).where(Stock.is_active == 1)
    if query:
        pattern = f"%{query}%"
        stock_stmt = stock_stmt.where(
            or_(
                Stock.symbol.ilike(pattern),
                Stock.company_name.ilike(pattern),
                Stock.short_name.ilike(pattern),
                Stock.industry.ilike(pattern),
            )
        )

    stock_stmt = stock_stmt.limit(limit * 3)
    stock_rows = (await db.execute(stock_stmt)).scalars().all()

    vn_results = [
        SearchTickerResult(
            symbol=row.symbol.upper(),
            name=row.company_name or row.short_name or row.symbol.upper(),
            type="vn_stock",
            exchange=row.exchange,
            tv_symbol=f"{row.exchange.upper()}:{row.symbol.upper()}"
            if row.exchange
            else row.symbol.upper(),
        )
        for row in stock_rows
        if row.symbol
    ]

    external_results = [
        item
        for item in GLOBAL_ASSET_RESULTS
        if not query or _rank_text(query, item.symbol, item.name) < 99
    ]

    combined = [*vn_results, *external_results]
    combined.sort(
        key=lambda item: (
            _rank_text(query, item.symbol, item.name),
            item.type != "vn_stock",
            item.symbol,
        )
    )

    unique_results: list[SearchTickerResult] = []
    seen_symbols: set[str] = set()
    for item in combined:
        key = f"{item.type}:{item.symbol}"
        if key in seen_symbols:
            continue
        seen_symbols.add(key)
        unique_results.append(item)
        if len(unique_results) >= limit:
            break

    return SearchTickersResponse(count=len(unique_results), results=unique_results)
