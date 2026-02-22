'use client';

import { memo, useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { LayoutGrid } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { useMarketHeatmap } from '@/lib/queries';

interface SectorBreakdownWidgetProps {
  id: string;
  onRemove?: () => void;
}

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#22d3ee', '#ef4444', '#06b6d4', '#f97316', '#22c55e'];

function SectorBreakdownWidgetComponent({ id, onRemove }: SectorBreakdownWidgetProps) {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useMarketHeatmap({
    group_by: 'sector',
    exchange: 'HOSE',
    limit: 300,
    use_cache: true,
  });

  const sectors = data?.sectors || [];
  const totalCap = sectors.reduce((sum, sector) => sum + (sector.total_market_cap || 0), 0);

  const chartData = useMemo(() => {
    return sectors.map((sector, index) => ({
      name: sector.sector,
      value: sector.total_market_cap || 0,
      share: totalCap ? (sector.total_market_cap / totalCap) * 100 : 0,
      changePct: sector.avg_change_pct || 0,
      color: COLORS[index % COLORS.length],
    }));
  }, [sectors, totalCap]);

  const hasData = chartData.length > 0;
  const isFallback = Boolean(error && hasData);

  return (
    <WidgetContainer title="Market Sector Breakdown" onRefresh={() => refetch()} onClose={onRemove} isLoading={isLoading && !hasData}>
      <div className="h-full w-full flex flex-col">
        <div className="pb-2 border-b border-[var(--border-subtle)]">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note="Market cap share"
            align="right"
          />
        </div>
        <div className="flex-1 w-full">
          {isLoading && !hasData ? (
            <WidgetSkeleton variant="chart" />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="Sector data will appear when available." icon={<LayoutGrid size={18} />} />
          ) : (
            <div className="w-full h-full min-h-[220px]">
              <ChartMountGuard className="h-full" minHeight={200}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                      }}
                      itemStyle={{ color: 'var(--text-primary)', fontSize: '10px' }}
                      formatter={(value: any, _name, props: any) => {
                        const payload = props?.payload;
                        const share = payload?.share ? `${payload.share.toFixed(1)}%` : '-';
                        return [`${share}`, 'Share'];
                      }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      height={36}
                      iconType="circle"
                      wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </ChartMountGuard>
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const SectorBreakdownWidget = memo(SectorBreakdownWidgetComponent);
export default SectorBreakdownWidget;
