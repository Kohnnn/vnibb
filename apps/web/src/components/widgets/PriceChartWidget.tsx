'use client';

import { useContext, useEffect, useState } from 'react';
import { BarChart3, ChartArea, ChartLine, Sigma } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useFinancialRatios, useProfile, useScreenerData } from '@/lib/queries';
import type { WidgetDataPayload } from '@/lib/widgetRuntime';
import { latestByFinancialPeriod } from '@/lib/financialPeriods';
import { TradingViewAdvancedChart } from '@/components/chart/TradingViewAdvancedChart';
import { PRICE_CHART_TIMEFRAME_OPTIONS, PRICE_CHART_MODE_OPTIONS } from '@/lib/priceChartControls';
import {
  buildPriceHistoryRuntime,
  PriceChartScopeContext,
  usePriceChartScope,
  type PriceHistoryStatus,
} from '@/lib/priceChartScope';
import { formatDividendYield, formatPercent, formatRatio, readDividendYield } from '@/lib/formatters';
import { firstFinite } from './utils';

const CHART_MODE_ICONS = { candles: BarChart3, line: ChartLine, area: ChartArea };
const CHART_FEATURES = ['Volume', 'Crosshair', 'Fast symbol switching'] as const;

interface PriceChartWidgetProps {
  id: string;
  symbol: string;
  timeframe?: string;
  config?: Record<string, unknown>;
  onConfigChange?: (updates: Record<string, unknown>) => void;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
}

interface SnapshotMetric {
  pe: number | null;
  pb: number | null;
  roe: number | null;
  dividendYield: number | null;
}

