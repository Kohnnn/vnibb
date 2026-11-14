import logging
import re
import unicodedata
from datetime import UTC, datetime, timedelta
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
    published_at: datetime | None = None
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
    # #250: class + evidence keep a direct mention distinguishable from an
    # indirect industry overlap on the wire.
    association_class: str | None = None
    match_evidence: dict[str, Any] = {}


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


# #250: a taxonomy value answers "which industry", never "what kind of legal
# entity" and never a placeholder. A legal form ("Công ty cổ phần") or a
# missing/unknown value used to reach `_extract_keywords` as a sector keyword
# and scored every article whose footer mentioned the same phrase.
LEGAL_FORM_TOKENS = {
    "cong",
    "ty",
    "co",
    "phan",
    "cp",
    "ctcp",
    "tnhh",
    "trach",
    "nhiem",
    "huu",
    "han",
    "hop",
    "danh",
    "doanh",
    "nghiep",
    "tu",
    "nhan",
    "joint",
    "stock",
    "company",
    "corporation",
    "limited",
    "liability",
    "llc",
    "jsc",
    "inc",
    "corp",
    "ltd",
}

PLACEHOLDER_TAXONOMY = {
    "unknown",
    "unclassified",
    "undefined",
    "none",
    "null",
    "na",
    "not available",
    "not applicable",
    "other",
    "khong xac dinh",
    "chua xac dinh",
    "khong ro",
}

GENERIC_TAXONOMY_TOKENS = LEGAL_FORM_TOKENS | PLACEHOLDER_TAXONOMY | {
    "sector",
    "nghe",
    "industry",
    "nganh",
    "linh",
    "vuc",
    "group",
    "holding",
}

# Leading text that marks a publisher/footer/navigation segment rather than
# article evidence (#250). "Nguồn" ("source/supply") and "Chia sẻ" ("share")
# open ordinary reporting sentences -- "Nguồn cung của HPG tăng", "Chia sẻ tại
# đại hội, HPG công bố" -- so they only count as metadata with a delimiter.
BOILERPLATE_SEGMENT_PATTERN = re.compile(
    r"^(?:nguon\s*[:\-–|]|source\s*[:\-–|]|nguon tin\s*[:\-–|]"
    r"|tin lien quan|bai viet lien quan|noi dung lien quan|tin cung chu de"
    r"|related (?:articles|news|stories)\s*[:\-–|]?"
    r"|doc them|doc tiep|xem them|see more|read more"
    r"|chia se bai viet|chia se\s*[:\-–|]|share this (?:article|story)"
    r"|ban quyen|copyright|all rights reserved"
    r"|tu khoa\s*[:\-–|]|tags\s*[:\-–|]"
    r"|subscribe|dang ky nhan tin|lien he\s*[:\-–|]"
    r"|quang cao|advertisement)"
)

# This set is the association classes a row may carry on the wire.
ASSOCIATION_CLASSES = frozenset(
    {"direct_company", "verified_peer", "verified_sector", "general_market"}
)

# Classes that prove an association with this issuer and may carry a rank.
# A verified sector hit shares an industry, so it is labelled but never scored.
RANKED_ASSOCIATIONS = frozenset({"direct_company", "verified_peer"})


def _taxonomy_tokens(value: Any) -> list[str]:
    folded = _fold_diacritics(_normalize_text(value))
    return [token for token in re.split(r"[^a-z0-9]+", folded) if token]


def _is_generic_taxonomy(value: Any) -> bool:
    """True when `value` cannot name an industry: legal form, placeholder, blank."""
    normalized = _fold_diacritics(_normalize_text(value))
    if not normalized:
        return True
    # "N/A", "n.a." and "không xác định" name nothing once punctuation is gone.
    compact = re.sub(r"[^a-z0-9]+", " ", normalized).strip()
    if compact in PLACEHOLDER_TAXONOMY or re.sub(r"[^a-z0-9]+", "", normalized) in {
        "na",
        "none",
        "null",
    }:
        return True
    tokens = _taxonomy_tokens(value)
    if not tokens:
        return True
    return all(token in GENERIC_TAXONOMY_TOKENS for token in tokens)


def _sanitize_sector_taxonomy(value: Any) -> str | None:
    """The sourced classification, or None when it only names a legal form."""
    if _is_generic_taxonomy(value):
        return None
    text = str(value).strip()
    return text or None


