// Enhanced News Feed Widget with AI Sentiment Analysis

'use client';

import { useState, useEffect } from 'react';
import {
    ExternalLink,
    Newspaper,
    RefreshCw,
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

interface NewsArticle {
    id: number;
    title: string;
    summary?: string;
    content?: string;
    source: string;
    url?: string;
    author?: string;
    image_url?: string;
    category?: string;
    published_date?: string;
    related_symbols: string[];
    sectors: string[];
    sentiment?: 'bullish' | 'neutral' | 'bearish';
    sentiment_score?: number;
    ai_summary?: string;
    read_count: number;
    bookmarked: boolean;
}

interface NewsFeedWidgetProps {
    symbol?: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

// Sentiment badge component
function SentimentBadge({ sentiment, score }: { sentiment?: string; score?: number }) {
    if (!sentiment) return null;

    const config = {
        bullish: {
            icon: TrendingUp,
            bg: 'bg-green-500/10',
            text: 'text-green-400',
            border: 'border-green-500/30',
            label: 'Bullish'
        },
        neutral: {
            icon: Minus,
            bg: 'bg-gray-500/10',
            text: 'text-gray-400',
            border: 'border-gray-500/30',
            label: 'Neutral'
        },
        bearish: {
            icon: TrendingDown,
            bg: 'bg-red-500/10',
            text: 'text-red-400',
            border: 'border-red-500/30',
            label: 'Bearish'
        }
    };

    const { icon: Icon, bg, text, border, label } = config[sentiment as keyof typeof config] || config.neutral;

    return (
        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${bg} ${text} ${border}`}>
            <Icon size={10} />
            <span className="text-[10px] font-medium">{label}</span>
            {score && <span className="text-[9px] opacity-70">({score}%)</span>}
        </div>
    );
}

// Format date relative to now
function formatDateRelative(dateStr: string | null | undefined): string {
    if (!dateStr) return '';

    try {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);

        if (diffHours < 1) return 'Just now';
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;

        return date.toLocaleDateString('vi-VN', {
            month: 'short',
            day: 'numeric',
        });
    } catch {
        return '';
    }
}

import { WidgetContainer } from '@/components/ui/WidgetContainer';

export function NewsFeedWidget({ symbol, isEditing, onRemove }: NewsFeedWidgetProps) {
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [sourceFilter, setSourceFilter] = useState<string>('');
    const [sentimentFilter, setSentimentFilter] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [bookmarkedIds, setBookmarkedIds] = useState<Set<number>>(new Set());

    // Fetch news feed with filters
    const { data, isLoading, refetch, isRefetching } = useQuery({
        queryKey: ['news-feed', symbol, sourceFilter, sentimentFilter],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (symbol) params.append('symbol', symbol);
            if (sourceFilter) params.append('source', sourceFilter);
            if (sentimentFilter) params.append('sentiment', sentimentFilter);
            params.append('limit', '30');

            const response = await fetch(`/api/v1/news/feed?${params}`);
            if (!response.ok) throw new Error('Failed to fetch news');
            return response.json();
        },
        refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
    });

    // Fetch market sentiment
    const { data: marketSentiment } = useQuery({
        queryKey: ['market-sentiment'],
        queryFn: async () => {
            const response = await fetch('/api/v1/news/sentiment');
            if (!response.ok) throw new Error('Failed to fetch sentiment');
            return response.json();
        },
        refetchInterval: 10 * 60 * 1000, // Refetch every 10 minutes
    });

    const newsItems: NewsArticle[] = data?.articles || [];

    // Filter by search query
    const filteredNews = newsItems.filter(item =>
        searchQuery === '' ||
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.summary?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Toggle bookmark
    const toggleBookmark = (id: number) => {
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

    return (
        <WidgetContainer
            title="Market News"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading || isRefetching}
            noPadding
        >
            <div className="h-full flex flex-col">
                {/* Header with Market Sentiment */}
                {!symbol && marketSentiment && (
                    <div className="px-3 py-2 m-2 bg-gray-800/30 rounded border border-gray-700/50">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-400">Market Sentiment:</span>
                                <SentimentBadge
                                    sentiment={marketSentiment.overall}
                                    score={Math.round(marketSentiment.bullish_percentage)}
                                />
                            </div>
                            <div className="text-[10px] text-gray-500">
                                {marketSentiment.total_articles} articles analyzed
                            </div>
                        </div>
                    </div>
                )}

                {/* Filters */}
                <div className="px-2 py-2 space-y-2 border-b border-gray-800">
                    {/* Search */}
                    <div className="relative">
                        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                            type="text"
                            placeholder="Search news..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-7 pr-2 py-1.5 text-xs bg-gray-800/50 border border-gray-700 rounded focus:outline-none focus:border-blue-500/50"
                        />
                    </div>

                    {/* Filter chips */}
                    <div className="flex items-center gap-2 flex-wrap text-left">
                        <Filter size={10} className="text-gray-500" />

                        {/* Sentiment filter */}
                        <select
                            value={sentimentFilter}
                            onChange={(e) => setSentimentFilter(e.target.value)}
                            className="text-[10px] px-2 py-1 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-blue-500/50"
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
                                className="text-[10px] px-2 py-1 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-blue-500/50"
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
                    {isLoading ? (
                        <div className="space-y-3 p-2 text-left">
                            {[...Array(5)].map((_, i) => (
                                <div key={i} className="animate-pulse">
                                    <div className="h-4 bg-gray-800 rounded w-3/4 mb-2" />
                                    <div className="h-3 bg-gray-800 rounded w-1/2 mb-1" />
                                    <div className="h-2 bg-gray-800 rounded w-1/4" />
                                </div>
                            ))}
                        </div>
                    ) : filteredNews.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                            <Newspaper size={24} className="mb-2 opacity-30" />
                            <p className="text-xs">
                                {searchQuery ? 'No matching news found' :
                                    symbol ? `No news available for ${symbol}` :
                                        'No news available'}
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-800/30 text-left">
                            {filteredNews.map((item) => (
                                <div
                                    key={item.id}
                                    className="group p-3 hover:bg-gray-800/30 cursor-pointer transition-colors"
                                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                                >
                                    {/* Header */}
                                    <div className="flex items-start gap-2">
                                        <div className="flex-1 min-w-0">
                                            {/* Title */}
                                            <h4 className={`text-sm text-gray-200 font-medium leading-tight mb-1 ${expandedId === item.id ? '' : 'line-clamp-2'
                                                }`}>
                                                {item.title}
                                            </h4>

                                            {/* Meta */}
                                            <div className="flex items-center gap-2 flex-wrap text-[10px] text-gray-500">
                                                {item.published_date && (
                                                    <span className="flex items-center gap-1">
                                                        <Clock size={10} />
                                                        {formatDateRelative(item.published_date)}
                                                    </span>
                                                )}
                                                {item.source && (
                                                    <span className="px-1.5 py-0.5 bg-gray-800 rounded">
                                                        {item.source}
                                                    </span>
                                                )}
                                                {item.sentiment && (
                                                    <SentimentBadge
                                                        sentiment={item.sentiment}
                                                        score={item.sentiment_score}
                                                    />
                                                )}
                                            </div>

                                            {/* Related symbols */}
                                            {item.related_symbols.length > 0 && (
                                                <div className="flex items-center gap-1 mt-1 flex-wrap">
                                                    {item.related_symbols.slice(0, 5).map(sym => (
                                                        <span
                                                            key={sym}
                                                            className="text-[9px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded border border-blue-500/30"
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
                                            className="p-1 text-gray-500 hover:text-yellow-400 transition-colors"
                                        >
                                            {bookmarkedIds.has(item.id) ? (
                                                <BookmarkCheck size={14} className="text-yellow-400" />
                                            ) : (
                                                <Bookmark size={14} />
                                            )}
                                        </button>
                                    </div>

                                    {/* Expanded Content */}
                                    {expandedId === item.id && (
                                        <div className="mt-3 space-y-2 border-t border-gray-800/50 pt-2">
                                            {/* AI Summary */}
                                            {item.ai_summary && (
                                                <div className="p-2 bg-blue-500/5 border border-blue-500/20 rounded">
                                                    <div className="text-[9px] text-blue-400 mb-1 font-medium">
                                                        AI SUMMARY
                                                    </div>
                                                    <p className="text-xs text-gray-300 leading-relaxed">
                                                        {item.ai_summary}
                                                    </p>
                                                </div>
                                            )}

                                            {/* Original summary */}
                                            {item.summary && !item.ai_summary && (
                                                <p className="text-xs text-gray-400 leading-relaxed">
                                                    {item.summary}
                                                </p>
                                            )}

                                            {/* Sectors */}
                                            {item.sectors.length > 0 && (
                                                <div className="flex items-center gap-1 flex-wrap">
                                                    <span className="text-[9px] text-gray-500">Sectors:</span>
                                                    {item.sectors.map(sector => (
                                                        <span
                                                            key={sector}
                                                            className="text-[9px] px-1.5 py-0.5 bg-purple-500/10 text-purple-400 rounded"
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
                                                    className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
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
                <div className="px-3 py-2 border-t border-gray-800 text-[10px] text-gray-500 text-left">
                    Showing {filteredNews.length} of {newsItems.length} articles
                </div>
            </div>
        </WidgetContainer>
    );
}

