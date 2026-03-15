// Insider Trading Widget - Recent insider buy/sell transactions

'use client';

import { useState } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getInsiderDeals, getInsiderSentiment } from '@/lib/api';
import { DEFAULT_TICKER } from '@/lib/defaultTicker';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

interface InsiderTradingWidgetProps {
  symbol?: string;
  isEditing?: boolean;
  onRemove?: () => void;
}

function formatCurrency(value: number | null | undefined): string {
  if (!value) return '-';
  if (value >= 1e9) return `VND${(value / 1e9).toFixed(1)}bn`;
  if (value >= 1e6) return `VND${(value / 1e6).toFixed(1)}mn`;
  if (value >= 1e3) return `VND${(value / 1e3).toFixed(1)}k`;
  return `VND${value}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('vi-VN');
}

function getSentimentColor(score: number): string {
  if (score > 30) return 'text-green-400';
  if (score < -30) return 'text-red-400';
  return 'text-[var(--text-secondary)]';
}

function getSentimentLabel(score: number): string {
  if (score > 50) return 'Very Bullish';
  if (score > 30) return 'Bullish';
  if (score > 10) return 'Slightly Bullish';
  if (score > -10) return 'Neutral';
  if (score > -30) return 'Slightly Bearish';
  if (score > -50) return 'Bearish';
  return 'Very Bearish';
}

export function InsiderTradingWidget({ symbol = DEFAULT_TICKER }: InsiderTradingWidgetProps) {
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell'>('all');

  const {
    data: dealsData,
    isLoading: dealsLoading,
    error: dealsError,
    refetch: refetchDeals,
    isFetching: dealsFetching,
    dataUpdatedAt: dealsUpdatedAt,
  } = useQuery({
    queryKey: ['insider-deals', symbol],
    queryFn: () => getInsiderDeals(symbol, { limit: 20 }),
    enabled: !!symbol,
  });

  const {
    data: sentimentData,
    isLoading: sentimentLoading,
    error: sentimentError,
    refetch: refetchSentiment,
    isFetching: sentimentFetching,
  } = useQuery({
    queryKey: ['insider-sentiment', symbol],
    queryFn: () => getInsiderSentiment(symbol, 90),
    enabled: !!symbol,
  });

  const deals = dealsData || [];
  const sentiment = sentimentData;

  const filteredDeals = deals.filter((deal) => {
    if (filter === 'all') return true;
    if (filter === 'buy') return deal.deal_action?.toLowerCase().includes('mua') || deal.deal_action?.toLowerCase().includes('buy');
    if (filter === 'sell') return deal.deal_action?.toLowerCase().includes('bán') || deal.deal_action?.toLowerCase().includes('sell');
    return true;
  });

  const isLoading = dealsLoading || sentimentLoading;
  const error = dealsError || sentimentError;
  const isFetching = dealsFetching || sentimentFetching;
  const hasData = deals.length > 0;
  const isFallback = Boolean(error && hasData);

  return (
    <div className="h-full flex flex-col">
      {/* Header with Sentiment */}
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2">
          {sentiment && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-[var(--text-muted)]">Sentiment:</span>
              <span className={`font-medium ${getSentimentColor(sentiment.sentiment_score)}`}>
                {sentiment.sentiment_score > 0 ? '+' : ''}{sentiment.sentiment_score.toFixed(0)}
              </span>
              <span className={`text-[10px] ${getSentimentColor(sentiment.sentiment_score)}`}>
                ({getSentimentLabel(sentiment.sentiment_score)})
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <WidgetMeta
            updatedAt={dealsUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note="90d sentiment"
            align="right"
          />
          <button
            onClick={() => {
              refetchDeals();
              refetchSentiment();
            }}
            disabled={isFetching}
            className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 mb-2 px-1">
        <button
          onClick={() => setFilter('all')}
          className={`flex-1 px-2 py-1 text-[10px] rounded transition-colors ${
            filter === 'all'
              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('buy')}
          className={`flex-1 px-2 py-1 text-[10px] rounded transition-colors ${
            filter === 'buy'
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setFilter('sell')}
          className={`flex-1 px-2 py-1 text-[10px] rounded transition-colors ${
            filter === 'sell'
              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          Sell
        </button>
      </div>

      {/* Deals List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && !hasData ? (
          <WidgetSkeleton lines={5} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => refetchDeals()} />
        ) : filteredDeals.length === 0 ? (
          <WidgetEmpty message="No insider trades found" icon={<AlertCircle size={18} />} />
        ) : (
          <div className="space-y-1.5">
            {filteredDeals.map((deal) => {
              const isBuy = deal.deal_action?.toLowerCase().includes('mua') || deal.deal_action?.toLowerCase().includes('buy');
              const ActionIcon = isBuy ? TrendingUp : TrendingDown;
              const actionColor = isBuy ? 'text-green-400' : 'text-red-400';

              return (
                <div
                  key={deal.id}
                  className="rounded bg-[var(--bg-secondary)] p-2 transition-colors hover:bg-[var(--bg-tertiary)]"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <ActionIcon size={12} className={actionColor} />
                      <span className="truncate text-xs text-[var(--text-primary)]" title={deal.insider_name || 'Unknown'}>
                        {deal.insider_name || 'Unknown'}
                      </span>
                    </div>
                    <span className={`text-xs font-medium ${actionColor}`}>
                      {formatCurrency(deal.deal_value)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                    <span className="truncate" title={deal.insider_position || ''}>
                      {deal.insider_position || 'N/A'}
                    </span>
                    <span>{formatDate(deal.announce_date)}</span>
                  </div>
                  {deal.deal_quantity && (
                    <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                      {deal.deal_quantity.toLocaleString()} shares @ {formatCurrency(deal.deal_price || 0)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Summary Footer */}
      {sentiment && !isLoading && (
        <div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">Buy:</span>
              <span className="text-green-400 font-medium">{formatCurrency(sentiment.buy_value)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">Sell:</span>
              <span className="text-red-400 font-medium">{formatCurrency(sentiment.sell_value)}</span>
            </div>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[var(--text-muted)]">Net:</span>
            <span className={`font-medium ${sentiment.net_value >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {sentiment.net_value >= 0 ? '+' : ''}{formatCurrency(sentiment.net_value)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
