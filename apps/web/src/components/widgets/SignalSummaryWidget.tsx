'use client'

import { useMemo, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useFullTechnicalAnalysis } from '@/lib/queries'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import type { Signal, Timeframe } from '@/types/technical'

const TIMEFRAME_OPTIONS: Array<{ value: Timeframe; label: string }> = [
  { value: 'D', label: 'Short' },
  { value: 'W', label: 'Medium' },
  { value: 'M', label: 'Long' },
]

function signalTone(signal: Signal | string) {
  switch (signal) {
    case 'strong_buy':
      return 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30'
    case 'buy':
      return 'bg-emerald-500/12 text-emerald-200 border-emerald-500/20'
    case 'strong_sell':
      return 'bg-rose-500/20 text-rose-200 border-rose-400/30'
    case 'sell':
      return 'bg-rose-500/12 text-rose-200 border-rose-500/20'
    default:
      return 'bg-amber-500/12 text-amber-100 border-amber-500/20'
  }
}

export function SignalSummaryWidget({ symbol }: { symbol?: string }) {
  const [timeframe, setTimeframe] = useState<Timeframe>('W')
  const upperSymbol = symbol?.toUpperCase() || ''
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useFullTechnicalAnalysis(upperSymbol, {
    timeframe,
    enabled: Boolean(upperSymbol),
  })

  const hasData = Boolean(data)
  const isFallback = Boolean(error && hasData)

  const derived = useMemo(() => {
    if (!data) return null
    const total = Math.max(data.signals.total_indicators || 0, 1)
    const strongest = Math.max(data.signals.buy_count, data.signals.sell_count, data.signals.neutral_count)
    const consensus = Math.round((strongest / total) * 100)
    const support = data.levels.support_resistance.support[0] ?? data.levels.support_resistance.nearest_support ?? null
    const support2 = data.levels.support_resistance.support[1] ?? null
    const resistance = data.levels.support_resistance.resistance[0] ?? data.levels.support_resistance.nearest_resistance ?? null
    const resistance2 = data.levels.support_resistance.resistance[1] ?? null
    const price = data.levels.support_resistance.current_price ?? null
    const supportDistancePct = support && price
      ? Math.abs((price - support) / price) * 100
      : null
    const resistanceDistancePct = resistance && price
      ? Math.abs((resistance - price) / price) * 100
      : null
    const balance = data.signals.buy_count - data.signals.sell_count

    return {
      consensus,
      price,
      support,
      support2,
      resistance,
      resistance2,
      supportDistancePct,
      resistanceDistancePct,
      balance,
    }
  }, [data])

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view trade signals" icon={<ShieldAlert size={18} />} />
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <ShieldAlert size={13} className="text-amber-400" />
          <span>Signal Summary</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5">
            {TIMEFRAME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTimeframe(option.value)}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                  timeframe === option.value
                    ? 'bg-amber-500/20 text-amber-100'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note={TIMEFRAME_OPTIONS.find((item) => item.value === timeframe)?.label}
            align="right"
          />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !data || !derived ? (
        <WidgetEmpty message="No signal summary available." icon={<ShieldAlert size={18} />} />
      ) : (
        <>
          <div className="grid grid-cols-[auto_1fr] gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
            <div className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-bold uppercase ${signalTone(data.signals.overall_signal)}`}>
              {data.signals.overall_signal.replace(/_/g, ' ')}
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                <span>Consensus</span>
                <span>{derived.consensus}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-400 via-sky-400 to-emerald-400" style={{ width: `${derived.consensus}%` }} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-center">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Bullish</div>
              <div className="mt-1 text-lg font-bold text-emerald-300">{data.signals.buy_count}</div>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-center">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Neutral</div>
              <div className="mt-1 text-lg font-bold text-amber-200">{data.signals.neutral_count}</div>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-center">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Bearish</div>
              <div className="mt-1 text-lg font-bold text-rose-300">{data.signals.sell_count}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Entry Zones</div>
              <div className="mt-1 space-y-1 text-[var(--text-primary)]">
                <div>Current: {derived.price?.toLocaleString() || '--'}</div>
                <div>Support 1: {derived.support?.toLocaleString() || '--'}</div>
                <div>Support 2: {derived.support2?.toLocaleString() || '--'}</div>
                <div>Resistance 1: {derived.resistance?.toLocaleString() || '--'}</div>
                <div>Resistance 2: {derived.resistance2?.toLocaleString() || '--'}</div>
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Context</div>
              <div className="mt-1 space-y-1 text-[var(--text-primary)]">
                <div>Trend strength: {data.signals.trend_strength.replace(/_/g, ' ')}</div>
                <div>Signal balance: {derived.balance > 0 ? `+${derived.balance} bullish` : derived.balance < 0 ? `${derived.balance} bearish` : 'Even'}</div>
                <div>To support: {derived.supportDistancePct ? `${derived.supportDistancePct.toFixed(2)}%` : '--'}</div>
                <div>To resistance: {derived.resistanceDistancePct ? `${derived.resistanceDistancePct.toFixed(2)}%` : '--'}</div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Indicator Breakdown</div>
            <div className="space-y-1.5">
              {data.signals.indicators.slice(0, 8).map((indicator) => (
                <div key={indicator.name} className="grid grid-cols-[minmax(0,1fr)_90px] items-center gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[var(--text-primary)]">{indicator.name}</div>
                    <div className="truncate text-[10px] text-[var(--text-muted)]">{String(indicator.value ?? 'No value')}</div>
                  </div>
                  <div className={`justify-self-end rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${signalTone(indicator.signal)}`}>
                    {indicator.signal.replace(/_/g, ' ')}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[10px] text-amber-100/85">
            Evidence only, not advice. Use this widget as a closing read after checking trend, structure, volume, and support or resistance behavior above it.
          </div>
        </>
      )}
    </div>
  )
}

export default SignalSummaryWidget
