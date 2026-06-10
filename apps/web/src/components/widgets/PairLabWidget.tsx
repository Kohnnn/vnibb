'use client'

import { useEffect, useMemo, useState } from 'react'
import { GitCompareArrows } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useHistoricalPrices, usePairDiagnostics } from '@/lib/queries'
import type { PairDiagnosticsPayload } from '@/lib/api'
import { QUANT_PERIOD_OPTIONS, getQuantPeriodStartDate, type QuantPeriodOption } from '@/lib/quantPeriods'
import { computePairStats, toDatedCloses } from '@/lib/quantLabMath'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { ChartMountGuard } from '@/components/ui/ChartMountGuard'
import { QuantRunHistoryPanel } from '@/components/widgets/QuantRunHistoryPanel'

interface PairLabWidgetProps {
  symbol: string
  onDataChange?: (data: unknown) => void
}

function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

export function PairLabWidget({ symbol, onDataChange }: PairLabWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('3Y')
  const [pairInput, setPairInput] = useState('')
  const [pairSymbol, setPairSymbol] = useState('')
  const [hedgeMode, setHedgeMode] = useState<'one_to_one' | 'ols'>('one_to_one')

  const startDate = useMemo(() => getQuantPeriodStartDate(period), [period])
  const effectivePair = pairSymbol.toUpperCase()

  const primaryQuery = useHistoricalPrices(upperSymbol, {
    startDate,
    interval: '1D',
    adjustmentMode: 'adjusted',
    enabled: Boolean(upperSymbol),
  })
  const pairQuery = useHistoricalPrices(effectivePair, {
    startDate,
    interval: '1D',
    adjustmentMode: 'adjusted',
    enabled: Boolean(effectivePair),
  })

  // Backend cointegration diagnostics (OLS hedge ratio + approximate ADF).
  // Only fetched when the user opts into OLS mode; tolerates a not-yet-deployed
  // backend (404) via the `not_deployed` sentinel from usePairDiagnostics.
  const backendQuery = usePairDiagnostics(upperSymbol, effectivePair, {
    period,
    adjustmentMode: 'adjusted',
    enabled: hedgeMode === 'ols' && Boolean(upperSymbol) && Boolean(effectivePair),
  })
  const backendState = backendQuery.data
  const backendPayload = backendState?.status === 'ok' ? backendState.payload : null
  const backendNotDeployed = backendState?.status === 'not_deployed'

  const stats = useMemo(() => {
    if (!effectivePair) return null
    const a = toDatedCloses(primaryQuery.data?.data || [])
    const b = toDatedCloses(pairQuery.data?.data || [])
    if (!a.length || !b.length) return null
    return computePairStats(a, b)
  }, [primaryQuery.data, pairQuery.data, effectivePair])

  const hasData = Boolean(stats && stats.series.length)
  const chartData = useMemo(
    () =>
      (stats?.series || [])
        .filter((point) => point.spreadZ !== null)
        .map((point) => ({ date: point.date, z: Number((point.spreadZ as number).toFixed(3)) })),
    [stats],
  )

  const isLoading = (primaryQuery.isLoading || pairQuery.isLoading) && !hasData
  const error = primaryQuery.error || pairQuery.error
  const isFetching = primaryQuery.isFetching || pairQuery.isFetching

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: { empty: !hasData, compactHeight: 5 },
        provenance: {
          sourceLabel: 'Pair Lab (derived)',
          apiGroup: '/equity',
          endpoint: `/equity/historical?symbols=${upperSymbol},${effectivePair || '?'}`,
          adjustmentMode: 'adjusted',
        },
      },
      rows: hasData && stats
        ? [{
            symbol_a: upperSymbol,
            symbol_b: effectivePair,
            aligned_days: stats.alignedDays,
            rolling_correlation_63d: stats.currentCorrelation,
            spread_z_score: stats.currentSpreadZ,
            ar1_half_life_days: stats.halfLifeDays,
          }]
        : [],
    })
  }, [hasData, onDataChange, upperSymbol, effectivePair, stats])

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to open the pair lab" icon={<GitCompareArrows size={18} />} />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between gap-2 px-1 py-1">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <GitCompareArrows size={12} className="text-cyan-400" />
          <span>Pair Lab</span>
          <span className="text-[10px] text-[var(--text-muted)]">{upperSymbol} vs {effectivePair || '?'}</span>
        </div>
        <div className="flex items-center gap-1">
          {QUANT_PERIOD_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setPeriod(option)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${period === option ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <form
        className="mb-2 flex items-center gap-1 px-1"
        onSubmit={(event) => {
          event.preventDefault()
          setPairSymbol(pairInput.trim().toUpperCase())
        }}
      >
        <input
          aria-label="Pair symbol"
          value={pairInput}
          onChange={(event) => setPairInput(event.target.value)}
          placeholder="Compare with… (e.g. VNM)"
          className="h-7 flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-blue-400/50"
        />
        <button
          type="submit"
          disabled={!pairInput.trim()}
          className="h-7 rounded-md border border-blue-400/30 bg-blue-400/10 px-2 text-[10px] font-black uppercase text-blue-100 hover:bg-blue-400/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Compare
        </button>
      </form>

      {effectivePair && (
        <div className="mb-2 flex items-center gap-2 px-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Hedge</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setHedgeMode('one_to_one')}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${hedgeMode === 'one_to_one' ? 'bg-violet-600/30 text-violet-200' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}
            >
              1:1 (client)
            </button>
            <button
              type="button"
              onClick={() => setHedgeMode('ols')}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${hedgeMode === 'ols' ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}
            >
              OLS (backend)
            </button>
          </div>
          {hedgeMode === 'ols' && backendQuery.isFetching && (
            <span className="text-[10px] text-[var(--text-muted)]">loading…</span>
          )}
        </div>
      )}

      {effectivePair && hedgeMode === 'ols' && (
        <PairBackendPanel
          notDeployed={backendNotDeployed}
          payload={backendPayload}
          error={backendState?.status === 'ok' ? backendState.error : null}
        />
      )}

      {!effectivePair ? (
        <WidgetEmpty
          message="Enter a second symbol to compare"
          icon={<GitCompareArrows size={18} />}
          detail="Pair Lab shows rolling correlation, log-spread z-score, and the AR(1) half-life of the 1:1 spread. Descriptive only — not a trading signal."
        />
      ) : isLoading ? (
        <WidgetSkeleton lines={8} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => { void primaryQuery.refetch(); void pairQuery.refetch() }} />
      ) : !hasData ? (
        <WidgetEmpty
          message="Not enough overlapping history"
          icon={<GitCompareArrows size={18} />}
          detail="Both symbols need at least ~3 months of overlapping adjusted daily bars."
        />
      ) : (
        <>
          <div className="mb-2 grid grid-cols-4 gap-2 px-1 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Corr 63D</div>
              <div className="font-mono text-cyan-300">{fmt(stats?.currentCorrelation)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Spread Z</div>
              <div className={`font-mono ${Math.abs(stats?.currentSpreadZ ?? 0) >= 2 ? 'text-amber-300' : 'text-[var(--text-primary)]'}`}>{fmt(stats?.currentSpreadZ)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Half-Life</div>
              <div className="font-mono text-violet-300">{stats?.halfLifeDays === null ? '—' : `${fmt(stats?.halfLifeDays, 1)}d`}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Aligned</div>
              <div className="font-mono text-[var(--text-primary)]">{stats?.alignedDays ?? 0}d</div>
            </div>
          </div>

          <div className="mx-1 flex min-h-[170px] flex-1 flex-col rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Log-Spread Z-Score (1:1)</div>
              <div className="text-[10px] text-[var(--text-secondary)]">full-period mean/std · descriptive</div>
            </div>
            <ChartMountGuard className="flex-1 min-h-[130px]" minHeight={130}>
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} minTickGap={48} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <ReferenceLine y={0} stroke="rgba(148,163,184,0.45)" strokeDasharray="4 4" />
                  <ReferenceLine y={2} stroke="rgba(245,158,11,0.5)" strokeDasharray="4 4" />
                  <ReferenceLine y={-2} stroke="rgba(245,158,11,0.5)" strokeDasharray="4 4" />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                    formatter={(value) => [Number(value).toFixed(2), 'Z'] as [string, string]}
                  />
                  <Line type="monotone" dataKey="z" stroke="#a78bfa" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartMountGuard>
          </div>

          <WidgetMeta
            className="px-1 pt-1"
            isFetching={isFetching && hasData}
            note={`${period} adjusted pair history`}
            align="right"
          />

          <QuantRunHistoryPanel
            widget="pair_lab"
            headlineKey="ar1_half_life_days"
            headlineLabel="AR(1) half-life (days)"
            buildRun={() =>
              hasData && stats
                ? {
                    name: `${upperSymbol}/${effectivePair} ${period} ${hedgeMode === 'ols' ? 'OLS' : '1:1'} · ${new Date().toLocaleDateString()}`,
                    config: { symbol: upperSymbol, pairSymbol: effectivePair, period, hedgeMode },
                    summary: {
                      rolling_correlation_63d: stats.currentCorrelation,
                      spread_z_score: stats.currentSpreadZ,
                      ar1_half_life_days: stats.halfLifeDays,
                      aligned_days: stats.alignedDays,
                      ols_hedge_ratio: backendPayload?.hedge_ratio_ols ?? null,
                      adf_tstat: backendPayload?.adf_tstat ?? null,
                    },
                  }
                : null
            }
            onApply={(config) => {
              if (typeof config.period === 'string') setPeriod(config.period as QuantPeriodOption)
              if (config.hedgeMode === 'ols' || config.hedgeMode === 'one_to_one') setHedgeMode(config.hedgeMode)
              if (typeof config.pairSymbol === 'string') {
                setPairInput(config.pairSymbol)
                setPairSymbol(config.pairSymbol)
              }
            }}
          />
        </>
      )}
    </div>
  )
}

