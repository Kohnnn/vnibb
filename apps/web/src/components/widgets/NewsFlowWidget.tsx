'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { API_BASE_URL } from '@/lib/api';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { useInfiniteQuery } from '@tanstack/react-query';
import { newsObservationProvenance } from '@/lib/newsTime';
import { NewsFilterBar } from './news/NewsFilterBar';
import { NewsCard } from './news/NewsCard';
import { Loader2, Newspaper } from 'lucide-react';
interface NewsFlowWidgetProps {
  id: string;
  symbol?: string;
  initialSymbols?: string[];
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
}


/**
 * `/news/flow` envelope (`vnibb/services/news_service.py` `NewsResponse`). An
 * item is a `NewsItem`; the publication fields are optional, so the row type
 * mirrors exactly what `NewsCard` consumes.
 */
type NewsFlowItem = {
  id: string | number;
  published_at?: string | null;
  published_date?: string | null;
  pubDate?: string | null;
  title: string;
  summary?: string;
  source: string;
  url: string;
  symbols: string[];
  sentiment: 'positive' | 'negative' | 'neutral' | 'bullish' | 'bearish';
  matched_symbols?: string[];
  relevance_score?: number | null;
  is_market_wide_fallback?: boolean;
};
type NewsFlowPage = {
  items: NewsFlowItem[];
  has_more?: boolean;
};

/** Shape check for the `/news/flow` envelope before it reaches rendering. */
function isNewsFlowPage(payload: unknown): payload is NewsFlowPage {
  if (typeof payload !== 'object' || payload === null || !('items' in payload)) return false
  return Array.isArray(payload.items)
}


function NewsFlowWidgetComponent({ id, symbol, initialSymbols, onRemove, onDataChange }: NewsFlowWidgetProps) {
  const [filters, setFilters] = useState({
    symbols: initialSymbols || (symbol ? [symbol] : []),
    sentiment: null as string | null,
  });

  useEffect(() => {
    if (initialSymbols && initialSymbols.length > 0) return;
    if (!symbol) return;
    setFilters(prev => ({
      ...prev,
      symbols: [symbol],
    }));
  }, [symbol, initialSymbols]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useInfiniteQuery({
    queryKey: ['news-flow', filters],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams();
      if (filters.symbols.length) params.set('symbols', filters.symbols.join(','));
      if (filters.sentiment) params.set('sentiment', filters.sentiment);
      params.set('offset', String(pageParam));
      params.set('limit', '20');

      const res = await fetch(`${API_BASE_URL}/news/flow?${params.toString()}`);
      if (!res.ok) throw new Error('News flow failed');
      const payload: unknown = await res.json();
      if (!isNewsFlowPage(payload)) throw new Error('Unexpected /news/flow envelope');
      return payload;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.has_more) {
        return allPages.length * 20;
      }
      return undefined;
    },
    initialPageParam: 0,
    staleTime: 5 * 60 * 1000,
  });

  const allNews: NewsFlowItem[] = data?.pages.flatMap((p) => p.items) || [];
  const hasData = allNews.length > 0;
  const isFallback = Boolean(error && hasData);
  // `/news/flow` rows may lack a source publication date; the helper reports
  // those as unknown instead of borrowing the query receipt.
  const observation = useMemo(
    () => newsObservationProvenance(allNews, { receiptAt: dataUpdatedAt }),
    [allNews, dataUpdatedAt],
  );

  useEffect(() => {
    onDataChange?.(
      buildWidgetRuntime({
        empty: !hasData,
        apiGroup: '/news',
        endpoint: '/news/flow',
        sourceLabel: filters.symbols.length ? 'Ticker feed' : 'Market feed',
        lastDataDate: observation.lastDataDate,
        fetchedAt: dataUpdatedAt,
        coverage: observation.coverage,
        stale: isFallback,
        cached: isFallback,
        warnings: observation.warning ? [observation.warning] : undefined,
        extra: { count: allNews.length },
      }),
    );
  }, [
    onDataChange,
    hasData,
    dataUpdatedAt,
    isFallback,
    allNews.length,
    filters.symbols.length,
    observation.lastDataDate,
    observation.coverage,
    observation.warning,
  ]);

  return (
    <WidgetContainer
      title="News Flow"
      widgetId={id}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
    >
      <div aria-label="News flow stream" className="h-full flex flex-col bg-[var(--bg-primary)]">
        <NewsFilterBar filters={filters} onFiltersChange={setFilters} />

        <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]">
          <WidgetMeta
            updatedAt={observation.lastDataDate}
            fetchedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note={filters.symbols.length ? 'Ticker feed' : 'Market feed'}
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
              message="No news flow yet. Try refreshing or adjust filters."
              icon={<Newspaper size={18} />}
              action={{ label: 'Refresh', onClick: () => refetch() }}
            />
          ) : (
            <div className="flex flex-col">
            {allNews.map((item, index) => (
              <NewsCard key={`${item.id ?? item.url ?? item.title}-${index}`} news={{ ...item, id: String(item.id) }} />
            ))}

              {hasNextPage && (
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="w-full py-4 text-center text-[10px] font-black uppercase text-blue-500 hover:text-blue-400 hover:bg-[var(--bg-hover)] transition-all"
                >
                  {isFetchingNextPage ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Loading...</span>
                    </div>
                  ) : (
                    'Load More Articles'
                  )}
                </button>
              )}

              {!hasNextPage && allNews.length > 0 && (
                <div className="py-6 text-center text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">
                  End of Flow
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const NewsFlowWidget = memo(NewsFlowWidgetComponent);
export default NewsFlowWidget;
