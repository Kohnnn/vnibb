'use client';

import { memo, useState, useEffect } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { API_BASE_URL } from '@/lib/api';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useInfiniteQuery } from '@tanstack/react-query';
import { NewsFilterBar } from './news/NewsFilterBar';
import { NewsCard } from './news/NewsCard';
import { Loader2, Newspaper } from 'lucide-react';

interface NewsFlowWidgetProps {
  id: string;
  symbol?: string;
  initialSymbols?: string[];
  onRemove?: () => void;
}

function NewsFlowWidgetComponent({ id, symbol, initialSymbols, onRemove }: NewsFlowWidgetProps) {
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
      return res.json();
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

  const allNews = data?.pages.flatMap((p: any) => p.items) || [];
  const hasData = allNews.length > 0;
  const isFallback = Boolean(error && hasData);

  return (
    <WidgetContainer
      title="News Flow"
      widgetId={id}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
    >
      <div className="h-full flex flex-col bg-black">
        <NewsFilterBar filters={filters} onFiltersChange={setFilters} />

        <div className="px-3 py-2 border-b border-gray-800/50 bg-[#0a0a0a]">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
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
            {allNews.map((item: any, index: number) => (
              <NewsCard key={`${item.id ?? item.url ?? item.title}-${index}`} news={item} />
            ))}

              {hasNextPage && (
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="w-full py-4 text-center text-[10px] font-black uppercase text-blue-500 hover:text-blue-400 hover:bg-white/5 transition-all"
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
                <div className="py-6 text-center text-[10px] font-bold text-gray-700 uppercase tracking-widest">
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
