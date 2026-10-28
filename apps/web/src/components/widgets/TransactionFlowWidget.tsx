'use client';

import { memo, useEffect, useMemo, useState } from 'react';
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

import { useUnit } from '@/contexts/UnitContext';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useTransactionFlow, useFlowCoverage } from '@/lib/queries';
import { formatNumber, formatPriceValueForUnit, formatCompactValueForUnit, type UnitConfig } from '@/lib/units';
import type { WidgetHealthState } from '@/lib/widgetHealth';
import type { TransactionFlowPoint } from '@/types/equity';
import { cn } from '@/lib/utils';

interface TransactionFlowWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
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

function formatFlowValue(
  value: number | null | undefined,
  mode: FlowMode,
  unitConfig: UnitConfig
) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  const abs = Math.abs(value);
  if (mode === 'value') {
    return formatCompactValueForUnit(value, { ...unitConfig, decimalPlaces: 2 });
  }
  if (abs >= 1e6) return `${value < 0 ? '-' : ''}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${value < 0 ? '-' : ''}${(abs / 1e3).toFixed(1)}K`;
  return formatNumber(value, { decimals: 0 });
}

function isFullSession(row: TransactionFlowPoint | undefined): boolean {
  return row?.coverage?.scope === 'full_session' && row.coverage.completed_session === true;
}

function getScopeValue(row: TransactionFlowPoint, scope: FlowScope, mode: FlowMode): number | null {
  if (scope === 'total') {
    return isFullSession(row)
      ? mode === 'value' ? row.total_net_value ?? null : row.total_net_volume ?? null
      : mode === 'value' ? row.observed_net_value ?? null : row.observed_net_volume ?? null;
  }
  if (scope === 'foreign') {
    return mode === 'value' ? row.foreign_net_value ?? null : row.foreign_net_volume ?? null;
  }
  if (scope === 'proprietary') {
    return mode === 'value' ? row.proprietary_net_value ?? null : row.proprietary_net_volume ?? null;
  }
  if (!isFullSession(row)) return null;
  return mode === 'value' ? row.domestic_net_value ?? null : row.domestic_net_volume ?? null;
}

