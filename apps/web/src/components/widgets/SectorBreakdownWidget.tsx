'use client';

import { memo, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LayoutGrid } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { useMarketHeatmap } from '@/lib/queries';
import { cn } from '@/lib/utils';

interface SectorBreakdownWidgetProps {
  id: string;
  onRemove?: () => void;
}

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#22d3ee', '#ef4444', '#06b6d4', '#f97316', '#22c55e'];
const TOP_OPTIONS = [5, 10, 20, -1] as const;
const METRIC_OPTIONS = [
  { id: 'share', label: 'MCap Share' },
  { id: 'change', label: 'Avg Change' },
  { id: 'count', label: 'Stock Count' },
] as const;

type SectorMetric = (typeof METRIC_OPTIONS)[number]['id'];

function SectorBreakdownWidgetComponent({ id, onRemove }: SectorBreakdownWidgetProps) {
  const [topCount, setTopCount] = useState<(typeof TOP_OPTIONS)[number]>(10);
  const [metric, setMetric] = useState<SectorMetric>('share');
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useMarketHeatmap({
    group_by: 'sector',
    exchange: 'HOSE',
    limit: 300,
    use_cache: true,
  });

  const sectors = data?.sectors || [];
  const totalCap = sectors.reduce((sum, sector) => sum + (sector.total_market_cap || 0), 0);

  const chartData = useMemo(() => {
    const baseRows = sectors.map((sector, index) => ({
      name: sector.sector,
      value: sector.total_market_cap || 0,
      share: totalCap ? (sector.total_market_cap / totalCap) * 100 : 0,
      changePct: sector.avg_change_pct || 0,
      stockCount: sector.stock_count || 0,
      color: COLORS[index % COLORS.length],
    }));

    const sortedRows = [...baseRows].sort((left, right) => {
      if (metric === 'change') return right.changePct - left.changePct;
      if (metric === 'count') return right.stockCount - left.stockCount;
      return right.share - left.share;
    });

    if (topCount === -1 || sortedRows.length <= topCount) {
      return sortedRows;
    }

    const visible = sortedRows.slice(0, topCount);
    const remaining = sortedRows.slice(topCount);
    const otherShare = remaining.reduce((sum, row) => sum + row.share, 0);
    const otherValue = remaining.reduce((sum, row) => sum + row.value, 0);
    const otherCount = remaining.reduce((sum, row) => sum + row.stockCount, 0);
    const weightedChange = otherValue > 0
      ? remaining.reduce((sum, row) => sum + row.changePct * row.value, 0) / otherValue
      : 0;

    return [
      ...visible,
      {
        name: 'Other',
        value: otherValue,
        share: otherShare,
        changePct: weightedChange,
        stockCount: otherCount,
        color: '#64748b',
      },
    ];
  }, [metric, sectors, topCount, totalCap]);

  const metricValueKey = metric === 'change' ? 'changePct' : metric === 'count' ? 'stockCount' : 'share';
  const metricAxisLabel = metric === 'change' ? 'Avg Change %' : metric === 'count' ? 'Stocks' : 'Share %';
  const metricNote = metric === 'change' ? 'Average daily change' : metric === 'count' ? 'Constituent count' : 'Market cap share';

  const hasData = chartData.length > 0;
  const isFallback = Boolean(error && hasData);

  return (
    <WidgetContainer title="Market Sector Breakdown" onRefresh={() => refetch()} onClose={onRemove} isLoading={isLoading && !hasData}>
      <div className="h-full w-full flex flex-col">
        <div className="pb-2 border-b border-[var(--border-subtle)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {TOP_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTopCount(option)}
                  className={cn(
                    'rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
                    topCount === option
                      ? 'bg-blue-600 text-white'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                  )}
                >
                  {option === -1 ? 'All' : `Top ${option}`}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] p-0.5">
                {METRIC_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setMetric(option.id)}
                    className={cn(
                      'rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
                      metric === option.id
                        ? 'bg-blue-600 text-white'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <WidgetMeta
                updatedAt={dataUpdatedAt}
                isFetching={isFetching && hasData}
                isCached={isFallback}
                note={metricNote}
                align="right"
              />
            </div>
          </div>
        </div>
        <div className="flex-1 w-full">
          {isLoading && !hasData ? (
            <WidgetSkeleton variant="chart" />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="Sector data will appear when available." icon={<LayoutGrid size={18} />} />
          ) : (
            <div className="grid h-full min-h-[240px] gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.8fr)]">
              <ChartMountGuard className="h-full" minHeight={200}>
                <ResponsiveContainer width="100%" height="100%" minWidth={260} minHeight={220}>
                  <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 18, left: 12, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                    <YAxis dataKey="name" type="category" width={92} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                      }}
                      itemStyle={{ color: 'var(--text-primary)', fontSize: '10px' }}
                      formatter={(value: any, _name, props: any) => {
                        const payload = props?.payload;
                        if (metric === 'change') return [`${Number(value).toFixed(2)}%`, 'Avg Change'];
                        if (metric === 'count') return [String(payload?.stockCount || 0), 'Stocks'];
                        return [`${payload?.share ? payload.share.toFixed(1) : '0.0'}%`, 'Share'];
                      }}
                    />
                    <Bar dataKey={metricValueKey} radius={[0, 6, 6, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartMountGuard>

              <div className="overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Ranked {metricAxisLabel}
                </div>
                <div className="space-y-2">
                  {chartData.map((entry) => (
                    <div key={entry.name} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                          <span className="truncate text-sm font-medium text-[var(--text-primary)]">{entry.name}</span>
                        </div>
                        <span className={cn('text-sm font-semibold', metric === 'change' ? (entry.changePct >= 0 ? 'text-emerald-300' : 'text-rose-300') : 'text-blue-300')}>
                          {metric === 'change'
                            ? `${entry.changePct >= 0 ? '+' : ''}${entry.changePct.toFixed(2)}%`
                            : metric === 'count'
                              ? entry.stockCount.toLocaleString()
                              : `${entry.share.toFixed(1)}%`}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                        <span>{entry.stockCount} stocks</span>
                        <span>{entry.changePct >= 0 ? '+' : ''}{entry.changePct.toFixed(2)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const SectorBreakdownWidget = memo(SectorBreakdownWidgetComponent);
export default SectorBreakdownWidget;
