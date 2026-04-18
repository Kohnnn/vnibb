'use client'

import { useMemo } from 'react'
import { Orbit } from 'lucide-react'
import { CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartMountGuard } from '@/components/ui/ChartMountGuard'
import { useRelativeRotation } from '@/lib/queries'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { Sparkline } from '@/components/ui/Sparkline'
import type { WidgetHealthState } from '@/lib/widgetHealth'

interface RelativeRotationWidgetProps {
  symbol: string
  isEditing?: boolean
  onRemove?: () => void
}

function quadrantTone(quadrant: string): string {
  if (quadrant === 'Leading') return 'text-emerald-400'
  if (quadrant === 'Improving') return 'text-cyan-400'
  if (quadrant === 'Weakening') return 'text-amber-400'
  if (quadrant === 'Lagging') return 'text-red-400'
  return 'text-[var(--text-secondary)]'
}

function quadrantFill(quadrant: string): string {
  if (quadrant === 'Leading') return '#4ade80'
  if (quadrant === 'Improving') return '#22d3ee'
  if (quadrant === 'Weakening') return '#f59e0b'
  if (quadrant === 'Lagging') return '#f87171'
  return '#94a3b8'
}

function buildDomain(values: number[]): [number, number] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  return [Math.floor(Math.min(95, min - 1.5)), Math.ceil(Math.max(105, max + 1.5))]
}

function RotationDot(props: {
  cx?: number
  cy?: number
  payload?: { color?: string; isSelected?: boolean; opacity?: number; radius?: number }
}) {
  const { cx = 0, cy = 0, payload } = props
  return (
    <circle
      cx={cx}
      cy={cy}
      r={payload?.radius ?? (payload?.isSelected ? 6 : 4)}
      fill={payload?.color || '#94a3b8'}
      fillOpacity={payload?.opacity ?? 0.85}
      stroke={payload?.isSelected ? '#e0f2fe' : 'rgba(255,255,255,0.32)'}
      strokeWidth={payload?.isSelected ? 2 : 1}
    />
  )
}

