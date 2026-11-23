'use client';

import { useEffect } from 'react';
import { Rows3 } from 'lucide-react';
import { useMicrostructureAnalysis } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { IntradayEmpty, IntradayStatus } from '@/components/ui/IntradayStatus';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { useIntradayAvailability } from '@/hooks/useIntradayAvailability';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { signedToneClass } from '@/lib/priceColor';

interface FootprintProxyWidgetProps {
  symbol: string;
  onDataChange?: (data: WidgetDataPayload) => void;
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toFixed(0);
}

export function FootprintProxyWidget({ symbol, onDataChange }: FootprintProxyWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || '';
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useMicrostructureAnalysis(upperSymbol, {
    features: ['footprint'],
    interval: '5m',
    lookbackDays: 7,
    enabled: Boolean(upperSymbol),
  });
  const bars = data?.data?.footprint?.bars;
  const hasData = Boolean(bars?.length);
  const availability = useIntradayAvailability({ response: data, error, hasData, isLoading, isFetching, dataUpdatedAt });
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 });
  const recent = bars?.slice(-8).reverse() ?? [];

  useEffect(() => {
    onDataChange?.(
      buildWidgetRuntime({
        ...availability.runtime,
        empty: !hasData,
        apiGroup: '/microstructure',
        endpoint: `/microstructure/${upperSymbol}?features=footprint&interval=5m&lookback_days=7`,
        sourceLabel: availability.source ?? 'Retained trade ticks',
        basis: 'Match-type proxy calculated from retained trade ticks',
        exportData: hasData ? bars : undefined,
      }),
    );
  }, [availability, bars, hasData, onDataChange, upperSymbol]);

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view footprint proxy" icon={<Rows3 size={18} />} />;
  }

  if (timedOut && isLoading && !hasData) {
    return <WidgetError title="Loading timed out" error={new Error('Footprint data took too long to load.')} onRetry={() => { resetTimeout(); refetch(); }} />;
  }

  if (isLoading && !hasData) {
    return <WidgetSkeleton lines={8} />;
  }

  if (!hasData) {
    return (
      <div className="flex h-full flex-col">
        <IntradayStatus availability={availability} hasData={false} isFetching={isFetching} />
        <IntradayEmpty
          availability={availability}
          unavailable="Footprint trade ticks unavailable"
          empty="No trade ticks returned for Footprint"
          detail="Trade coverage is unverified for the requested 7-day lookback."
          icon={<Rows3 size={18} />}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Rows3 size={12} className="text-[var(--color-accent-primary)]" />
          <span>Footprint Proxy</span>
        </div>
        <IntradayStatus availability={availability} hasData={hasData} isFetching={isFetching} label="Match-type proxy" />
      </div>

      <div className="flex-1 overflow-auto space-y-2 pr-1">
        {recent.map((bar, index) => {
          const levels = Array.isArray(bar.levels) ? bar.levels.slice(-5).reverse() : [];
          const maxVolume = levels.reduce((max: number, level: any) => Math.max(max, Number(level.ask_volume || 0), Number(level.bid_volume || 0)), 1);
          return (
            <div key={`${String(bar.time)}-${index}`} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
              <div className="mb-1 flex items-center justify-between text-[10px]">
                <span className="font-mono text-[var(--text-muted)]">{String(bar.time).slice(11, 16)}</span>
                <span className={`font-mono ${signedToneClass(Number(bar.delta))}`}>{formatCompact(Number(bar.delta || 0))}</span>
              </div>
              <div className="space-y-1">
                {levels.map((level: any, levelIndex: number) => {
                  const ask = Number(level.ask_volume || 0);
                  const bid = Number(level.bid_volume || 0);
                  return (
                    <div key={`${level.price}-${levelIndex}`} className="grid grid-cols-[1fr_52px_1fr] items-center gap-1 text-[10px]">
                      <div className="h-3 rounded bg-[var(--color-negative-bg)] text-right" style={{ width: `${Math.max(4, (bid / maxVolume) * 100)}%`, justifySelf: 'end' }} title={`Bid ${formatCompact(bid)}`} />
                      <div className="text-center font-mono text-[var(--text-secondary)]">{Number(level.price || 0).toFixed(2)}</div>
                      <div className="h-3 rounded bg-[var(--color-positive-bg)]" style={{ width: `${Math.max(4, (ask / maxVolume) * 100)}%` }} title={`Ask ${formatCompact(ask)}`} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default FootprintProxyWidget;
