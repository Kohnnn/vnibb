'use client';

import { useMemo, useState } from 'react';
import { Area, AreaChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Sigma } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { useRatioHistory } from '@/lib/queries';
import type { RatioHistoryResponse } from '@/types/equity';

interface ValuationBandWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

const METRIC_OPTIONS = [
  { key: 'pe', label: 'P/E', color: '#38bdf8' },
  { key: 'pb', label: 'P/B', color: '#22c55e' },
] as const;

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function formatMetric(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

export function ValuationBandWidget({ id, symbol, onRemove }: ValuationBandWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || '';
  const [metric, setMetric] = useState<(typeof METRIC_OPTIONS)[number]['key']>('pe');

  const ratioHistoryQuery = useRatioHistory(upperSymbol, {
    ratios: ['pe', 'pb'],
    period: 'year',
    limit: 20,
    enabled: Boolean(upperSymbol),
  });
  const historyResponse = ratioHistoryQuery.data as RatioHistoryResponse | undefined;
  const { isLoading, error, refetch, isFetching, dataUpdatedAt } = ratioHistoryQuery;

  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !(historyResponse?.data?.length ?? 0), { timeoutMs: 10_000 });
  const seriesConfig = METRIC_OPTIONS.find((option) => option.key === metric) || METRIC_OPTIONS[0];
  const rows = historyResponse?.data || [];
  const seriesValues = rows
    .map((row) => Number(row[metric]))
    .filter((value) => Number.isFinite(value) && value > 0);
  const mean = average(seriesValues);
  const sigma = std(seriesValues);
  const current = seriesValues[seriesValues.length - 1] ?? null;
  const percentile = current !== null && seriesValues.length
    ? Math.round((seriesValues.filter((value) => value <= current).length / seriesValues.length) * 100)
    : null;

  const chartData = useMemo(() => {
    const lower = mean !== null ? Math.max(mean - sigma, 0) : null;
    const upper = mean !== null ? mean + sigma : null;

    return rows
      .slice()
      .reverse()
      .map((row) => {
        const value = Number(row[metric]);
        return {
          period: row.period || '—',
          current: Number.isFinite(value) && value > 0 ? value : null,
          lowerBase: lower,
          bandRange: lower !== null && upper !== null ? upper - lower : null,
          mean,
        };
      });
  }, [rows, metric, mean, sigma]);

  const hasData = seriesValues.length >= 3;

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view valuation bands" icon={<Sigma size={18} />} />;
  }

  return (
    <WidgetContainer
      title="Valuation Band"
      symbol={upperSymbol}
      widgetId={id}
      onClose={onRemove}
      onRefresh={() => {
        resetTimeout();
        void refetch();
      }}
      noPadding
      exportData={rows}
      exportFilename={`valuation_band_${upperSymbol}_${metric}`}
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5">
            {METRIC_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setMetric(option.key)}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                  metric === option.key
                    ? 'bg-blue-600 text-white'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            note="Annual bands"
            align="right"
          />
        </div>

        {timedOut && isLoading && !hasData ? (
          <WidgetError
            title="Loading timed out"
            error={new Error('Valuation history took too long to load.')}
            onRetry={() => {
              resetTimeout();
              void refetch();
            }}
          />
        ) : isLoading && !hasData ? (
          <WidgetSkeleton lines={7} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => refetch()} />
        ) : !hasData ? (
          <WidgetEmpty message="Not enough ratio history to build valuation bands" icon={<Sigma size={18} />} />
        ) : (
          <div className="flex h-full flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Current {seriesConfig.label}</div>
                <div className="mt-1 text-lg font-semibold" style={{ color: seriesConfig.color }}>{formatMetric(current)}</div>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Mean</div>
                <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{formatMetric(mean)}</div>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">1σ Band</div>
                <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                  {mean !== null ? `${formatMetric(Math.max(mean - sigma, 0))} - ${formatMetric(mean + sigma)}` : '—'}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Percentile</div>
                <div className="mt-1 text-lg font-semibold text-cyan-300">{percentile === null ? '—' : `${percentile}%`}</div>
              </div>
            </div>

            <div className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                Historical {seriesConfig.label} vs statistical band
              </div>
              <ChartMountGuard className="h-[260px]" minHeight={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="period" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        fontSize: '11px',
                      }}
                    />
                    {mean !== null ? <ReferenceLine y={mean} stroke="#94a3b8" strokeDasharray="4 4" /> : null}
                    <Area type="monotone" dataKey="lowerBase" stackId="band" stroke="none" fill="transparent" />
                    <Area type="monotone" dataKey="bandRange" stackId="band" stroke="none" fill="rgba(56,189,248,0.18)" />
                    <Line type="monotone" dataKey="current" stroke={seriesConfig.color} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="mean" stroke="#cbd5e1" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartMountGuard>
            </div>
          </div>
        )}
      </div>
    </WidgetContainer>
  );
}

export default ValuationBandWidget;
