// Block Trade Widget - Large trade detection and monitoring

'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, AlertTriangle, Globe, Building2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getBlockTrades } from '@/lib/api';
import { formatTimestamp } from '@/lib/format';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

interface BlockTradeWidgetProps {
  symbol?: string;
  isEditing?: boolean;
  onRemove?: () => void;
  onDataChange?: (data: unknown) => void;
}

function formatCurrency(value: number | null | undefined): string {
  if (!value) return '-';
  if (value >= 1e9) return `VND${(value / 1e9).toFixed(1)}bn`;
  if (value >= 1e6) return `VND${(value / 1e6).toFixed(1)}mn`;
  if (value >= 1e3) return `VND${(value / 1e3).toFixed(1)}k`;
  return `VND${value}`;
}

function formatTime(dateStr: string): string {
  return formatTimestamp(dateStr);
}

function formatQuantity(qty: number): string {
  if (qty >= 1e6) return `${(qty / 1e6).toFixed(2)}M`;
  if (qty >= 1e3) return `${(qty / 1e3).toFixed(1)}K`;
  return qty.toLocaleString();
}

export function BlockTradeWidget({ symbol, onDataChange }: BlockTradeWidgetProps) {
  const [minThreshold, setMinThreshold] = useState<number>(10); // VND billions

  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['block-trades', symbol],
    queryFn: () => getBlockTrades({ symbol, limit: 50 }),
    refetchInterval: 60000, // Refresh every minute
  });

  const trades = data || [];
  const hasData = trades.length > 0;
  const isMissingData = trades.length === 0;
  const isFallback = Boolean(error && hasData);

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

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: {
          empty: filteredTrades.length === 0,
          compactHeight: 4,
        },
      },
    });
  }, [filteredTrades.length, onDataChange]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs">
          <AlertTriangle size={12} className="text-yellow-400" />
          <span className="text-[var(--text-muted)]">{filteredTrades.length} block trades</span>
        </div>
        <div className="flex items-center gap-2">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note="Large trades"
            align="right"
          />
          <button
            onClick={() => refetch()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                refetch();
              }
            }}
            disabled={isFetching}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
            aria-label="Refresh block trades"
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Threshold Selector */}
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-[10px] text-[var(--text-muted)]">Min:</span>
        <select
          value={minThreshold}
          onChange={(e) => setMinThreshold(Number(e.target.value))}
          className="flex-1 px-2 py-1 text-[10px] bg-[var(--bg-secondary)] text-[var(--text-secondary)] rounded border border-[var(--border-color)] focus:border-blue-500 focus:outline-none"
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
        <div className="mb-2 p-2 bg-[var(--bg-secondary)] rounded border border-[var(--border-color)]">
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <div>
              <div className="text-[var(--text-muted)] mb-0.5">Buy</div>
              <div className="text-green-400 font-medium">{formatCurrency(totalBuyValue)}</div>
            </div>
            <div>
              <div className="text-[var(--text-muted)] mb-0.5">Sell</div>
              <div className="text-red-400 font-medium">{formatCurrency(totalSellValue)}</div>
            </div>
            <div>
              <div className="text-[var(--text-muted)] mb-0.5">Net</div>
              <div className={`font-medium ${netValue >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {netValue >= 0 ? '+' : ''}{formatCurrency(Math.abs(netValue))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trades List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && !hasData ? (
          <WidgetSkeleton lines={5} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => refetch()} />
        ) : filteredTrades.length === 0 ? (
          <WidgetEmpty
            message={isMissingData ? 'Block trade data not available yet' : 'No block trades match your filter'}
            icon={<AlertTriangle size={18} />}
            detail={isMissingData ? 'Large negotiated prints show up here when the provider publishes them.' : undefined}
            size="compact"
            action={!isMissingData ? { label: 'Lower threshold', onClick: () => setMinThreshold(5) } : undefined}
          />
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
                  className={`p-2 ${bgColor} rounded hover:bg-[var(--bg-hover)] transition-colors border border-[var(--border-color)]`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5">
                      <SideIcon size={12} className={sideColor} />
                      <span className="text-xs font-medium text-[var(--text-primary)]">{trade.symbol}</span>
                      {trade.is_foreign && (
                        <Globe size={10} className="text-blue-400" />
                      )}
                      {trade.is_proprietary && (
                        <Building2 size={10} className="text-cyan-400" />
                      )}
                    </div>
                    <span className={`text-xs font-medium ${sideColor}`}>
                      {formatCurrency(trade.value)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
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
      {filteredTrades.length > 0 ? (
        <div className="mt-2 pt-2 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
            <div className="flex items-center gap-1">
              <Globe size={10} className="text-blue-400" />
              <span>Foreign</span>
            </div>
            <div className="flex items-center gap-1">
              <Building2 size={10} className="text-cyan-400" />
              <span>Proprietary</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
