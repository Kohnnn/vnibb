'use client'

import { ShieldCheck } from 'lucide-react'
import { useEarningsQuality } from '@/lib/queries'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'

interface EarningsQualityWidgetProps {
  symbol: string
  isEditing?: boolean
  onRemove?: () => void
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  return `${value.toFixed(2)}%`
}

function score(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  return value.toFixed(1)
}

function persistence(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  return value.toFixed(2)
}

function gradeTone(grade: string): string {
  if (grade === 'A') return 'text-emerald-400'
  if (grade === 'B') return 'text-cyan-400'
  if (grade === 'C') return 'text-amber-400'
  if (grade === 'D') return 'text-red-400'
  return 'text-[var(--text-primary)]'
}

export function EarningsQualityWidget({ symbol }: EarningsQualityWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useEarningsQuality(
    upperSymbol,
    Boolean(upperSymbol)
  )

  const payload = data?.data
  const hasData = Boolean(payload)

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view earnings quality" icon={<ShieldCheck size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <ShieldCheck size={12} className="text-cyan-400" />
          <span>Earnings Quality</span>
        </div>
        <WidgetMeta
          updatedAt={dataUpdatedAt}
          isFetching={isFetching && hasData}
          note="Quarterly quality factors"
          align="right"
        />
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={7} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty message="No quality data available" icon={<ShieldCheck size={18} />} />
      ) : (
        <>
          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 mb-2">
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Quality Grade</div>
            <div className={`text-lg font-semibold ${gradeTone(payload?.grade || 'N/A')}`}>{payload?.grade || 'N/A'}</div>
            <div className="text-[10px] text-[var(--text-secondary)]">Quality Score: {score(payload?.quality_score)} / 100</div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] mb-2">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Accruals</div>
              <div className="font-mono text-[var(--text-primary)]">{pct(payload?.accruals_ratio_pct)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Cash Conversion</div>
              <div className="font-mono text-[var(--text-primary)]">{pct(payload?.revenue_quality_pct)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">EPS Persistence</div>
              <div className="font-mono text-[var(--text-primary)]">{persistence(payload?.earnings_persistence)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Trend</div>
              <div className="font-mono text-[var(--text-primary)]">{payload?.trend || 'Stable'}</div>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 text-[10px]">
            <div className="uppercase tracking-widest text-[var(--text-muted)] mb-1">Active Checks</div>
            {payload?.checks?.length ? (
              <div className="space-y-1">
                {payload.checks.map((item) => (
                  <div key={item} className="text-[var(--text-secondary)]">
                    • {item}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[var(--text-secondary)]">No quality conditions met.</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default EarningsQualityWidget
