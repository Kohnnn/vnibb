from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from vnibb.services.news_crawler import (
    _coerce_published_date,
    _extract_vnexpress_published_date_from_html,
    _to_market_news_storage_datetime,
)
from vnibb.services.news_service import (
    NewsItem,
    _contains_symbol,
    _extract_keywords,
    _parse_published_at,
    _score_news_row,
    get_company_news_rows,
    get_news_flow,
)


@pytest.mark.parametrize("text", ["Opta Analyst", "Jonathan David", "plant", "antibiotics", "ANTWERP"])
def test_news_ticker_match_rejects_word_substrings(text):
    assert not _contains_symbol(text.lower(), "ANT")


def test_news_ticker_match_accepts_complete_tokens_only():
    assert _contains_symbol("Company ANT: report", "ANT")
    assert _contains_symbol("vnm, dpm and vib", "VNM")
    assert not _contains_symbol("VNM1 and VNM_extra", "VNM")


@pytest.mark.parametrize(
    "content",
    [
        "Tom Marieb told TechRadar that Apple uses Ceramic Shield 2 on iPhone.",
        "MDP joins VNBA to cooperate on FinTech and digital payments.",
        "Tech Awards lists Xiaomi, LG and Philips air purifiers.",
    ],
)
def test_msr_company_news_does_not_match_generic_name_fragments(content):
    context = {
        "symbol": "MSR",
        "company_keywords": _extract_keywords("CTCP Masan High-Tech Materials", whole_names=True),
        "peer_symbols": [],
        "sector_keywords": [],
    }
    row = _score_news_row({"title": "Source article", "content": content}, context)
    assert row["relevance_score"] == 0
    assert row["matched_symbols"] == []


def test_news_company_name_and_direct_body_mentions_remain_supported():
    context = {
        "symbol": "MSR",
        "company_keywords": _extract_keywords("CTCP Masan High-Tech Materials", whole_names=True),
    }
    assert context["company_keywords"] == ["masan high-tech materials"]
    named = _score_news_row({"title": "Masan High-Tech Materials announces a dividend"}, context)
    assert named["relevance_score"] == 0.84
    assert named["match_reason"] == "company_keyword"
    direct = _score_news_row({"title": "Dividend stocks", "content": "IJC, VNM, DPM and VIB yield 7%."}, {"symbol": "VNM"})
    assert direct["relevance_score"] == 0.94
    assert direct["matched_symbols"] == ["VNM"]


def test_sector_keywords_drop_generic_vietnamese_fragments():
    """GENERIC_KEYWORDS is unaccented, so the filter must fold Vietnamese text."""

    keywords = _extract_keywords("Ngân hàng", "Ngân hàng thương mại")

    # The sector phrase stays usable; only generic word fragments are dropped.
    assert "ngân hàng" in keywords
    assert "ngân hàng thương mại" in keywords
    assert "ngân" not in keywords
    assert "hàng" not in keywords
    assert "thương" not in keywords


def test_vnm_football_does_not_match_peer_name_substrings():
    row = _score_news_row(
        {"title": "Atletico vs Real", "content": "Opta Analyst shows Jonathan David's positions."},
        {"symbol": "VNM", "peer_symbols": ["ANT"], "company_keywords": ["vinamilk"]},
    )
    assert row["relevance_score"] == 0
    assert row["matched_symbols"] == []


def test_news_crawler_parses_vnexpress_vietnamese_gmt7_date():
    parsed = _coerce_published_date("Thứ 5, 28/05/2026 17:00:00 GMT+7")

    assert parsed is not None
    assert parsed.astimezone(UTC) == datetime(2026, 5, 28, 10, 0, tzinfo=UTC)


def test_news_crawler_extracts_vnexpress_article_meta_date():
    html = """
    <html>
      <head>
        <meta content="2026-05-22T17:24:00+07:00" itemprop="datePublished" name="pubdate"/>
      </head>
    </html>
    """

    parsed = _extract_vnexpress_published_date_from_html(html)

    assert parsed is not None
    assert parsed.astimezone(UTC) == datetime(2026, 5, 22, 10, 24, tzinfo=UTC)


