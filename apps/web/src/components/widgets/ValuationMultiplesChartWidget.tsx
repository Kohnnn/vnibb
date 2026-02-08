'use client';

import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useRatioHistory } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { ChartSizeBox } from '@/components/ui/ChartSizeBox';

interface ValuationMultiplesChartWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

const SERIES = [
  { key: 'pe', label: 'P/E', color: '#38bdf8' },
  { key: 'pb', label: 'P/B', color: '#22c55e' },
  { key: 'ps', label: 'P/S', color: '#f59e0b' },
  { key: 'ev_ebitda', label: 'EV/EBITDA', color: '#f97316' },
  { key: 'ev_sales', label: 'EV/Sales', color: '#e11d48' },
];

export function ValuationMultiplesChartWidget({ id, symbol, onRemove }: ValuationMultiplesChartWidgetProps) {
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useRatioHistory(symbol, {
    ratios: ['pe', 'pb', 'ps', 'ev_ebitda', 'ev_sales'],
    period: 'year',
    limit: 20,
    enabled: !!symbol,
  });

  const rows = data?.data || [];
  const hasData = rows.length > 0;
  const isFallback = Boolean(error && hasData);

  const chartData = useMemo(() => {
    if (!rows.length) return [];
    return [...rows]
      .slice()
      .reverse()
      .map((row) => ({
        period: row.period || '-',
        pe: row.pe ?? null,
        pb: row.pb ?? null,
        ps: row.ps ?? null,
        ev_ebitda: row.ev_ebitda ?? null,
        ev_sales: row.ev_sales ?? null,
      }));
  }, [rows]);

  if (!symbol) {
    return <WidgetEmpty message="Select a symbol to view valuation multiples" icon={<BarChart3 size={18} />} />;
  }

  return (
    <WidgetContainer
      title="Valuation Multiples"
      symbol={symbol}
      widgetId={id}
      onClose={onRemove}
      onRefresh={() => refetch()}
      isLoading={isLoading && !hasData}
      noPadding
      exportData={rows}
      exportFilename={`valuation_multiples_${symbol}`}
    >
      <div className="h-full flex flex-col bg-[#0a0a0a]">
        <div className="px-3 py-2 border-b border-gray-800/60">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note="Annual"
            align="right"
          />
        </div>
        <div className="flex-1 px-2 py-2">
          {isLoading && !hasData ? (
            <WidgetSkeleton variant="chart" />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message={`No valuation history for ${symbol}`} icon={<BarChart3 size={18} />} />
          ) : (
            <ChartSizeBox className="h-full" minHeight={220}>
              {({ width, height }) => (
                <LineChart width={width} height={height} data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="period"
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
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  {SERIES.map((series) => (
                    <Line
                      key={series.key}
                      type="monotone"
                      dataKey={series.key}
                      name={series.label}
                      stroke={series.color}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              )}
            </ChartSizeBox>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export default ValuationMultiplesChartWidget;
