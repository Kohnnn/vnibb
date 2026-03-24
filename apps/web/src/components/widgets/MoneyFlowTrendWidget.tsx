'use client';

import { memo, useMemo, useState } from 'react';
import {
  Legend,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, Info } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useMoneyFlowTrend } from '@/lib/queries';
import { formatNumber } from '@/lib/units';
import { cn } from '@/lib/utils';

interface MoneyFlowTrendWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

type Timeframe = 'short' | 'medium' | 'long';

const TIMEFRAME_OPTIONS: Array<{ id: Timeframe; label: string }> = [
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long', label: 'Long' },
];

const QUADRANT_STYLES = {
  bullish: { label: 'Bullish', bg: 'rgba(34,197,94,0.12)', text: '#86efac' },
  accumulation: { label: 'Accumulation', bg: 'rgba(56,189,248,0.12)', text: '#7dd3fc' },
  weakening: { label: 'Weakening', bg: 'rgba(234,179,8,0.12)', text: '#fde047' },
  bearish: { label: 'Bearish', bg: 'rgba(239,68,68,0.12)', text: '#fca5a5' },
} as const;

function FlowPointShape(props: any) {
  const { cx, cy, payload, stroke } = props;
  const latest = Boolean(payload?.isLatest);
  const radius = latest ? 8 : 4;

  return (
    <g>
      <circle cx={cx} cy={cy} r={radius} fill={stroke} fillOpacity={latest ? 0.95 : 0.35} stroke="#f8fafc" strokeWidth={latest ? 1.5 : 0.5} />
      {latest ? (
        <text x={cx + 10} y={cy + 4} fontSize={11} fontWeight={700} fill="#e2e8f0">
          {payload.symbol}
        </text>
      ) : null}
    </g>
  );
}

function MoneyFlowTrendWidgetComponent({ id, symbol, onRemove }: MoneyFlowTrendWidgetProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('medium');
  const [visibleSymbols, setVisibleSymbols] = useState<Record<string, boolean>>({});
  const upperSymbol = symbol?.toUpperCase() || '';

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useMoneyFlowTrend({
    symbol: upperSymbol,
    timeframe,
    trail_length: 8,
    enabled: Boolean(upperSymbol),
  });

  const stocks = data?.stocks || [];
  const hasData = stocks.length > 0;

  const stockDatasets = useMemo(() => {
    return stocks
      .filter((stock) => visibleSymbols[stock.symbol] !== false)
      .map((stock) => ({
        ...stock,
        trailData: (stock.trail || []).map((point, index, items) => ({
          ...point,
          x: point.s_trend,
          y: point.s_strength,
          symbol: stock.symbol,
          isLatest: index === items.length - 1,
        })),
      }))
  }, [stocks, visibleSymbols]);

  const note = data?.sector
    ? `${data.sector} vs ${data.benchmark}`
    : `Universe vs ${data?.benchmark || 'VNINDEX'}`;
  const referenceStock = useMemo(
    () => stocks.find((stock) => stock.symbol === upperSymbol) || stocks[0] || null,
    [stocks, upperSymbol]
  );

  const toggleSymbol = (ticker: string) => {
    setVisibleSymbols((current) => ({
      ...current,
      [ticker]: current[ticker] === false,
    }));
  };

  return (
    <WidgetContainer
      title="Money Flow Trend"
      subtitle="Quadrant rotation proxy for sector peers"
      symbol={upperSymbol}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
      exportData={stocks}
      exportFilename={`money_flow_trend_${upperSymbol}`}
      widgetId={id}
      showLinkToggle
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] p-0.5">
              {TIMEFRAME_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setTimeframe(option.id)}
                  className={cn(
                    'rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
                    timeframe === option.id
                      ? 'bg-blue-600 text-white'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <WidgetMeta
              updatedAt={data?.updated_at || dataUpdatedAt}
              isFetching={isFetching && hasData}
              note={note}
              align="right"
            />
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
            <Info size={12} className="text-cyan-300" />
            <span>Proxy model: relative strength vs VNINDEX with trend and momentum centered at 100.</span>
          </div>
          {referenceStock && (
            <div className="mt-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">Current read:</span>{' '}
              {referenceStock.symbol} is the anchor name for this view, so use its latest trail position versus the 100/100 crosshair to judge whether momentum is improving, stalling, or rolling over.
            </div>
          )}
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 p-3">
            {isLoading && !hasData ? (
              <WidgetSkeleton variant="chart" />
            ) : error && !hasData ? (
              <WidgetError error={error as Error} onRetry={() => refetch()} />
            ) : !hasData ? (
              <WidgetEmpty message={`No money-flow trend data available for ${upperSymbol}.`} icon={<Activity size={18} />} />
            ) : (
              <ChartMountGuard className="h-full min-h-[340px]" minHeight={320}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 16, right: 20, bottom: 24, left: 16 }}>
                    <ReferenceArea x1={0} x2={100} y1={100} y2={140} fill={QUADRANT_STYLES.accumulation.bg} />
                    <ReferenceArea x1={100} x2={140} y1={100} y2={140} fill={QUADRANT_STYLES.bullish.bg} />
                    <ReferenceArea x1={100} x2={140} y1={60} y2={100} fill={QUADRANT_STYLES.weakening.bg} />
                    <ReferenceArea x1={0} x2={100} y1={60} y2={100} fill={QUADRANT_STYLES.bearish.bg} />
                    <ReferenceLine x={100} stroke="rgba(148,163,184,0.45)" strokeDasharray="4 4" />
                    <ReferenceLine y={100} stroke="rgba(148,163,184,0.45)" strokeDasharray="4 4" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      domain={[80, 120]}
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      axisLine={false}
                      tickLine={false}
                      label={{ value: 'S-Trend', position: 'insideBottom', offset: -10, fill: 'var(--text-muted)', fontSize: 10 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      domain={[80, 120]}
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      axisLine={false}
                      tickLine={false}
                      label={{ value: 'S-Strength', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        fontSize: '11px',
                      }}
                      formatter={(value: any, name: any) => [formatNumber(Number(value), { decimals: 2 }), String(name)]}
                      labelFormatter={(_, payload) => {
                        const point = payload?.[0]?.payload;
                        return point ? `${point.symbol} · ${point.date}` : '';
                      }}
                    />
                    <Legend />
                    {stockDatasets.map((stock) => (
                      <Scatter
                        key={stock.symbol}
                        name={stock.symbol}
                        data={stock.trailData}
                        line={{ stroke: stock.color, strokeOpacity: 0.35, strokeWidth: 2 }}
                        lineType="joint"
                        shape={<FlowPointShape />}
                        fill={stock.color}
                      />
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartMountGuard>
            )}
          </div>

          <div className="w-[180px] border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 overflow-auto scrollbar-hide">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Universe</div>
            <div className="space-y-2">
              {stocks.map((stock) => (
                <label key={stock.symbol} className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    checked={visibleSymbols[stock.symbol] !== false}
                    onChange={() => toggleSymbol(stock.symbol)}
                  />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stock.color }} />
                  <span className="font-medium">{stock.symbol}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </WidgetContainer>
  )
}

export const MoneyFlowTrendWidget = memo(MoneyFlowTrendWidgetComponent)
export default MoneyFlowTrendWidget
