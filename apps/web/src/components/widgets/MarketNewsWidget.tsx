'use client';

import { memo } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Clock, Newspaper } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { API_BASE_URL } from '@/lib/api';

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

function parseNewsDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const normalized = value.replace(/\//g, '-');
    const fallback = new Date(normalized);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  return parsed;
}

function formatPublishedDistance(value: string | null | undefined): string {
  const parsed = parseNewsDate(value);
  if (!parsed) return 'Unknown time';
  return formatDistanceToNow(parsed, { addSuffix: true });
}

function MarketNewsWidgetComponent() {
  const {
    data: news,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['market-news-global'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/news/feed?limit=20`);
      if (!res.ok) throw new Error('Failed to fetch news');
      const data = await res.json();
      const rawItems = Array.isArray(data?.articles)
        ? data.articles
        : Array.isArray(data?.data)
          ? data.data
          : [];

      return rawItems.map((item: any) => ({
        ...item,
        title: cleanText(item.title || ''),
        summary: cleanText(item.summary || item.description || ''),
        source: cleanText(item.source || 'Unknown'),
        publishedDate: item.published_date || item.published_at || item.date || null,
        url: item.url || item.link || null,
      }));
    },
    refetchInterval: 60000,
  });

  const hasData = Boolean(news && news.length > 0);
  const isFallback = Boolean(error && hasData);

  return (
    <WidgetContainer
      title="Global Market News"
      exportData={news}
      exportFilename="market_news"
      onRefresh={() => refetch()}
      isLoading={isLoading && !hasData}
      noPadding
    >
      <div className="h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note="Global feed"
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
              {news.map((item: any, index: number) => (
                <a
                  key={`${item.id ?? item.url ?? item.title}-${index}`}
                  href={item.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-3 hover:bg-[var(--bg-tertiary)]/30 transition-colors group"
                >
                  <div className="text-sm text-[var(--text-primary)] font-medium line-clamp-2 mb-1 group-hover:text-blue-400 transition-colors">
                    {item.title}
                  </div>
                  {item.summary && (
                    <div className="text-[11px] text-[var(--text-secondary)] line-clamp-2 mb-1.5">
                      {item.summary}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                    <div className="flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {formatPublishedDistance(item.publishedDate)}
                    </div>
                    <span className="text-[var(--text-muted)]/60">•</span>
                    <span className="px-1.5 py-0.5 bg-[var(--bg-secondary)] rounded border border-[var(--border-color)] uppercase font-bold text-[9px]">
                      {item.source || 'Unknown'}
                    </span>
                    <ExternalLink className="w-2.5 h-2.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const MarketNewsWidget = memo(MarketNewsWidgetComponent);
export default MarketNewsWidget;
