"""Reparse published_date for legacy market_news rows that have NULL.

The pre-PR-A news_crawler used only `pub_date` and `published_date` keys,
so every row crawled before that fix has `published_date=NULL` even when
the source DOM/RSS shipped a date under a different name. This script
re-derives the timestamp from the article URL slug, source, and any
embedded date hints in title/summary; rows that still can't be parsed are
left as-is (the FE handles NULL gracefully now).

Run inside the API container:
    docker exec vnibb-api python /tmp/reparse_news_dates.py
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import and_, select, update

from vnibb.core.database import async_session_maker
from vnibb.models.market_news import MarketNews

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("reparse_news_dates")


# Common Vietnamese-news URL patterns embed the publication date as
# /YYYY/MM/DD/, /YYYYMMDD/, /YYYY-MM-DD/, or /YYYY-MM-DD-slug.
URL_DATE_PATTERNS = [
    re.compile(r"/(\d{4})[/\-](\d{2})[/\-](\d{2})(?:[/\-]|\.)"),
    re.compile(r"/(\d{4})(\d{2})(\d{2})(?:[/\-]|\.)"),
    re.compile(r"-(\d{4})(\d{2})(\d{2})\."),
]

# Inline date in title/summary like "20/05/2026" or "Ngày 20/05/2026".
INLINE_DATE_PATTERNS = [
    re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})"),
    re.compile(r"(\d{4})-(\d{2})-(\d{2})"),
]


def _safe_date(year: int, month: int, day: int) -> Optional[datetime]:
    if not (1 <= month <= 12 and 1 <= day <= 31 and 2000 <= year <= 2030):
        return None
    try:
        return datetime(year, month, day, tzinfo=UTC)
    except ValueError:
        return None


def derive_timestamp(url: str | None, title: str | None, summary: str | None) -> Optional[datetime]:
    candidates: list[Optional[datetime]] = []

    if url:
        for pattern in URL_DATE_PATTERNS:
            m = pattern.search(url)
            if m:
                # YYYY/MM/DD pattern (1) or YYYYMMDD pattern (2/3)
                year, month, day = (int(m.group(1)), int(m.group(2)), int(m.group(3)))
                candidates.append(_safe_date(year, month, day))

    for text in (title or "", summary or ""):
        for pattern in INLINE_DATE_PATTERNS:
            m = pattern.search(text)
            if not m:
                continue
            try:
                a, b, c = int(m.group(1)), int(m.group(2)), int(m.group(3))
            except ValueError:
                continue
            if pattern.pattern.startswith(r"(\d{1,2})"):  # DD/MM/YYYY
                candidates.append(_safe_date(c, b, a))
            else:  # YYYY-MM-DD
                candidates.append(_safe_date(a, b, c))

    for candidate in candidates:
        if candidate is not None:
            return candidate
    return None


async def main() -> None:
    async with async_session_maker() as session:
        rows = (
            await session.execute(
                select(MarketNews.id, MarketNews.url, MarketNews.title, MarketNews.summary)
                .where(MarketNews.published_date.is_(None))
            )
        ).all()
        logger.info("found %d MarketNews rows with NULL published_date", len(rows))

        updated = 0
        skipped = 0
        for chunk_start in range(0, len(rows), 500):
            chunk = rows[chunk_start : chunk_start + 500]
            for row in chunk:
                derived = derive_timestamp(row.url, row.title, row.summary)
                if derived is None:
                    skipped += 1
                    continue
                await session.execute(
                    update(MarketNews)
                    .where(MarketNews.id == row.id)
                    .values(published_date=derived)
                )
                updated += 1
            await session.commit()
            logger.info("updated %d skipped %d / %d", updated, skipped, len(rows))

        logger.info("done: updated=%d skipped=%d total=%d", updated, skipped, len(rows))


if __name__ == "__main__":
    asyncio.run(main())
