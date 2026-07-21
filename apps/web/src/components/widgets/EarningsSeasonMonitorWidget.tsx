'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, CalendarClock, Search, Sparkles } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { useEarningsSeason } from '@/lib/queries';
import { formatCompact } from '@/lib/format';
import { formatNumber, formatPercent } from '@/lib/units';
import { formatRelativeTime } from '@/lib/format';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import type { WidgetGroupId } from '@/types/widget';

interface EarningsSeasonMonitorWidgetProps {
  id: string;
  symbol?: string;
  widgetGroup?: WidgetGroupId;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
}

const EXCHANGES = ['ALL', 'HOSE', 'HNX', 'UPCOM'] as const;
const SIGNALS = ['ALL', 'High Conviction', 'Watch', 'Mixed', 'Caution'] as const;

type ExchangeFilter = (typeof EXCHANGES)[number];
type SignalFilter = (typeof SIGNALS)[number];
type SortMode = 'newest' | 'score' | 'revenue' | 'earnings';

function signalTone(signal: string): string {
  if (signal === 'High Conviction') return 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10';
  if (signal === 'Watch') return 'text-cyan-300 border-cyan-500/20 bg-cyan-500/10';
  if (signal === 'Mixed') return 'text-amber-300 border-amber-500/20 bg-amber-500/10';
  return 'text-rose-300 border-rose-500/20 bg-rose-500/10';
}