export function RelativeRotationWidget({ symbol }: RelativeRotationWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useRelativeRotation(upperSymbol, {
    lookbackDays: 260,
    enabled: Boolean(upperSymbol),
  })

  const payload = data?.data
  const selected = payload?.selected ?? null
  const hasData = Boolean(selected || (payload?.universe?.length ?? 0) > 0)
  const trailSeries =
    selected?.trail
      ?.map((point) => Number(point.rs_ratio))
      .filter((value) => Number.isFinite(value)) ?? []
  const universePoints = useMemo(
    () => (payload?.universe ?? [])
      .map((point) => ({
        symbol: point.symbol,
        rsRatio: Number(point.rs_ratio),
        rsMomentum: Number(point.rs_momentum),
        quadrant: point.quadrant,
        color: quadrantFill(point.quadrant),
        isSelected: point.symbol === upperSymbol,
      }))
      .filter((point) => Number.isFinite(point.rsRatio) && Number.isFinite(point.rsMomentum)),
    [payload?.universe, upperSymbol]
  )
  const selectedPoint = useMemo(
    () => universePoints.find((point) => point.isSelected) ?? null,
    [universePoints]
  )
  const selectedRsRatio = selectedPoint?.rsRatio ?? null
  const selectedRsMomentum = selectedPoint?.rsMomentum ?? null
  const peerPoints = useMemo(
    () => universePoints.filter((point) => !point.isSelected),
    [universePoints]
  )
  const trailPoints = useMemo(
    () => (selected?.trail ?? [])
      .map((point, index, trail) => ({
        symbol: upperSymbol,
        rsRatio: Number(point.rs_ratio),
        rsMomentum: Number(point.rs_momentum),
        color: '#38bdf8',
        opacity: 0.3 + (index / Math.max(trail.length, 1)) * 0.55,
        radius: index === trail.length - 1 ? 4 : 2.5,
      }))
      .filter((point) => Number.isFinite(point.rsRatio) && Number.isFinite(point.rsMomentum)),
    [selected?.trail, upperSymbol]
  )
  const chartDomain = useMemo(() => {
    const xValues = [100, ...universePoints.map((point) => point.rsRatio), ...trailPoints.map((point) => point.rsRatio)]
    const yValues = [100, ...universePoints.map((point) => point.rsMomentum), ...trailPoints.map((point) => point.rsMomentum)]
    return {
      x: buildDomain(xValues),
      y: buildDomain(yValues),
    }
  }, [trailPoints, universePoints])
  const hasChartData = universePoints.length > 0
  const healthState: WidgetHealthState | undefined = hasData && !hasChartData
    ? {
        status: 'limited',
        label: 'Limited history',
        detail: `Need enough overlapping ${upperSymbol} and ${payload?.benchmark || 'VNINDEX'} history to plot the quadrant map.`,
      }
    : undefined

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view relative rotation" icon={<Orbit size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Orbit size={12} className="text-cyan-400" />
          <span>Relative Rotation</span>
        </div>
        <WidgetMeta
          updatedAt={dataUpdatedAt}
          isFetching={isFetching && hasData}
          health={healthState}
          note="VN30 vs VNINDEX"
          align="right"
        />
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={6} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 mb-2">
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Rotation Quadrant</div>
            <div className={`text-lg font-semibold ${quadrantTone(selected?.quadrant || 'Unknown')}`}>
              {selected?.quadrant || 'Awaiting data'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-2 text-[10px]">
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="uppercase tracking-widest text-[var(--text-muted)]">RS-Ratio</div>
                <div className="font-mono text-[var(--text-primary)]">
                  {selectedRsRatio !== null
                    ? selectedRsRatio.toFixed(2)
                    : '-'}
                </div>
              </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">RS-Momentum</div>
              <div
                className={
                  (selectedRsMomentum ?? 0) >= 100
                    ? 'font-mono text-emerald-400'
                    : 'font-mono text-red-400'
                }
              >
                  {selectedRsMomentum !== null
                    ? selectedRsMomentum.toFixed(2)
                    : '-'}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 mb-2">
            <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              <span>RRG Map</span>
              <span>{payload?.benchmark || 'VNINDEX'} benchmark</span>
            </div>
            <div className="relative">
              <ChartMountGuard className="h-[240px] min-h-[220px]" minHeight={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 16, right: 16, bottom: 16, left: 0 }}>
                    <ReferenceArea x1={chartDomain.x[0]} x2={100} y1={100} y2={chartDomain.y[1]} fill="rgba(34,211,238,0.06)" />
                    <ReferenceArea x1={100} x2={chartDomain.x[1]} y1={100} y2={chartDomain.y[1]} fill="rgba(74,222,128,0.07)" />
                    <ReferenceArea x1={100} x2={chartDomain.x[1]} y1={chartDomain.y[0]} y2={100} fill="rgba(245,158,11,0.07)" />
                    <ReferenceArea x1={chartDomain.x[0]} x2={100} y1={chartDomain.y[0]} y2={100} fill="rgba(248,113,113,0.07)" />
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                    <ReferenceLine x={100} stroke="rgba(148,163,184,0.45)" strokeDasharray="4 4" />
                    <ReferenceLine y={100} stroke="rgba(148,163,184,0.45)" strokeDasharray="4 4" />
                    <XAxis
                      type="number"
                      dataKey="rsRatio"
                      domain={chartDomain.x}
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      axisLine={false}
                      tickLine={false}
                      label={{ value: 'RS-Ratio', position: 'insideBottom', offset: -8, fill: 'var(--text-muted)', fontSize: 10 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="rsMomentum"
                      domain={chartDomain.y}
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      axisLine={false}
                      tickLine={false}
                      label={{ value: 'RS-Momentum', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        fontSize: '11px',
                      }}
                      labelFormatter={(_, payloadItems) => payloadItems?.[0]?.payload?.symbol || upperSymbol}
                      formatter={(value: unknown, name) => [
                        Number(Array.isArray(value) ? value[0] : value ?? 0).toFixed(2),
                        name === 'rsRatio' ? 'RS-Ratio' : 'RS-Momentum',
                      ]}
                    />
                    {trailPoints.length > 1 ? (
                      <Scatter data={trailPoints} line={{ stroke: '#38bdf8', strokeWidth: 1.5 }} shape={<RotationDot />} />
                    ) : null}
                    {peerPoints.length ? (
                      <Scatter data={peerPoints} shape={<RotationDot />} />
                    ) : null}
                    {selectedPoint ? (
                      <Scatter data={[selectedPoint]} shape={<RotationDot />} />
                    ) : null}
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartMountGuard>
              {!hasChartData ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="max-w-[230px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/94 px-4 py-3 text-center">
                    <div className="text-xs font-semibold text-[var(--text-primary)]">No relative-rotation data available</div>
                    <div className="mt-1 text-[10px] leading-5 text-[var(--text-secondary)]">
                      Waiting for enough overlapping history between {upperSymbol} and {payload?.benchmark || 'VNINDEX'} to plot the quadrant map.
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1">RS-Ratio Trail</div>
            {trailSeries.length < 2 ? (
              <div className="text-[10px] text-[var(--text-secondary)]">
                {hasChartData ? 'Insufficient trail history.' : 'Trail history will appear once the benchmark-relative series is available.'}
              </div>
            ) : (
              <Sparkline data={trailSeries} width={220} height={40} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default RelativeRotationWidget
