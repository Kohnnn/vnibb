'use client';

import { Activity, Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { useTrendingAnalysis, useMarketSentiment } from '@/lib/queries';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';

interface MarketSentimentWidgetProps {
  id: string;
  onRemove?: () => void;
}

const sentimentConfig = {
  bullish: {
    icon: TrendingUp,
    color: 'text-green-400',
    bg: 'bg-green-500/20',
    border: 'border-green-500/40',
  },
  neutral: {
    icon: Minus,
    color: 'text-[var(--text-secondary)]',
    bg: 'bg-[var(--bg-tertiary)]',
    border: 'border-[var(--border-subtle)]',
  },
  bearish: {
    icon: TrendingDown,
    color: 'text-red-400',
    bg: 'bg-red-500/20',
    border: 'border-red-500/40',
  },
} as const;

function sentimentLabel(value: string | null | undefined) {
  return String(value || 'neutral').toLowerCase();
}

export function MarketSentimentWidget({ id, onRemove }: MarketSentimentWidgetProps) {
  const { setLinkedSymbol } = useWidgetSymbolLink(undefined, { widgetType: 'market_sentiment' });
  const sentimentQuery = useMarketSentiment();
  const trendingQuery = useTrendingAnalysis();

  const sentiment = sentimentQuery.data;
  const trending = trendingQuery.data;
  const isLoading = (sentimentQuery.isLoading || trendingQuery.isLoading) && !sentiment;
  const error = sentimentQuery.error || trendingQuery.error;
  const hasData = Boolean(sentiment && sentiment.total_articles > 0);
  const updatedAt = Math.max(sentimentQuery.dataUpdatedAt, trendingQuery.dataUpdatedAt);

  if (isLoading) {
    return <WidgetSkeleton lines={6} />;
  }

  if (error && !hasData) {
    return <WidgetError error={error as Error} onRetry={() => {
      void sentimentQuery.refetch();
      void trendingQuery.refetch();
    }} />;
  }

  if (!sentiment || sentiment.total_articles === 0) {
    return <WidgetEmpty message="No market sentiment data available yet" icon={<Activity size={18} />} />;
  }

  const normalizedOverall = sentimentLabel(sentiment.overall);
  const config = sentimentConfig[normalizedOverall as keyof typeof sentimentConfig] || sentimentConfig.neutral;
  const Icon = config.icon;
  const neutralPercentage = Math.max(0, 100 - sentiment.bullish_percentage - sentiment.bearish_percentage);

  return (
    <WidgetContainer
      title="Market Sentiment"
      subtitle="News-driven pulse and discovery cues"
      widgetId={id}
      onClose={onRemove}
      onRefresh={() => {
        void sentimentQuery.refetch();
        void trendingQuery.refetch();
      }}
      noPadding
      exportData={{ sentiment, trending }}
      exportFilename="market_sentiment"
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${config.bg} ${config.border}`}>
            <Icon size={20} className={config.color} />
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Overall Mood</div>
              <div className={`text-lg font-semibold capitalize ${config.color}`}>{normalizedOverall}</div>
            </div>
          </div>
          <WidgetMeta updatedAt={updatedAt} isFetching={(sentimentQuery.isFetching || trendingQuery.isFetching) && hasData} note={`${sentiment.total_articles} articles`} align="right" />
        </div>

        <div className="mb-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
            <span>Sentiment Distribution</span>
            <span>{sentiment.trend_direction}</span>
          </div>
          <div className="flex h-8 overflow-hidden rounded border border-[var(--border-subtle)]">
            <div className="flex items-center justify-center bg-green-500/80 text-xs font-medium text-white" style={{ width: `${sentiment.bullish_percentage}%` }}>
              {sentiment.bullish_percentage > 15 ? `${sentiment.bullish_percentage.toFixed(0)}%` : ''}
            </div>
            <div className="flex items-center justify-center bg-[var(--bg-tertiary)] text-xs font-medium text-[var(--text-primary)]" style={{ width: `${neutralPercentage}%` }}>
              {neutralPercentage > 15 ? `${neutralPercentage.toFixed(0)}%` : ''}
            </div>
            <div className="flex items-center justify-center bg-red-500/80 text-xs font-medium text-white" style={{ width: `${sentiment.bearish_percentage}%` }}>
              {sentiment.bearish_percentage > 15 ? `${sentiment.bearish_percentage.toFixed(0)}%` : ''}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-2">
            <div className="text-[10px] uppercase tracking-widest text-green-300">Bullish</div>
            <div className="mt-1 text-lg font-bold text-green-300">{sentiment.bullish_count}</div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2">
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">Neutral</div>
            <div className="mt-1 text-lg font-bold text-[var(--text-primary)]">{sentiment.neutral_count}</div>
          </div>
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-2">
            <div className="text-[10px] uppercase tracking-widest text-red-300">Bearish</div>
            <div className="mt-1 text-lg font-bold text-red-300">{sentiment.bearish_count}</div>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Trending Topics</div>
            <div className="flex flex-wrap gap-2">
              {(trending?.topics || []).slice(0, 8).map((topic) => (
                <span key={topic} className="rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)]">
                  {topic}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Most Mentioned Stocks</div>
            {(trending?.stocks_mentioned || []).slice(0, 8).length === 0 ? (
              <WidgetEmpty message="No stock mentions extracted" size="compact" />
            ) : (
              <div className="flex flex-wrap gap-2">
                {(trending?.stocks_mentioned || []).slice(0, 8).map((ticker) => (
                  <button
                    key={ticker}
                    type="button"
                    onClick={() => setLinkedSymbol(ticker)}
                    className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold text-blue-200 transition-colors hover:bg-blue-500/20"
                  >
                    {ticker}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </WidgetContainer>
  );
}

export default MarketSentimentWidget;
