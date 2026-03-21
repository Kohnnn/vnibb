'use client';

import { memo, useMemo, useState } from 'react';
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { CircleDot, SlidersHorizontal } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { useIndustryBubble } from '@/lib/queries';
import { formatNumber, formatPercent } from '@/lib/units';
import { cn } from '@/lib/utils';

interface IndustryBubbleWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

const AXIS_OPTIONS = [
  { value: 'pb_ratio', label: 'P/B' },
  { value: 'pe_ratio', label: 'P/E' },
  { value: 'ps_ratio', label: 'P/S' },
  { value: 'roe', label: 'ROE' },
  { value: 'roa', label: 'ROA' },
  { value: 'roic', label: 'ROIC' },
  { value: 'debt_to_equity', label: 'Debt / Equity' },
  { value: 'revenue_growth', label: 'Revenue Growth' },
  { value: 'earnings_growth', label: 'Earnings Growth' },
  { value: 'market_cap', label: 'Market Cap' },
] as const;

const SIZE_OPTIONS = [
  { value: 'market_cap', label: 'Market Cap' },
  { value: 'volume', label: 'Volume' },
  { value: 'revenue', label: 'Revenue' },
] as const;

function metricLabel(metric: string) {
  return AXIS_OPTIONS.find((option) => option.value === metric)?.label
    || SIZE_OPTIONS.find((option) => option.value === metric)?.label
    || metric;
}

function formatBubbleMetric(metric: string, value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  if (metric.includes('growth') || metric === 'roe' || metric === 'roa' || metric === 'roic') {
    return formatPercent(value, { input: 'percent', decimals: 2 });
  }
  if (metric === 'market_cap' || metric === 'revenue' || metric === 'volume') {
    return formatNumber(value, { decimals: 0 });
  }
  return formatNumber(value, { decimals: 2 });
}

function BubbleShape(props: any) {
  const { cx, cy, payload, size } = props;
  const radius = Math.max(10, Math.sqrt((size || 120) / 4));
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={payload.color}
        fillOpacity={payload.is_reference ? 0.9 : 0.75}
        stroke={payload.is_reference ? '#f8fafc' : 'rgba(255,255,255,0.3)'}
        strokeWidth={payload.is_reference ? 2.5 : 1.25}
      />
      <text
        x={cx}
        y={cy + 4}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        fill="#f8fafc"
      >
        {payload.symbol}
      </text>
    </g>
  );
}

function IndustryBubbleWidgetComponent({ id, symbol, onRemove }: IndustryBubbleWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || '';
  const [xMetric, setXMetric] = useState('pb_ratio');
  const [yMetric, setYMetric] = useState('pe_ratio');
  const [sizeMetric, setSizeMetric] = useState('market_cap');
  const [topN, setTopN] = useState(20);

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useIndustryBubble({
    symbol: upperSymbol,
    x_metric: xMetric,
    y_metric: yMetric,
    size_metric: sizeMetric,
    top_n: topN,
    enabled: Boolean(upperSymbol),
  });

  const points = data?.data || [];
  const hasData = points.length > 0;

  const legendItems = useMemo(() => points.slice().sort((a, b) => Number(b.is_reference) - Number(a.is_reference)), [points]);

  return (
    <WidgetContainer
      title="Industry Bubble"
      subtitle="Sector-relative valuation and quality map"
      symbol={upperSymbol}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
      exportData={points}
      exportFilename={`industry_bubble_${upperSymbol}`}
      widgetId={id}
      showLinkToggle
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <div className="border-b border-[var(--border-color)]/70 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                <CircleDot size={12} className="text-fuchsia-300" />
                <span>{data?.sector || 'Sector peers'}</span>
              </div>

              {[5, 10, 20].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTopN(value)}
                  className={cn(
                    'rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
                    topN === value
                      ? 'bg-blue-600 text-white'
                      : 'border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  )}
                >
                  Top {value}
                </button>
              ))}
            </div>

            <WidgetMeta
              updatedAt={data?.updated_at || dataUpdatedAt}
              isFetching={isFetching && hasData}
              note={`${metricLabel(xMetric)} vs ${metricLabel(yMetric)}`}
              align="right"
            />
          </div>
        </div>

        <div className="border-b border-[var(--border-color)]/70 px-3 py-2">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <label className="flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <SlidersHorizontal size={12} />
              <span>X</span>
              <select value={xMetric} onChange={(event) => setXMetric(event.target.value)} className="ml-auto bg-transparent text-[var(--text-primary)] outline-none">
                {AXIS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <SlidersHorizontal size={12} />
              <span>Y</span>
              <select value={yMetric} onChange={(event) => setYMetric(event.target.value)} className="ml-auto bg-transparent text-[var(--text-primary)] outline-none">
                {AXIS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <SlidersHorizontal size={12} />
              <span>Size</span>
              <select value={sizeMetric} onChange={(event) => setSizeMetric(event.target.value)} className="ml-auto bg-transparent text-[var(--text-primary)] outline-none">
                {SIZE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-3 py-3 scrollbar-hide">
          {isLoading && !hasData ? (
            <WidgetSkeleton variant="chart" />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message={`No industry bubble data available for ${upperSymbol}.`} icon={<CircleDot size={18} />} />
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                <ChartMountGuard className="h-[360px]" minHeight={320}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 16, right: 24, bottom: 24, left: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                      <XAxis
                        type="number"
                        dataKey="x"
                        name={metricLabel(xMetric)}
                        tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                        axisLine={false}
                        tickLine={false}
                        label={{ value: metricLabel(xMetric), position: 'insideBottom', offset: -10, fill: 'var(--text-muted)', fontSize: 10 }}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        name={metricLabel(yMetric)}
                        tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                        axisLine={false}
                        tickLine={false}
                        label={{ value: metricLabel(yMetric), angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 10 }}
                      />
                      <ZAxis type="number" dataKey="size" range={[180, 1800]} />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 3' }}
                        contentStyle={{
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          fontSize: '11px',
                        }}
                        formatter={(value: any, name: any) => [formatBubbleMetric(name, Number(value)), metricLabel(String(name))]}
                        labelFormatter={(_, payload) => {
                          const point = payload?.[0]?.payload;
                          return point ? `${point.symbol} · ${point.name}` : '';
                        }}
                      />
                      {data?.sector_average?.x != null && (
                        <ReferenceLine x={data.sector_average.x} stroke="#94a3b8" strokeDasharray="4 4" />
                      )}
                      {data?.sector_average?.y != null && (
                        <ReferenceLine y={data.sector_average.y} stroke="#94a3b8" strokeDasharray="4 4" />
                      )}
                      <Scatter data={points} shape={<BubbleShape />} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </ChartMountGuard>
              </div>

              <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Sector Average</div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-[var(--text-muted)]">{metricLabel(xMetric)}</div>
                      <div className="font-semibold text-[var(--text-primary)]">{formatBubbleMetric(xMetric, data?.sector_average?.x)}</div>
                    </div>
                    <div>
                      <div className="text-[var(--text-muted)]">{metricLabel(yMetric)}</div>
                      <div className="font-semibold text-[var(--text-primary)]">{formatBubbleMetric(yMetric, data?.sector_average?.y)}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Legend</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    {legendItems.map((item) => (
                      <div key={item.symbol} className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className={cn('font-medium', item.is_reference && 'text-fuchsia-300')}>
                          {item.symbol}{item.is_reference ? ' · Ref' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const IndustryBubbleWidget = memo(IndustryBubbleWidgetComponent);
export default IndustryBubbleWidget;
