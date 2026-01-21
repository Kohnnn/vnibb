'use client';

import { memo, useState, useEffect } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { useInfiniteQuery } from '@tanstack/react-query';
import { NewsFilterBar } from './news/NewsFilterBar';
import { NewsCard } from './news/NewsCard';
import { Loader2, RefreshCw, Newspaper } from 'lucide-react';
import { useLinkedSymbol } from '@/hooks/useLinkedSymbol';

interface NewsFlowWidgetProps {
  id: string;
  symbol?: string;
  initialSymbols?: string[];
  onRemove?: () => void;
}

function NewsFlowWidgetComponent({ id, symbol: linkedSymbol, initialSymbols, onRemove }: NewsFlowWidgetProps) {
  const { symbol, isLinked } = useLinkedSymbol({
    widgetId: id,
    defaultSymbol: linkedSymbol || 'VNM',
  });

  const [filters, setFilters] = useState({
    symbols: initialSymbols || [],
    sentiment: null as string | null,
  });

  // Sync symbols filter with linked symbol
  useEffect(() => {
    if (isLinked && symbol) {
      setFilters(prev => ({
        ...prev,
        symbols: [symbol]
      }));
    }
  }, [isLinked, symbol]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
    isRefetching
  } = useInfiniteQuery({
    queryKey: ['news-flow', filters],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams();
      if (filters.symbols.length) params.set('symbols', filters.symbols.join(','));
      if (filters.sentiment) params.set('sentiment', filters.sentiment);
      params.set('offset', String(pageParam));
      params.set('limit', '20');
      
      const res = await fetch(`/api/v1/news/flow?${params.toString()}`);
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

  const allNews = data?.pages.flatMap(p => p.items) || [];

  return (
    <WidgetContainer 
      title="News Flow"
      widgetId={id}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading || isRefetching}
      showLinkToggle
      noPadding
    >
      <div className="h-full flex flex-col bg-black">
        {/* Filter Bar */}
        <NewsFilterBar filters={filters} onFiltersChange={setFilters} />

        {/* News List */}
        <div className="flex-1 overflow-auto scrollbar-hide">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
                <RefreshCw size={24} className="animate-spin" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Streaming News...</span>
            </div>
          ) : allNews.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2 opacity-50 uppercase font-black text-[10px] tracking-widest">
                <Newspaper size={32} strokeWidth={1} />
                No news found
            </div>
          ) : (
            <div className="flex flex-col">
              {allNews.map((item: any) => (
                <NewsCard key={item.id} news={item} />
              ))}
              
              {/* Load More */}
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
                  ) : 'Load More Articles'}
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
