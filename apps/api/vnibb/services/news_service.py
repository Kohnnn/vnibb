import logging
import re
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select

from vnibb.core.database import async_session_maker
from vnibb.models.stock import Stock
from vnibb.providers.vnstock.company_news import CompanyNewsQueryParams, VnstockCompanyNewsFetcher
from vnibb.services.news_crawler import news_crawler

logger = logging.getLogger(__name__)


class NewsSentiment(str, Enum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"
    BULLISH = "bullish"
    BEARISH = "bearish"


class NewsItem(BaseModel):
    id: str
    title: str
    summary: str | None = None
    source: str
    published_at: datetime
    url: str
    symbols: list[str] = []
    sector: str | None = None
    sentiment: str = "neutral"
    sentiment_score: float | None = None
    ai_summary: str | None = None
    relevance_score: float | None = None
    matched_symbols: list[str] = []
    match_reason: str | None = None
    is_market_wide_fallback: bool = False


class NewsResponse(BaseModel):
    items: list[NewsItem]
    total: int
    has_more: bool
    mode: str = "all"
    fallback_used: bool = False


GENERIC_KEYWORDS = {
    "cp",
    "ctcp",
    "jsc",
    "joint",
    "stock",
    "company",
    "holding",
    "group",
    "co",
    "ltd",
    "limited",
    "securities",
    "bank",
    "commercial",
    "investment",
    "corporation",
    "ngan",
    "hang",
    "cong",
    "ty",
    "tap",
    "doan",
    "thuong",
    "mai",
    "dich",
    "vu",
}


def _parse_symbols(raw_symbols: Any) -> list[str]:
    if isinstance(raw_symbols, list):
        return [str(symbol).strip().upper() for symbol in raw_symbols if str(symbol).strip()]

    if isinstance(raw_symbols, str):
        return [symbol.strip().upper() for symbol in raw_symbols.split(",") if symbol.strip()]

    return []


def _normalize_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    return re.sub(r"\s+", " ", text)


def _extract_keywords(*values: Any) -> list[str]:
    keywords: list[str] = []
    seen: set[str] = set()

    for value in values:
        normalized = _normalize_text(value)
        if not normalized:
            continue

        if normalized not in seen and len(normalized) >= 4:
            seen.add(normalized)
            keywords.append(normalized)

        for token in re.split(r"[^a-z0-9]+", normalized):
            if len(token) < 4 or token in GENERIC_KEYWORDS or token.isdigit():
                continue
            if token in seen:
                continue
            seen.add(token)
            keywords.append(token)

    return keywords


def _parse_published_at(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value

    if isinstance(value, str) and value.strip():
        normalized = value.strip().replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            pass

    return datetime.now()


def _to_news_item(row: dict[str, Any]) -> NewsItem:
    return NewsItem(
        id=str(row.get("id", "")),
        title=row.get("title", ""),
        summary=row.get("summary", ""),
        source=row.get("source", "unknown"),
        published_at=_parse_published_at(row.get("published_date") or row.get("published_at")),
        url=row.get("url", ""),
        symbols=_parse_symbols(row.get("related_symbols")),
        sentiment=row.get("sentiment", "neutral"),
        sentiment_score=row.get("sentiment_score"),
        ai_summary=row.get("ai_summary"),
        sector=row.get("sector"),
        relevance_score=row.get("relevance_score"),
        matched_symbols=_parse_symbols(row.get("matched_symbols")),
        match_reason=row.get("match_reason"),
        is_market_wide_fallback=bool(row.get("is_market_wide_fallback", False)),
    )


async def _load_symbol_context(symbol: str) -> dict[str, Any]:
    upper_symbol = symbol.upper().strip()
    if not upper_symbol:
        return {
            "symbol": None,
            "peer_symbols": [],
            "sector_keywords": [],
            "company_keywords": [],
        }

    async with async_session_maker() as session:
        stock = await session.scalar(select(Stock).where(Stock.symbol == upper_symbol))

        if stock is None:
            return {
                "symbol": upper_symbol,
                "peer_symbols": [],
                "sector_keywords": [],
                "company_keywords": [],
            }

        peer_query = select(Stock.symbol).where(Stock.symbol != upper_symbol)
        if stock.industry:
            peer_query = peer_query.where(Stock.industry == stock.industry)
        elif stock.sector:
            peer_query = peer_query.where(Stock.sector == stock.sector)
        else:
            peer_query = peer_query.where(Stock.exchange == stock.exchange)

        peer_query = peer_query.order_by(Stock.symbol.asc()).limit(6)
        peer_rows = await session.execute(peer_query)
        peer_symbols = [
            str(item).upper() for item in peer_rows.scalars().all() if str(item).strip()
        ]

        return {
            "symbol": upper_symbol,
            "peer_symbols": peer_symbols,
            "sector_keywords": _extract_keywords(stock.sector, stock.industry),
            "company_keywords": _extract_keywords(stock.short_name, stock.company_name),
        }


def _contains_symbol(text: str, symbol: str) -> bool:
    return bool(re.search(rf"(?<![A-Z0-9]){re.escape(symbol.lower())}(?![A-Z0-9])", text))


def _score_news_row(row: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    symbol = context.get("symbol")
    title = _normalize_text(row.get("title"))
    body = _normalize_text(
        " ".join(filter(None, [row.get("summary"), row.get("content"), row.get("category")]))
    )
    related_symbols = _parse_symbols(row.get("related_symbols"))
    related_set = {item.upper() for item in related_symbols}
    matched_symbols: list[str] = []
    score = 0.0
    reason = None

    if symbol:
        if _contains_symbol(title, symbol):
            score = 1.0
            reason = "exact_symbol_title"
            matched_symbols.append(symbol)
        elif symbol in related_set:
            score = 0.97
            reason = "exact_symbol_related"
            matched_symbols.append(symbol)
        elif _contains_symbol(body, symbol):
            score = 0.94
            reason = "exact_symbol_body"
            matched_symbols.append(symbol)

    if score < 0.9:
        for keyword in context.get("company_keywords", []):
            if keyword and (keyword in title or keyword in body):
                score = max(score, 0.84)
                reason = reason or "company_keyword"
                if symbol and symbol not in matched_symbols:
                    matched_symbols.append(symbol)
                break

    peer_hits = 0
    for peer_symbol in context.get("peer_symbols", []):
        if (
            peer_symbol in related_set
            or _contains_symbol(title, peer_symbol)
            or _contains_symbol(body, peer_symbol)
        ):
            peer_hits += 1
            if peer_symbol not in matched_symbols:
                matched_symbols.append(peer_symbol)
    if peer_hits:
        score = max(score, min(0.78, 0.62 + (peer_hits * 0.06)))
        reason = reason or "peer_mentions"

    sector_hits = 0
    for keyword in context.get("sector_keywords", []):
        if keyword and (keyword in title or keyword in body):
            sector_hits += 1
    if sector_hits:
        score = max(score, min(0.58, 0.42 + (sector_hits * 0.06)))
        reason = reason or "sector_keyword"

    enriched = dict(row)
    enriched["relevance_score"] = round(score, 3) if score > 0 else 0.0
    enriched["matched_symbols"] = matched_symbols
    enriched["match_reason"] = reason
    return enriched


async def _hydrate_company_news_fallback(symbol: str | None, limit: int) -> list[dict[str, Any]]:
    fallback_symbols = [symbol.upper()] if symbol else ["VNM", "FPT", "VCB", "HPG", "VIC"]
    hydrated: list[dict[str, Any]] = []
    used_urls: set[str] = set()

    for fallback_symbol in fallback_symbols:
        if len(hydrated) >= limit:
            break

        try:
            per_symbol_limit = limit if symbol else max(2, limit // len(fallback_symbols))
            company_news = await VnstockCompanyNewsFetcher.fetch(
                CompanyNewsQueryParams(symbol=fallback_symbol, limit=per_symbol_limit)
            )
        except Exception as error:
            logger.warning(
                "Company news fallback failed",
                extra={"symbol": fallback_symbol, "error": str(error)},
            )
            continue

        for idx, item in enumerate(company_news):
            if item.url in used_urls:
                continue

            used_urls.add(item.url)
            hydrated.append(
                {
                    "id": f"{fallback_symbol}-{idx}",
                    "title": item.title,
                    "summary": item.summary,
                    "source": item.source or "vnstock",
                    "published_date": item.published_at,
                    "url": item.url,
                    "related_symbols": [fallback_symbol],
                    "sentiment": "neutral",
                    "sentiment_score": None,
                    "ai_summary": None,
                    "relevance_score": 1.0 if symbol else 0.0,
                    "matched_symbols": [fallback_symbol],
                    "match_reason": "company_news_fallback" if symbol else None,
                    "is_market_wide_fallback": False,
                }
            )

            if len(hydrated) >= limit:
                break

    return hydrated


async def get_ranked_news_rows(
    *,
    source: str | None = None,
    sentiment: str | None = None,
    symbol: str | None = None,
    limit: int = 20,
    offset: int = 0,
    mode: str = "all",
) -> tuple[list[dict[str, Any]], bool]:
    upper_symbol = symbol.upper().strip() if symbol else None
    related_mode = upper_symbol is not None and mode == "related"

    try:
        if related_mode:
            candidate_limit = min(max(limit * 5, 40), 120)
            results = await news_crawler.get_latest_news(
                source=source,
                sentiment=sentiment,
                symbol=None,
                limit=candidate_limit,
                offset=0,
            )
            context = await _load_symbol_context(upper_symbol)
            scored_rows = [_score_news_row(row, context) for row in results]
            relevant_rows = [
                row for row in scored_rows if float(row.get("relevance_score") or 0) > 0
            ]
            relevant_rows.sort(
                key=lambda row: (
                    float(row.get("relevance_score") or 0),
                    _parse_published_at(row.get("published_date") or row.get("published_at")),
                ),
                reverse=True,
            )
            if relevant_rows:
                return relevant_rows[offset : offset + limit], False

            market_rows = await news_crawler.get_latest_news(
                source=source,
                sentiment=sentiment,
                symbol=None,
                limit=limit,
                offset=offset,
            )
            fallback_rows = []
            for row in market_rows:
                enriched = dict(row)
                enriched["relevance_score"] = 0.0
                enriched["matched_symbols"] = []
                enriched["match_reason"] = None
                enriched["is_market_wide_fallback"] = True
                fallback_rows.append(enriched)
            if fallback_rows:
                return fallback_rows, True
        else:
            results = await news_crawler.get_latest_news(
                source=source,
                sentiment=sentiment,
                symbol=upper_symbol if upper_symbol and mode != "all" else None,
                limit=limit,
                offset=offset,
            )
            return results, False
    except Exception as error:
        logger.warning(
            "Primary news query failed",
            extra={
                "symbol": upper_symbol,
                "sentiment": sentiment,
                "source": source,
                "error": str(error),
            },
        )

    fallback_rows = await _hydrate_company_news_fallback(symbol=upper_symbol, limit=limit)
    return fallback_rows[offset : offset + limit], False


async def get_news_flow(
    symbols: list[str] | None = None,
    sector: str | None = None,
    sentiment: str | None = None,
    limit: int = 20,
    offset: int = 0,
    mode: str = "related",
) -> NewsResponse:
    """
    Fetch aggregated news from database via news_crawler.
    """
    symbol = symbols[0].strip().upper() if symbols and symbols[0].strip() else None

    _ = sector
    results, fallback_used = await get_ranked_news_rows(
        symbol=symbol,
        sentiment=sentiment,
        limit=limit,
        offset=offset,
        mode=mode,
    )

    items = [_to_news_item(row) for row in results]

    return NewsResponse(
        items=items,
        total=len(items),
        has_more=len(items) == limit,
        mode=mode,
        fallback_used=fallback_used,
    )
