'use client';

import { memo } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Clock, Newspaper } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

function MarketNewsWidgetComponent() {
  const { data: news, isLoading } = useQuery({
    queryKey: ['market-news-global'],
    queryFn: async () => {
        const res = await fetch('/api/v1/news/feed?limit=20');
        if (!res.ok) throw new Error('Failed to fetch news');
        const data = await res.json();
        return data.articles;
    },
    refetchInterval: 60000,
  });

  return (
    <WidgetContainer 
      title="Global Market News"
      exportData={news}
      exportFilename="market_news"
      noPadding
    >
      <div className="h-full overflow-auto scrollbar-hide bg-black/20">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs">Streaming news...</span>
          </div>
        ) : !news || news.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
                <Newspaper size={32} opacity={0.2} />
                <span className="text-[10px] uppercase font-bold tracking-widest">No news available</span>
            </div>
        ) : (
          <div className="divide-y divide-gray-800/30">
            {news.map((item: any) => (
              <a
                key={item.id}
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
                  <span className="px-1.5 py-0.5 bg-gray-900 rounded border border-gray-800 uppercase font-bold text-[9px]">{item.source}</span>
                  <ExternalLink className="w-2.5 h-2.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </WidgetContainer>
  );
}

export const MarketNewsWidget = memo(MarketNewsWidgetComponent);
export default MarketNewsWidget;
