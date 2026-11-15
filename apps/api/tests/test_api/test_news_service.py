import sys
from datetime import UTC, datetime, timedelta
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock
from xml.etree import ElementTree as ET

import pytest

from vnibb.services.news_crawler import (
    FREE_RSS_FEEDS,
    NewsCrawlerService,
    _coerce_published_date,
    _extract_vnexpress_published_date_from_html,
    _to_market_news_storage_datetime,
)
from vnibb.services.news_service import (
    NewsItem,
    _contains_symbol,
    _extract_keywords,
    _is_generic_taxonomy,
    _parse_published_at,
    _sanitize_sector_taxonomy,
    _score_news_row,
    _strip_boilerplate,
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


@pytest.mark.parametrize(
    "taxonomy",
    [
        "Công ty cổ phần",
        "Joint Stock Company",
        "CTCP",
        "JSC",
        "Unknown",
        "unclassified",
        "N/A",
        "",
        None,
        "Ngành nghề: Công ty TNHH",
    ],
)
def test_legal_form_and_placeholder_taxonomy_is_not_an_industry(taxonomy):
    """#250: a legal form or placeholder answers no industry question."""

    assert _is_generic_taxonomy(taxonomy)
    assert _sanitize_sector_taxonomy(taxonomy) is None
    assert _extract_keywords(taxonomy) == []


@pytest.mark.parametrize("taxonomy", ["Steel", "Ngân hàng", "Bất động sản", "dairy"])
def test_real_sector_taxonomy_survives(taxonomy):
    assert not _is_generic_taxonomy(taxonomy)
    assert _sanitize_sector_taxonomy(taxonomy) == taxonomy
    assert _extract_keywords(taxonomy)


@pytest.mark.parametrize(
    "taxonomy", ["Công ty cổ phần", "Joint Stock Company", "Unknown"]
)
def test_unrelated_health_article_scores_zero_for_legal_form_sector(taxonomy):
    """The executed reproduction: boilerplate legal form scored 0.48/100."""

    context = {
        "symbol": "HPG",
        "peer_symbols": [],
        "company_keywords": [],
        "sector_keywords": _extract_keywords(taxonomy),
    }
    row = _score_news_row(
        {
            "title": "Cholesterol cao: dấu hiệu cảnh báo bạn cần đi khám",
            "content": (
                "Cholesterol cao thường không có triệu chứng rõ ràng. "
                "Bản quyền thuộc về Tạp chí sức khỏe."
            ),
            "category": taxonomy,
        },
        context,
    )

    assert row["relevance_score"] == 0
    assert row["match_reason"] is None
    assert row["association_class"] == "none"


def test_boilerplate_footer_is_not_article_evidence():
    context = {
        "symbol": "HPG",
        "peer_symbols": [],
        "company_keywords": [],
        "sector_keywords": ["thép"],
    }
    row = _score_news_row(
        {
            "title": "Cholesterol cao và nguy cơ tim mạch",
            "content": "Bản quyền thuộc về Tạp chí sức khỏe. Đọc thêm về thép tại chuyên mục.",
        },
        context,
    )

    assert _strip_boilerplate("Đọc thêm về thép tại chuyên mục.") == ""
    assert _strip_boilerplate("Nguồn: Tạp chí sức khỏe") == ""
    assert row["relevance_score"] == 0
    assert row["association_class"] == "none"


@pytest.mark.parametrize(
    "sentence",
    [
        "Nguồn cung của HPG tăng trong quý này.",
        "Nguồn cung thép trong nước đang thắt chặt.",
        "Chia sẻ tại đại hội, HPG công bố kế hoạch mới.",
    ],
)
def test_reporting_sentences_opening_with_nguon_or_chia_se_survive(sentence):
    """#250 review: those words open ordinary reporting, not only footers."""

    assert _strip_boilerplate(sentence) == sentence


def test_source_metadata_segment_is_still_dropped():
    assert _strip_boilerplate("Nguồn: CafeF") == ""
    assert _strip_boilerplate("Source: Reuters") == ""


def test_unpunctuated_source_summary_does_not_consume_the_content_field():
    """#250 review: strip each field, or a bare 'Nguồn: X' eats the body."""

    context = {"symbol": "HPG", "peer_symbols": [], "company_keywords": []}
    row = _score_news_row(
        {
            "title": "Thị trường điều chỉnh nhẹ",
            "summary": "Nguồn: CafeF",
            "content": "HPG công bố kế hoạch mới.",
        },
        context,
    )

    assert row["association_class"] == "direct_company"
    assert row["relevance_score"] == 0.94
    assert row["match_evidence"]["matched_terms"] == [
        {"term": "HPG", "field": "body", "kind": "symbol"}
    ]


def test_newline_separated_footer_does_not_become_evidence():
    """#250 review: a newline footer must not turn into a direct claim."""

    context = {"symbol": "HPG", "peer_symbols": [], "company_keywords": []}
    row = _score_news_row(
        {
            "title": "Thị trường điều chỉnh nhẹ",
            "content": "Market digest\nNguồn: HPG",
        },
        context,
    )

    assert row["association_class"] == "none"
    assert row["relevance_score"] == 0.0
    assert row["matched_symbols"] == []


def test_newline_footer_does_not_discard_the_legitimate_line_below():
    """#250 review: only the footer line is dropped, not its neighbour."""

    context = {"symbol": "HPG", "peer_symbols": [], "company_keywords": []}
    row = _score_news_row(
        {
            "title": "Thị trường điều chỉnh nhẹ",
            "content": "Nguồn: CafeF\nHPG công bố kế hoạch mới.",
        },
        context,
    )

    assert row["association_class"] == "direct_company"
    assert row["relevance_score"] == 0.94
    assert row["match_evidence"]["matched_terms"] == [
        {"term": "HPG", "field": "body", "kind": "symbol"}
    ]


def test_verified_sector_overlap_is_labelled_but_carries_no_score():
    """A shared industry is an association class, not a relevance number."""

    context = {
        "symbol": "HPG",
        "peer_symbols": [],
        "company_keywords": [],
        "sector_keywords": ["thép"],
        "classification_provenance": {"sector": "Thép", "sector_source": "stock.sector"},
    }
    row = _score_news_row(
        {"title": "Giá thép xây dựng tăng trong quý này", "content": "Nguồn cung thắt chặt."},
        context,
    )

    assert row["relevance_score"] is None
    assert row["match_reason"] == "sector_keyword"
    assert row["association_class"] == "verified_sector"
    assert row["match_evidence"]["sector_keywords"] == ["thép"]
    assert row["match_evidence"]["matched_terms"] == [
        {"term": "thép", "field": "title", "kind": "sector_keyword"}
    ]
    assert row["match_evidence"]["classification"]["sector"] == "Thép"


def test_direct_company_and_verified_peer_keep_exact_evidence():
    context = {
        "symbol": "HPG",
        "peer_symbols": ["HSG"],
        "peer_classification_basis": "industry",
        "company_keywords": ["hoa phat"],
        "sector_keywords": ["thép"],
        "classification_provenance": {
            "sector": "Thép",
            "industry": "Thép",
            "sector_source": "stock.sector",
            "industry_source": "stock.industry",
        },
    }
    direct = _score_news_row({"title": "HPG công bố kết quả kinh doanh"}, context)
    peer = _score_news_row({"title": "HSG mở rộng công suất"}, context)
    named = _score_news_row({"title": "Hoa Phat tăng sản lượng"}, context)

    assert direct["association_class"] == "direct_company"
    assert direct["relevance_score"] == 1.0
    assert direct["matched_symbols"] == ["HPG"]
    assert direct["match_evidence"]["matched_terms"] == [
        {"term": "HPG", "field": "title", "kind": "symbol"}
    ]
    assert peer["association_class"] == "verified_peer"
    assert peer["matched_symbols"] == ["HSG"]
    assert peer["match_evidence"]["peer_symbols"] == ["HSG"]
    # A peer-only row still carries why the peer set was trusted.
    assert peer["match_evidence"]["classification"] == {
        "sector": "Thép",
        "industry": "Thép",
        "sector_source": "stock.sector",
        "industry_source": "stock.industry",
        "peer_basis": "industry",
    }
    assert named["association_class"] == "direct_company"
    assert named["relevance_score"] == 0.84
    # The actual keyword is retained, never the rule identifier.
    assert named["match_evidence"]["matched_terms"] == [
        {"term": "hoa phat", "field": "title", "kind": "company_name"}
    ]


@pytest.mark.asyncio
async def test_rejected_taxonomy_does_not_fall_back_to_exchange_peers(monkeypatch):
    """#250 review: an exchange is not an industry, so it names no peers."""

    from vnibb.models.stock import Stock
    from vnibb.services import news_service

    class _FakeSession:
        def __init__(self):
            self.queries = []

        async def scalar(self, _query):
            return Stock(
                symbol="HPG",
                sector="Công ty cổ phần",
                industry="Unknown",
                exchange="HOSE",
                short_name="CTCP",
                company_name="Công ty cổ phần",
            )

        async def execute(self, query):
            self.queries.append(str(query))

            class _Rows:
                def scalars(self):
                    class _Scalars:
                        def all(self):
                            return ["AAA", "BBB"]

                    return _Scalars()

            return _Rows()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

    session = _FakeSession()
    monkeypatch.setattr(news_service, "async_session_maker", lambda: session)

    context = await news_service._load_symbol_context("HPG")

    assert context["peer_symbols"] == []
    assert context["sector_keywords"] == []
    assert context["peer_classification_basis"] is None
    assert session.queries == []
    assert set(context["classification_provenance"]["rejected"]) == {"sector", "industry"}


@pytest.mark.asyncio
async def test_related_feed_retains_verified_sector_but_drops_unrelated(monkeypatch):
    """Verified sector rows keep a label; no-association rows never enter."""

    async def fake_latest_news(*, source=None, symbol, sentiment, limit, offset):
        return [
            {
                "id": "health-1",
                "title": "Cholesterol cao: dấu hiệu cảnh báo",
                "summary": "Bản quyền thuộc về tạp chí sức khỏe.",
                "source": "cafef",
                "published_date": datetime(2026, 11, 10, 9, 0),
                "url": "https://example.com/health-1",
                "related_symbols": [],
                "sentiment": "neutral",
            },
            {
                "id": "sector-1",
                "title": "Giá thép xây dựng tăng trong quý này",
                "summary": "Nguồn cung trong nước thắt chặt.",
                "source": "cafef",
                "published_date": datetime(2026, 11, 10, 10, 0),
                "url": "https://example.com/sector-1",
                "related_symbols": [],
                "sentiment": "neutral",
            },
            {
                "id": "direct-1",
                "title": "HPG công bố sản lượng thép quý 4",
                "summary": "Sản lượng tiêu thụ tăng.",
                "source": "cafef",
                "published_date": datetime(2026, 11, 10, 11, 0),
                "url": "https://example.com/direct-1",
                "related_symbols": [],
                "sentiment": "neutral",
            },
        ]

    async def fake_context(_symbol):
        return {
            "symbol": "HPG",
            "peer_symbols": [],
            "company_keywords": [],
            "sector_keywords": ["thép"],
            "classification_provenance": {"sector": "Thép", "sector_source": "stock.sector"},
        }

    monkeypatch.setattr(
        "vnibb.services.news_service.news_crawler.get_latest_news", fake_latest_news
    )
    monkeypatch.setattr("vnibb.services.news_service._load_symbol_context", fake_context)

    response = await get_news_flow(symbols=["HPG"], mode="related", limit=5)
    by_id = {item.id: item for item in response.items}

    assert set(by_id) == {"sector-1", "direct-1"}
    assert response.fallback_used is False
    assert by_id["direct-1"].association_class == "direct_company"
    assert by_id["direct-1"].relevance_score == 1.0
    # The legitimate steel-only article survives, unscored and labelled.
    assert by_id["sector-1"].association_class == "verified_sector"
    assert by_id["sector-1"].relevance_score is None
    assert by_id["sector-1"].match_evidence["sector_keywords"] == ["thép"]


@pytest.mark.asyncio
async def test_provider_fallback_rows_are_rescored_not_promoted(monkeypatch):
    """#250 review: the request symbol is metadata, not article evidence."""

    async def fake_company_news(_query):
        return [
            SimpleNamespace(
                title="Volkswagen launches new SUV line",
                summary="Automotive market update.",
                source="cafef",
                published_at=datetime(2026, 11, 10, 8, 0),
                url="https://example.com/unrelated",
                category="Auto",
            )
        ]

    async def fake_context(_symbol):
        return {
            "symbol": "HPG",
            "peer_symbols": [],
            "company_keywords": ["hoa phat"],
            "sector_keywords": ["thép"],
            "classification_provenance": {},
        }

    async def empty_ranked(**_kwargs):
        return ([], False)

    monkeypatch.setattr(
        "vnibb.services.news_service.VnstockCompanyNewsFetcher.fetch", fake_company_news
    )
    monkeypatch.setattr("vnibb.services.news_service._load_symbol_context", fake_context)
    monkeypatch.setattr(
        "vnibb.services.news_service.get_ranked_news_rows", empty_ranked
    )
    monkeypatch.setattr(
        "vnibb.services.news_service._enrich_sentiment_rows", _identity_rows
    )

    rows = await get_company_news_rows("HPG", limit=5)

    assert len(rows) == 1
    row = rows[0]
    assert row["association_class"] == "none"
    assert row["relevance_score"] == 0.0
    assert row["matched_symbols"] == []
    assert row["match_evidence"]["provider_validated_text"] is False


@pytest.mark.asyncio
async def test_provider_fallback_survives_context_outage_without_self_verification(
    monkeypatch,
):
    """#250 review: a DB outage degrades scoring, it does not drop live rows."""

    async def fake_company_news(_query):
        return [
            SimpleNamespace(
                title="Volkswagen launches new SUV line",
                summary="Automotive market update.",
                source="cafef",
                published_at=datetime(2026, 11, 10, 8, 0),
                url="https://example.com/unrelated",
                category="Auto",
            ),
            SimpleNamespace(
                title="HPG công bố kế hoạch mới",
                summary="Kế hoạch sản xuất quý 4.",
                source="cafef",
                published_at=datetime(2026, 11, 10, 9, 0),
                url="https://example.com/hpg-plan",
                category="Steel",
            ),
        ]

    async def raising_context(_symbol):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(
        "vnibb.services.news_service.VnstockCompanyNewsFetcher.fetch", fake_company_news
    )
    monkeypatch.setattr(
        "vnibb.services.news_service._load_symbol_context", raising_context
    )

    # The fallback owns this behaviour; the primary lookup in
    # `get_company_news_rows` is a separate pre-existing contract.
    from vnibb.services.news_service import _hydrate_company_news_fallback

    rows = await _hydrate_company_news_fallback("HPG", 5)

    # Both available provider rows survive the DB outage instead of rethrowing.
    by_url = {row["url"]: row for row in rows}
    assert set(by_url) == {
        "https://example.com/unrelated",
        "https://example.com/hpg-plan",
    }
    # Without context nothing can be verified, so the unrelated row makes no
    # claim and carries no rank; the request symbol cannot verify itself.
    unrelated = by_url["https://example.com/unrelated"]
    assert unrelated["association_class"] == "none"
    assert unrelated["relevance_score"] == 0.0
    assert unrelated["matched_symbols"] == []
    assert unrelated["match_reason"] is None
    assert unrelated["match_evidence"]["context_available"] is False
    assert unrelated["match_evidence"]["provider_validated_text"] is False
    # The outage degrades scoring, it does not rewrite evidence: a title that
    # genuinely names the issuer still proves the direct association.
    named = by_url["https://example.com/hpg-plan"]
    assert named["association_class"] == "direct_company"
    assert named["match_evidence"]["matched_terms"] == [
        {"term": "HPG", "field": "title", "kind": "symbol"}
    ]
    assert named["match_evidence"]["context_available"] is False


async def _identity_rows(rows):
    return rows




def test_news_crawler_parses_rss_leaf_text_and_namespaced_fields():
    item = ET.fromstring("""<item xmlns:content="http://purl.org/rss/1.0/modules/content/"
        xmlns:dc="http://purl.org/dc/elements/1.1/">
        <title>RSS headline</title><link>https://example.com/rss</link>
        <description>RSS summary</description><content:encoded>RSS body</content:encoded>
        <category>Markets</category><pubDate>Mon, 26 Oct 2026 09:00:00 GMT</pubDate>
        <dc:date>2026-10-25T10:00:00Z</dc:date>
    </item>""")

    assert NewsCrawlerService._parse_rss_item(item, "RSS source") == {
        "title": "RSS headline", "summary": "RSS summary", "content": "RSS body",
        "source": "RSS source", "url": "https://example.com/rss", "category": "Markets",
        "pub_date": "Mon, 26 Oct 2026 09:00:00 GMT",
    }


def test_news_crawler_parses_atom_leaf_text_and_link():
    item = ET.fromstring("""<entry xmlns="http://www.w3.org/2005/Atom">
        <title>Atom headline</title><link href="https://example.com/atom"/>
        <summary>Atom summary</summary><content>Atom body</content>
        <category>Economy</category><published>2026-10-24T12:30:00Z</published>
        <updated>2026-10-26T14:00:00Z</updated>
    </entry>""")

    assert NewsCrawlerService._parse_rss_item(item, "Atom source") == {
        "title": "Atom headline", "summary": "Atom summary", "content": "Atom body",
        "source": "Atom source", "url": "https://example.com/atom", "category": "Economy",
        "pub_date": "2026-10-24T12:30:00Z",
    }


def test_news_crawler_parses_dublin_core_date_when_rss_date_absent():
    item = ET.fromstring("""<item xmlns:dc="http://purl.org/dc/elements/1.1/">
        <title>Other headline</title><link>https://example.com/other</link>
        <dc:date>2026-10-23T08:15:00Z</dc:date>
    </item>""")

    article = NewsCrawlerService._parse_rss_item(item, "RSS source")
    assert article is not None
    assert article["pub_date"] == "2026-10-23T08:15:00Z"


@pytest.mark.asyncio
@pytest.mark.parametrize("category", ["Markets", "x" * 50, "y" * 60, None])
async def test_news_crawler_bounds_rss_category_for_storage(category):
    item = ET.fromstring("<item><title>Headline</title><link>https://example.com/article</link></item>")
    if category is not None:
        ET.SubElement(item, "category").text = category
    article = NewsCrawlerService._parse_rss_item(item, "RSS source")
    assert article is not None
    session = SimpleNamespace(execute=AsyncMock())

    await NewsCrawlerService()._store_article(session, article)

    statement = session.execute.await_args.args[0]
    assert statement.compile().params["category"] == (category[:50] if category is not None else None)


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
                    "match_reason": "exact_symbol_title",
                    "association_class": "direct_company",
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


@pytest.mark.asyncio
async def test_installed_paid_news_is_never_selected(monkeypatch):
    module = ModuleType("vnstock_news")

    def paid_access(name):
        pytest.fail(f"Paid news package accessed: {name}")

    module.__getattr__ = paid_access
    monkeypatch.setitem(sys.modules, "vnstock_news", module)
    crawler = NewsCrawlerService()
    rss = AsyncMock(return_value=3)
    sentiment = AsyncMock()
    monkeypatch.setattr(crawler, "_crawl_with_rss", rss)
    monkeypatch.setattr(crawler, "analyze_unprocessed_articles", sentiment)

    assert await crawler.crawl_market_news(limit=10) == 3
    assert crawler._news_available is False
    assert set(crawler.SOURCES) == set(FREE_RSS_FEEDS)
    rss.assert_awaited_once_with(["cafef.vn", "vietstock.vn", "vnexpress.net"], 10)
    sentiment.assert_awaited_once_with(batch_size=20)
    assert await crawler.analyze_trending() == {
        "available": False, "reason": "trending_analysis_unavailable",
    }


@pytest.mark.asyncio
async def test_news_flow_marks_locally_computed_sentiment_as_heuristic(monkeypatch):
    """#250: a label this service computes is heuristic, and its zero survives."""

    async def fake_latest_news(**_kwargs):
        return [
            {
                "id": "computed",
                "title": "HPG lợi nhuận tăng mạnh",
                "source": "cafef",
                "published_date": datetime(2026, 3, 2, 9, 0),
                "url": "https://example.com/computed",
                "related_symbols": ["HPG"],
                "sentiment": "neutral",
                "sentiment_score": 0,
            }
        ]

    async def fake_analyze_batch(_articles, max_concurrent=5):
        assert max_concurrent >= 1
        return [
            {"sentiment": "bullish", "confidence": 0, "symbols": [], "sectors": [], "ai_summary": ""}
        ]

    monkeypatch.setattr(
        "vnibb.services.news_service.news_crawler.get_latest_news", fake_latest_news
    )
    monkeypatch.setattr(
        "vnibb.services.news_service.sentiment_analyzer.analyze_batch", fake_analyze_batch
    )

    response = await get_news_flow(mode="all", limit=5)

    item = response.items[0]
    assert item.sentiment_source == "heuristic"
    # A reported zero confidence survives the enrichment untouched.
    assert item.sentiment_score == 0


def test_resolve_sentiment_source_never_guesses_provider_provenance():
    """#250: a legacy bare label keeps an unknown origin; no label is unavailable."""
    from vnibb.services.news_service import resolve_sentiment_source

    assert resolve_sentiment_source({"sentiment": "bullish"}) is None
    assert resolve_sentiment_source({"sentiment": "bullish", "sentiment_source": "provider"}) == "provider"
    assert resolve_sentiment_source({}) == "unavailable"


def test_news_item_sentiment_source_defaults_to_unknown():
    """#250: an item with no label never claims a provider classification."""
    item = NewsItem(id="n", title="No label", source="cafef", url="https://example.com/n")

    assert item.model_dump(mode="json")["sentiment_source"] is None


@pytest.mark.asyncio
async def test_hydrated_fallback_rows_do_not_invent_a_sentiment_label(monkeypatch):
    """#250: a row with no computed label declares unavailable, not neutral."""
    from vnibb.services.news_service import _hydrate_company_news_fallback

    async def fake_company_news(_query):
        return [
            SimpleNamespace(
                title="HPG công bố kế hoạch mở rộng",
                summary="HPG expands capacity.",
                source="cafef",
                published_at=datetime(2026, 3, 4, 9, 0),
                url="https://example.com/hpg-plan-250",
                category=None,
            )
        ]

    async def fake_context(_symbol):
        return {"symbol": "HPG", "peer_symbols": [], "sector_keywords": [], "company_keywords": []}

    monkeypatch.setattr(
        "vnibb.services.news_service.VnstockCompanyNewsFetcher.fetch", fake_company_news
    )
    monkeypatch.setattr("vnibb.services.news_service._load_symbol_context", fake_context)

    rows = await _hydrate_company_news_fallback("HPG", 5)

    assert rows[0]["sentiment_source"] == "unavailable"
    # The analyzer has not run: there is no score to report, and 0 would be a
    # real confidence value.
    assert rows[0].get("sentiment_score") is None
