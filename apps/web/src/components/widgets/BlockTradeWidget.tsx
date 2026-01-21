// Block Trade Widget - Large trade detection and monitoring

'use client';

import { useState } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, AlertTriangle, Globe, Building2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getBlockTrades } from '@/lib/api';
import type { BlockTrade } from '@/types/insider';

interface BlockTradeWidgetProps {
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

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return date.toLocaleDateString('vi-VN');
}

function formatQuantity(qty: number): string {
  if (qty >= 1e6) return `${(qty / 1e6).toFixed(2)}M`;
  if (qty >= 1e3) return `${(qty / 1e3).toFixed(1)}K`;
  return qty.toLocaleString();
}

export function BlockTradeWidget({ symbol }: BlockTradeWidgetProps) {
  const [minThreshold, setMinThreshold] = useState<number>(10); // VND billions

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['block-trades', symbol],
    queryFn: () => getBlockTrades({ symbol, limit: 50 }),
    refetchInterval: 60000, // Refresh every minute
  });

  const trades = data || [];

  // Filter by threshold
  const filteredTrades = trades.filter((trade) => {
    const valueInBillions = (trade.value || 0) / 1e9;
    return valueInBillions >= minThreshold;
  });

  // Calculate stats
  const totalBuyValue = filteredTrades
    .filter((t) => t.side === 'BUY')
    .reduce((sum, t) => sum + (t.value || 0), 0);
  const totalSellValue = filteredTrades
    .filter((t) => t.side === 'SELL')
    .reduce((sum, t) => sum + (t.value || 0), 0);
  const netValue = totalBuyValue - totalSellValue;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs">
          <AlertTriangle size={12} className="text-yellow-400" />
          <span className="text-gray-500">{filteredTrades.length} block trades</span>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="p-1 text-gray-500 hover:text-white hover:bg-gray-800 rounded transition-colors"
        >
          <RefreshCw size={12} className={isRefetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Threshold Selector */}
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-[10px] text-gray-500">Min:</span>
        <select
          value={minThreshold}
          onChange={(e) => setMinThreshold(Number(e.target.value))}
          className="flex-1 px-2 py-1 text-[10px] bg-gray-800 text-gray-200 rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
        >
          <option value={5}>VND 5bn+</option>
          <option value={10}>VND 10bn+</option>
          <option value={20}>VND 20bn+</option>
          <option value={50}>VND 50bn+</option>
          <option value={100}>VND 100bn+</option>
        </select>
      </div>

      {/* Net Flow Summary */}
      {!isLoading && filteredTrades.length > 0 && (
        <div className="mb-2 p-2 bg-gray-800/30 rounded">
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <div>
              <div className="text-gray-500 mb-0.5">Buy</div>
              <div className="text-green-400 font-medium">{formatCurrency(totalBuyValue)}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-0.5">Sell</div>
              <div className="text-red-400 font-medium">{formatCurrency(totalSellValue)}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-0.5">Net</div>
              <div className={`font-medium ${netValue >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {netValue >= 0 ? '+' : ''}{formatCurrency(Math.abs(netValue))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trades List */}
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
        ) : filteredTrades.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <AlertTriangle size={24} className="mb-2 opacity-30" />
            <p className="text-xs">No block trades found</p>
            <p className="text-[10px] mt-1">Try lowering the threshold</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredTrades.map((trade) => {
              const isBuy = trade.side === 'BUY';
              const SideIcon = isBuy ? TrendingUp : TrendingDown;
              const sideColor = isBuy ? 'text-green-400' : 'text-red-400';
              const bgColor = isBuy ? 'bg-green-500/5' : 'bg-red-500/5';

              return (
                <div
                  key={trade.id}
                  className={`p-2 ${bgColor} rounded hover:bg-gray-800/50 transition-colors border border-gray-800`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5">
                      <SideIcon size={12} className={sideColor} />
                      <span className="text-xs font-medium text-gray-200">{trade.symbol}</span>
                      {trade.is_foreign && (
                        <Globe size={10} className="text-blue-400" />
                      )}
                      {trade.is_proprietary && (
                        <Building2 size={10} className="text-purple-400" />
                      )}
                    </div>
                    <span className={`text-xs font-medium ${sideColor}`}>
                      {formatCurrency(trade.value)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-500">
                    <span>
                      {formatQuantity(trade.quantity)} @ {formatCurrency(trade.price)}
                    </span>
                    <span>{formatTime(trade.trade_time)}</span>
                  </div>
                  {trade.volume_ratio !== null && trade.volume_ratio > 1 && (
                    <div className="mt-1 text-[10px] text-yellow-400">
                      {trade.volume_ratio.toFixed(1)}x avg volume
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-2 pt-2 border-t border-gray-800">
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <div className="flex items-center gap-1">
            <Globe size={10} className="text-blue-400" />
            <span>Foreign</span>
          </div>
          <div className="flex items-center gap-1">
            <Building2 size={10} className="text-purple-400" />
            <span>Proprietary</span>
          </div>
        </div>
      </div>
    </div>
  );
}