export function EarningsSeasonMonitorWidget({ id, widgetGroup, onRemove, onDataChange }: EarningsSeasonMonitorWidgetProps) {
  const [exchange, setExchange] = useState<ExchangeFilter>('ALL');
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('ALL');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup, { widgetType: 'earnings_season_monitor' });
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useEarningsSeason({
    exchange: exchange === 'ALL' ? undefined : exchange,
    limit: 24,
  });

  const rows = data?.data || [];
  const sourceError = data?.error || null;
  const latestDate = data?.updated_at || null;
  const yoyCoverage = useMemo(
    () => rows.filter((row) => row.revenue_yoy != null || row.earnings_yoy != null).length,
    [rows],
  );
  const filteredRows = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const nextRows = rows.filter((row) => {
      if (exchange !== 'ALL' && row.exchange !== exchange) return false;
      if (signalFilter !== 'ALL' && row.signal !== signalFilter) return false;
      if (!normalizedQuery) return true;
      return `${row.symbol} ${row.name} ${row.period}`.toLowerCase().includes(normalizedQuery);
    });

    nextRows.sort((left, right) => {
      const comparison = sortMode === 'score'
        ? (right.score ?? -999) - (left.score ?? -999)
        : sortMode === 'revenue'
          ? (right.revenue_yoy ?? -999) - (left.revenue_yoy ?? -999)
          : sortMode === 'earnings'
            ? (right.earnings_yoy ?? -999) - (left.earnings_yoy ?? -999)
            : `${right.updated_at || ''}`.localeCompare(left.updated_at || '');
      return comparison || left.symbol.localeCompare(right.symbol) || left.period.localeCompare(right.period);
    });

    return nextRows;
  }, [exchange, rows, searchQuery, signalFilter, sortMode]);
  const hasData = filteredRows.length > 0;

  const summary = useMemo(() => {
    const positiveRevenue = filteredRows.filter((row) => (row.revenue_yoy ?? -999) > 0).length;
    const positiveEarnings = filteredRows.filter((row) => (row.earnings_yoy ?? -999) > 0).length;
    const highConviction = filteredRows.filter((row) => row.signal === 'High Conviction').length;
    return { positiveRevenue, positiveEarnings, highConviction };
  }, [filteredRows]);

  useEffect(() => {
    onDataChange?.(
      buildWidgetRuntime({
        empty: !hasData,
        apiGroup: '/market',
        endpoint: `/market/earnings-season?limit=24${exchange === 'ALL' ? '' : `&exchange=${exchange}`}`,
        sourceLabel: 'VNIBB stored income statements',
        lastDataDate: latestDate || dataUpdatedAt,
        stale: Boolean((error || sourceError) && hasData),
        extra: {
          count: filteredRows.length,
          resultCount: data?.count ?? rows.length,
          latestDate,
          source: 'VNIBB stored income statements',
          yoyCoverage: { available: yoyCoverage, total: rows.length },
        },
      }),
    );
  }, [onDataChange, hasData, latestDate, dataUpdatedAt, error, sourceError, filteredRows.length, exchange, data?.count, rows.length, yoyCoverage]);

  return (
    <WidgetContainer
      title="Earnings Season"
      widgetId={id}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-blue-400" />
              <div>
                <div className="text-xs font-semibold text-[var(--text-primary)]">{data?.season || 'Latest quarterly releases'}</div>
                <div className="text-[10px] text-[var(--text-muted)]">Cross-check new quarterly statements and prioritize follow-up names.</div>
              </div>
            </div>
            <WidgetMeta
              updatedAt={data?.updated_at || dataUpdatedAt}
              isFetching={isFetching && hasData}
              note={`${data?.count ?? rows.length} results · ${latestDate ? `latest ${latestDate}` : 'latest date unavailable'}`}
              align="right"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {EXCHANGES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setExchange(option)}
                className={`rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${exchange === option ? 'border-blue-500/40 bg-blue-500/10 text-blue-300' : 'border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <label className="flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
              <Search className="h-3.5 w-3.5" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Filter symbol or period"
                className="w-full bg-transparent text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
              <ArrowUpDown className="h-3.5 w-3.5" />
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="bg-transparent text-xs font-semibold text-[var(--text-primary)] outline-none"
              >
                <option value="newest">Newest</option>
                <option value="score">Top Score</option>
                <option value="revenue">Revenue YoY</option>
                <option value="earnings">Earnings YoY</option>
              </select>
            </label>
            <label className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
              <select
                value={signalFilter}
                onChange={(event) => setSignalFilter(event.target.value as SignalFilter)}
                className="bg-transparent text-xs font-semibold text-[var(--text-primary)] outline-none"
              >
                {SIGNALS.map((signal) => (
                  <option key={signal} value={signal}>{signal}</option>
                ))}
              </select>
            </label>
          </div>

          {sourceError ? <div className="mt-2 text-[10px] text-amber-300">Source warning: {sourceError}</div> : null}
          {hasData ? <div className="mt-2 text-[10px] text-[var(--text-muted)]">YoY available for {yoyCoverage} of {rows.length} results. Missing fields are unavailable from stored comparable statements.</div> : null}

          <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
            <SummaryCard label="Revenue Up" value={summary.positiveRevenue} tone="text-cyan-300" />
            <SummaryCard label="Earnings Up" value={summary.positiveEarnings} tone="text-emerald-300" />
            <SummaryCard label="High Conviction" value={summary.highConviction} tone="text-amber-300" />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={8} />
          ) : (error || sourceError) && !hasData ? (
            <WidgetError error={(error ?? new Error(sourceError ?? 'Earnings season data unavailable')) as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty
              message={rows.length > 0 ? 'No releases match the current filters' : 'No stored quarterly statements are available'}
              detail={rows.length > 0 ? 'Try another exchange, signal, or search term.' : 'This reflects stored source coverage and does not mean no companies reported.'}
              icon={<Sparkles size={18} />}
            />
          ) : (
            <div className="space-y-2">
              {filteredRows.map((row) => (
                <button
                  key={`${row.symbol}-${row.period}`}
                  type="button"
                  onClick={() => setLinkedSymbol(row.symbol)}
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 text-left transition-colors hover:border-blue-500/30 hover:bg-[var(--bg-tertiary)]/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--text-primary)]">{row.symbol}</span>
                        {row.exchange ? (
                          <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[9px] font-semibold uppercase text-[var(--text-muted)]">
                            {row.exchange}
                          </span>
                        ) : null}
                        <span className="text-[10px] text-[var(--text-muted)]">{row.period}</span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-1">{row.name}</div>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${signalTone(row.signal)}`}>
                      {row.signal}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                    <Metric label="Revenue YoY" value={formatPercent(row.revenue_yoy, { decimals: 1, input: 'percent', clamp: 'yoy_change' })} />
                    <Metric label="Earnings YoY" value={formatPercent(row.earnings_yoy, { decimals: 1, input: 'percent', clamp: 'yoy_change' })} />
                    <Metric label="Gross Margin" value={formatPercent(row.gross_margin, { decimals: 1, input: 'percent', clamp: 'margin' })} />
                    <Metric label="Margin Delta" value={formatPercent(row.gross_margin_delta, { decimals: 1, input: 'percent', clamp: 'margin' })} />
                    <Metric label="EPS" value={formatNumber(row.eps, { decimals: 2 })} />
                  </div>

                  <div className="mt-3 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                    <div className="flex items-center gap-3">
                      <span>Revenue {formatCompact(row.revenue, 1)}</span>
                      <span>Net Income {formatCompact(row.net_income, 1)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {typeof row.score === 'number' ? <span>Score {row.score.toFixed(1)}</span> : null}
                      {row.updated_at ? <span>{formatRelativeTime(row.updated_at)}</span> : null}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-xs font-semibold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

export default EarningsSeasonMonitorWidget;
