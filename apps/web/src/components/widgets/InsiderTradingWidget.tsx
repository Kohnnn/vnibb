// Insider Trading Widget - Recent insider buy/sell transactions

'use client';

import { useState } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, User, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getInsiderDeals, getInsiderSentiment } from '@/lib/api';
import type { InsiderTrade, InsiderSentiment } from '@/types/insider';

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
  return 'text-zinc-400';
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

export function InsiderTradingWidget({ symbol = 'VNM' }: InsiderTradingWidgetProps) {
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell'>('all');

  const { data: dealsData, isLoading: dealsLoading, refetch: refetchDeals, isRefetching } = useQuery({
    queryKey: ['insider-deals', symbol],
    queryFn: () => getInsiderDeals(symbol, { limit: 20 }),
    enabled: !!symbol,
  });

  const { data: sentimentData, isLoading: sentimentLoading } = useQuery({
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

  return (
    <div className="h-full flex flex-col">
      {/* Header with Sentiment */}
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2">
          {sentiment && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-gray-500">Sentiment:</span>
              <span className={`font-medium ${getSentimentColor(sentiment.sentiment_score)}`}>
                {sentiment.sentiment_score > 0 ? '+' : ''}{sentiment.sentiment_score.toFixed(0)}
              </span>
              <span className={`text-[10px] ${getSentimentColor(sentiment.sentiment_score)}`}>
                ({getSentimentLabel(sentiment.sentiment_score)})
              </span>
            </div>
          )}
        </div>
        <button
          onClick={() => refetchDeals()}
          disabled={isRefetching}
          className="p-1 text-gray-500 hover:text-white hover:bg-gray-800 rounded transition-colors"
        >
          <RefreshCw size={12} className={isRefetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 mb-2 px-1">
        <button
          onClick={() => setFilter('all')}
          className={`flex-1 px-2 py-1 text-[10px] rounded transition-colors ${
            filter === 'all'
              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('buy')}
          className={`flex-1 px-2 py-1 text-[10px] rounded transition-colors ${
            filter === 'buy'
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setFilter('sell')}
          className={`flex-1 px-2 py-1 text-[10px] rounded transition-colors ${
            filter === 'sell'
              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
              : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800'
          }`}
        >
          Sell
        </button>
      </div>

      {/* Deals List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse p-2 bg-gray-800/30 rounded">
                <div className="h-3 bg-gray-800 rounded w-3/4 mb-1" />
                <div className="h-2 bg-gray-800 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : filteredDeals.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <AlertCircle size={24} className="mb-2 opacity-30" />
            <p className="text-xs">No insider trades found</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredDeals.map((deal) => {
              const isBuy = deal.deal_action?.toLowerCase().includes('mua') || deal.deal_action?.toLowerCase().includes('buy');
              const ActionIcon = isBuy ? TrendingUp : TrendingDown;
              const actionColor = isBuy ? 'text-green-400' : 'text-red-400';

              return (
                <div
                  key={deal.id}
                  className="p-2 bg-gray-800/30 rounded hover:bg-gray-800/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <ActionIcon size={12} className={actionColor} />
                      <span className="text-xs text-gray-200 truncate" title={deal.insider_name || 'Unknown'}>
                        {deal.insider_name || 'Unknown'}
                      </span>
                    </div>
                    <span className={`text-xs font-medium ${actionColor}`}>
                      {formatCurrency(deal.deal_value)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-500">
                    <span className="truncate" title={deal.insider_position || ''}>
                      {deal.insider_position || 'N/A'}
                    </span>
                    <span>{formatDate(deal.announce_date)}</span>
                  </div>
                  {deal.deal_quantity && (
                    <div className="text-[10px] text-gray-500 mt-0.5">
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
        <div className="mt-2 pt-2 border-t border-gray-800">
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Buy:</span>
              <span className="text-green-400 font-medium">{formatCurrency(sentiment.buy_value)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Sell:</span>
              <span className="text-red-400 font-medium">{formatCurrency(sentiment.sell_value)}</span>
            </div>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-gray-500">Net:</span>
            <span className={`font-medium ${sentiment.net_value >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {sentiment.net_value >= 0 ? '+' : ''}{formatCurrency(sentiment.net_value)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
