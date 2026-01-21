'use client';

import { memo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ExternalLink, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NewsCardProps {
  news: {
    id: string;
    title: string;
    summary?: string;
    source: string;
    published_at: string;
    url: string;
    symbols: string[];
    sentiment: 'positive' | 'negative' | 'neutral' | 'bullish' | 'bearish';
  };
}

const SENTIMENT_CONFIG = {
  positive: { icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/10' },
  bullish: { icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/10' },
  negative: { icon: TrendingDown, color: 'text-red-400', bg: 'bg-red-500/10' },
  bearish: { icon: TrendingDown, color: 'text-red-400', bg: 'bg-red-500/10' },
  neutral: { icon: Minus, color: 'text-gray-400', bg: 'bg-gray-500/10' },
};

function NewsCardComponent({ news }: NewsCardProps) {
  const sentimentKey = (news.sentiment || 'neutral').toLowerCase() as keyof typeof SENTIMENT_CONFIG;
  const sentiment = SENTIMENT_CONFIG[sentimentKey] || SENTIMENT_CONFIG.neutral;
  const SentimentIcon = sentiment.icon;

  return (
    <a
      href={news.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-3 hover:bg-white/5 transition-colors group border-b border-gray-800/30 last:border-0"
    >
      <div className="flex gap-3">
        {/* Sentiment indicator */}
        <div className={cn("mt-1 p-1.5 rounded shrink-0", sentiment.bg)}>
          <SentimentIcon className={cn("w-4 h-4", sentiment.color)} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <h4 className="text-sm text-gray-100 font-medium line-clamp-2 mb-1 group-hover:text-blue-400 transition-colors leading-snug">
            {news.title}
          </h4>

          {/* Summary */}
          {news.summary && (
            <p className="text-xs text-gray-500 line-clamp-2 mb-2 leading-relaxed">
              {news.summary}
            </p>
          )}

          {/* Meta */}
          <div className="flex items-center gap-2 text-[10px] text-gray-500 font-bold uppercase tracking-tighter">
            <span className="px-1.5 py-0.5 bg-gray-900 border border-gray-800 rounded">{news.source}</span>
            <span>•</span>
            <span className="flex items-center gap-1">
                {formatDistanceToNow(new Date(news.published_at), { addSuffix: true })}
            </span>
            
            {news.symbols && news.symbols.length > 0 && (
              <>
                <span>•</span>
                <div className="flex gap-1">
                  {news.symbols.slice(0, 3).map(s => (
                    <span key={s} className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded">
                      {s}
                    </span>
                  ))}
                </div>
              </>
            )}

            <ExternalLink className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      </div>
    </a>
  );
}

export const NewsCard = memo(NewsCardComponent);
export default NewsCard;
