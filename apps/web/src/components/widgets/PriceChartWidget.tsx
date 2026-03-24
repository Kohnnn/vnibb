'use client';

import { useMemo, useState } from 'react';
import { BarChart3, ChartArea, ChartLine, Sigma } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useFinancialRatios, useProfile, useScreenerData } from '@/lib/queries';
import {
  TradingViewAdvancedChart,
  type AdvancedChartMode,
  type AdvancedChartTimeframe,
} from '@/components/chart/TradingViewAdvancedChart';
import { formatPercent, formatRatio } from '@/lib/formatters';

const TIMEFRAME_OPTIONS: readonly AdvancedChartTimeframe[] = [
  '1D',
  '5D',
  '1M',
  '3M',
  '6M',
  '1Y',
  '3Y',
  '5Y',
  'YTD',
];

const CHART_MODE_OPTIONS: Array<{ value: AdvancedChartMode; label: string; icon: typeof BarChart3 }> = [
  { value: 'candles', label: 'Candles', icon: BarChart3 },
  { value: 'line', label: 'Line', icon: ChartLine },
  { value: 'area', label: 'Area', icon: ChartArea },
];

interface PriceChartWidgetProps {
  id: string;
  symbol: string;
  timeframe?: string;
  onRemove?: () => void;
}

function normalizeChartTimeframe(value: string | undefined): AdvancedChartTimeframe {
  return TIMEFRAME_OPTIONS.includes((value || '') as AdvancedChartTimeframe)
    ? (value as AdvancedChartTimeframe)
    : '1Y';
}

export function PriceChartWidget({ id, symbol, timeframe = '1Y', onRemove }: PriceChartWidgetProps) {
  const { data: profileData } = useProfile(symbol, !!symbol);
  const {
    data: screenerData,
    isLoading: metricsLoading,
    error: metricsError,
    isFetching: metricsFetching,
    dataUpdatedAt: metricsUpdatedAt,
  } = useScreenerData({ symbol, limit: 1, enabled: Boolean(symbol) });
  const { data: ratiosData } = useFinancialRatios(symbol, { period: 'FY', enabled: Boolean(symbol) });

  const [selectedTimeframe, setSelectedTimeframe] = useState<AdvancedChartTimeframe>(
    normalizeChartTimeframe(timeframe)
  );
  const [chartMode, setChartMode] = useState<AdvancedChartMode>('candles');

  const exchange = profileData?.data?.exchange;
  const metrics = screenerData?.data?.[0];
  const latestRatio = ratiosData?.data?.[0];
  const mergedMetrics: any = metrics || {
    pe: latestRatio?.pe,
    pb: latestRatio?.pb,
    roe: latestRatio?.roe,
    dividend_yield: undefined,
  };
  const hasMetrics = Boolean(
    mergedMetrics && Object.values(mergedMetrics).some((value) => value !== null && value !== undefined)
  );

  const featureChips = useMemo(() => ['Live data', 'Volume', 'Crosshair', 'Fast symbol switching'], []);

  if (!symbol) {
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
        <div className="border-b border-[var(--border-subtle)] px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-0.5">
                {TIMEFRAME_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSelectedTimeframe(option)}
                    className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                      selectedTimeframe === option
                        ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-0.5">
                {CHART_MODE_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setChartMode(option.value)}
                      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                        chartMode === option.value
                          ? 'bg-sky-500/15 text-sky-200'
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
                {featureChips.map((feature) => (
                  <span
                    key={feature}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 text-[10px] font-semibold text-[var(--text-muted)]"
                  >
                    <Sigma size={10} />
                    {feature}
                  </span>
                ))}
              </div>
            </div>

            <WidgetMeta
              sourceLabel={exchange || 'VNIBB'}
              note={`${selectedTimeframe} lightweight chart`}
              updatedAt={metricsUpdatedAt}
              isFetching={metricsFetching && hasMetrics}
              align="right"
            />
          </div>
        </div>

        <div className="relative flex-1 min-h-[320px]">
          <TradingViewAdvancedChart
            symbol={symbol}
            timeframe={selectedTimeframe}
            mode={chartMode}
            className="h-full"
            height={320}
          />
          <div className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-[var(--text-muted)]">
            Lightweight TradingView-style chart using live VNIBB data without local chart caching
          </div>
        </div>

        <div className="border-t border-[var(--border-subtle)] px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Fundamentals Snapshot
            </span>
            <WidgetMeta
              updatedAt={metricsUpdatedAt}
              isFetching={metricsFetching && hasMetrics}
              note="Screener"
              align="right"
            />
          </div>

          {metricsLoading && !hasMetrics ? (
            <WidgetSkeleton lines={2} />
          ) : metricsError && !hasMetrics ? (
            <div className="text-sm text-[var(--text-muted)]">Fundamentals not available yet.</div>
          ) : !hasMetrics ? (
            <div className="text-sm text-[var(--text-muted)]">Fundamentals not available yet.</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {[
                { label: 'P/E', value: formatRatio(mergedMetrics.pe) },
                { label: 'P/B', value: formatRatio(mergedMetrics.pb) },
                { label: 'ROE', value: formatPercent(mergedMetrics.roe) },
                { label: 'Div Yield', value: formatPercent(mergedMetrics.dividend_yield) },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-2"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {item.label}
                  </div>
                  <div className="mt-1 text-sm font-mono font-semibold text-[var(--text-primary)]">
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export default PriceChartWidget;
