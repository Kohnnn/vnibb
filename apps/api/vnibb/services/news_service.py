import logging
import re
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select

from vnibb.core.database import async_session_maker
from vnibb.models.stock import Stock
from vnibb.providers.vnstock.company_news import CompanyNewsQueryParams, VnstockCompanyNewsFetcher
from vnibb.services.news_crawler import news_crawler
from vnibb.services.sentiment_analyzer import sentiment_analyzer

logger = logging.getLogger(__name__)


class NewsSentiment(StrEnum):
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
            dmy = re.match(
                r"^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$",
                normalized,
            )
            if dmy:
                year = int(dmy.group(3))
                if year < 100:
                    year += 2000
                return datetime(
                    year,
                    int(dmy.group(2)),
                    int(dmy.group(1)),
                    int(dmy.group(4) or 0),
                    int(dmy.group(5) or 0),
                    int(dmy.group(6) or 0),
                )

            lower = normalized.lower()
            relative_match = re.match(
                r"^(\d+)\s*(phut|phút|min|minute|minutes|gio|giờ|hour|hours|ngay|ngày|day|days)\s*(truoc|trước|ago)$",
                lower,
            )
            if relative_match:
                amount = int(relative_match.group(1))
                unit = relative_match.group(2)
                now = datetime.now()
                if unit in {"phut", "phút", "min", "minute", "minutes"}:
                    return now - timedelta(minutes=amount)
                if unit in {"gio", "giờ", "hour", "hours"}:
                    return now - timedelta(hours=amount)
                if unit in {"ngay", "ngày", "day", "days"}:
                    return now - timedelta(days=amount)

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


def _needs_runtime_sentiment(row: dict[str, Any]) -> bool:
    sentiment = str(row.get("sentiment") or "").strip().lower()
    score = row.get("sentiment_score")
    try:
        numeric_score = float(score) if score is not None else None
    except (TypeError, ValueError):
        numeric_score = None

    if sentiment in {"bullish", "bearish", "positive", "negative"}:
        return numeric_score in (None, 0.0)

    return sentiment not in {"neutral"} or numeric_score in (None, 0.0)


async def _enrich_sentiment_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized_rows = [dict(row) for row in rows]
    pending_indexes: list[int] = []
    pending_articles: list[dict[str, Any]] = []

    for index, row in enumerate(normalized_rows):
        if not _needs_runtime_sentiment(row):
            continue

        pending_indexes.append(index)
        pending_articles.append(
            {
                "title": row.get("title", ""),
                "content": row.get("content"),
                "summary": row.get("summary"),
            }
        )

    if not pending_articles:
        return normalized_rows

    sentiments = await sentiment_analyzer.analyze_batch(pending_articles, max_concurrent=6)

    for index, sentiment in zip(pending_indexes, sentiments, strict=False):
        row = normalized_rows[index]
        row["sentiment"] = sentiment.get("sentiment", row.get("sentiment") or "neutral")
        row["sentiment_score"] = sentiment.get("confidence", row.get("sentiment_score"))

        if sentiment.get("ai_summary") and not row.get("ai_summary"):
            row["ai_summary"] = sentiment["ai_summary"]

        existing_symbols = _parse_symbols(row.get("related_symbols"))
        inferred_symbols = _parse_symbols(sentiment.get("symbols"))
        if inferred_symbols:
            row["related_symbols"] = list(dict.fromkeys([*existing_symbols, *inferred_symbols]))[
                :10
            ]

        if sentiment.get("sectors") and not row.get("sectors"):
            row["sectors"] = sentiment.get("sectors", [])

    return normalized_rows


def _serialize_company_news_item(item: Any, symbol: str, index: int) -> dict[str, Any]:
    return {
        "id": f"{symbol}-{index}",
        "symbol": symbol,
        "title": getattr(item, "title", "") or "Untitled",
        "summary": getattr(item, "summary", None),
        "content": getattr(item, "summary", None),
        "source": getattr(item, "source", None) or "vnstock",
        "published_at": getattr(item, "published_at", None),
        "published_date": getattr(item, "published_at", None),
        "url": getattr(item, "url", None),
        "category": getattr(item, "category", None),
        "related_symbols": [],
        "matched_symbols": [],
        "relevance_score": 0.0,
        "match_reason": None,
        "is_market_wide_fallback": False,
    }


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


async def get_company_news_rows(symbol: str, limit: int = 20) -> list[dict[str, Any]]:
    upper_symbol = symbol.upper().strip()
    if not upper_symbol:
        return []

    try:
        provider_items = await VnstockCompanyNewsFetcher.fetch(
            CompanyNewsQueryParams(symbol=upper_symbol, limit=max(limit * 2, 12))
        )
    except Exception as error:
        logger.warning(
            "Company news provider failed",
            extra={"symbol": upper_symbol, "error": str(error)},
        )
        provider_items = []

    context = await _load_symbol_context(upper_symbol)
    provider_rows = [
        _score_news_row(_serialize_company_news_item(item, upper_symbol, index), context)
        for index, item in enumerate(provider_items)
    ]
    provider_rows.sort(
        key=lambda row: (
            float(row.get("relevance_score") or 0),
            _parse_published_at(row.get("published_date") or row.get("published_at")),
        ),
        reverse=True,
    )

    relevant_provider_rows = [
        row for row in provider_rows if float(row.get("relevance_score") or 0) >= 0.65
    ]

    ranked_rows, _ = await get_ranked_news_rows(
        symbol=upper_symbol,
        limit=max(limit * 2, 12),
        offset=0,
        mode="related",
    )
    ranked_rows = [
        {**row, "symbol": upper_symbol}
        for row in ranked_rows
        if not row.get("is_market_wide_fallback")
    ]

    merged_rows: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    def append_rows(rows: list[dict[str, Any]]) -> None:
        for row in rows:
            key = str(row.get("url") or row.get("title") or row.get("id") or "").strip().lower()
            if not key or key in seen_keys:
                continue
            seen_keys.add(key)
            merged_rows.append({**row, "symbol": upper_symbol})
            if len(merged_rows) >= limit:
                break

    append_rows(relevant_provider_rows)
    if len(merged_rows) < limit:
        append_rows(ranked_rows)
    if len(merged_rows) == 0:
        append_rows(await _hydrate_company_news_fallback(symbol=upper_symbol, limit=limit))

    merged_rows.sort(
        key=lambda row: (
            float(row.get("relevance_score") or 0),
            _parse_published_at(row.get("published_date") or row.get("published_at")),
        ),
        reverse=True,
    )

    return await _enrich_sentiment_rows(merged_rows[:limit])


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
            candidate_limit = min(max(limit * 6, 60), 180)
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
                enriched_rows = await _enrich_sentiment_rows(relevant_rows[offset : offset + limit])
                return enriched_rows, False

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
                enriched_fallback_rows = await _enrich_sentiment_rows(fallback_rows)
                return enriched_fallback_rows, True
        else:
            results = await news_crawler.get_latest_news(
                source=source,
                sentiment=sentiment,
                symbol=upper_symbol if upper_symbol and mode != "all" else None,
                limit=limit,
                offset=offset,
            )
            enriched_results = await _enrich_sentiment_rows(results)
            return enriched_results, False
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
    enriched_fallback_rows = await _enrich_sentiment_rows(fallback_rows[offset : offset + limit])
    return enriched_fallback_rows, False


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
