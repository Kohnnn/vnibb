'use client';

import { memo, useMemo, useState } from 'react';
import { Activity, Building2, Landmark, Wallet } from 'lucide-react';
import {
  Bar,
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useTransactionFlow } from '@/lib/queries';
import { formatNumber } from '@/lib/units';
import { cn } from '@/lib/utils';

interface TransactionFlowWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

const SCOPE_OPTIONS = [
  { id: 'total', label: 'All Flow', icon: Activity },
  { id: 'domestic', label: 'Domestic', icon: Wallet },
  { id: 'foreign', label: 'Foreign', icon: Landmark },
  { id: 'proprietary', label: 'Prop', icon: Building2 },
] as const;

const MODE_OPTIONS = [
  { id: 'value', label: 'Value' },
  { id: 'volume', label: 'Volume' },
] as const;

type FlowScope = (typeof SCOPE_OPTIONS)[number]['id'];
type FlowMode = (typeof MODE_OPTIONS)[number]['id'];

function formatShortDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}

function formatFlowValue(value: number | null | undefined, mode: FlowMode) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  const abs = Math.abs(value);
  if (mode === 'value') {
    if (abs >= 1e9) return `${value < 0 ? '-' : ''}${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${value < 0 ? '-' : ''}${(abs / 1e6).toFixed(2)}M`;
    return formatNumber(value, { decimals: 0 });
  }
  if (abs >= 1e6) return `${value < 0 ? '-' : ''}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${value < 0 ? '-' : ''}${(abs / 1e3).toFixed(1)}K`;
  return formatNumber(value, { decimals: 0 });
}

function getScopeValue(row: any, scope: FlowScope, mode: FlowMode): number | null {
  if (scope === 'total') {
    return mode === 'value' ? row.total_net_value ?? null : row.total_net_volume ?? null;
  }
  if (scope === 'foreign') {
    return mode === 'value' ? row.foreign_net_value ?? null : row.foreign_net_volume ?? null;
  }
  if (scope === 'proprietary') {
    return mode === 'value' ? row.proprietary_net_value ?? null : row.proprietary_net_volume ?? null;
  }
  return mode === 'value' ? row.domestic_net_value ?? null : row.domestic_net_volume ?? null;
}

