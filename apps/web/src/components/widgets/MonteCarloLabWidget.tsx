'use client'

import { useEffect, useMemo, useState } from 'react'
import { Dices } from 'lucide-react'
import { useHistoricalPrices } from '@/lib/queries'
import { QUANT_PERIOD_OPTIONS, getQuantPeriodStartDate, type QuantPeriodOption } from '@/lib/quantPeriods'
import { dailyReturns, runDrawdownBootstrap, toDatedCloses } from '@/lib/quantLabMath'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { QuantRunHistoryPanel } from '@/components/widgets/QuantRunHistoryPanel'

interface MonteCarloLabWidgetProps {
  symbol: string
  onDataChange?: (data: WidgetDataPayload) => void
}

const HORIZON_OPTIONS = [63, 126, 252] as const
type Horizon = (typeof HORIZON_OPTIONS)[number]

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

export function MonteCarloLabWidget({ symbol, onDataChange }: MonteCarloLabWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('3Y')
  const [horizon, setHorizon] = useState<Horizon>(126)

  const startDate = useMemo(() => getQuantPeriodStartDate(period), [period])
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useHistoricalPrices(upperSymbol, {
    startDate,
    interval: '1D',
    adjustmentMode: 'adjusted',
    enabled: Boolean(upperSymbol),
  })

  const stats = useMemo(() => {
    const closes = toDatedCloses(data?.data || []).map((bar) => bar.close)
    return runDrawdownBootstrap(dailyReturns(closes), { horizonDays: horizon })
  }, [data, horizon])

  const hasData = Boolean(stats)

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: { empty: !hasData, compactHeight: 5 },
        provenance: {
          sourceLabel: 'Monte Carlo Lab (derived)',
          apiGroup: '/equity',
          endpoint: `/equity/historical?symbol=${upperSymbol}`,
          adjustmentMode: 'adjusted',
          updatedAt: data?.meta?.last_data_date ?? (dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined),
        },
      },
      rows: stats
        ? [{
            symbol: upperSymbol,
            paths: stats.paths,
            horizon_days: stats.horizonDays,
            sample_days: stats.sampleDays,
            max_drawdown_p5_pct: stats.maxDrawdownPct.p5,
            max_drawdown_p50_pct: stats.maxDrawdownPct.p50,
            max_drawdown_p95_pct: stats.maxDrawdownPct.p95,
            terminal_return_p5_pct: stats.terminalReturnPct.p5,
            terminal_return_p50_pct: stats.terminalReturnPct.p50,
            terminal_return_p95_pct: stats.terminalReturnPct.p95,
          }]
        : [],
    })
  }, [hasData, onDataChange, upperSymbol, stats, data?.meta?.last_data_date, dataUpdatedAt])

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to run the drawdown bootstrap" icon={<Dices size={18} />} />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Dices size={12} className="text-cyan-400" />
          <span>Monte Carlo Lab</span>
          <span className="text-[10px] text-[var(--text-muted)]">{stats ? `${stats.paths} paths` : 'bootstrap'}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {HORIZON_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setHorizon(value)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${horizon === value ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}
              >
                {value}D
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {QUANT_PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${period === option ? 'bg-violet-600/30 text-violet-200' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-1 mb-2 rounded border border-violet-500/25 bg-violet-500/5 px-2 py-1 text-[9px] leading-3 text-violet-200/90">
        Resampling of this symbol&apos;s past daily returns (IID bootstrap). Ignores volatility clustering and regime change. A range of historical-style outcomes — not a prediction.
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty
          message="Not enough history to bootstrap"
          icon={<Dices size={18} />}
          detail="Needs at least 60 adjusted daily returns in the selected period."
        />
      ) : stats ? (
        <div className="flex-1 overflow-auto px-1">
          <div className="mb-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
            <div className="mb-1 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Forward {stats.horizonDays}D Max Drawdown
            </div>
            <table className="w-full text-[11px]" aria-label={`${symbol} bootstrap max drawdown percentiles`}>
              <thead className="text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
                <tr>
                  <th className="px-1 py-0.5 text-left">P5 (mild)</th>
                  <th className="px-1 py-0.5 text-left">P25</th>
                  <th className="px-1 py-0.5 text-left">Median</th>
                  <th className="px-1 py-0.5 text-left">P75</th>
                  <th className="px-1 py-0.5 text-left">P95 (deep)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="font-mono">
                  <td className="px-1 py-1 text-emerald-300">{fmtPct(stats.maxDrawdownPct.p5)}</td>
                  <td className="px-1 py-1 text-[var(--text-primary)]">{fmtPct(stats.maxDrawdownPct.p25)}</td>
                  <td className="px-1 py-1 font-semibold text-amber-300">{fmtPct(stats.maxDrawdownPct.p50)}</td>
                  <td className="px-1 py-1 text-[var(--text-primary)]">{fmtPct(stats.maxDrawdownPct.p75)}</td>
                  <td className="px-1 py-1 text-rose-300">{fmtPct(stats.maxDrawdownPct.p95)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
            <div className="mb-1 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Terminal Return after {stats.horizonDays}D
            </div>
            <table className="w-full text-[11px]" aria-label={`${symbol} bootstrap terminal return percentiles`}>
              <thead className="text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
                <tr>
                  <th className="px-1 py-0.5 text-left">P5</th>
                  <th className="px-1 py-0.5 text-left">P25</th>
                  <th className="px-1 py-0.5 text-left">Median</th>
                  <th className="px-1 py-0.5 text-left">P75</th>
                  <th className="px-1 py-0.5 text-left">P95</th>
                </tr>
              </thead>
              <tbody>
                <tr className="font-mono">
                  <td className="px-1 py-1 text-rose-300">{fmtPct(stats.terminalReturnPct.p5)}</td>
                  <td className="px-1 py-1 text-[var(--text-primary)]">{fmtPct(stats.terminalReturnPct.p25)}</td>
                  <td className="px-1 py-1 font-semibold text-cyan-300">{fmtPct(stats.terminalReturnPct.p50)}</td>
                  <td className="px-1 py-1 text-[var(--text-primary)]">{fmtPct(stats.terminalReturnPct.p75)}</td>
                  <td className="px-1 py-1 text-emerald-300">{fmtPct(stats.terminalReturnPct.p95)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-2 text-[10px] text-[var(--text-muted)]">
            Sample: {stats.sampleDays} daily returns ({period}, adjusted). Fixed seed — results are stable across refreshes.
          </div>
        </div>
      ) : null}

      <WidgetMeta
        className="px-1 pt-1"
        updatedAt={data?.meta?.last_data_date ?? dataUpdatedAt}
        isFetching={isFetching && hasData}
        align="right"
      />

      <QuantRunHistoryPanel
        widget="monte_carlo_lab"
        headlineKey="terminal_return_p50_pct"
        headlineLabel="Median terminal return %"
        buildRun={() =>
          stats
            ? {
                name: `${upperSymbol} ${horizon}D ${period} · ${new Date().toLocaleDateString()}`,
                config: { symbol: upperSymbol, period, horizon },
                summary: {
                  max_drawdown_p50_pct: stats.maxDrawdownPct.p50,
                  max_drawdown_p95_pct: stats.maxDrawdownPct.p95,
                  terminal_return_p50_pct: stats.terminalReturnPct.p50,
                  terminal_return_p5_pct: stats.terminalReturnPct.p5,
                  terminal_return_p95_pct: stats.terminalReturnPct.p95,
                },
              }
            : null
        }
        onApply={(config) => {
          if (typeof config.period === 'string') setPeriod(config.period as QuantPeriodOption)
          if (typeof config.horizon === 'number' && HORIZON_OPTIONS.includes(config.horizon as Horizon)) {
            setHorizon(config.horizon as Horizon)
          }
        }}
      />
    </div>
  )
}

export default MonteCarloLabWidget
