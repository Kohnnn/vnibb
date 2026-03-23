'use client';

import { useMemo } from 'react';
import { ExternalLink, MoveDiagonal, PenTool, Sigma } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { ChartSizeBox } from '@/components/ui/ChartSizeBox';
import { useFinancialRatios, useHistoricalPrices, useProfile, useScreenerData } from '@/lib/queries';
import { toTradingViewSymbol } from '@/lib/tradingView';
import { TradingViewAdvancedChart } from '@/components/chart/TradingViewAdvancedChart';
import { formatPercent, formatRatio } from '@/lib/formatters';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type TimeframeType = '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y';
type ChartSourceMode = 'tradingview' | 'local';

const TIMEFRAME_OPTIONS: readonly TimeframeType[] = ['1M', '3M', '6M', '1Y', '3Y', '5Y'];

const TIMEFRAME_INTERVAL_MAP: Record<TimeframeType, string> = {
  '1M': 'D',
  '3M': 'D',
  '6M': 'D',
  '1Y': 'W',
  '3Y': 'W',
  '5Y': 'M',
};

function normalizeChartTimeframe(value: string | undefined): TimeframeType {
  return TIMEFRAME_OPTIONS.includes((value || '') as TimeframeType)
    ? (value as TimeframeType)
    : '1Y';
}

interface PriceChartWidgetProps {
  id: string;
  symbol: string;
  timeframe?: string;
  isEditing?: boolean;
  onRemove?: () => void;
  enableRealtime?: boolean;
  lastRefresh?: number;
}