function TransactionFlowWidgetComponent({ id, symbol, onRemove }: TransactionFlowWidgetProps) {
  const [scope, setScope] = useState<FlowScope>('total');
  const [mode, setMode] = useState<FlowMode>('value');
  const upperSymbol = symbol?.toUpperCase() || '';

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useTransactionFlow(upperSymbol, {
    days: 30,
    enabled: Boolean(upperSymbol),
  });

  const rows = data?.data?.data || [];
  const hasData = rows.length > 0;
  const latest = rows[rows.length - 1];
  const latestDataDate = data?.meta?.last_data_date ?? latest?.date ?? null;

  const staleDays = useMemo(() => {
    if (!latestDataDate) return null;
    const parsed = new Date(latestDataDate);
    if (Number.isNaN(parsed.getTime())) return null;
    return Math.floor((Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24));
  }, [latestDataDate]);

  const isStale = Boolean(staleDays !== null && staleDays > 7);

  const chartRows = useMemo(() => {
    return rows.map((row) => ({
      ...row,
      label: formatShortDate(row.date),
      domestic: mode === 'value' ? row.domestic_net_value ?? null : row.domestic_net_volume ?? null,
      foreign: mode === 'value' ? row.foreign_net_value ?? null : row.foreign_net_volume ?? null,
      proprietary:
        mode === 'value' ? row.proprietary_net_value ?? null : row.proprietary_net_volume ?? null,
      selected: getScopeValue(row, scope, mode),
      price: row.price ?? null,
    }));
  }, [mode, rows, scope]);

  const summaryCards = useMemo(() => {
    if (!latest) return [];
    return [
      { label: 'Domestic', value: getScopeValue(latest, 'domestic', mode), tone: 'text-sky-300' },
      { label: 'Foreign', value: getScopeValue(latest, 'foreign', mode), tone: 'text-fuchsia-300' },
      { label: 'Prop', value: getScopeValue(latest, 'proprietary', mode), tone: 'text-cyan-300' },
      { label: 'Total', value: getScopeValue(latest, 'total', mode), tone: 'text-emerald-300' },
    ];
  }, [latest, mode]);

  const note = scope === 'total'
    ? `${mode === 'value' ? 'Net value' : 'Net volume'} stacked by inferred investor bucket`
    : `${scope} ${mode}`;
  const latestLead = useMemo(() => {
    if (!latest) return null;
    const candidates = [
      { label: 'Domestic', value: getScopeValue(latest, 'domestic', mode) },
      { label: 'Foreign', value: getScopeValue(latest, 'foreign', mode) },
      { label: 'Prop', value: getScopeValue(latest, 'proprietary', mode) },
    ].filter((item) => item.value !== null) as Array<{ label: string; value: number }>;

    return candidates.sort((left, right) => Math.abs(right.value) - Math.abs(left.value))[0] || null;
  }, [latest, mode]);

  const hasRenderableFlowData = useMemo(() => {
    return rows.some((row) => (
      [
        getScopeValue(row, 'domestic', mode),
        getScopeValue(row, 'foreign', mode),
        getScopeValue(row, 'proprietary', mode),
        getScopeValue(row, 'total', mode),
      ].some((value) => value !== null && value !== undefined)
    ));
  }, [mode, rows]);

  return (
    <WidgetContainer
      title="Transaction Flow"
      subtitle="Daily flow composition with price overlay"
      symbol={upperSymbol}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
      exportData={rows}
      exportFilename={`transaction_flow_${upperSymbol}`}
      widgetId={id}
      showLinkToggle
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <div className="border-b border-[var(--border-color)]/70 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {SCOPE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = scope === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setScope(option.id)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
                      active
                        ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200'
                        : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <Icon size={11} />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] p-0.5">
                {MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setMode(option.id)}
                    className={cn(
                      'rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
                      mode === option.id
                        ? 'bg-blue-600 text-white'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <WidgetMeta
                updatedAt={data?.meta?.last_data_date ?? dataUpdatedAt}
                isFetching={isFetching && hasData}
                note={note}
                align="right"
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-3 py-3 scrollbar-hide">
          {isLoading && !hasData ? (
            <WidgetSkeleton variant="table" lines={8} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty
              icon={<Activity size={18} />}
              message={`No transaction flow data available for ${upperSymbol}.`}
            />
          ) : !hasRenderableFlowData ? (
            <WidgetEmpty
              icon={<Activity size={18} />}
              message={`Investor bucket flow is not available for ${upperSymbol} yet.`}
            />
          ) : (
            <div className="space-y-3">
              {isStale ? (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Latest transaction flow snapshot is {staleDays} days old. Showing the last available session until the pipeline refreshes.
                </div>
              ) : null}
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                <span className="font-semibold text-[var(--text-primary)]">Current read:</span>{' '}
                {latestLead
                  ? `${latestLead.label} flow is the strongest driver in the latest session, while price overlay helps confirm whether participation is supportive or divergent.`
                  : 'Flow strength becomes more useful when at least one participant bucket shows persistent expansion.'}
              </div>

              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                {summaryCards.map((card) => (
                  <div
                    key={card.label}
                    className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3"
                  >
                    <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                      {card.label}
                    </div>
                    <div className={cn('text-lg font-semibold', card.tone)}>
                      {formatFlowValue(card.value, mode)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                      Flow vs Price
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {scope === 'total'
                        ? 'Domestic residual + foreign + proprietary stacked with closing price overlay'
                        : `Net ${scope} ${mode} with price overlay`}
                    </div>
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)]">Last {rows.length} sessions</div>
                </div>

                <ChartMountGuard className="h-[260px]" minHeight={240}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartRows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis
                        yAxisId="flow"
                        tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => formatFlowValue(Number(value), mode)}
                      />
                      <YAxis
                        yAxisId="price"
                        orientation="right"
                        tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => formatNumber(Number(value), { decimals: 2 })}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          fontSize: '11px',
                        }}
                        formatter={(value: any, name: any) => {
                          const numericValue = typeof value === 'number' ? value : Number(value);
                          const label = typeof name === 'string' ? name : 'Flow';
                          if (label === 'Price') return [formatNumber(numericValue, { decimals: 2 }), label];
                          return [formatFlowValue(numericValue, mode), label];
                        }}
                      />
                      <Legend />

                      {scope === 'total' ? (
                        <>
                          <Bar yAxisId="flow" dataKey="domestic" stackId="flow" fill="#2563eb" name="Domestic" radius={[2, 2, 0, 0]} />
                          <Bar yAxisId="flow" dataKey="foreign" stackId="flow" fill="#c026d3" name="Foreign" radius={[2, 2, 0, 0]} />
                          <Bar yAxisId="flow" dataKey="proprietary" stackId="flow" fill="#06b6d4" name="Proprietary" radius={[2, 2, 0, 0]} />
                        </>
                      ) : (
                        <Bar
                          yAxisId="flow"
                          dataKey="selected"
                          fill={scope === 'foreign' ? '#c026d3' : scope === 'proprietary' ? '#06b6d4' : '#2563eb'}
                          name={scope === 'foreign' ? 'Foreign' : scope === 'proprietary' ? 'Proprietary' : 'Domestic'}
                          radius={[2, 2, 0, 0]}
                        />
                      )}

                      <Line
                        yAxisId="price"
                        type="monotone"
                        dataKey="price"
                        stroke="#93c5fd"
                        strokeWidth={2}
                        dot={false}
                        strokeDasharray="4 4"
                        name="Price"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartMountGuard>
              </div>

              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Latest Session Snapshot
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] xl:grid-cols-5">
                  <div>
                    <div className="text-[var(--text-muted)]">Date</div>
                    <div className="font-medium text-[var(--text-primary)]">{latest?.date ?? 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">Price</div>
                    <div className="font-medium text-[var(--text-primary)]">
                      {formatNumber(latest?.price ?? null, { decimals: 2 })}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">Gross</div>
                    <div className="font-medium text-[var(--text-primary)]">
                      {formatFlowValue(latest?.total_gross_value, 'value')}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">Big Orders</div>
                    <div className="font-medium text-[var(--text-primary)]">
                      {latest?.big_order_count ?? 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">Block Trades</div>
                    <div className="font-medium text-[var(--text-primary)]">
                      {latest?.block_trade_count ?? 'N/A'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const TransactionFlowWidget = memo(TransactionFlowWidgetComponent);
export default TransactionFlowWidget;
