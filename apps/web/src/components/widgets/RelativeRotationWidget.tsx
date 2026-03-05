'use client'

import { Orbit } from 'lucide-react'
import { useRelativeRotation } from '@/lib/queries'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { Sparkline } from '@/components/ui/Sparkline'

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
          note="VN30 vs VNINDEX"
          align="right"
        />
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={6} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty message="No relative-rotation data available" icon={<Orbit size={18} />} />
      ) : (
        <>
          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 mb-2">
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Rotation Quadrant</div>
            <div className={`text-lg font-semibold ${quadrantTone(selected?.quadrant || 'Unknown')}`}>
              {selected?.quadrant || 'Unknown'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">RS-Ratio</div>
              <div className="font-mono text-[var(--text-primary)]">
                {selected?.rs_ratio !== null && selected?.rs_ratio !== undefined
                  ? selected.rs_ratio.toFixed(2)
                  : '-'}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">RS-Momentum</div>
              <div
                className={
                  (selected?.rs_momentum ?? 0) >= 100
                    ? 'font-mono text-emerald-400'
                    : 'font-mono text-red-400'
                }
              >
                {selected?.rs_momentum !== null && selected?.rs_momentum !== undefined
                  ? selected.rs_momentum.toFixed(2)
                  : '-'}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1">RS-Ratio Trail</div>
            {trailSeries.length < 2 ? (
              <div className="text-[10px] text-[var(--text-secondary)]">Insufficient trail history.</div>
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
