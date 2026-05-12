'use client';

import { Rows3 } from 'lucide-react';
import { useMicrostructureAnalysis } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';

interface FootprintProxyWidgetProps {
  symbol: string;
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toFixed(0);
}

export function FootprintProxyWidget({ symbol }: FootprintProxyWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || '';
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useMicrostructureAnalysis(upperSymbol, {
    features: ['footprint'],
    interval: '5m',
    lookbackDays: 7,
    enabled: Boolean(upperSymbol),
  });
  const bars = data?.data?.footprint?.bars || [];
  const hasData = bars.length > 0;
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 });
  const recent = bars.slice(-8).reverse();

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view footprint proxy" icon={<Rows3 size={18} />} />;
  }

  if (timedOut && isLoading && !hasData) {
    return <WidgetError title="Loading timed out" error={new Error('Footprint data took too long to load.')} onRetry={() => { resetTimeout(); refetch(); }} />;
  }

  if (isLoading && !hasData) {
    return <WidgetSkeleton lines={8} />;
  }

  if (error && !hasData) {
    return <WidgetError error={error as Error} onRetry={() => refetch()} />;
  }

  if (!hasData) {
    return <WidgetEmpty message="No footprint proxy data" icon={<Rows3 size={18} />} size="compact" />;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Rows3 size={12} className="text-cyan-400" />
          <span>Footprint Proxy</span>
        </div>
        <WidgetMeta updatedAt={dataUpdatedAt} isFetching={isFetching && hasData} note="Mongo match-type proxy" align="right" />
      </div>

      <div className="flex-1 overflow-auto space-y-2 pr-1">
        {recent.map((bar, index) => {
          const levels = Array.isArray(bar.levels) ? bar.levels.slice(-5).reverse() : [];
          const maxVolume = levels.reduce((max: number, level: any) => Math.max(max, Number(level.ask_volume || 0), Number(level.bid_volume || 0)), 1);
          return (
            <div key={`${String(bar.time)}-${index}`} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
              <div className="mb-1 flex items-center justify-between text-[10px]">
                <span className="font-mono text-[var(--text-muted)]">{String(bar.time).slice(11, 16)}</span>
                <span className={`font-mono ${Number(bar.delta || 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{formatCompact(Number(bar.delta || 0))}</span>
              </div>
              <div className="space-y-1">
                {levels.map((level: any, levelIndex: number) => {
                  const ask = Number(level.ask_volume || 0);
                  const bid = Number(level.bid_volume || 0);
                  return (
                    <div key={`${level.price}-${levelIndex}`} className="grid grid-cols-[1fr_52px_1fr] items-center gap-1 text-[10px]">
                      <div className="h-3 rounded bg-red-500/25 text-right" style={{ width: `${Math.max(4, (bid / maxVolume) * 100)}%`, justifySelf: 'end' }} title={`Bid ${formatCompact(bid)}`} />
                      <div className="text-center font-mono text-[var(--text-secondary)]">{Number(level.price || 0).toFixed(2)}</div>
                      <div className="h-3 rounded bg-emerald-500/30" style={{ width: `${Math.max(4, (ask / maxVolume) * 100)}%` }} title={`Ask ${formatCompact(ask)}`} />
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
