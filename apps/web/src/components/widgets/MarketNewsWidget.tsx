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
      return data.articles;
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
      <div className="h-full flex flex-col bg-black/20">
        <div className="px-3 py-2 border-b border-gray-800/40">
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
            <div className="divide-y divide-gray-800/30">
              {news.map((item: any, index: number) => (
                <a
                  key={`${item.id ?? item.url ?? item.title}-${index}`}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-3 hover:bg-white/5 transition-colors group"
                >
                  <div className="text-sm text-gray-200 font-medium line-clamp-2 mb-1 group-hover:text-blue-400 transition-colors">
                    {item.title}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-500">
                    <div className="flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {formatDistanceToNow(new Date(item.published_date), { addSuffix: true })}
                    </div>
                    <span className="text-gray-700">•</span>
                    <span className="px-1.5 py-0.5 bg-gray-900 rounded border border-gray-800 uppercase font-bold text-[9px]">
                      {item.source}
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
