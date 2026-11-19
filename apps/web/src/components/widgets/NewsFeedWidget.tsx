// Enhanced News Feed Widget with AI Sentiment Analysis

'use client';

import { useMemo, useState, useEffect } from 'react';
import {
    ExternalLink,
    Newspaper,
    Clock,
    TrendingUp,
    TrendingDown,
    Minus,
    Filter,
    Search,
    Bookmark,
    BookmarkCheck
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE_URL, APIError } from '@/lib/api';
import { formatTimestamp } from '@/lib/formatDate';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '@/lib/pollingPolicy';
import { normalizeNewsItemTimestamp, newsObservationProvenance } from '@/lib/newsTime';
import { getSentimentProvenance } from '@/components/widgets/news/NewsCard';

interface NewsArticle {
    id: number | string;
    title: string;
    summary?: string;
    content?: string;
    source: string;
    url?: string;
    author?: string;
    image_url?: string;
    category?: string;
    published_at?: string | null;
    published_date?: string | null;
    related_symbols: string[];
    sectors: string[];
    sentiment?: 'bullish' | 'neutral' | 'bearish' | null;
    sentiment_score?: number;
    sentiment_source?: 'provider' | 'heuristic' | 'unavailable' | null;
    ai_summary?: string;
    read_count: number;
    bookmarked: boolean;
    relevance_score?: number | null;
    matched_symbols?: string[];
    match_reason?: string | null;
    is_market_wide_fallback?: boolean;
    association_class?: string | null;
}

function isMarketWideArticle(article: NewsArticle) {
    return article.is_market_wide_fallback === true || article.association_class === 'general_market';
}

function isAdmittedArticle(article: NewsArticle) {
    return !isMarketWideArticle(article) && (article.association_class === 'direct_company'
        || article.association_class === 'verified_peer' || article.association_class === 'verified_sector');
}

function NewsAssociation({ article, symbol }: { readonly article: NewsArticle; readonly symbol: string }) {
    const marketWide = isMarketWideArticle(article);
    const matched = marketWide ? [] : article.matched_symbols ?? [];
    const upperSymbol = symbol.toUpperCase();
    let label = 'Association unverified';
    if (marketWide) {
        label = 'Market-wide fallback';
    } else if (article.association_class === 'verified_sector') {
        label = 'Industry overlap · no company evidence';
    } else if (article.association_class === 'verified_peer') {
        const peers = matched.filter(value => value.toUpperCase() !== upperSymbol);
        label = peers.length ? `Verified peer: ${peers.join(', ')}` : 'Verified peer';
    } else if (article.association_class === 'direct_company') {
        const exact = matched.some(value => value.toUpperCase() === upperSymbol)
            && ['exact_symbol_title', 'exact_symbol_body', 'exact_symbol_related'].includes(article.match_reason ?? '');
        label = exact ? `Symbol mention: ${upperSymbol}` : 'Direct company';
    }
    const reason = marketWide ? null : article.match_reason;
    const score = marketWide && article.relevance_score !== 0 ? null : article.relevance_score;
    const association = marketWide ? 'general_market' : article.association_class;
    const detail = `Article association evidence, not investment relevance. Reason: ${reason ?? 'unavailable'}; matched symbols: ${matched.join(', ') || 'none'}; score: ${score ?? 'unavailable'}; class: ${association ?? 'unavailable'}.`;
    return <span title={detail} className="text-[10px] text-[var(--text-muted)]">{label}</span>;
}

interface NewsFeedResponse {
    readonly articles: readonly NewsArticle[];
    readonly mode?: 'all' | 'related';
    readonly fallback_used?: boolean;
}

interface NewsFeedWidgetProps {
    symbol?: string;
    config?: Record<string, unknown>;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: WidgetDataPayload) => void;
}