function PairBackendPanel({
  notDeployed,
  payload,
  error,
}: {
  notDeployed: boolean
  payload: PairDiagnosticsPayload | null
  error?: string | null
}) {
  if (notDeployed) {
    return (
      <div className="mx-1 mb-2 rounded border border-amber-500/25 bg-amber-500/5 px-2 py-1 text-[9px] leading-3 text-amber-200/90">
        OLS hedge-ratio diagnostics aren&apos;t available yet — the backend endpoint hasn&apos;t been deployed.
        Showing the client 1:1 spread below. Switch back to 1:1 to hide this notice.
      </div>
    )
  }
  if (error || !payload) {
    return (
      <div className="mx-1 mb-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 px-2 py-1 text-[9px] leading-3 text-[var(--text-muted)]">
        {error || 'Computing OLS hedge ratio…'}
      </div>
    )
  }
  return (
    <div className="mx-1 mb-2 rounded-md border border-blue-500/25 bg-blue-500/5 p-2">
      <div className="mb-1 grid grid-cols-4 gap-2 text-[10px]">
        <div>
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Hedge β</div>
          <div className="font-mono text-blue-200">{fmt(payload.hedge_ratio_ols)}</div>
        </div>
        <div>
          <div className="text-[var(--text-muted)] uppercase tracking-widest">ADF t</div>
          <div className="font-mono text-violet-200">{fmt(payload.adf_tstat)}</div>
        </div>
        <div>
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Half-life</div>
          <div className="font-mono text-cyan-200">
            {payload.half_life_days === null ? '—' : `${fmt(payload.half_life_days, 1)}d`}
          </div>
        </div>
        <div>
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Corr 63D</div>
          <div className="font-mono text-[var(--text-primary)]">{fmt(payload.rolling_correlation_63d)}</div>
        </div>
      </div>
      {payload.adf_verdict && (
        <div className="text-[9px] text-[var(--text-secondary)]">
          {payload.adf_verdict} (5% crit ≈ {fmt(payload.adf_critical_values?.['5%'])})
        </div>
      )}
      <div className="mt-0.5 text-[9px] leading-3 text-[var(--text-muted)]">{payload.adf_caveat}</div>
    </div>
  )
}

export default PairLabWidget
