'use client';

import { useEffect } from 'react';
import { useScreenerData } from '@/lib/queries';
import { formatRatio } from '@/lib/formatters';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell
} from 'recharts';
import { ChartSizeBox } from '@/components/ui/ChartSizeBox';

interface ValuationWidgetProps {
  symbol: string;
  onDataChange?: (data: any) => void;
}

export function ValuationWidget({ symbol, onDataChange }: ValuationWidgetProps) {
  const { data: peerData, isLoading, error, refetch, isFetching, dataUpdatedAt } = useScreenerData({
    limit: 10,
  });

  const stocks = peerData?.data || [];
  const hasData = stocks.length > 0;
  const isFallback = Boolean(error && hasData);
  const currentStock = stocks.find(s => s.ticker === symbol) || stocks[0];

  useEffect(() => {
    if (peerData) {
      onDataChange?.(peerData);
    }
  }, [peerData, onDataChange]);

  if (isLoading && !hasData) return <WidgetSkeleton variant="chart" />;
  if (error && !hasData) return <WidgetError error={error as Error} onRetry={() => refetch()} />;
  if (!hasData) return <WidgetEmpty message="No valuation data" />;

  const chartData = stocks.slice(0, 8).map(s => ({
    name: s.ticker,
    pe: s.pe || 0,
    pb: s.pb || 0,
    isCurrent: s.ticker === symbol
  }));

  return (
    <div className="p-4 flex flex-col h-full space-y-3 overflow-hidden">
      <WidgetMeta
        updatedAt={dataUpdatedAt}
        isFetching={isFetching && hasData}
        isCached={isFallback}
        note="Peer snapshot"
        align="right"
      />

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[var(--bg-secondary)] p-3 rounded-lg border border-[var(--border-default)]">
          <span className="text-[10px] text-[var(--text-muted)] uppercase font-bold">P/E Ratio</span>
          <div className="text-xl font-bold text-[var(--text-primary)] mt-1">
            {formatRatio(currentStock?.pe)}
          </div>
        </div>
        <div className="bg-[var(--bg-secondary)] p-3 rounded-lg border border-[var(--border-default)]">
          <span className="text-[10px] text-[var(--text-muted)] uppercase font-bold">P/B Ratio</span>
          <div className="text-xl font-bold text-[var(--text-primary)] mt-1">
            {formatRatio(currentStock?.pb)}
          </div>
        </div>
      </div>

      <div className="flex-1 w-full">
        <h3 className="text-[10px] text-[var(--text-muted)] uppercase font-bold mb-3">Peer P/E Comparison</h3>
        <ChartSizeBox className="h-full" minHeight={140}>
          {({ width, height }) => (
            <BarChart width={width} height={height} data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--bg-tooltip)', border: '1px solid var(--border-default)', fontSize: '12px' }}
                itemStyle={{ color: 'var(--text-primary)' }}
              />
              <Bar dataKey="pe" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.isCurrent ? '#3b82f6' : 'var(--bg-secondary)'}
                    stroke={entry.isCurrent ? '#60a5fa' : 'var(--border-default)'}
                  />
                ))}
              </Bar>
            </BarChart>
          )}
        </ChartSizeBox>
      </div>
    </div>
  );
}