// Sentiment badge component
function SentimentBadge({
    sentiment,
    score,
    source,
}: {
    sentiment?: string | null;
    score?: number;
    source?: 'provider' | 'heuristic' | 'unavailable' | null;
}) {
    if (!sentiment && source !== 'unavailable') return null;

    const config = {
        bullish: {
            icon: TrendingUp,
            bg: 'bg-[var(--color-positive-bg)]',
            text: 'text-[var(--color-positive)]',
            border: 'border-[var(--color-state-border)]',
            label: 'Bullish'
        },
        neutral: {
            icon: Minus,
            bg: 'bg-[var(--bg-hover)]',
            text: 'text-[var(--text-muted)]',
            border: 'border-[var(--border-color)]',
            label: 'Neutral'
        },
        bearish: {
            icon: TrendingDown,
            bg: 'bg-[var(--color-negative-bg)]',
            text: 'text-[var(--color-negative)]',
            border: 'border-[var(--color-state-border)]',
            label: 'Bearish'
        }
    };

    const { icon: Icon, bg, text, border, label } = config[sentiment as keyof typeof config] || config.neutral;
    const provenance = getSentimentProvenance(source);

    // #250: no recorded label means no direction is shown, never a fake Neutral.
    if (source === 'unavailable') {
        return (
            <span
                className="inline-flex items-center gap-1 rounded border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-2 py-0.5 text-[var(--text-muted)]"
                role="note"
                title={provenance.detail}
                aria-label={`Article sentiment: Sentiment unavailable. ${provenance.detail}`}
            >
                <span className="text-[length:var(--font-size-sm)] font-medium">{provenance.label}</span>
            </span>
        );
    }

    return (
        <div
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${bg} ${text} ${border}`}
            role="note"
            title={provenance.detail}
            aria-label={`Article sentiment: ${label} (${provenance.label}). ${provenance.detail}`}
        >
            <Icon size={11} />
            <span className="text-[length:var(--font-size-sm)] font-medium">{label}</span>
            <span className="text-[length:var(--font-size-sm)] opacity-80">{provenance.label}</span>
            {/* A reported 0 confidence is a real value; absent is not zero. */}
            {typeof score === 'number' && (
                <span className="text-[length:var(--font-size-sm)] opacity-80">({score}%)</span>
            )}
        </div>
    );
}

function formatPublishedTime(dateStr: string | null | undefined): string {
    return formatTimestamp(dateStr);
}

import { WidgetContainer } from '@/components/ui/WidgetContainer';

export function NewsFeedWidget({ symbol, isEditing, onRemove, onDataChange }: NewsFeedWidgetProps) {
    const [expandedId, setExpandedId] = useState<number | string | null>(null);
    const [sourceFilter, setSourceFilter] = useState<string>('');
    const [sentimentFilter, setSentimentFilter] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [bookmarkedIds, setBookmarkedIds] = useState<Set<number | string>>(new Set());
    const requestMode = symbol ? 'related' : 'all';

    // Fetch news feed with filters
    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useQuery<NewsFeedResponse>({
        queryKey: ['news-feed', symbol, sourceFilter, sentimentFilter, requestMode],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (symbol) params.append('symbol', symbol);
            if (sourceFilter) params.append('source', sourceFilter);
            if (sentimentFilter) params.append('sentiment', sentimentFilter);
            params.append('mode', requestMode);
            params.append('limit', '40');

            const response = await fetch(`${API_BASE_URL}/news/feed?${params}`);
            if (!response.ok) throw new APIError(`API Error: ${response.status} ${response.statusText}`, response.status, response.statusText);
            return response.json();
        },
        staleTime: 2 * 60 * 1000,
        refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.news),
        refetchIntervalInBackground: false,
        networkMode: 'online',
    });

    // Fetch market sentiment
    const { data: marketSentiment } = useQuery({
        queryKey: ['market-sentiment'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/news/sentiment`);
            if (!response.ok) throw new APIError(`API Error: ${response.status} ${response.statusText}`, response.status, response.statusText);
            return response.json();
        },
        staleTime: 5 * 60 * 1000,
        refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.news),
        refetchIntervalInBackground: false,
        networkMode: 'online',
    });

    const isRelated = requestMode === 'related' && data?.mode !== 'all';
    const newsItems: NewsArticle[] = useMemo(
        () => (data?.articles || []).map((item: NewsArticle) => ({
            ...item,
            published_date: normalizeNewsItemTimestamp(item) || item.published_date || null,
            is_market_wide_fallback: data?.fallback_used === true || item.is_market_wide_fallback,
        })),
        [data?.articles, data?.fallback_used]
    );
    const hasData = newsItems.length > 0;
    const isFallback = Boolean(error && hasData);
    const momentumArticles = useMemo(() => isRelated ? newsItems.filter(isAdmittedArticle) : newsItems, [isRelated, newsItems]);
    let feedNote = 'Market feed';
    if (isRelated) {
        if (hasData && newsItems.every(isMarketWideArticle)) feedNote = 'Market-wide fallback';
        else if (hasData && !momentumArticles.length) feedNote = 'Ticker association unverified';
        else feedNote = `${symbol} related feed`;
    }
    // Source observation only: raw API rows (not the UI-mapped `published_date`,
    // which may fall back to crawl aliases) so the latest genuine article date is
    // used and the query receipt never becomes freshness.
    const observation = useMemo(
        () => newsObservationProvenance(data?.articles, { receiptAt: dataUpdatedAt }),
        [data?.articles, dataUpdatedAt],
    );
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 });

    useEffect(() => {
        onDataChange?.(
            buildWidgetRuntime({
                empty: !hasData,
                apiGroup: '/news',
                endpoint: '/news/feed',
                sourceLabel: feedNote,
                lastDataDate: observation.lastDataDate,
                fetchedAt: dataUpdatedAt,
                coverage: observation.coverage,
                stale: isFallback,
                cached: isFallback,
                warnings: observation.warning ? [observation.warning] : undefined,
                extra: { count: newsItems.length },
            }),
        );
    }, [
        onDataChange,
        hasData,
        dataUpdatedAt,
        isFallback,
        newsItems.length,
        feedNote,
        observation.lastDataDate,
        observation.coverage,
        observation.warning,
    ]);

    // Filter by search query
    const filteredNews = newsItems.filter(item =>
        searchQuery === '' ||
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.summary?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Toggle bookmark
    const toggleBookmark = (id: number | string) => {
        setBookmarkedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    // Available sources from data
    const sources = Array.from(new Set(newsItems.map(n => n.source)));
    const recentArticleCount = useMemo(() => {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return momentumArticles.filter((item) => {
            if (!item.published_date) return false;
            const parsed = new Date(item.published_date).getTime();
            return Number.isFinite(parsed) && parsed >= cutoff;
        }).length;
    }, [momentumArticles]);
    const momentumBars = useMemo(() => {
        const buckets = Array.from({ length: 7 }, (_, index) => {
            const date = new Date();
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() - (6 - index));
            return {
                key: date.toISOString().slice(0, 10),
                label: date.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2),
                count: 0,
            };
        });
        const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));

        momentumArticles.forEach((item) => {
            if (!item.published_date) return;
            const parsed = new Date(item.published_date);
            if (Number.isNaN(parsed.getTime())) return;
            parsed.setHours(0, 0, 0, 0);
            const key = parsed.toISOString().slice(0, 10);
            const bucket = bucketMap.get(key);
            if (bucket) {
                bucket.count += 1;
            }
        });

        const peak = Math.max(...buckets.map((bucket) => bucket.count), 1);
        return buckets.map((bucket) => ({
            ...bucket,
            height: `${Math.max(18, Math.round((bucket.count / peak) * 100))}%`,
        }));
    }, [momentumArticles]);

    return (
        <WidgetContainer
            title={symbol ? 'Company News' : 'Market News'}
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading && !hasData}
            noPadding
        >
            <div className="h-full flex flex-col">
                {/* Header with Market Sentiment */}
                {!symbol && marketSentiment && (
                    <div className="px-3 py-2 m-2 bg-muted/40 rounded border border-border/60">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Market Sentiment:</span>
                                <SentimentBadge
                                    sentiment={marketSentiment.overall}
                                    score={Math.round(marketSentiment.bullish_percentage)}
                                />
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                                {marketSentiment.total_articles} articles analyzed
                            </div>
                        </div>
                    </div>
                )}
                <div className="px-3 pt-2">
                    <WidgetMeta
                        updatedAt={observation.lastDataDate}
                        fetchedAt={dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={isFallback}
                        note={feedNote}
                        align="right"
                    />
                </div>

                {momentumArticles.length > 0 && (
                    <div className="mx-2 mb-2 mt-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]/50 px-3 py-2">
                        <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                            <span>{isRelated ? `${symbol} news momentum` : 'News momentum'}</span>
                            <span>{recentArticleCount}/{momentumArticles.length} articles in 7d</span>
                        </div>
                        <div className="mt-2 flex items-end gap-1.5 h-16">
                            {momentumBars.map((bucket) => (
                                <div key={bucket.key} className="flex flex-1 flex-col items-center gap-1">
                                    <div className="relative flex w-full flex-1 items-end rounded bg-[var(--bg-primary)]/80">
                                        <div className="w-full rounded bg-[var(--color-state-bg)] transition-all" style={{ height: bucket.height }} />
                                    </div>
                                    <span className="text-[9px] text-[var(--text-muted)]">{bucket.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Filters */}
                <div className="px-2 py-2 space-y-2 border-b border-border/60">
                    {/* Search */}
                    <div className="relative">
                        <Search
                            size={12}
                            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <input
                            type="text"
                            placeholder={symbol ? 'Search company news...' : 'Search news...'}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-7 pr-2 py-1.5 text-xs rounded bg-background/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
                        />
                    </div>

                    {/* Filter chips */}
                    <div className="flex items-center gap-2 flex-wrap text-left">
                        <Filter size={10} className="text-[var(--text-muted)]" />

                        {/* Sentiment filter */}
                        <select
                            value={sentimentFilter}
                            onChange={(e) => setSentimentFilter(e.target.value)}
                            className="text-[10px] px-2 py-1 rounded bg-background/80 border border-border text-foreground focus:outline-none focus:border-primary/40"
                        >
                            <option value="">All Sentiment</option>
                            <option value="bullish">Bullish</option>
                            <option value="neutral">Neutral</option>
                            <option value="bearish">Bearish</option>
                        </select>

                        {/* Source filter */}
                        {sources.length > 0 && (
                            <select
                                value={sourceFilter}
                                onChange={(e) => setSourceFilter(e.target.value)}
                                className="text-[10px] px-2 py-1 rounded bg-background/80 border border-border text-foreground focus:outline-none focus:border-primary/40"
                            >
                                <option value="">All Sources</option>
                                {sources.map(source => (
                                    <option key={source} value={source}>{source}</option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>

                {/* News List */}
                <div className="flex-1 overflow-y-auto">
                    {timedOut && isLoading && !hasData ? (
                        <WidgetError
                            title="Loading timed out"
                            error={new Error('News feed took too long to load.')}
                            onRetry={() => {
                                resetTimeout();
                                refetch();
                            }}
                        />
                    ) : isLoading && !hasData ? (
                        <WidgetSkeleton lines={6} />
                    ) : error && !hasData ? (
                        <WidgetError error={error as Error} onRetry={() => refetch()} />
                    ) : !hasData ? (
                        <WidgetEmpty
                            message={symbol
                                ? `No news available for ${symbol}. Try refreshing or check back later.`
                                : 'No news available yet. Try refreshing or check back later.'}
                            icon={<Newspaper size={18} />}
                            action={{ label: 'Refresh', onClick: () => refetch() }}
                        />
                    ) : filteredNews.length === 0 ? (
                        <WidgetEmpty message="No matching news found. Try adjusting filters." icon={<Newspaper size={18} />} />
                    ) : (
                        <div className="divide-y divide-[var(--border-color)] text-left">
                            {filteredNews.map((item, index) => (
                                <div
                                    key={`${item.id ?? item.url ?? item.title}-${index}`}
                                    className="group p-3 hover:bg-muted/40 cursor-pointer transition-colors"
                                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                                >
                                    {/* Header */}
                                    <div className="flex items-start gap-2">
                                        <div className="flex-1 min-w-0">
                                            {/* Title */}
                                            <h4 className={`text-sm text-[var(--text-primary)] font-medium leading-tight mb-1 ${expandedId === item.id ? '' : 'line-clamp-2'
                                                }`}>
                                                {item.title}
                                            </h4>

                                            {/* Meta */}
                                            <div className="flex items-center gap-2 flex-wrap text-[10px] text-[var(--text-muted)]">
                                                <span className="flex items-center gap-1">
                                                    <Clock size={10} />
                                                    {item.published_date ? formatPublishedTime(item.published_date) : 'Date unavailable'}
                                                </span>
                                                {item.source && (
                                                    <span className="px-1.5 py-0.5 bg-muted/70 text-foreground rounded">
                                                        {item.source}
                                                    </span>
                                                )}
                                                {(item.sentiment || item.sentiment_source === 'unavailable') && (
                                                    <SentimentBadge
                                                        sentiment={item.sentiment}
                                                        score={item.sentiment_score}
                                                        source={item.sentiment_source}
                                                    />
                                                )}
                                                {isRelated && symbol && <NewsAssociation article={item} symbol={symbol} />}
                                            </div>

                                            {/* Related symbols */}
                                            {item.related_symbols.length > 0 && (
                                                <div className="flex items-center gap-1 mt-1 flex-wrap">
                                                    <span className="text-[9px] text-[var(--text-muted)]">Source tags:</span>
                                                    {item.related_symbols.slice(0, 5).map(sym => (
                                                        <span
                                                            key={sym}
                                                            className="text-[9px] px-1.5 py-0.5 bg-[var(--color-state-bg)] text-[var(--color-accent-primary)] rounded border border-[var(--color-state-border)]"
                                                        >
                                                            {sym}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Bookmark button */}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleBookmark(item.id);
                                            }}
                                            className="p-1 text-[var(--text-muted)] hover:text-[var(--color-accent-primary)] transition-colors"
                                        >
                                            {bookmarkedIds.has(item.id) ? (
                                                <BookmarkCheck size={14} className="text-[var(--color-accent-primary)]" />
                                            ) : (
                                                <Bookmark size={14} />
                                            )}
                                        </button>
                                    </div>

                                    {/* Expanded Content */}
                                    {expandedId === item.id && (
                                        <div className="mt-3 space-y-2 border-t border-border/60 pt-2">
                                            {/* AI Summary */}
                                            {item.ai_summary && (
                                                <div className="p-2 bg-[var(--color-state-bg)] border border-[var(--color-state-border)] rounded">
                                                    <div className="text-[9px] text-[var(--color-accent-primary)] mb-1 font-medium">
                                                        AI SUMMARY
                                                    </div>
                                                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                                                        {item.ai_summary}
                                                    </p>
                                                </div>
                                            )}

                                            {/* Original summary */}
                                            {item.summary && !item.ai_summary && (
                                                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                                                    {item.summary}
                                                </p>
                                            )}

                                            {/* Sectors */}
                                            {item.sectors.length > 0 && (
                                                <div className="flex items-center gap-1 flex-wrap">
                                                    <span className="text-[9px] text-[var(--text-muted)]">Sectors:</span>
                                                    {item.sectors.map(sector => (
                                                        <span
                                                            key={sector}
                                                            className="text-[9px] px-1.5 py-0.5 bg-[var(--color-state-bg)] text-[var(--color-accent-primary)] rounded"
                                                        >
                                                            {sector}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Read full article */}
                                            {item.url && (
                                                <a
                                                    href={item.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="inline-flex items-center gap-1 text-xs text-[var(--color-accent-primary)] hover:text-[var(--color-accent-primary)]"
                                                >
                                                    Read full article
                                                    <ExternalLink size={10} />
                                                </a>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer stats */}
                <div className="px-3 py-2 border-t border-border/60 text-[10px] text-muted-foreground text-left">
                    Showing {filteredNews.length} of {newsItems.length} articles
                </div>
            </div>
        </WidgetContainer>
    );
}
