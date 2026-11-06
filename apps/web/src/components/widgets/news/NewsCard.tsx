'use client';

import { memo } from 'react';
import { ExternalLink, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTimestamp } from '@/lib/formatDate';
import { normalizeNewsItemTimestamp } from '@/lib/newsTime';

interface NewsCardProps {
  news: {
    id: string;
    title: string;
    summary?: string;
    source: string;
    published_at?: string | null;
    published_date?: string | null;
    publishedDate?: string | null;
    created_at?: string | null;
    timestamp?: string | number | null;
    url: string;
    symbols: string[];
    sentiment: 'positive' | 'negative' | 'neutral' | 'bullish' | 'bearish';
    matched_symbols?: string[];
    relevance_score?: number | null;
    match_reason?: string | null;
    is_market_wide_fallback?: boolean;
  };
}

const SENTIMENT_CONFIG = {
  positive: { icon: TrendingUp, color: 'text-[var(--color-positive)]', bg: 'bg-[var(--color-positive-bg)]' },
  bullish: { icon: TrendingUp, color: 'text-[var(--color-positive)]', bg: 'bg-[var(--color-positive-bg)]' },
  negative: { icon: TrendingDown, color: 'text-[var(--color-negative)]', bg: 'bg-[var(--color-negative-bg)]' },
  bearish: { icon: TrendingDown, color: 'text-[var(--color-negative)]', bg: 'bg-[var(--color-negative-bg)]' },
  neutral: { icon: Minus, color: 'text-[var(--text-muted)]', bg: 'bg-[var(--bg-hover)]' },
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
      className="block p-3 hover:bg-[var(--bg-hover)] transition-colors group border-b border-[var(--border-color)] last:border-0"
    >
      <div className="flex gap-3">
        {/* Sentiment indicator */}
        <div className={cn("mt-1 p-1.5 rounded shrink-0", sentiment.bg)}>
          <SentimentIcon className={cn("w-4 h-4", sentiment.color)} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <h4 className="text-sm text-[var(--text-primary)] font-medium line-clamp-2 mb-1 group-hover:text-[var(--color-accent-secondary)] transition-colors leading-snug">
            {news.title}
          </h4>

          {((news.matched_symbols?.length ?? 0) > 0 || (news.relevance_score ?? 0) > 0) && (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {news.matched_symbols?.slice(0, 3).map((symbol) => (
                <span
                  key={`${news.id}-${symbol}`}
                  className="rounded border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--color-accent-secondary)]"
                >
                  {symbol}
                </span>
              ))}
              {typeof news.relevance_score === 'number' && !news.is_market_wide_fallback && (
                <span
                  className="rounded border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--color-accent-secondary)]"
                  title="Rule-based ranking score, not a probability of company relevance. Peer and sector matches are indirect."
                >
                  {news.match_reason?.replaceAll('_', ' ') || 'Association unverified'} · rank {Math.round(news.relevance_score * 100)}/100
                </span>
              )}
            </div>
          )}

          {/* Summary */}
          {news.summary && (
            <p className="text-xs text-[var(--text-muted)] line-clamp-2 mb-2 leading-relaxed">
              {news.summary}
            </p>
          )}

          {/* Meta */}
          <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-tighter">
            <span className="px-1.5 py-0.5 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-secondary)]">{news.source}</span>
            <span>•</span>
            <span className="flex items-center gap-1">
                {formatTimestamp(normalizeNewsItemTimestamp(news as unknown as Record<string, unknown>))}
            </span>
            
            {news.symbols && news.symbols.length > 0 && (
              <>
                <span>•</span>
                <div className="flex gap-1">
                  {news.symbols.slice(0, 3).map(s => (
                    <span key={s} className="px-1.5 py-0.5 bg-[var(--color-state-bg)] text-[var(--color-accent-secondary)] border border-[var(--color-state-border)] rounded">
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
