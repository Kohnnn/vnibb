'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { useForeignFlowLeaderboard, useMarketFreshness } from '@/lib/queries';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import type { ForeignFlowLeaderboardRow, ForeignFlowMetric, ForeignFlowWindow } from '@/lib/api';
import type { WidgetGroupId } from '@/types/widget';

interface ForeignFlowLeaderboardWidgetProps {
  id: string;
  widgetGroup?: WidgetGroupId;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
}

function formatMetric(value: number, metric: ForeignFlowMetric): string {
  const absolute = Math.abs(value);
  return metric === 'net_value'
    ? absolute.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : absolute.toLocaleString('en-US');
}

function displayMetricUnit(unit: 'shares' | 'provider_native_value'): string {
  return unit === 'provider_native_value' ? 'provider value units' : unit;
}

export function ForeignFlowLeaderboardWidget({ id, widgetGroup, onRemove, onDataChange }: ForeignFlowLeaderboardWidgetProps) {
  const [metric, setMetric] = useState<ForeignFlowMetric>('net_volume');
  const [window, setWindow] = useState<ForeignFlowWindow>('1D');
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useForeignFlowLeaderboard({ metric, window });
  const { data: freshnessData, error: freshnessError } = useMarketFreshness();
  const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup, { widgetType: 'foreign_flow_leaderboard' });
  const rows = useMemo(() => [...(data?.top_net_buy ?? []), ...(data?.top_net_sell ?? [])], [data]);
  const windowSize = Number(window.slice(0, -1));
  const isPartial = Boolean(data && data.available_settlement_dates < windowSize);
  const freshness = freshnessData?.buckets.find((bucket) => bucket.label === 'Foreign trading');
  const freshnessLabel = freshnessError || !freshness || freshness.status === 'unknown'
    ? 'Freshness unavailable'
    : freshness.status === 'fresh'
      ? 'Source fresh'
      : `Source ${freshness.status}`;
  const sourceStale = freshness?.status === 'stale' || freshness?.status === 'critical';
  const metricUnit = displayMetricUnit(data?.metric_unit ?? (metric === 'net_value' ? 'provider_native_value' : 'shares'));

  useEffect(() => {
    onDataChange?.(buildWidgetRuntime({
      empty: (data?.symbols_covered ?? 0) === 0,
      apiGroup: '/market',
      endpoint: '/market/foreign-flow-leaderboard',
      sourceLabel: data?.source ?? 'VNIBB stored foreign_trading',
      lastDataDate: sourceStale ? freshness?.last_data_date ?? data?.trade_date ?? dataUpdatedAt : null,
      stale: sourceStale || Boolean(error && rows.length),
      exportData: rows,
      extra: { metric, window, tradeDate: data?.trade_date, symbolsCovered: data?.symbols_covered ?? 0, symbolsUnavailable: data?.symbols_unavailable ?? 0, windowCoverage: data?.window_coverage, settlementDates: data?.settlement_dates ?? [], availableFields: data?.available_fields ?? [], freshnessStatus: freshness?.status ?? 'unavailable' },
    }));
  }, [data, dataUpdatedAt, error, freshness?.last_data_date, freshness?.status, metric, onDataChange, rows, sourceStale, window]);

  return (
    <WidgetContainer title="Foreign Flow Leaderboard" widgetId={id} onRefresh={() => refetch()} onClose={onRemove} isLoading={isLoading && !rows.length} noPadding exportData={rows} exportFilename={`foreign_flow_${metric}_${window.toLowerCase()}`}>
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <WidgetMeta updatedAt={data?.trade_date ?? dataUpdatedAt} isFetching={isFetching && Boolean(rows.length)} sourceLabel={data?.source ?? 'VNIBB stored foreign_trading'} note={data?.trade_date ? `Settlement end ${data.trade_date}` : 'Settlement date unavailable'} align="right" />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
            <div role="group" aria-label="Foreign-flow metric" className="flex rounded border border-[var(--border-subtle)]">
              {([['net_volume', 'Net volume'], ['net_value', 'Net value']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={metric === value} onClick={() => setMetric(value)} className={`min-h-11 px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${metric === value ? 'bg-blue-500/20 text-blue-200' : 'text-[var(--text-muted)]'}`}>{label}</button>)}
            </div>
            <div role="group" aria-label="Foreign-flow settlement window" className="flex rounded border border-[var(--border-subtle)]">
              {(['1D', '5D', '20D'] as const).map((value) => <button key={value} type="button" aria-pressed={window === value} onClick={() => setWindow(value)} className={`min-h-11 min-w-11 px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${window === value ? 'bg-blue-500/20 text-blue-200' : 'text-[var(--text-muted)]'}`}>{value}</button>)}
            </div>
            <span className="text-[var(--text-muted)]">{metricUnit} · {data?.window_coverage ?? `0/${windowSize} settlement dates`}{isPartial ? ' · partial' : ''}</span>
          </div>
          <div className="mt-2 text-[10px] text-[var(--text-muted)]">Fields: {data?.available_fields?.length ? data.available_fields.map((field) => field.replace('_', ' ')).join(', ') : 'unavailable'} · {freshnessLabel}</div>
          <div className="mt-1 text-[10px] text-[var(--text-muted)]">Observed volume/value flow is not ownership, allocation, or investor intent.</div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[10px]">
            <div className="rounded border border-emerald-500/20 py-1 text-emerald-300">Inflow {data?.breadth.positive ?? 0}</div>
            <div className="rounded border border-rose-500/20 py-1 text-rose-300">Outflow {data?.breadth.negative ?? 0}</div>
            <div className="rounded border border-[var(--border-subtle)] py-1 text-[var(--text-muted)]">Zero {data?.breadth.flat ?? 0}</div>
          </div>
          <div className="mt-2 text-[10px] text-[var(--text-muted)]">{data?.symbols_covered ?? 0}/{data?.universe_symbols ?? 0} available · {data?.symbols_unavailable ?? 0} unavailable{data?.fallback_used ? ' · fallback used' : ''}</div>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {isLoading && !rows.length ? <WidgetSkeleton lines={6} /> : error && !rows.length ? <WidgetError error={error as Error} onRetry={() => refetch()} /> : !rows.length ? <WidgetEmpty message={(data?.symbols_covered ?? 0) > 0 ? 'No net inflow or outflow in this window' : 'No eligible stored foreign-flow observations'} detail={(data?.symbols_covered ?? 0) > 0 ? `${data?.breadth.flat ?? data?.symbols_covered ?? 0} covered symbol${(data?.breadth.flat ?? data?.symbols_covered ?? 0) === 1 ? '' : 's'} had flat observed flow.` : 'This view uses settlement-qualified rows only; absent or non-finite metrics are unavailable, not zero.'} /> : (
            <div className="grid gap-3 md:grid-cols-2">
              <FlowList title="Top Net Inflow" rows={data?.top_net_buy ?? []} metric={metric} unit={metricUnit} tone="text-emerald-300" icon={<ArrowUp size={13} />} onSelect={setLinkedSymbol} />
              <FlowList title="Top Net Outflow" rows={data?.top_net_sell ?? []} metric={metric} unit={metricUnit} tone="text-rose-300" icon={<ArrowDown size={13} />} onSelect={setLinkedSymbol} />
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

function FlowList({ title, rows, metric, unit, tone, icon, onSelect }: { title: string; rows: ForeignFlowLeaderboardRow[]; metric: ForeignFlowMetric; unit: string; tone: string; icon: ReactNode; onSelect: (symbol: string) => void }) {
  return <section><div className={`mb-2 flex items-center gap-1 text-xs font-semibold ${tone}`}>{icon}{title}</div><div className="space-y-1">{rows.map((row) => {
    const value = metric === 'net_value' ? row.net_value : row.net_volume;
    return <button key={row.symbol} type="button" onClick={() => onSelect(row.symbol)} className="flex min-h-11 w-full items-center justify-between rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-1.5 text-left hover:border-blue-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"><span><span className="block font-semibold text-[var(--text-primary)]">{row.symbol}</span><span className="block text-[10px] text-[var(--text-muted)]">{row.observations} settlement observation{row.observations === 1 ? '' : 's'}</span></span><span className={`font-mono text-right text-xs ${tone}`}>{value != null ? `${value > 0 ? '+' : '-'}${formatMetric(value, metric)}` : 'Unavailable'}<span className="block text-[10px] text-[var(--text-muted)]">{unit}</span></span></button>;
  })}</div></section>;
}

export default ForeignFlowLeaderboardWidget;