def _strip_boilerplate(text: str) -> str:
    """Drop publisher/footer/navigation segments before relevance matching."""
    if not text:
        return ""
    kept = [
        segment.strip()
        for segment in re.split(r"(?<=[.!?;])\s+|[\n\r]+", text)
        if segment.strip()
        and not BOILERPLATE_SEGMENT_PATTERN.match(
            _fold_diacritics(_normalize_text(segment))
        )
    ]
    return " ".join(kept)


def _parse_symbols(raw_symbols: Any) -> list[str]:
    if isinstance(raw_symbols, list):
        return [str(symbol).strip().upper() for symbol in raw_symbols if str(symbol).strip()]

    if isinstance(raw_symbols, str):
        return [symbol.strip().upper() for symbol in raw_symbols.split(",") if symbol.strip()]

    return []


def _normalize_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    return re.sub(r"\s+", " ", text)


def _fold_diacritics(token: str) -> str:
    """ASCII-fold a token so GENERIC_KEYWORDS matches Vietnamese text.

    The generic set is unaccented ("ngan", "hang", ...) while `_normalize_text`
    keeps diacritics, so the filter never matched a Vietnamese word and generic
    fragments like "hàng"/"ngân" became sector keywords (issue #107).
    """
    decomposed = unicodedata.normalize("NFD", token)
    return "".join(char for char in decomposed if not unicodedata.combining(char)).replace("đ", "d")


def _extract_keywords(*values: Any, whole_names: bool = False) -> list[str]:
    keywords: list[str] = []
    seen: set[str] = set()

    for value in values:
        if _is_generic_taxonomy(value):
            # A whole sector/company name that is only a legal form, a
            # placeholder or blank names no entity (#250).
            continue
        normalized = _normalize_text(value)
        if whole_names:
            normalized = re.sub(
                r"^(?:ctcp|công ty cổ phần|công ty cp|joint stock company)\s+", "", normalized
            )
        if not normalized:
            continue

        if normalized not in seen and len(normalized) >= 4:
            seen.add(normalized)
            keywords.append(normalized)
        if whole_names:
            continue

        for token in re.split(r"[^a-z0-9]+", normalized):
            if len(token) < 4 or token.isdigit() or _fold_diacritics(token) in GENERIC_KEYWORDS:
                continue
            if token in seen:
                continue
            seen.add(token)
            keywords.append(token)

    return keywords


def _parse_published_at(value: Any) -> datetime | None:
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
                try:
                    return datetime(
                        year,
                        int(dmy.group(2)),
                        int(dmy.group(1)),
                        int(dmy.group(4) or 0),
                        int(dmy.group(5) or 0),
                        int(dmy.group(6) or 0),
                    )
                except ValueError:
                    return None

            lower = normalized.lower()
            relative_match = re.match(
                r"^(\d+)\s*(phut|phút|min|minute|minutes|gio|giờ|hour|hours|ngay|ngày|day|days)\s*(truoc|trước|ago)$",
                lower,
            )
            if relative_match:
                try:
                    amount = int(relative_match.group(1))
                    unit = relative_match.group(2)
                    now = datetime.now()
                    if unit in {"phut", "phút", "min", "minute", "minutes"}:
                        return now - timedelta(minutes=amount)
                    if unit in {"gio", "giờ", "hour", "hours"}:
                        return now - timedelta(hours=amount)
                    if unit in {"ngay", "ngày", "day", "days"}:
                        return now - timedelta(days=amount)
                except (ValueError, OverflowError):
                    return None

    return None


