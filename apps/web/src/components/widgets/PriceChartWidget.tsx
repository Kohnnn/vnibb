'use client';

import { useMemo } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { ChartSizeBox } from '@/components/ui/ChartSizeBox';
import { useFinancialRatios, useHistoricalPrices, useProfile, useScreenerData } from '@/lib/queries';
import { toTradingViewSymbol } from '@/lib/tradingView';
import { TradingViewAdvancedChart } from '@/components/chart/TradingViewAdvancedChart';
import { formatPercent, formatRatio } from '@/lib/formatters';
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type TimeframeType = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL';

const TIMEFRAME_INTERVAL_MAP: Record<TimeframeType, string> = {
  '1D': 'D',
  '5D': 'D',
  '1M': 'D',
  '3M': 'D',
  '6M': 'D',
  '1Y': 'W',
  '5Y': 'M',
  'ALL': 'M',
};

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
  timeframe = '1M',
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
  const { data: ratiosData } = useFinancialRatios(symbol, { period: 'year', enabled: Boolean(symbol) });
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

  const tvSymbol = useMemo(() => {
    return toTradingViewSymbol(symbol, exchange);
  }, [symbol, exchange]);

  const interval = useMemo(() => {
    const tf = (timeframe || '1M') as TimeframeType;
    return TIMEFRAME_INTERVAL_MAP[tf] || 'D';
  }, [timeframe]);

  const dateRange = useMemo(() => {
    const tf = (timeframe || '1M') as TimeframeType;
    const daysMap: Record<TimeframeType, number> = {
      '1D': 7,
      '5D': 10,
      '1M': 30,
      '3M': 90,
      '6M': 180,
      '1Y': 365,
      '5Y': 365 * 5,
      'ALL': 365 * 10,
    };
    const days = daysMap[tf] || 30;
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    const toDate = (value: Date) => value.toISOString().split('T')[0];
    return { startDate: toDate(start), endDate: toDate(end) };
  }, [timeframe]);

  const historicalQuery = useHistoricalPrices(symbol, {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    interval: '1D',
    enabled: Boolean(symbol) && isVietnamExchange,
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
      <div className="h-full flex flex-col bg-[#0a0a0a]">
        <div className="px-3 py-2 border-b border-gray-800/60">
          <WidgetMeta
            sourceLabel={isVietnamExchange ? 'VNIBB' : 'TradingView'}
            note={isVietnamExchange ? 'Local historical data' : 'Streaming via TradingView'}
            updatedAt={isVietnamExchange ? historyUpdatedAt : undefined}
            isFetching={isVietnamExchange ? historicalQuery.isFetching && hasHistory : undefined}
            align="right"
          />
        </div>
        <div className="relative flex-1 w-full">
          {isVietnamExchange ? (
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
                  <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#9ca3af', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#9ca3af', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0b1221', border: '1px solid #1f2937', fontSize: '11px' }}
                    labelStyle={{ color: '#9ca3af' }}
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
            <TradingViewAdvancedChart symbol={tvSymbol || symbol} interval={interval} />
          )}
        </div>
        <div className="border-t border-gray-800/60">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Fundamentals</span>
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
              <div className="text-xs text-gray-500">Fundamentals not available yet.</div>
            ) : !hasMetrics ? (
              <div className="text-xs text-gray-500">Fundamentals not available yet.</div>
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
                    className="rounded-lg border border-gray-800/60 bg-black/20 px-2 py-2"
                  >
                    <div className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">
                      {item.label}
                    </div>
                    <div className="text-xs font-mono text-gray-200">{item.value}</div>
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