def test_news_crawler_extracts_vnexpress_datalayer_date():
    html = "<script>dataLayer.push({'articlePublishDate':'20260522172400'});</script>"

    parsed = _extract_vnexpress_published_date_from_html(html)

    assert parsed is not None
    assert parsed.astimezone(UTC) == datetime(2026, 5, 22, 10, 24, tzinfo=UTC)


def test_news_crawler_converts_aware_dates_to_vietnam_naive_storage_time():
    parsed = _coerce_published_date("2026-05-22T10:24:00Z")

    stored = _to_market_news_storage_datetime(parsed)

    assert stored == datetime(2026, 5, 22, 17, 24)
    assert stored.tzinfo is None


@pytest.mark.parametrize("value", [None, "", "not a date", "31/02/2026", "999999999999999 days ago"])
def test_news_publication_parser_keeps_unknown_dates_null(value):
    assert _parse_published_at(value) is None


def test_news_item_defaults_to_unknown_publication():
    item = NewsItem(id="unknown", title="No source date", source="cafef", url="https://example.com")

    assert item.model_dump(mode="json")["published_at"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("publication", [None, "invalid", "recent", "2020-01-02T08:00:00Z"])
async def test_get_news_flow_preserves_source_publication_across_refetch(monkeypatch, publication):
    receipt = datetime.now(UTC)
    if publication == "recent":
        publication = receipt - timedelta(minutes=1)
    row = {
        "id": "source-date",
        "title": "Source publication contract",
        "source": "cafef",
        "url": "https://example.com/source-date",
        "published_date": publication,
        "created_at": receipt,
        "updated_at": receipt,
    }

    async def fake_latest_news(**_kwargs):
        return [dict(row)]

    async def preserve_rows(rows):
        return rows

    monkeypatch.setattr("vnibb.services.news_service.news_crawler.get_latest_news", fake_latest_news)
    monkeypatch.setattr("vnibb.services.news_service._enrich_sentiment_rows", preserve_rows)

    first = await get_news_flow(mode="all")
    row["created_at"] = receipt + timedelta(hours=1)
    row["updated_at"] = receipt + timedelta(hours=1)
    refetched = await get_news_flow(mode="all")

    expected = _parse_published_at(publication)
    assert first.items[0].published_at == expected
    assert refetched.items[0].published_at == expected
    if publication in (None, "invalid"):
        assert refetched.model_dump(mode="json")["items"][0]["published_at"] is None
    elif isinstance(publication, datetime):
        assert refetched.items[0].published_at == publication
    else:
        assert refetched.items[0].published_at == datetime(2020, 1, 2, 8, tzinfo=UTC)


@pytest.mark.asyncio
async def test_get_news_flow_sorts_unknown_and_mixed_timezone_publications(monkeypatch):
    rows = [
        {
            "id": article_id,
            "title": "VNM source publication",
            "source": "cafef",
            "url": f"https://example.com/{article_id}",
            "published_date": publication,
        }
        for article_id, publication in [
            ("unknown", None),
            ("invalid", "invalid"),
            ("older", datetime(2020, 1, 1, 8)),
            ("newer", datetime(2020, 1, 2, 8, tzinfo=UTC)),
        ]
    ]

    async def fake_latest_news(**_kwargs):
        return rows

    async def fake_context(symbol):
        return {"symbol": symbol}

    async def preserve_rows(scored_rows):
        return scored_rows

    monkeypatch.setattr("vnibb.services.news_service.news_crawler.get_latest_news", fake_latest_news)
    monkeypatch.setattr("vnibb.services.news_service._load_symbol_context", fake_context)
    monkeypatch.setattr("vnibb.services.news_service._enrich_sentiment_rows", preserve_rows)

    response = await get_news_flow(symbols=["VNM"], limit=5)

    assert [item.id for item in response.items] == ["newer", "older", "unknown", "invalid"]
    assert response.items[2].published_at is None
    assert response.items[3].published_at is None


@pytest.mark.asyncio
async def test_get_news_flow_uses_primary_crawler_rows(monkeypatch):
    async def fake_latest_news(*, source=None, symbol, sentiment, limit, offset):
        assert symbol is None
        assert sentiment == "neutral"
        assert limit >= 5
        return [
            {
                "id": "row-1",
                "title": "Vinamilk update",
                "summary": "Earnings call highlights",
                "source": "cafef",
                "published_date": datetime(2026, 2, 14, 8, 30),
                "url": "https://example.com/vnm",
                "related_symbols": "VNM, fpt",
                "sentiment": "neutral",
            }
        ]

    async def fake_symbol_context(symbol: str):
        assert symbol == "VNM"
        return {
            "symbol": "VNM",
            "peer_symbols": ["FPT"],
            "sector_keywords": ["consumer"],
            "company_keywords": ["vinamilk"],
        }

    monkeypatch.setattr(
        "vnibb.services.news_service.news_crawler.get_latest_news",
        fake_latest_news,
    )
    monkeypatch.setattr("vnibb.services.news_service._load_symbol_context", fake_symbol_context)

    response = await get_news_flow(symbols=["vnm"], sentiment="neutral", limit=5, offset=0)

    assert response.total == 1
    assert response.has_more is False
    assert response.items[0].id == "row-1"
    assert response.items[0].symbols == ["VNM", "FPT"]
    assert response.items[0].relevance_score == 0.97
    assert response.items[0].matched_symbols == ["VNM", "FPT"]


@pytest.mark.asyncio
async def test_get_news_flow_returns_empty_when_primary_and_fallback_fail(monkeypatch):
    async def fake_latest_news(*, source=None, symbol, sentiment, limit, offset):
        raise RuntimeError("crawler unavailable")

    async def fake_company_news(_query):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(
        "vnibb.services.news_service.news_crawler.get_latest_news",
        fake_latest_news,
    )
    monkeypatch.setattr(
        "vnibb.services.news_service.VnstockCompanyNewsFetcher.fetch",
        fake_company_news,
    )

    response = await get_news_flow(symbols=["VNM"], limit=3)

    assert response.total == 0
    assert response.items == []
    assert response.has_more is False


@pytest.mark.asyncio
async def test_get_news_flow_hydrates_from_company_news_when_primary_empty(monkeypatch):
    async def fake_latest_news(*, source=None, symbol, sentiment, limit, offset):
        return []

    async def fake_symbol_context(_symbol: str):
        return {
            "symbol": "FPT",
            "peer_symbols": [],
            "sector_keywords": [],
            "company_keywords": ["fpt"],
        }

    async def fake_company_news(_query):
        return [
            SimpleNamespace(
                title="FPT signs major AI partnership",
                summary="Enterprise expansion",
                source=None,
                published_at=datetime(2026, 2, 14, 10, 0),
                url="https://example.com/fpt-news",
            )
        ]

    monkeypatch.setattr(
        "vnibb.services.news_service.news_crawler.get_latest_news",
        fake_latest_news,
    )
    monkeypatch.setattr("vnibb.services.news_service._load_symbol_context", fake_symbol_context)
    monkeypatch.setattr(
        "vnibb.services.news_service.VnstockCompanyNewsFetcher.fetch",
        fake_company_news,
    )

    response = await get_news_flow(symbols=["fpt"], limit=2)

    assert response.total == 1
    assert response.items[0].title == "FPT signs major AI partnership"
    assert response.items[0].source == "vnstock"
    assert response.items[0].symbols == ["FPT"]
    assert response.has_more is False


@pytest.mark.asyncio
async def test_get_news_flow_marks_has_more_when_total_matches_limit(monkeypatch):
    async def fake_latest_news(*, source=None, symbol, sentiment, limit, offset):
        return [
            {
                "id": f"id-{index}",
                "title": f"Story {index}",
                "source": "vnexpress",
                "published_date": "2026-02-14T09:00:00",
                "url": f"https://example.com/news-{index}",
                "related_symbols": ["VCB"],
                "sentiment": "positive",
            }
            for index in range(limit)
        ]

    async def fake_symbol_context(symbol: str):
        return {
            "symbol": symbol,
            "peer_symbols": [],
            "sector_keywords": [],
            "company_keywords": [],
        }

    monkeypatch.setattr(
        "vnibb.services.news_service.news_crawler.get_latest_news",
        fake_latest_news,
    )
    monkeypatch.setattr("vnibb.services.news_service._load_symbol_context", fake_symbol_context)

    response = await get_news_flow(symbols=["VCB"], limit=2)

    assert response.total == 2
    assert response.has_more is True


@pytest.mark.asyncio
async def test_get_news_flow_uses_market_wide_fallback_when_no_relevant_rows(monkeypatch):
    async def fake_latest_news(*, source=None, symbol, sentiment, limit, offset):
        return [
            {
                "id": "general-1",
                "title": "VN-Index closes higher on broad market strength",
                "summary": "Liquidity improves across the board.",
                "source": "cafef",
                "published_date": datetime(2026, 2, 15, 10, 0),
                "url": "https://example.com/general-1",
                "related_symbols": [],
                "sentiment": "neutral",
            }
        ]

    async def fake_symbol_context(symbol: str):
        return {
            "symbol": symbol,
            "peer_symbols": [],
            "sector_keywords": ["banking"],
            "company_keywords": ["vinamilk"],
        }

    monkeypatch.setattr(
        "vnibb.services.news_service.news_crawler.get_latest_news",
        fake_latest_news,
    )
    monkeypatch.setattr("vnibb.services.news_service._load_symbol_context", fake_symbol_context)

    response = await get_news_flow(symbols=["VNM"], limit=3)

    assert response.total == 1
    assert response.fallback_used is True
    assert response.items[0].is_market_wide_fallback is True
    assert response.items[0].relevance_score == 0.0


@pytest.mark.asyncio
async def test_get_news_flow_enriches_runtime_sentiment(monkeypatch):
    async def fake_latest_news(*, source=None, symbol, sentiment, limit, offset):
        return [
            {
                "id": "row-2",
                "title": "Vinamilk lợi nhuận tăng mạnh quý này",
                "summary": "Biên lợi nhuận cải thiện rõ rệt.",
                "source": "cafef",
                "published_date": datetime(2026, 2, 16, 9, 30),
                "url": "https://example.com/vnm-profit",
                "related_symbols": [],
                "sentiment": "neutral",
                "sentiment_score": 0,
            }
        ]

    async def fake_symbol_context(symbol: str):
        return {
            "symbol": symbol,
            "peer_symbols": [],
            "sector_keywords": ["consumer"],
            "company_keywords": ["vinamilk"],
        }

    async def fake_analyze_batch(_articles, max_concurrent=5):
        assert max_concurrent >= 1
        return [
            {
                "sentiment": "bullish",
                "confidence": 76,
                "symbols": ["VNM"],
                "sectors": ["Consumer"],
                "ai_summary": "Vinamilk posts a strong profit rebound.",
            }
        ]

    monkeypatch.setattr(
        "vnibb.services.news_service.news_crawler.get_latest_news",
        fake_latest_news,
    )
    monkeypatch.setattr("vnibb.services.news_service._load_symbol_context", fake_symbol_context)
    monkeypatch.setattr(
        "vnibb.services.news_service.sentiment_analyzer.analyze_batch",
        fake_analyze_batch,
    )

    response = await get_news_flow(symbols=["VNM"], limit=5)

    assert response.total == 1
    assert response.items[0].sentiment == "bullish"
    assert response.items[0].sentiment_score == 76


@pytest.mark.asyncio
async def test_news_flow_gates_inferred_symbols_on_confidence_and_word_boundary(monkeypatch):
    """NLP-inferred symbols are only surfaced on a title mention with real confidence."""

    rows = [
        {
            "id": "embedded",
            "title": "Antwerp logistics summit draws freight operators",
            "source": "cafef",
            "published_date": datetime(2026, 2, 16, 9, 0),
            "url": "https://example.com/antwerp",
            "related_symbols": [],
            "sentiment": "neutral",
            "sentiment_score": 0,
        },
        {
            "id": "low-confidence",
            "title": "ANT announces a cash dividend",
            "source": "cafef",
            "published_date": datetime(2026, 2, 16, 10, 0),
            "url": "https://example.com/ant-dividend",
            "related_symbols": [],
            "sentiment": "neutral",
            "sentiment_score": 0,
        },
        {
            "id": "named",
            "title": "ANT publishes audited results",
            "source": "cafef",
            "published_date": datetime(2026, 2, 16, 11, 0),
            "url": "https://example.com/ant-results",
            "related_symbols": [],
            "sentiment": "neutral",
            "sentiment_score": 0,
        },
    ]

    async def fake_latest_news(**_kwargs):
        return [dict(row) for row in rows]

    async def fake_analyze_batch(_articles, max_concurrent=5):
        assert max_concurrent >= 1
        # `sentiment_analyzer` reports 0-100 confidence: 76 is high, 50 is the
        # neutral default and must not unlock an inferred ticker.
        return [
            {"sentiment": "neutral", "confidence": 76, "symbols": ["ANT"]},
            {"sentiment": "neutral", "confidence": 50, "symbols": ["ANT"]},
            {"sentiment": "neutral", "confidence": 76, "symbols": ["ANT"]},
        ]

    monkeypatch.setattr(
        "vnibb.services.news_service.news_crawler.get_latest_news",
        fake_latest_news,
    )
    monkeypatch.setattr(
        "vnibb.services.news_service.sentiment_analyzer.analyze_batch",
        fake_analyze_batch,
    )

    response = await get_news_flow(symbols=["ANT"], mode="all", limit=5)
    by_id = {item.id: item for item in response.items}

    # Ticker inside a longer word is not a mention.
    assert by_id["embedded"].symbols == []
    # Standalone title mention without high confidence stays unassociated.
    assert by_id["low-confidence"].symbols == []
    assert by_id["named"].symbols == ["ANT"]


@pytest.mark.asyncio
async def test_get_company_news_rows_filters_irrelevant_provider_articles(monkeypatch):
    async def fake_company_news(_query):
        return [
            SimpleNamespace(
                title="Volkswagen launches new SUV line",
                summary="Automotive market update.",
                source="cafef",
                published_at=datetime(2026, 2, 17, 8, 0),
                url="https://example.com/auto-news",
                category="Auto",
            ),
            SimpleNamespace(
                title="Vinamilk tăng trưởng lợi nhuận và mở rộng thị phần",
                summary="Vinamilk posts stronger dairy demand.",
                source="cafef",
                published_at=datetime(2026, 2, 17, 9, 0),
                url="https://example.com/vnm-growth",
                category="Consumer",
            ),
        ]

    async def fake_symbol_context(symbol: str):
        return {
            "symbol": symbol,
            "peer_symbols": [],
            "sector_keywords": ["dairy", "consumer"],
            "company_keywords": ["vinamilk"],
        }

    async def fake_analyze_batch(_articles, max_concurrent=5):
        return [
            {
                "sentiment": "bullish",
                "confidence": 72,
                "symbols": ["VNM"],
                "sectors": ["Consumer"],
                "ai_summary": "Vinamilk growth remains strong.",
            }
        ]

    monkeypatch.setattr(
        "vnibb.services.news_service.VnstockCompanyNewsFetcher.fetch",
        fake_company_news,
    )
    monkeypatch.setattr("vnibb.services.news_service._load_symbol_context", fake_symbol_context)

    async def fake_ranked_rows(**_kwargs):
        return ([], False)

    monkeypatch.setattr(
        "vnibb.services.news_service.get_ranked_news_rows",
        fake_ranked_rows,
    )
    monkeypatch.setattr(
        "vnibb.services.news_service.sentiment_analyzer.analyze_batch",
        fake_analyze_batch,
    )

    rows = await get_company_news_rows("VNM", limit=5)

    assert len(rows) == 1
    assert rows[0]["title"].startswith("Vinamilk")
    assert rows[0]["sentiment"] == "bullish"
    assert rows[0]["sentiment_score"] == 72
    assert rows[0]["relevance_score"] >= 0.8


@pytest.mark.asyncio
async def test_get_company_news_rows_merges_provider_and_ranked_related_results(monkeypatch):
    async def fake_company_news(_query):
        return [
            SimpleNamespace(
                title="Vietcap expands prime brokerage operations",
                summary="VCI boosts institutional coverage.",
                source="cafef",
                published_at=datetime(2026, 3, 30, 8, 0),
                url="https://example.com/vci-prime",
                category="Brokerage",
            )
        ]

    async def fake_symbol_context(symbol: str):
        return {
            "symbol": symbol,
            "peer_symbols": ["SSI"],
            "sector_keywords": ["brokerage", "securities"],
            "company_keywords": ["vietcap", "ban viet"],
        }

    async def fake_ranked_rows(**_kwargs):
        return (
            [
                {
                    "id": "ranked-1",
                    "title": "VCI margin lending demand improves",
                    "summary": "Retail activity rises in March.",
                    "source": "vietstock",
                    "published_date": datetime(2026, 3, 29, 10, 0),
                    "url": "https://example.com/vci-margin",
                    "relevance_score": 0.91,
                    "matched_symbols": ["VCI"],
                    "is_market_wide_fallback": False,
                    "sentiment": "neutral",
                    "sentiment_score": None,
                }
            ],
            False,
        )

    async def fake_analyze_batch(articles, max_concurrent=5):
        _ = max_concurrent
        return [
            {
                "sentiment": "bullish",
                "confidence": 70,
                "symbols": ["VCI"],
                "sectors": ["Financial Services"],
                "ai_summary": article["title"],
            }
            for article in articles
        ]

    monkeypatch.setattr(
        "vnibb.services.news_service.VnstockCompanyNewsFetcher.fetch",
        fake_company_news,
    )
    monkeypatch.setattr("vnibb.services.news_service._load_symbol_context", fake_symbol_context)
    monkeypatch.setattr("vnibb.services.news_service.get_ranked_news_rows", fake_ranked_rows)
    monkeypatch.setattr(
        "vnibb.services.news_service.sentiment_analyzer.analyze_batch",
        fake_analyze_batch,
    )

    rows = await get_company_news_rows("VCI", limit=5)

    assert len(rows) == 2
    assert {row["source"] for row in rows} == {"cafef", "vietstock"}


@pytest.mark.asyncio
async def test_get_company_news_rows_sorts_unknown_and_mixed_timezone_publications(monkeypatch):
    async def fake_company_news(_query):
        return [
            SimpleNamespace(
                title=f"VNM {name}",
                summary="Company update",
                source="cafef",
                published_at=publication,
                url=f"https://example.com/{name}",
                category="Consumer",
            )
            for name, publication in [
                ("unknown", None),
                ("older", datetime(2020, 1, 1, 8)),
                ("newer", datetime(2020, 1, 2, 8, tzinfo=UTC)),
            ]
        ]

    async def fake_context(symbol):
        return {"symbol": symbol}

    async def fake_ranked_rows(**_kwargs):
        return ([], False)

    async def preserve_rows(rows):
        return rows

    monkeypatch.setattr("vnibb.services.news_service.VnstockCompanyNewsFetcher.fetch", fake_company_news)
    monkeypatch.setattr("vnibb.services.news_service._load_symbol_context", fake_context)
    monkeypatch.setattr("vnibb.services.news_service.get_ranked_news_rows", fake_ranked_rows)
    monkeypatch.setattr("vnibb.services.news_service._enrich_sentiment_rows", preserve_rows)

    rows = await get_company_news_rows("VNM", limit=5)

    assert [row["title"] for row in rows] == ["VNM newer", "VNM older", "VNM unknown"]
    assert rows[-1]["published_date"] is None