def _publication_sort_key(row: dict[str, Any]) -> datetime:
    value = _parse_published_at(row.get("published_date") or row.get("published_at"))
    if value is None:
        return datetime.min.replace(tzinfo=UTC)
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


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
        association_class=row.get("association_class"),
        match_evidence=row.get("match_evidence") or {},
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
            # QA-v3 F11: Filter NLP-inferred symbols against the article
            # title only. Body-text inference produced spurious matches
            # (e.g. AGR/TIN/HCM tagged on Arsenal football articles because
            # the words appeared in unrelated context).
            # We additionally require either a high sentiment confidence OR
            # the ticker to be already in `existing_symbols` (i.e. confirmed
            # elsewhere) before we surface it. `sentiment_analyzer` reports
            # confidence on a 0-100 scale (clamped; neutral default 50), so the
            # gate is 70 — the previous `>= 0.7` compared a 0-100 score against
            # a fraction and never rejected anything.
            confidence = (
                sentiment.get("confidence")
                if isinstance(sentiment.get("confidence"), (int, float))
                else 0.0
            )
            title_text = str(row.get("title") or "").upper()
            high_confidence = float(confidence or 0.0) >= 70

            def _accept(sym: str) -> bool:
                if not sym:
                    return False
                upper = sym.upper()
                if upper in existing_symbols:
                    return True
                # Same word-boundary rule as `_contains_symbol`: a ticker inside a
                # longer word ("ANTWERP", "ANTạ") is not a mention (issue #107).
                return high_confidence and _contains_symbol(title_text, upper)

            filtered_symbols = [s for s in inferred_symbols if _accept(s)]
            if filtered_symbols:
                row["related_symbols"] = list(
                    dict.fromkeys([*existing_symbols, *filtered_symbols])
                )[:10]

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
                "classification_provenance": {},
            }

        # #250: the peer bucket and the sector vocabulary must both come from a
        # classification, never from a legal form or placeholder. When neither
        # survives there is no peer set at all -- an exchange is not an industry,
        # so same-exchange symbols are NOT verified peers.
        industry = _sanitize_sector_taxonomy(stock.industry)
        sector = _sanitize_sector_taxonomy(stock.sector)

        peer_symbols: list[str] = []
        peer_basis: str | None = None
        if industry or sector:
            peer_query = select(Stock.symbol).where(Stock.symbol != upper_symbol)
            if industry:
                peer_query = peer_query.where(Stock.industry == stock.industry)
                peer_basis = "industry"
            else:
                peer_query = peer_query.where(Stock.sector == stock.sector)
                peer_basis = "sector"
            peer_query = peer_query.order_by(Stock.symbol.asc()).limit(6)
            peer_rows = await session.execute(peer_query)
            peer_symbols = [
                str(item).upper() for item in peer_rows.scalars().all() if str(item).strip()
            ]

        return {
            "symbol": upper_symbol,
            "peer_symbols": peer_symbols,
            "peer_classification_basis": peer_basis,
            "sector_keywords": _extract_keywords(sector, industry),
            "company_keywords": _extract_keywords(
                stock.short_name, stock.company_name, whole_names=True
            ),
            "classification_provenance": {
                "sector": sector,
                "industry": industry,
                "sector_source": "stock.sector" if sector else None,
                "industry_source": "stock.industry" if industry else None,
                "rejected": [
                    name
                    for name, value in (("sector", stock.sector), ("industry", stock.industry))
                    if value and _is_generic_taxonomy(value)
                ],
            },
        }



def _contains_symbol(text: str, symbol: str) -> bool:
    return bool(re.search(rf"(?<!\w){re.escape(symbol)}(?!\w)", text, re.IGNORECASE))


