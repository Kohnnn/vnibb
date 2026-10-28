'use client'

import { useEffect, useState } from 'react'
import { Gauge } from 'lucide-react'
import { useMomentumProfile } from '@/lib/queries'
import { QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { QuantWarningBanner } from '@/components/ui/QuantWarningBanner'

interface MomentumWidgetProps {
  symbol: string
  isEditing?: boolean
  onRemove?: () => void
  onDataChange?: (data: WidgetDataPayload) => void
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

export function MomentumWidget({ symbol, onDataChange }: MomentumWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('3Y')

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useMomentumProfile(upperSymbol, {
    period,
    enabled: Boolean(upperSymbol),
  })

  const payload = data?.data
  const meta = data?.meta as (NonNullable<typeof data>['meta'] & {
    unit_status?: string; unresolved_excluded_dates?: string[]; unresolved_session_count?: number;
    quality_status?: string; unavailable?: boolean; warnings?: string[]; adjustment_warning?: string;
    fallback_used?: boolean; completeness_status?: string;
  }) | undefined
  const RESOLVED_UNIT_STATUSES = ['confirmed_vnd', 'index_points', 'not_applicable']
  const legacyQualityUnknown = Boolean(payload) && !RESOLVED_UNIT_STATUSES.includes(meta?.unit_status ?? '')
  const derivedWithheld = Boolean(data?.error || meta?.unavailable)
    || legacyQualityUnknown
    || Boolean(meta?.unresolved_excluded_dates?.length || meta?.unresolved_session_count)
    || ['unavailable', 'error', 'unresolved', 'unconfirmed', 'mixed'].includes(meta?.quality_status ?? '')
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

  const warnings = [
    payload?.data_quality_note, data?.error, ...(meta?.warnings ?? []), meta?.adjustment_warning,
    meta?.fallback_used ? 'Historical source fallback used' : null,
    meta?.completeness_status === 'partial' ? 'Partial historical coverage' : null,
    error && payload ? 'Latest momentum refresh failed; showing previous observations' : null,
    derivedWithheld ? legacyQualityUnknown && !meta?.unit_status
      ? 'Legacy quality unknown: historical price units were not certified; momentum metrics withheld.'
      : 'Momentum metrics withheld: source quality is unavailable or unresolved.' : null,
  ].filter((message): message is string => Boolean(message))
  const quantWarning = warnings.length ? [...new Set(warnings)].join(' · ') : null
  const trendLabel = derivedWithheld ? 'Direction not assessed' : payload?.trend_label ?? scoreLabel(momentumScore)
  const hasData = Boolean(payload && (r20 !== null || r60 !== null || r120 !== null || r252 !== null))

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: {
          empty: !hasData,
          compactHeight: 4,
        },
      },
    })
  }, [hasData, onDataChange])

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
          <WidgetMeta updatedAt={data?.data?.last_data_date} fetchedAt={dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} · ${(payload?.adjustment_mode || 'adjusted')} history`} align="right" />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={7} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty message={data?.error || 'No momentum data available'} icon={<Gauge size={18} />} />
      ) : (
        <>
          <QuantWarningBanner warning={quantWarning} className="mb-2" />
          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 mb-2">
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Composite Momentum</div>
            <div className={`text-lg font-semibold ${derivedWithheld ? 'text-[var(--text-secondary)]' : scoreTone(momentumScore)}`}>{trendLabel}</div>
            <div className="text-[10px] text-[var(--text-secondary)]">
              {derivedWithheld ? 'Score withheld while source data quality is unresolved.' : `Score: ${momentumScore} / 4`}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">1M</div>
              <div className={derivedWithheld ? 'text-[var(--text-secondary)] font-mono' : r20 !== null && r20 >= 0 ? 'price-up font-mono' : 'price-down font-mono'}>
                {derivedWithheld ? '-' : formatPct(r20)}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">3M</div>
              <div className={derivedWithheld ? 'text-[var(--text-secondary)] font-mono' : r60 !== null && r60 >= 0 ? 'price-up font-mono' : 'price-down font-mono'}>
                {derivedWithheld ? '-' : formatPct(r60)}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">6M</div>
              <div className={derivedWithheld ? 'text-[var(--text-secondary)] font-mono' : r120 !== null && r120 >= 0 ? 'price-up font-mono' : 'price-down font-mono'}>
                {derivedWithheld ? '-' : formatPct(r120)}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">12M</div>
              <div className={derivedWithheld ? 'text-[var(--text-secondary)] font-mono' : r252 !== null && r252 >= 0 ? 'price-up font-mono' : 'price-down font-mono'}>
                {derivedWithheld ? '-' : formatPct(r252)}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default MomentumWidget
