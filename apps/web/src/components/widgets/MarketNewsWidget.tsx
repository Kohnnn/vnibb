'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Clock, Newspaper } from 'lucide-react';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { API_BASE_URL } from '@/lib/api';
import { formatTimestamp } from '@/lib/format';

function decodeHtml(value: string | null | undefined): string {
  if (!value) return '';

  if (typeof document === 'undefined') {
    return value
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
  }

  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function cleanText(value: string | null | undefined): string {
  return decodeHtml(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPublishedTime(value: string | null | undefined): string {
  const formatted = formatTimestamp(value);
  return formatted === '-' ? 'Unknown time' : formatted;
}

function renderHighlightedText(text: string, tokens: string[]) {
  if (!text || tokens.length === 0) return text;

  const escapedTokens = tokens
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (!escapedTokens.length) return text;

  const regex = new RegExp(`(${escapedTokens.join('|')})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, index) =>
    escapedTokens.some((token) => new RegExp(`^${token}$`, 'i').test(part)) ? (
      <mark key={`${part}-${index}`} className="rounded bg-amber-400/20 px-0.5 text-amber-100">
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    )
  );
}

interface MarketNewsArticle {
  id?: number | string | null;
  title: string;
  summary: string;
  source: string;
  publishedDate: string | null;
  url: string | null;
  matchedSymbols: string[];
  relevanceScore: number | null;
  isMarketWideFallback: boolean;
}

interface MarketNewsFeed {
  articles: MarketNewsArticle[];
  fallbackUsed: boolean;
  mode: 'all' | 'related';
}

function MarketNewsWidgetComponent({ symbol }: { symbol?: string }) {
  const upperSymbol = symbol?.toUpperCase() || '';
  const [mode, setMode] = useState<'all' | 'related'>(upperSymbol ? 'related' : 'all');

  useEffect(() => {
    setMode(upperSymbol ? 'related' : 'all');
  }, [upperSymbol]);

  const {
    data: news,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['market-news-global', upperSymbol, mode],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '20', mode });
      if (upperSymbol) {
        params.set('symbol', upperSymbol);
      }

      const res = await fetch(`${API_BASE_URL}/news/feed?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch news');
      const data = await res.json();
      const rawItems = Array.isArray(data?.articles)
        ? data.articles
        : Array.isArray(data?.data)
          ? data.data
          : [];

      return {
        articles: rawItems.map((item: any) => ({
          ...item,
          title: cleanText(item.title || ''),
          summary: cleanText(item.summary || item.description || ''),
          source: cleanText(item.source || 'Unknown'),
          publishedDate: item.published_date || item.published_at || item.date || null,
          url: item.url || item.link || null,
          matchedSymbols: Array.isArray(item.matched_symbols)
            ? item.matched_symbols.map((value: string) => String(value).toUpperCase())
            : [],
          relevanceScore: typeof item.relevance_score === 'number' ? item.relevance_score : null,
          isMarketWideFallback: Boolean(item.is_market_wide_fallback),
        })),
        fallbackUsed: Boolean(data?.fallback_used),
        mode: (data?.mode || mode) as 'all' | 'related',
      } satisfies MarketNewsFeed;
    },
    refetchInterval: 60000,
  });

  const articles = news?.articles || [];
  const hasData = articles.length > 0;
  const isFallback = Boolean(error && hasData);
  const feedNote = news?.fallbackUsed
    ? 'Market-wide fallback'
    : mode === 'related' && upperSymbol
      ? `Related to ${upperSymbol}`
      : 'Global feed';

  const exportRows = useMemo(
    () => articles.map((item: MarketNewsArticle) => ({ ...item, matchedSymbols: item.matchedSymbols.join(', ') })),
    [articles]
  );

  return (
    <WidgetContainer
      title="Global Market News"
      exportData={exportRows}
      exportFilename="market_news"
      onRefresh={() => refetch()}
      isLoading={isLoading && !hasData}
      noPadding
    >
      <div className="h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="flex rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5">
            <button
              type="button"
              onClick={() => setMode('all')}
              className={`rounded px-2 py-1 text-[10px] font-bold uppercase transition-colors ${
                mode === 'all'
                  ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              All News
            </button>
            <button
              type="button"
              onClick={() => upperSymbol && setMode('related')}
              disabled={!upperSymbol}
              className={`rounded px-2 py-1 text-[10px] font-bold uppercase transition-colors ${
                mode === 'related'
                  ? 'bg-blue-500/20 text-blue-200'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40'
              }`}
            >
              {upperSymbol ? `Related to ${upperSymbol}` : 'Related'}
            </button>
          </div>
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note={feedNote}
            align="right"
          />
        </div>
        <div className="flex-1 overflow-auto scrollbar-hide">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={6} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty
              message="No market news yet. Try refreshing or check back later."
              icon={<Newspaper size={18} />}
              action={{ label: 'Refresh', onClick: () => refetch() }}
            />
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {articles.map((item: MarketNewsArticle, index: number) => {
                const highlightTokens = Array.from(new Set([upperSymbol, ...item.matchedSymbols].filter(Boolean)));

                return (
                <a
                  key={`${item.id ?? item.url ?? item.title}-${index}`}
                  href={item.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-3 hover:bg-[var(--bg-tertiary)]/30 transition-colors group"
                >
                  <div className="mb-1 flex flex-wrap items-start gap-1.5">
                    <div className="text-sm text-[var(--text-primary)] font-medium line-clamp-2 group-hover:text-blue-400 transition-colors">
                      {item.title}
                    </div>
                    {item.matchedSymbols.slice(0, 3).map((matchedSymbol: string) => (
                      <span
                        key={`${item.id ?? item.title}-${matchedSymbol}`}
                        className="rounded border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-300"
                      >
                        {matchedSymbol}
                      </span>
                    ))}
                    {item.relevanceScore !== null && mode === 'related' && !item.isMarketWideFallback && (
                      <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300">
                        {(item.relevanceScore * 100).toFixed(0)}% match
                      </span>
                    )}
                    {item.isMarketWideFallback && (
                      <span className="rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-200">
                        Market-wide
                      </span>
                    )}
                  </div>
                  {item.summary && (
                    <div className="text-[11px] text-[var(--text-secondary)] line-clamp-2 mb-1.5">
                      {renderHighlightedText(item.summary, highlightTokens)}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                    <div className="flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {formatPublishedTime(item.publishedDate)}
                    </div>
                    <span className="text-[var(--text-muted)]/60">•</span>
                    <span className="px-1.5 py-0.5 bg-[var(--bg-secondary)] rounded border border-[var(--border-color)] uppercase font-bold text-[9px]">
                      {item.source || 'Unknown'}
                    </span>
                    <ExternalLink className="w-2.5 h-2.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </a>
                )})}
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const MarketNewsWidget = memo(MarketNewsWidgetComponent);
export default MarketNewsWidget;
