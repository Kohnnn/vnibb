'use client';

import { useEffect } from 'react';
import { Activity } from 'lucide-react';
import { useMicrostructureAnalysis } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { useMarketState } from '@/hooks/useMarketState';
import { describeIntradayUnavailable } from '@/lib/marketHours';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';

interface VWAPBandsWidgetProps {
  symbol: string;
  onDataChange?: (data: WidgetDataPayload) => void;
}

function formatPrice(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '-';
}

export function VWAPBandsWidget({ symbol, onDataChange }: VWAPBandsWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || '';
  const marketState = useMarketState();
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useMicrostructureAnalysis(upperSymbol, {
    features: ['vwap'],
    interval: '5m',
    lookbackDays: 7,
    enabled: Boolean(upperSymbol),
  });
  const points = data?.data?.vwap?.points || [];
  const vwapBlock = data?.data?.vwap as { source?: string; quality?: string } | undefined;
  // Backend reports availability via `quality` ('available' / 'unavailable' /
  // 'not_requested'). The legacy `source` key is a fallback. (QA-v2 T2)
  const vwapStatus = vwapBlock?.quality || vwapBlock?.source;
  const isUnavailable =
    vwapStatus === 'unavailable' ||
    (Array.isArray(data?.data?.unsupported_reasons) && data.data.unsupported_reasons.length > 0 && points.length === 0);
  const hasData = points.length > 0;
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 });
  const latest = points[points.length - 1];
  const recent = points.slice(-20);
  const values = recent.flatMap((point) => [point.lower2, point.upper2]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;
  const span = maxValue - minValue || 1;

  useEffect(() => {
    onDataChange?.(
      buildWidgetRuntime({
        empty: !hasData,
        apiGroup: '/microstructure',
        endpoint: `/microstructure/${upperSymbol}?features=vwap&interval=5m&lookback_days=7`,
        sourceLabel: 'VWAP bands · trade ticks',
        lastDataDate: dataUpdatedAt,
        extra: hasData ? { points: points.length, quality: vwapStatus } : undefined,
      }),
    );
  }, [onDataChange, hasData, dataUpdatedAt, upperSymbol, points.length, vwapStatus]);

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view VWAP bands" icon={<Activity size={18} />} />;
  }

  if (timedOut && isLoading && !hasData) {
    return <WidgetError title="Loading timed out" error={new Error('VWAP data took too long to load.')} onRetry={() => { resetTimeout(); refetch(); }} />;
  }

  if (isLoading && !hasData) {
    return <WidgetSkeleton variant="chart" />;
  }

  if (error && !hasData) {
    return <WidgetError error={error as Error} onRetry={() => refetch()} />;
  }

  if (!hasData) {
    const unavailableCopy = describeIntradayUnavailable(marketState);
    return (
      <WidgetEmpty
        message={isUnavailable ? `Intraday VWAP not available · ${unavailableCopy.primary}` : 'No intraday VWAP data yet'}
        detail={isUnavailable ? unavailableCopy.detail : 'Waiting for trade ticks. Try refresh in a few minutes.'}
        icon={<Activity size={18} />}
        size="compact"
        action={{ label: 'Refresh', onClick: () => refetch() }}
      />
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Activity size={12} className="text-cyan-400" />
          <span>VWAP Bands</span>
        </div>
        <WidgetMeta updatedAt={dataUpdatedAt} isFetching={isFetching && hasData} note="Mongo trade ticks" align="right" />
      </div>

      <div className="grid grid-cols-3 gap-2 text-[10px] mb-2">
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">VWAP</div>
          <div className="font-mono text-cyan-300">{formatPrice(latest?.vwap)}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Upper 1σ</div>
          <div className="font-mono text-emerald-300">{formatPrice(latest?.upper1)}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Lower 1σ</div>
          <div className="font-mono text-amber-300">{formatPrice(latest?.lower1)}</div>
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
        <div className="relative h-full min-h-[120px]">
          {recent.map((point, index) => {
            const x = recent.length <= 1 ? 0 : (index / (recent.length - 1)) * 100;
            const y = typeof point.vwap === 'number' ? 100 - ((point.vwap - minValue) / span) * 100 : 50;
            const bandTop = typeof point.upper1 === 'number' ? 100 - ((point.upper1 - minValue) / span) * 100 : y;
            const bandBottom = typeof point.lower1 === 'number' ? 100 - ((point.lower1 - minValue) / span) * 100 : y;
            return (
              <div key={`${point.time}-${index}`} className="absolute bottom-0 top-0" style={{ left: `${x}%` }}>
                <div className="absolute w-px bg-cyan-500/35" style={{ top: `${bandTop}%`, height: `${Math.max(1, bandBottom - bandTop)}%` }} />
                <div className="absolute -ml-0.5 h-1.5 w-1.5 rounded-full bg-cyan-300" style={{ top: `${y}%` }} title={`${point.time} VWAP ${formatPrice(point.vwap)}`} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default VWAPBandsWidget;
