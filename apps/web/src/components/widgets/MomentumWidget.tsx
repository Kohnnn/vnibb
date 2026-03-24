'use client'

import { useState } from 'react'
import { Gauge } from 'lucide-react'
import { useMomentumProfile } from '@/lib/queries'
import { QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'

interface MomentumWidgetProps {
  symbol: string
  isEditing?: boolean
  onRemove?: () => void
}

function formatPct(value: number | null): string {
  if (value === null) return '-'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function scoreTone(score: number): string {
  if (score >= 3) return 'text-emerald-400'
  if (score >= 1) return 'text-cyan-400'
  if (score <= -3) return 'text-red-400'
  if (score <= -1) return 'text-amber-400'
  return 'text-[var(--text-secondary)]'
}

function scoreLabel(score: number): string {
  if (score >= 3) return 'Strong Uptrend'
  if (score >= 1) return 'Uptrend'
  if (score <= -3) return 'Strong Downtrend'
  if (score <= -1) return 'Downtrend'
  return 'Sideways'
}

export function MomentumWidget({ symbol }: MomentumWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('3Y')

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useMomentumProfile(upperSymbol, {
    period,
    enabled: Boolean(upperSymbol),
  })

  const payload = data?.data
  const r20 = payload?.returns_pct?.r1m ?? null
  const r60 = payload?.returns_pct?.r3m ?? null
  const r120 = payload?.returns_pct?.r6m ?? null
  const r252 = payload?.returns_pct?.r12m ?? null

  const momentumScore = payload?.momentum_score ?? [r20, r60, r120, r252].reduce<number>((score, value) => {
    if (value === null) return score
    if (value > 0) return score + 1
    if (value < 0) return score - 1
    return score
  }, 0)

  const trendLabel = payload?.trend_label ?? scoreLabel(momentumScore)
  const hasData = Boolean(payload && (r20 !== null || r60 !== null || r120 !== null || r252 !== null))

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view momentum" icon={<Gauge size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Gauge size={12} className="text-cyan-400" />
          <span>Momentum Profile</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
              {QUANT_PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  period === option
                    ? 'bg-blue-600 text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <WidgetMeta updatedAt={data?.data?.last_data_date ?? data?.data?.computed_at ?? dataUpdatedAt} isFetching={isFetching && hasData} note={period} align="right" />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={7} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty message="No momentum data available" icon={<Gauge size={18} />} />
      ) : (
        <>
          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 mb-2">
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Composite Momentum</div>
            <div className={`text-lg font-semibold ${scoreTone(momentumScore)}`}>{trendLabel}</div>
            <div className="text-[10px] text-[var(--text-secondary)]">Score: {momentumScore} / 4</div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">1M</div>
              <div className={r20 !== null && r20 >= 0 ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono'}>
                {formatPct(r20)}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">3M</div>
              <div className={r60 !== null && r60 >= 0 ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono'}>
                {formatPct(r60)}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">6M</div>
              <div className={r120 !== null && r120 >= 0 ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono'}>
                {formatPct(r120)}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">12M</div>
              <div className={r252 !== null && r252 >= 0 ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono'}>
                {formatPct(r252)}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default MomentumWidget