export function PriceChartWidget({
  id,
  symbol,
  timeframe = '1Y',
  onRemove,
}: PriceChartWidgetProps) {
  const { data: profileData } = useProfile(symbol, !!symbol);
  const {
    data: screenerData,
    isLoading: metricsLoading,
    error: metricsError,
    isFetching: metricsFetching,
    dataUpdatedAt: metricsUpdatedAt,
  } = useScreenerData({ symbol, limit: 1, enabled: Boolean(symbol) });
  const { data: ratiosData } = useFinancialRatios(symbol, { period: 'FY', enabled: Boolean(symbol) });
  const exchange = profileData?.data?.exchange;
  const metrics = screenerData?.data?.[0];
  const latestRatio = ratiosData?.data?.[0];
  const mergedMetrics: any = metrics || {
    pe: latestRatio?.pe,
    pb: latestRatio?.pb,
    roe: latestRatio?.roe,
    dividend_yield: undefined,
  };
  const hasMetrics = Boolean(mergedMetrics && Object.values(mergedMetrics).some((v) => v !== null && v !== undefined));

  const normalizedExchange = exchange?.trim().toUpperCase() || '';
  const isVietnamExchange = !normalizedExchange || ['HOSE', 'HNX', 'UPCOM'].includes(normalizedExchange);
  const [sourceMode, setSourceMode] = useLocalStorage<ChartSourceMode>(
    `vnibb_price_chart_source_${id}`,
    'tradingview'
  );
  const [selectedTimeframe, setSelectedTimeframe] = useLocalStorage<TimeframeType>(
    `vnibb_price_chart_timeframe_${id}`,
    normalizeChartTimeframe(timeframe)
  );
  const shouldUseLocalHistory = isVietnamExchange && sourceMode === 'local';

  const tvSymbol = useMemo(() => {
    return toTradingViewSymbol(symbol, exchange);
  }, [symbol, exchange]);

  const interval = useMemo(() => {
    const tf = normalizeChartTimeframe(selectedTimeframe);
    return TIMEFRAME_INTERVAL_MAP[tf] || 'D';
  }, [selectedTimeframe]);

  const dateRange = useMemo(() => {
    const tf = normalizeChartTimeframe(selectedTimeframe);
    const daysMap: Record<TimeframeType, number> = {
      '1M': 30,
      '3M': 90,
      '6M': 180,
      '1Y': 365,
      '3Y': 365 * 3,
      '5Y': 365 * 5,
    };
    const days = daysMap[tf] || 30;
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    const toDate = (value: Date) => value.toISOString().split('T')[0];
    return { startDate: toDate(start), endDate: toDate(end) };
  }, [selectedTimeframe]);

  const historicalQuery = useHistoricalPrices(symbol, {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    interval: '1D',
    enabled: Boolean(symbol) && shouldUseLocalHistory,
  });

  const historicalData = historicalQuery.data?.data || [];
  const historyLoading = historicalQuery.isLoading;
  const historyError = historicalQuery.error;
  const hasHistory = historicalData.length > 0;
  const historyUpdatedAt = historicalQuery.dataUpdatedAt;
  const localChartData = useMemo(
    () =>
      historicalData.map((point) => ({
        date: point.time,
        close: point.close,
      })),
    [historicalData]
  );
  const tradingViewUrl = tvSymbol
    ? `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`
    : 'https://www.tradingview.com/';
  const featureChips = shouldUseLocalHistory
    ? ['VNIBB price history', 'Fast local reloads', 'Clean trend view']
    : ['Drawing tools', 'Fibonacci', 'Indicators'];

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
      <div className="h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-0.5">
                {TIMEFRAME_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSelectedTimeframe(option)}
                    className={`rounded px-2 py-1 text-[10px] font-semibold transition-colors ${
                      selectedTimeframe === option
                        ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSourceMode('tradingview')}
                  className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                    !shouldUseLocalHistory
                      ? 'border-blue-500/50 bg-blue-500/15 text-blue-200'
                      : 'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  TradingView
                </button>
                <button
                  type="button"
                  disabled={!isVietnamExchange}
                  onClick={() => setSourceMode('local')}
                  className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                    shouldUseLocalHistory
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                      : 'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                  title={isVietnamExchange ? 'Use VNIBB historical prices' : 'Local mode is available for VN exchanges only'}
                >
                  Local
                </button>
              </div>

              {!shouldUseLocalHistory && (
                <a
                  href={tradingViewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] font-semibold text-blue-200 transition-colors hover:bg-blue-500/20"
                >
                  <ExternalLink size={11} />
                  Open
                </a>
              )}

              <div className="hidden items-center gap-1 md:flex">
                {featureChips.map((feature) => {
                  const Icon = feature === 'Drawing tools' ? PenTool : feature === 'Fibonacci' ? MoveDiagonal : feature === 'Indicators' ? Sigma : null;
                  return (
                    <span
                      key={feature}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-[var(--text-muted)]"
                    >
                      {Icon ? <Icon size={10} /> : null}
                      {feature}
                    </span>
                  );
                })}
              </div>
            </div>
            <WidgetMeta
              sourceLabel={shouldUseLocalHistory ? 'VNIBB' : 'TradingView'}
              note={shouldUseLocalHistory ? `${selectedTimeframe} local history` : `${selectedTimeframe} advanced chart`}
              updatedAt={shouldUseLocalHistory ? historyUpdatedAt : undefined}
              isFetching={shouldUseLocalHistory ? historicalQuery.isFetching && hasHistory : undefined}
              align="right"
            />
          </div>
        </div>
        <div className="relative flex-1 w-full">
          {shouldUseLocalHistory ? (
            historyLoading && !hasHistory ? (
              <WidgetSkeleton lines={6} />
            ) : historyError && !hasHistory ? (
              <WidgetEmpty message="Price history not available yet." />
            ) : !hasHistory ? (
              <WidgetEmpty message="No historical price data available." />
            ) : (
              <ChartSizeBox className="h-full" minHeight={180}>
                {({ width, height }) => (
                <LineChart width={width} height={height} data={localChartData} margin={{ top: 12, right: 16, left: 12, bottom: 12 }}>
                  <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    domain={['auto', 'auto']}
                    label={{ value: 'VND', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-tooltip)', border: '1px solid var(--border-default)', fontSize: '11px' }}
                    labelStyle={{ color: 'var(--text-muted)' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="close"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
                )}
              </ChartSizeBox>
            )
          ) : (
            <div className="relative h-full w-full">
              <TradingViewAdvancedChart symbol={tvSymbol || symbol} exchange={exchange} interval={interval} />
              <div className="pointer-events-none absolute bottom-1 left-2 text-[9px] text-[var(--text-muted)]">
                TradingView toolbar includes drawing tools, Fibonacci, and indicator overlays
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-[var(--border-subtle)]">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Fundamentals</span>
            <WidgetMeta
              updatedAt={metricsUpdatedAt}
              isFetching={metricsFetching && hasMetrics}
              note="Screener"
              align="right"
            />
          </div>
          <div className="px-3 pb-3">
            {metricsLoading && !hasMetrics ? (
              <WidgetSkeleton lines={2} />
            ) : metricsError && !hasMetrics ? (
              <div className="text-xs text-[var(--text-muted)]">Fundamentals not available yet.</div>
            ) : !hasMetrics ? (
              <div className="text-xs text-[var(--text-muted)]">Fundamentals not available yet.</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { label: 'P/E', value: formatRatio(mergedMetrics.pe) },
                  { label: 'P/B', value: formatRatio(mergedMetrics.pb) },
                  { label: 'ROE', value: formatPercent(mergedMetrics.roe) },
                  { label: 'Div Yield', value: formatPercent(mergedMetrics.dividend_yield) },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-2"
                  >
                    <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">
                      {item.label}
                    </div>
                    <div className="text-xs font-mono text-[var(--text-secondary)]">{item.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </WidgetContainer>
  );
}

export default PriceChartWidget;