function TransactionFlowWidgetComponent({ id, symbol, onRemove, onDataChange }: TransactionFlowWidgetProps) {
  const [scope, setScope] = useState<FlowScope>('total');
  const [mode, setMode] = useState<FlowMode>('value');
  const upperSymbol = symbol?.toUpperCase() || '';
  const { config: unitConfig } = useUnit();

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useTransactionFlow(upperSymbol, {
    days: 30,
    enabled: Boolean(upperSymbol),
  });

  // Pulled once per session and shared across widget instances. Used to render
  // a dynamic "supported tickers" hint instead of the previously hard-coded
  // list which contradicted itself when the active symbol *was* in the list
  // but its own buckets were sparse.
  const { data: flowCoverage } = useFlowCoverage({ days: 30 });

  const rows = data?.data?.data || [];
  const hasData = rows.length > 0;
  const latest = rows[rows.length - 1];
  const latestIsFullSession = isFullSession(latest);
  const hasIncompleteSessions = rows.some((row) => !isFullSession(row));
  const coverage = latest?.coverage;
  const completeness = latestIsFullSession
    ? 'Complete session'
    : coverage?.scope === 'sampled' ? 'Sampled / partial' : 'Unknown';
  const latestDataDate = data?.meta?.last_data_date ?? latest?.date ?? null;

  const staleDays = useMemo(() => {
    if (!latestDataDate) return null;
    const parsed = new Date(latestDataDate);
    if (Number.isNaN(parsed.getTime())) return null;
    return Math.floor((Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24));
  }, [latestDataDate]);

  const isStale = Boolean(staleDays !== null && staleDays > 7);
  const healthState: WidgetHealthState | undefined = isStale
    ? {
        status: 'stale',
        label: 'Stale snapshot',
        detail: `Latest flow snapshot is ${staleDays} day${staleDays === 1 ? '' : 's'} old.`,
      }
    : error && hasData
      ? {
          status: 'cached',
          label: 'Cached snapshot',
          detail: 'Showing the last successful transaction flow data while refresh is degraded.',
        }
      : undefined

  const chartRows = useMemo(() => {
    return rows.map((row) => ({
      ...row,
      label: formatShortDate(row.date),
      domestic: getScopeValue(row, 'domestic', mode),
      foreign: mode === 'value' ? row.foreign_net_value ?? null : row.foreign_net_volume ?? null,
      proprietary:
        mode === 'value' ? row.proprietary_net_value ?? null : row.proprietary_net_volume ?? null,
      selected: getScopeValue(row, scope, mode),
      sessionTotal: isFullSession(row) ? getScopeValue(row, 'total', mode) : null,
      observed: isFullSession(row) ? null : getScopeValue(row, 'total', mode),
      price: row.price ?? null,
    }));
  }, [mode, rows, scope]);

  const summaryCards = useMemo(() => {
    if (!latest) return [];
    // QA-v4 Transaction Flow: when the latest row's bucket is null
    // (e.g. weekend/post-close where the foreign feed lags one session),
    // walk back through `rows` to surface the most recent non-null value
    // instead of rendering "N/A". Track which row was used so the UI can
    // optionally annotate "as of <date>" if needed.
    const lastNonNull = (s: FlowScope): { value: number | null; date: string | null } => {
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const v = getScopeValue(rows[i], s, mode);
        if (v !== null && v !== undefined && Number.isFinite(v)) {
          return { value: v, date: rows[i]?.date ?? null };
        }
      }
      return { value: null, date: null };
    };
    return [
      { label: 'Domestic', ...(latestIsFullSession ? lastNonNull('domestic') : { value: null, date: latest.date }), tone: 'text-sky-300' },
      { label: 'Foreign', ...lastNonNull('foreign'), tone: 'text-fuchsia-300' },
      { label: 'Prop', ...lastNonNull('proprietary'), tone: 'text-cyan-300' },
      { label: latestIsFullSession ? 'Total' : 'Observed sample', value: getScopeValue(latest, 'total', mode), date: latest.date, tone: 'text-emerald-300' },
    ];
  }, [latest, latestIsFullSession, mode, rows]);

  const note = scope === 'total'
    ? hasIncompleteSessions ? 'Observed samples are not daily session totals' : `${mode === 'value' ? 'Net value' : 'Net volume'} stacked by inferred investor bucket`
    : `${scope} ${mode}`;
  const latestLead = useMemo(() => {
    if (!latest || !latestIsFullSession) return null;
    const candidates = [
      { label: 'Domestic', value: getScopeValue(latest, 'domestic', mode) },
      { label: 'Foreign', value: getScopeValue(latest, 'foreign', mode) },
      { label: 'Prop', value: getScopeValue(latest, 'proprietary', mode) },
    ].filter((item) => item.value !== null) as Array<{ label: string; value: number }>;

    return candidates.sort((left, right) => Math.abs(right.value) - Math.abs(left.value))[0] || null;
  }, [latest, latestIsFullSession, mode]);

  const hasRenderableFlowData = useMemo(() => {
    return rows.some((row) => (
      [
        getScopeValue(row, 'domestic', mode),
        getScopeValue(row, 'foreign', mode),
        getScopeValue(row, 'proprietary', mode),
        getScopeValue(row, 'total', mode),
        ...(!isFullSession(row) ? [row.observed_buy_value, row.observed_sell_value, row.observed_gross_value, row.observed_buy_volume, row.observed_sell_volume, row.observed_volume] : []),
      ].some((value) => value != null && Number.isFinite(value))
    ));
  }, [mode, rows]);

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: {
          empty: !hasRenderableFlowData,
          compactHeight: 4,
        },
        provenance: {
          sourceLabel: 'Transaction flow',
          apiGroup: '/equity',
          endpoint: `/equity/${upperSymbol}/transaction-flow`,
          updatedAt: latestDataDate,
          fetchedAt: dataUpdatedAt,
        },
      },
    });
  }, [hasRenderableFlowData, onDataChange, upperSymbol, latestDataDate, dataUpdatedAt]);

  return (
    <WidgetContainer
      title="Transaction Flow"
      subtitle={hasIncompleteSessions ? 'Observed samples and certified session flow with price overlay' : 'Daily flow composition with price overlay'}
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
                    <span>{option.id === 'total' && hasIncompleteSessions ? 'Observed / Session' : option.label}</span>
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
                updatedAt={latestDataDate}
                fetchedAt={dataUpdatedAt}
                isFetching={isFetching && hasData}
                health={healthState}
                note={note}
                align="right"
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-3 py-3 scrollbar-hide">
          {hasData ? (
            <div className="mb-3 rounded-lg border border-amber-500/20 bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)]">
              <div className="font-semibold text-[var(--text-primary)]">
                {latestIsFullSession ? 'Session coverage' : 'Observed sample'} · {completeness}
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div><dt>Observed trades</dt><dd>{coverage?.observed_trade_count ?? 'N/A'}</dd></div>
                <div><dt>Observed window (source time)</dt><dd>{coverage?.observed_window_start ?? 'N/A'} – {coverage?.observed_window_end ?? 'N/A'}</dd></div>
                <div><dt>Source session / requested session</dt><dd>{coverage?.session_date ?? 'N/A'} / {coverage?.requested_session_date ?? 'N/A'}</dd></div>
                <div><dt>Source / status</dt><dd>{coverage?.provider ?? 'Unknown'} / {coverage?.status ?? 'Unknown'}</dd></div>
                <div><dt>Session trade count / coverage</dt><dd>{latestIsFullSession ? coverage?.denominator_trade_count ?? 'N/A' : 'N/A'} / {latestIsFullSession && coverage?.session_fraction != null ? `${formatNumber(coverage.session_fraction * 100, { decimals: 1 })}%` : 'Unknown'}</dd></div>
                <div><dt>Stored flow / SQL ticks / Mongo ticks</dt><dd>{coverage?.sql_flows?.status ?? 'Unknown'} / {coverage?.sql_ticks?.status ?? 'Unknown'} / {coverage?.mongo_ticks?.status ?? 'Unknown'}</dd></div>
              </dl>
              {!latestIsFullSession ? (
                <p className="mt-2">Measured values cover only the observed sample, not the full trading session. Domestic residual and session totals are unavailable. Foreign and proprietary values are independent daily feeds, not sample-matched buckets.</p>
              ) : null}
            </div>
          ) : null}
          {isLoading && !hasData ? (
            <WidgetSkeleton variant="table" lines={8} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty
              icon={<Activity size={18} />}
              message={`No transaction flow data available for ${upperSymbol}.`}
              detail="Data updates when investor bucket flow is published."
              size="compact"
            />
          ) : !hasRenderableFlowData ? (
            (() => {
              const supportedSymbols = (flowCoverage?.data || [])
                .filter((entry) => entry.days_with_buckets >= 5)
                .slice(0, 8)
                .map((entry) => entry.symbol);
              const symbolIsListed = supportedSymbols.includes(upperSymbol);
              const supportedListLabel =
                supportedSymbols.length > 0 ? supportedSymbols.join(', ') : null;
              const detail = symbolIsListed
                ? `${upperSymbol} has certified investor bucket flow in this window, but the latest values are unavailable.`
                : supportedListLabel
                  ? `Certified investor bucket flow is available for ${supportedListLabel} in this window. No measured flow values are available for ${upperSymbol}.`
                  : 'No measured flow values are available. Source coverage is unknown until a coverage receipt is published.';
              return (
                <WidgetEmpty
                  icon={<Activity size={18} />}
                  message={`Investor bucket flow is not available for ${upperSymbol} yet.`}
                  detail={detail}
                  health={{
                    status: 'coverage_gap',
                    label: 'Sparse coverage',
                    detail: 'No available measured values or certified investor buckets for this window.',
                  }}
                  size="compact"
                />
              );
            })()
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
                  : latestIsFullSession ? 'Flow strength becomes more useful when at least one participant bucket shows persistent expansion.' : 'Observed sample only; session-wide participation and investor-bucket drivers cannot be inferred.'}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-4">
                {summaryCards.map((card) => {
                  const cardDate = (card as { date?: string | null }).date ?? null;
                  const isLagged =
                    cardDate &&
                    latest?.date &&
                    cardDate !== latest.date &&
                    card.value !== null;
                  return (
                    <div
                      key={card.label}
                      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3"
                    >
                      <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                        {card.label}
                      </div>
                      <div className={cn('text-lg font-semibold', card.tone)}>
                        {formatFlowValue(card.value, mode, unitConfig)}
                      </div>
                      {isLagged ? (
                        <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                          as of {formatShortDate(cardDate)}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="flex min-h-[150px] flex-col rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                <div className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                      Flow vs Price
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {scope === 'total'
                        ? hasIncompleteSessions ? 'Observed sample net flow and certified session net flow shown separately; no sample bucket decomposition' : 'Domestic residual + foreign + proprietary stacked with closing price overlay'
                        : `Net ${scope} ${mode} with price overlay`}
                    </div>
                  </div>
                  <div className="shrink-0 text-[10px] text-[var(--text-muted)]">Last {rows.length} sessions</div>
                </div>

                <ChartMountGuard className="h-[180px] w-full shrink-0" minHeight={180}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={180}>
                    <ComposedChart data={chartRows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis
                        yAxisId="flow"
                        tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => formatFlowValue(Number(value), mode, unitConfig)}
                      />
                      <YAxis
                        yAxisId="price"
                        orientation="right"
                        tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => formatPriceValueForUnit(Number(value), unitConfig, { decimals: 2 })}
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
                          if (label === 'Price') return [formatPriceValueForUnit(numericValue, unitConfig, { decimals: 2 }), label];
                          return [formatFlowValue(numericValue, mode, unitConfig), label];
                        }}
                      />
                      <Legend />

                      {scope === 'total' && hasIncompleteSessions ? (
                        <>
                          <Bar yAxisId="flow" dataKey="observed" fill="#10b981" name="Observed sample" radius={[2, 2, 0, 0]} />
                          <Bar yAxisId="flow" dataKey="sessionTotal" fill="#2563eb" name="Certified session total" radius={[2, 2, 0, 0]} />
                        </>
                      ) : scope === 'total' ? (
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
                  {latestIsFullSession ? 'Latest Session Snapshot' : 'Latest Observed Sample'}
                </div>
                <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <div className="text-[var(--text-muted)]">Date</div>
                    <div className="font-medium text-[var(--text-primary)]">{latest?.date ?? 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">Price</div>
                    <div className="font-medium text-[var(--text-primary)]">
                      {formatPriceValueForUnit(latest?.price ?? null, unitConfig, { decimals: 2 })}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">{latestIsFullSession ? 'Gross' : 'Observed gross'}</div>
                    <div className="font-medium text-[var(--text-primary)]">
                      {formatFlowValue(latestIsFullSession ? latest?.total_gross_value : latest?.observed_gross_value, 'value', unitConfig)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">{latestIsFullSession ? 'Big Orders' : 'Observed Big Orders'}</div>
                    <div className="font-medium text-[var(--text-primary)]">
                      {latestIsFullSession || coverage?.observed_trade_count != null ? latest?.big_order_count ?? 'N/A' : 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">{latestIsFullSession ? 'Block Trades' : 'Observed Block Trades'}</div>
                    <div className="font-medium text-[var(--text-primary)]">
                      {latestIsFullSession || coverage?.observed_trade_count != null ? latest?.block_trade_count ?? 'N/A' : 'N/A'}
                    </div>
                  </div>
                </div>
                {!latestIsFullSession ? (
                  <dl className="mt-3 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2 xl:grid-cols-3">
                    <div><dt>Observed buy value</dt><dd>{formatFlowValue(latest?.observed_buy_value, 'value', unitConfig)}</dd></div>
                    <div><dt>Observed sell value</dt><dd>{formatFlowValue(latest?.observed_sell_value, 'value', unitConfig)}</dd></div>
                    <div><dt>Observed net value</dt><dd>{formatFlowValue(latest?.observed_net_value, 'value', unitConfig)}</dd></div>
                    <div><dt>Observed buy volume</dt><dd>{formatFlowValue(latest?.observed_buy_volume, 'volume', unitConfig)}</dd></div>
                    <div><dt>Observed sell volume</dt><dd>{formatFlowValue(latest?.observed_sell_volume, 'volume', unitConfig)}</dd></div>
                    <div><dt>Observed volume</dt><dd>{formatFlowValue(latest?.observed_volume, 'volume', unitConfig)}</dd></div>
                    <div><dt>Observed net volume</dt><dd>{formatFlowValue(latest?.observed_net_volume, 'volume', unitConfig)}</dd></div>
                  </dl>
                ) : null}
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