export function PriceChartWidget({ id, symbol, timeframe = '1Y', config, onConfigChange, onRemove, onDataChange }: PriceChartWidgetProps) {
  const { data: profileData } = useProfile(symbol, !!symbol);
  const {
    data: screenerData,
    isLoading: metricsLoading,
    isFetching: metricsFetching,
    isError: screenerFailed,
    dataUpdatedAt: metricsFetchedAt,
  } = useScreenerData({ symbol, limit: 1, enabled: Boolean(symbol) });
  const {
    data: ratiosData, isLoading: ratiosLoading, isFetching: ratiosFetching, isError: ratiosFailed,
  } = useFinancialRatios(symbol, { period: 'FY', enabled: Boolean(symbol) });

  const dashboardScope = useContext(PriceChartScopeContext);
  const standaloneScope = usePriceChartScope(symbol, { ...config, timeframe: config?.timeframe ?? timeframe }, !dashboardScope);
  const scope = dashboardScope ?? standaloneScope;
  const { request, controls, setAdjustmentMode } = scope;
  const { timeframe: selectedTimeframe, chartType: chartMode, compareSymbol: compareInput } = controls;
  const updateControls = (updates: Partial<typeof controls>) => {
    scope.updateControls(updates);
    onConfigChange?.(updates);
  };

  const exchange = profileData?.data?.exchange;
  const metrics = screenerData?.data[0];
  const latestRatio = latestByFinancialPeriod(ratiosData?.data);
  const ratioMetrics: SnapshotMetric = {
    pe: firstFinite(latestRatio?.pe),
    pb: firstFinite(latestRatio?.pb),
    roe: firstFinite(latestRatio?.roe),
    dividendYield: firstFinite(readDividendYield(latestRatio?.dividend_yield, latestRatio?.ratio_units?.dividend_yield)),
  };
  const snapshotMetrics: SnapshotMetric = {
    pe: ratioMetrics.pe ?? firstFinite(metrics?.pe),
    pb: ratioMetrics.pb ?? firstFinite(metrics?.pb),
    roe: ratioMetrics.roe ?? firstFinite(metrics?.roe),
    dividendYield: ratioMetrics.dividendYield ?? firstFinite(readDividendYield(metrics?.dividend_yield, metrics?.ratio_units?.dividend_yield)),
  };
  const hasMetrics = Object.values(snapshotMetrics).some((value) => value !== null);
  const hasRatioMetrics = Object.values(ratioMetrics).some((value) => value !== null);
  const screenerMeta = screenerData?.meta;
  const screenerUnavailable = screenerMeta?.availability === 'unavailable' ||
    (!metrics && (screenerFailed || Boolean(screenerData?.error)));
  const screenerStale = screenerMeta?.stale || screenerMeta?.source === 'stale_cache';
  const screenerFallback = screenerMeta?.fallback || screenerMeta?.source === 'fallback_cache';
  let screenerNotice: string | undefined;
  if (screenerUnavailable) {
    screenerNotice = 'Screener data is unavailable.';
  } else if (screenerFailed) {
    screenerNotice = 'Screener refresh failed. Keeping the previously fetched screener snapshot.';
  } else if (screenerFallback) {
    screenerNotice = screenerStale ? 'Using a stale fallback screener snapshot.' : 'Using a fallback screener snapshot.';
  } else if (screenerStale) {
    screenerNotice = 'Using a stale screener snapshot.';
  } else if (screenerData?.error) {
    screenerNotice = 'Screener delivery is incomplete.';
  }
  const ratiosNotice = ratiosFailed
    ? hasRatioMetrics ? 'Financial ratios refresh failed. Keeping the previously fetched ratios.' : 'Financial ratios are unavailable.'
    : ratiosData?.error
      ? hasRatioMetrics ? 'Financial ratios delivery is incomplete. Showing available ratios.' : 'Financial ratios are unavailable.'
      : null;

  const [historyStatus, setHistoryStatus] = useState<PriceHistoryStatus>();
  const currentStatus = historyStatus?.request === request ? historyStatus : undefined;
  useEffect(() => {
    if (request) onDataChange?.(buildPriceHistoryRuntime(request, chartMode, currentStatus));
  }, [chartMode, currentStatus, onDataChange, request]);

  if (!symbol || !request) {
    return <WidgetEmpty message="Select a symbol to view the chart" />;
  }

  return (
    <WidgetContainer
      title="Price Chart"
      symbol={symbol}
      onClose={onRemove}
      noPadding
      widgetId={id}
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        <div role="group" aria-label="Chart settings" className="border-b border-[var(--border-subtle)] px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-0.5" role="group" aria-label="Chart timeframe">
                {PRICE_CHART_TIMEFRAME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateControls({ timeframe: option.value })}
                    aria-pressed={selectedTimeframe === option.value}
                    className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                      selectedTimeframe === option.value
                        ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-0.5" role="group" aria-label="Chart mode">
                {PRICE_CHART_MODE_OPTIONS.map((option) => {
                  const Icon = CHART_MODE_ICONS[option.value];
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateControls({ chartType: option.value })}
                      aria-label={option.label}
                      aria-pressed={chartMode === option.value}
                      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                        chartMode === option.value
                          ? 'bg-[var(--color-state-bg)] text-[var(--color-accent-primary)]'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <Icon size={12} />
                      <span className="hidden sm:inline">{option.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="hidden items-center gap-1 md:flex">
                {CHART_FEATURES.map((feature) => (
                  <span
                    key={feature}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 text-[10px] font-semibold text-[var(--text-muted)]"
                  >
                    <Sigma size={10} />
                    {feature}
                  </span>
                ))}
              </div>

              <label className="flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1 text-[11px] font-semibold text-[var(--text-muted)]">
                <span className="hidden lg:inline">Compare</span>
                <input
                  value={compareInput}
                  onChange={(event) => updateControls({ compareSymbol: event.target.value.toUpperCase() })}
                  placeholder="Ticker"
                  className="w-16 bg-transparent font-mono text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                  aria-label="Compare ticker"
                />
                {compareInput ? (
                  <button
                    type="button"
                    onClick={() => updateControls({ compareSymbol: '' })}
                    className="rounded px-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    aria-label="Clear compare ticker"
                  >
                    Clear
                  </button>
                ) : null}
              </label>
            </div>

            <WidgetMeta
              sourceLabel="VniBB"
              note={exchange ? `Listing venue: ${exchange}` : undefined}
              align="right"
            />
          </div>
        </div>

        <section aria-label="Price history chart" className="relative flex-1 min-h-[220px]">
          <TradingViewAdvancedChart
            symbol={symbol}
            timeframe={selectedTimeframe}
            mode={chartMode}
            className="h-full"
            height={220}
            history={{ request, setAdjustmentMode }}
            onHistoryStatusChange={setHistoryStatus}
          />
        </section>

        <section aria-label="Fundamentals Snapshot" className="border-t border-[var(--border-subtle)] px-3 py-2.5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Fundamentals Snapshot
            </h3>
            <WidgetMeta
              fetchedAt={hasMetrics && !hasRatioMetrics && !screenerUnavailable ? metricsFetchedAt : undefined}
              isFetching={(metricsFetching || ratiosFetching) && hasMetrics}
              note={hasRatioMetrics ? 'Ratios prioritized' : undefined}
              align="right"
            />
          </div>

          {screenerNotice && (
            <p role="status" aria-label="Screener delivery" className="mb-2 text-xs text-[var(--color-warning)]">
              {screenerNotice}
            </p>
          )}
          {ratiosNotice && (
            <p role="status" aria-label="Financial ratios delivery" className="mb-2 text-xs text-[var(--color-warning)]">
              {ratiosNotice}
            </p>
          )}

          {(metricsLoading || ratiosLoading) && !hasMetrics ? (
            <WidgetSkeleton lines={2} />
          ) : !hasMetrics ? (
            <div className="text-sm text-[var(--text-muted)]">Fundamentals not available yet.</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {[
                { label: 'P/E', value: formatRatio(snapshotMetrics.pe), tone: 'border-[var(--color-state-border)] bg-[var(--color-state-bg)]/[0.06]' },
                { label: 'P/B', value: formatRatio(snapshotMetrics.pb), tone: 'border-[var(--color-state-border)] bg-[var(--color-state-bg)]/[0.06]' },
                { label: 'ROE', value: formatPercent(snapshotMetrics.roe), tone: 'border-[var(--color-state-border)] bg-[var(--color-positive-bg)]/[0.06]' },
                { label: 'Dividend Yield', value: formatDividendYield(snapshotMetrics.dividendYield), tone: 'border-[var(--color-state-border)] bg-[var(--color-state-bg)]/[0.06]' },
              ].map((item) => (
                <div
                  key={item.label}
                  className={`rounded-xl border px-3 py-2.5 ${item.tone}`}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {item.label}
                  </div>
                  <div className="mt-1 text-sm font-mono font-semibold text-[var(--text-primary)] tabular-nums">
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </WidgetContainer>
  );
}

export default PriceChartWidget;
