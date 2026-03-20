'use client'

import { useState } from 'react'
import { Atom } from 'lucide-react'
import { useGammaExposure } from '@/lib/queries'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'

interface GammaExposureWidgetProps {
  symbol: string
  isEditing?: boolean
  onRemove?: () => void
}

const PERIOD_OPTIONS = ['6M', '1Y', '3Y', '5Y'] as const

type PeriodOption = (typeof PERIOD_OPTIONS)[number]

function estimateGammaRegime(zScore: number): { label: string; tone: string } {
  if (zScore >= 1.5) return { label: 'Negative Gamma Risk', tone: 'text-red-400' }
  if (zScore >= 0.5) return { label: 'Neutral / Choppy', tone: 'text-amber-400' }
  if (zScore <= -0.8) return { label: 'Positive Gamma Cushion', tone: 'text-emerald-400' }
  return { label: 'Balanced', tone: 'text-cyan-400' }
}

export function GammaExposureWidget({ symbol }: GammaExposureWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<PeriodOption>('3Y')

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useGammaExposure(upperSymbol, {
    period,
    enabled: Boolean(upperSymbol),
  })

  const payload = data?.data

  const vol30 = Number(payload?.current_realized_vol_30d_pct ?? NaN)
  const zScore = Number(payload?.regime_z_score ?? NaN)
  const netGamma = Number(payload?.net_gamma_proxy ?? NaN)
  const hasData = Number.isFinite(vol30) || Number.isFinite(zScore)

  const regime = payload?.regime_label
    ? {
        label: payload.regime_label,
        tone:
          payload.dealer_position_proxy === 'long_gamma'
            ? 'text-emerald-400'
            : payload.dealer_position_proxy === 'short_gamma'
              ? 'text-red-400'
              : 'text-cyan-400',
      }
    : estimateGammaRegime(Number.isFinite(zScore) ? zScore : 0)

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view gamma exposure proxy" icon={<Atom size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Atom size={12} className="text-cyan-400" />
          <span>Gamma Exposure (Proxy)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {PERIOD_OPTIONS.map((option) => (
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
          <WidgetMeta updatedAt={data?.data?.last_data_date ?? data?.data?.computed_at ?? dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} proxy`} align="right" />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={6} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty
          message="No volatility proxy available for gamma estimate"
          icon={<Atom size={18} />}
        />
      ) : (
        <>
          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 mb-2">
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Estimated Regime</div>
            <div className={`text-lg font-semibold ${regime.tone}`}>{regime.label}</div>
            <div className="text-[10px] text-[var(--text-secondary)]">
              Net Gamma Proxy: {Number.isFinite(netGamma) ? netGamma.toFixed(2) : '-'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] mb-2">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">30D Realized Vol</div>
              <div className="font-mono text-[var(--text-primary)]">
                {Number.isFinite(vol30) ? `${vol30.toFixed(2)}%` : '-'}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Vol Z-Score</div>
              <div className="font-mono text-[var(--text-primary)]">
                {Number.isFinite(zScore) ? zScore.toFixed(2) : '-'}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 text-[10px] text-[var(--text-secondary)] leading-relaxed">
            This widget currently estimates gamma pressure from volatility regime data. Full gamma exposure
            requires options open-interest by strike and dealer-position assumptions, which are planned for a
            later provider integration.
          </div>
        </>
      )}
    </div>
  )
}

export default GammaExposureWidget