def _score_news_row(row: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    symbol = context.get("symbol")
    title = _normalize_text(row.get("title"))
    # #250: publisher/footer/navigation text is not article evidence. Matching
    # it let a legal form or sector phrase in boilerplate admit any article.
    # Each field is stripped on its own: an unprefixed join would let an
    # unpunctuated "Nguồn: CafeF" summary swallow the real content field.
    body = _normalize_text(
        " ".join(
            filter(
                None,
                (
                    _strip_boilerplate(_normalize_text(row.get(field)))
                    for field in ("summary", "content", "category")
                ),
            )
        )
    )
    related_symbols = _parse_symbols(row.get("related_symbols"))
    related_set = {item.upper() for item in related_symbols}
    matched_symbols: list[str] = []
    score = 0.0
    reason = None

    # #250: evidence records what actually matched, in which field, so a
    # consumer can re-derive the claim instead of trusting a rule label.
    matched_terms: list[dict[str, str]] = []

    if symbol:
        if _contains_symbol(title, symbol):
            score = 1.0
            reason = "exact_symbol_title"
            matched_symbols.append(symbol)
            matched_terms.append({"term": symbol, "field": "title", "kind": "symbol"})
        elif symbol in related_set:
            score = 0.97
            reason = "exact_symbol_related"
            matched_symbols.append(symbol)
            matched_terms.append({"term": symbol, "field": "related_symbols", "kind": "symbol"})
        elif _contains_symbol(body, symbol):
            score = 0.94
            reason = "exact_symbol_body"
            matched_symbols.append(symbol)
            matched_terms.append({"term": symbol, "field": "body", "kind": "symbol"})

    if score < 0.9:
        for keyword in context.get("company_keywords", []):
            if not keyword:
                continue
            field = None
            if _contains_symbol(title, keyword):
                field = "title"
            elif _contains_symbol(body, keyword):
                field = "body"
            if field is None:
                continue
            score = max(score, 0.84)
            reason = reason or "company_keyword"
            if symbol and symbol not in matched_symbols:
                matched_symbols.append(symbol)
            matched_terms.append({"term": keyword, "field": field, "kind": "company_name"})
            break

    peer_hits = 0
    peer_evidence: list[str] = []
    for peer_symbol in context.get("peer_symbols", []):
        if peer_symbol in related_set:
            peer_evidence.append(peer_symbol)
            matched_terms.append(
                {"term": peer_symbol, "field": "related_symbols", "kind": "peer_symbol"}
            )
        elif _contains_symbol(title, peer_symbol):
            peer_evidence.append(peer_symbol)
            matched_terms.append({"term": peer_symbol, "field": "title", "kind": "peer_symbol"})
        elif _contains_symbol(body, peer_symbol):
            peer_evidence.append(peer_symbol)
            matched_terms.append({"term": peer_symbol, "field": "body", "kind": "peer_symbol"})
        else:
            continue
        peer_hits += 1
        if peer_symbol not in matched_symbols:
            matched_symbols.append(peer_symbol)
    if peer_hits:
        score = max(score, min(0.78, 0.62 + (peer_hits * 0.06)))
        reason = reason or "peer_mentions"

    sector_hits = 0
    sector_evidence: list[str] = []
    for keyword in context.get("sector_keywords", []):
        if _is_generic_taxonomy(keyword):
            # Defense in depth: a context built before #250 could still carry a
            # legal form or placeholder as a keyword.
            continue
        if not keyword:
            continue
        field = None
        if _contains_symbol(title, keyword):
            field = "title"
        elif _contains_symbol(body, keyword):
            field = "body"
        if field is None:
            continue
        sector_hits += 1
        sector_evidence.append(keyword)
        matched_terms.append({"term": keyword, "field": field, "kind": "sector_keyword"})
    if sector_hits:
        score = max(score, min(0.58, 0.42 + (sector_hits * 0.06)))
        reason = reason or "sector_keyword"

    # #250: the association class and its evidence travel with the row so a
    # consumer can tell a direct mention from an indirect industry overlap.
    if reason in {"exact_symbol_title", "exact_symbol_related", "exact_symbol_body", "company_keyword"}:
        association_class = "direct_company"
    elif reason == "peer_mentions":
        association_class = "verified_peer"
    elif reason == "sector_keyword":
        association_class = "verified_sector"
    else:
        association_class = "none"

    evidence: dict[str, Any] = {}
    if matched_terms:
        evidence["matched_terms"] = matched_terms
    if peer_evidence:
        evidence["peer_symbols"] = peer_evidence
    if sector_evidence:
        evidence["sector_keywords"] = sector_evidence
    provenance = context.get("classification_provenance") or {}
    # Peer verification rests on the same classification, so it is attached for
    # peer and sector matches alike -- not only when a sector keyword matched.
    if sector_evidence or peer_evidence:
        basis = {
            key: provenance.get(key)
            for key in ("sector", "industry", "sector_source", "industry_source")
            if provenance.get(key)
        }
        if peer_evidence and context.get("peer_classification_basis"):
            basis["peer_basis"] = context["peer_classification_basis"]
        if basis:
            evidence["classification"] = basis

    enriched = dict(row)
    # Only a direct or verified-peer association carries a ranking number. A
    # verified sector overlap keeps its class and evidence but no score; a row
    # with no association keeps the pre-existing 0.0 "no evidence" value.
    if association_class in RANKED_ASSOCIATIONS:
        enriched["relevance_score"] = round(score, 3)
    elif association_class == "verified_sector":
        enriched["relevance_score"] = None
    else:
        enriched["relevance_score"] = 0.0
    enriched["matched_symbols"] = matched_symbols
    enriched["match_reason"] = reason
    enriched["association_class"] = association_class
    enriched["match_evidence"] = evidence
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

        # #250: the requested symbol is association metadata, not article
        # evidence. Each provider row is scored like any other row; an article
        # that fails every check stays association-unverified with no rank
        # instead of being promoted to a direct-company claim.
        #
        # The context lookup is local to these rows: a DB outage must degrade
        # the scoring, not discard provider rows that are already in hand.
        context_available = True
        try:
            context = await _load_symbol_context(fallback_symbol)
        except Exception as error:
            logger.warning(
                "Company news fallback context unavailable",
                extra={"symbol": fallback_symbol, "error": str(error)},
            )
            context_available = False
            context = {
                "symbol": None,
                "peer_symbols": [],
                "sector_keywords": [],
                "company_keywords": [],
            }
        for idx, item in enumerate(company_news):
            if item.url in used_urls:
                continue

            used_urls.add(item.url)
            row = _score_news_row(
                {
                    "id": f"{fallback_symbol}-{idx}",
                    "title": item.title,
                    "summary": item.summary,
                    "content": item.summary,
                    "category": getattr(item, "category", None),
                    "source": item.source or "vnstock",
                    "published_date": item.published_at,
                    "url": item.url,
                    # The request symbol is not article evidence: passing it as
                    # relation data would let the fallback verify itself.
                    "related_symbols": [],
                    "sentiment": "neutral",
                    "sentiment_score": None,
                    "ai_summary": None,
                },
                {**context, "symbol": fallback_symbol if symbol else None},
            )
            if not context_available:
                row["match_evidence"] = {
                    **(row.get("match_evidence") or {}),
                    "context_available": False,
                }
            # The provider's own tag is kept for display, but only after
            # scoring, so it can never serve as its own evidence (#250).
            row["related_symbols"] = [fallback_symbol] if symbol else []
            if row["association_class"] == "none":
                row["relevance_score"] = 0.0
                row["matched_symbols"] = []
                row["match_reason"] = None
                row["is_market_wide_fallback"] = not symbol
                row["match_evidence"] = {
                    **(row.get("match_evidence") or {}),
                    "provider": "company_news",
                    "request_symbol": fallback_symbol,
                    "provider_validated_text": False,
                }
            elif not symbol:
                # A market-only listing cannot claim a company association.
                row["association_class"] = "general_market"
                row["relevance_score"] = 0.0
                row["is_market_wide_fallback"] = True
            hydrated.append(row)

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
            _publication_sort_key(row),
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
    # Company news is issuer news: a verified sector overlap belongs on the
    # related feed as an industry-only row, not in a company's own news list.
    ranked_rows = [
        {**row, "symbol": upper_symbol}
        for row in ranked_rows
        if row.get("association_class") in RANKED_ASSOCIATIONS
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
            _publication_sort_key(row),
        ),
        reverse=True,
    )

    # Drop articles older than 90 days when newer ones exist. This
    # prevents the company-news widget from surfacing year-old archive
    # rows alongside fresh stories purely because the older row had a
    # higher relevance score (QA-v2 F7).
    if merged_rows:
        cutoff = datetime.now(UTC) - timedelta(days=90)
        any_fresh = any(_publication_sort_key(row) >= cutoff for row in merged_rows)
        if any_fresh:
            merged_rows = [row for row in merged_rows if _publication_sort_key(row) >= cutoff]

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
            # #250: every proven association is admitted by class -- direct,
            # verified peer, and verified sector. A sector row keeps a null score
            # and an industry-only label, so the legitimate steel/sector case is
            # retained instead of being silently dropped. Rows with no
            # association (class "none") never enter the feed.
            relevant_rows = [
                row for row in scored_rows if row.get("association_class") in ASSOCIATION_CLASSES
            ]
            relevant_rows.sort(
                key=lambda row: (
                    float(row.get("relevance_score") or 0),
                    _publication_sort_key(row),
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
                enriched["association_class"] = "general_market"
                enriched["match_evidence"] = {}
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
