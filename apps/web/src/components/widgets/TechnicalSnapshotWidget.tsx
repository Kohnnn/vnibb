'use client';

import { Activity } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useFullTechnicalAnalysis } from '@/lib/queries';
import { formatNumber } from '@/lib/format';

interface TechnicalSnapshotWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

function formatSignal(signal?: string) {
  if (!signal) return 'Neutral';
  return signal.replace('_', ' ').replace(/\n/g, ' ');
}

function signalColor(signal?: string) {
  if (!signal) return 'text-gray-400';
  if (signal.includes('strong_buy') || signal.includes('buy')) return 'text-emerald-400';
  if (signal.includes('strong_sell') || signal.includes('sell')) return 'text-red-400';
  return 'text-gray-400';
}

export function TechnicalSnapshotWidget({ id, symbol, onRemove }: TechnicalSnapshotWidgetProps) {
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useFullTechnicalAnalysis(symbol, { timeframe: 'D', enabled: Boolean(symbol) });

  const hasData = Boolean(data);
  const rsi = data?.oscillators?.rsi?.value;
  const macd = data?.oscillators?.macd?.histogram;
  const adx = data?.volatility?.adx?.adx;
  const support = data?.levels?.support_resistance?.nearest_support;
  const resistance = data?.levels?.support_resistance?.nearest_resistance;

  if (!symbol) {
    return <WidgetEmpty message="Select a symbol to view technicals" />;
  }

  return (
    <WidgetContainer
      title="Technical Snapshot"
      symbol={symbol}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
      widgetId={id}
    >
      <div className="h-full flex flex-col bg-[#0a0a0a]">
        <div className="px-3 py-2 border-b border-gray-800/60">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={Boolean(error && hasData)}
            note="Daily timeframe"
            align="right"
          />
        </div>

        <div className="flex-1 overflow-auto p-3">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={5} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="Technical indicators not available" icon={<Activity size={18} />} />
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-800/60 bg-black/20 px-3 py-2">
                <div className="text-[10px] text-gray-500 uppercase tracking-widest">Overall Signal</div>
                <div className={`text-sm font-bold ${signalColor(data?.signals?.overall_signal)}`}>
                  {formatSignal(data?.signals?.overall_signal)}
                </div>
                <div className="text-[10px] text-gray-500">
                  {data?.signals?.buy_count} buy • {data?.signals?.sell_count} sell • {data?.signals?.neutral_count} neutral
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'RSI (14)', value: rsi ? formatNumber(rsi, 2) : '-' },
                  { label: 'MACD Hist', value: macd ? formatNumber(macd, 2) : '-' },
                  { label: 'ADX', value: adx ? formatNumber(adx, 1) : '-' },
                  { label: 'Support', value: support ? formatNumber(support, 0) : '-' },
                  { label: 'Resistance', value: resistance ? formatNumber(resistance, 0) : '-' },
                  { label: 'Trend', value: data?.signals?.trend_strength || '-' },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg border border-gray-800/60 bg-black/20 px-2 py-2"
                  >
                    <div className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">{item.label}</div>
                    <div className="text-xs font-mono text-gray-200">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export default TechnicalSnapshotWidget;
