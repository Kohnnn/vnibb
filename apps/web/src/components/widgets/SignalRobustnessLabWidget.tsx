'use client'

import { useEffect, useMemo, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { useScreenerData } from '@/lib/queries'
import type { ScreenerData } from '@/types/screener'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { QuantRunHistoryPanel } from '@/components/widgets/QuantRunHistoryPanel'

interface SignalRobustnessLabWidgetProps {
  symbol?: string
  onSymbolClick?: (symbol: string) => void
  onDataChange?: (data: unknown) => void
}

// Candidate signal metrics that exist on the screener row.
const SIGNAL_FIELDS = [
  { key: 'rs_rating', label: 'RS Rating', defaultThreshold: 80, comparator: 'gte' as const },
  { key: 'perf_1m', label: '1M return %', defaultThreshold: 0, comparator: 'gte' as const },
  { key: 'roe', label: 'ROE %', defaultThreshold: 15, comparator: 'gte' as const },
  { key: 'pe', label: 'P/E', defaultThreshold: 15, comparator: 'lte' as const },
] as const

type SignalKey = (typeof SIGNAL_FIELDS)[number]['key']

// Forward-return columns used as the (coarse, descriptive) edge read.
const RETURN_FIELDS: Array<{ key: keyof ScreenerData; label: string }> = [
  { key: 'perf_1m', label: '1M' },
  { key: 'perf_3m', label: '3M' },
  { key: 'perf_6m', label: '6M' },
]

function num(row: ScreenerData, key: string): number | null {
  const raw = (row as Record<string, unknown>)[key]
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(value) ? value : null
}

function avg(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function SignalRobustnessLabWidget({ onSymbolClick, onDataChange }: SignalRobustnessLabWidgetProps) {
  const [signalKey, setSignalKey] = useState<SignalKey>('rs_rating')
  const [comparator, setComparator] = useState<'gte' | 'lte'>('gte')
  const [threshold, setThreshold] = useState<number>(80)

  const { data, isLoading, error, refetch, isFetching } = useScreenerData({ limit: 300 })

  // When the signal field changes, reset comparator/threshold to its defaults.
  const handleSignalChange = (key: SignalKey) => {
    const def = SIGNAL_FIELDS.find((f) => f.key === key)
    setSignalKey(key)
    if (def) {
      setComparator(def.comparator)
      setThreshold(def.defaultThreshold)
    }
  }

  const rows = useMemo<ScreenerData[]>(() => data?.data || [], [data])

  const evaluation = useMemo(() => {
    const universe = rows.filter((r) => num(r, signalKey) !== null)
    const passes = universe.filter((r) => {
      const v = num(r, signalKey)
      if (v === null) return false
      return comparator === 'gte' ? v >= threshold : v <= threshold
    })

    const returnReads = RETURN_FIELDS.map((field) => {
      const passVals = passes.map((r) => num(r, field.key as string)).filter((v): v is number => v !== null)
      const universeVals = universe.map((r) => num(r, field.key as string)).filter((v): v is number => v !== null)
      const passAvg = avg(passVals)
      const universeAvg = avg(universeVals)
      const edge = passAvg !== null && universeAvg !== null ? passAvg - universeAvg : null
      return { label: field.label, passAvg, universeAvg, edge }
    })

    return {
      universeCount: universe.length,
      passCount: passes.length,
      passRate: universe.length ? (passes.length / universe.length) * 100 : null,
      returnReads,
      passes: passes
        .map((r) => ({
          symbol: r.ticker || r.symbol || '',
          signal: num(r, signalKey),
          perf1m: num(r, 'perf_1m'),
          perf3m: num(r, 'perf_3m'),
        }))
        .filter((r) => r.symbol)
        .sort((a, b) => (b.signal ?? 0) - (a.signal ?? 0))
        .slice(0, 30),
    }
  }, [rows, signalKey, comparator, threshold])

  const hasData = rows.length > 0

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: { empty: !hasData, compactHeight: 6 },
        provenance: {
          sourceLabel: 'Screener universe (descriptive test)',
          apiGroup: '/screener',
          endpoint: '/screener/',
          updatedAt: data?.meta?.last_data_date ?? undefined,
        },
      },
      signal: { field: signalKey, comparator, threshold },
      summary: {
        universe: evaluation.universeCount,
        pass: evaluation.passCount,
        pass_rate_pct: evaluation.passRate,
      },
      return_reads: evaluation.returnReads,
      rows: evaluation.passes,
    })
  }, [hasData, onDataChange, signalKey, comparator, threshold, evaluation, data?.meta?.last_data_date])

  if (isLoading && !hasData) return <WidgetSkeleton />
  if (error && !hasData) return <WidgetError title="Failed to load screener universe" onRetry={() => refetch()} />
  if (!hasData) {
    return <WidgetEmpty message="No screener universe available" icon={<FlaskConical size={18} />} />
  }

  const signalLabel = SIGNAL_FIELDS.find((f) => f.key === signalKey)?.label ?? signalKey

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-2 flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <FlaskConical size={12} className="text-violet-400" />
          <span>Signal Robustness</span>
          <span className="text-[10px] text-[var(--text-muted)]">descriptive</span>
        </div>
      </div>

      {/* Signal config */}
      <div className="flex flex-wrap items-center gap-1 px-1">
        <select
          value={signalKey}
          onChange={(e) => handleSignalChange(e.target.value as SignalKey)}
          className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
        >
          {SIGNAL_FIELDS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          value={comparator}
          onChange={(e) => setComparator(e.target.value as 'gte' | 'lte')}
          className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
        >
          <option value="gte">&ge;</option>
          <option value="lte">&le;</option>
        </select>
        <input
          type="number"
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-20 rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-right text-[11px] text-[var(--text-primary)]"
        />
      </div>

      {/* Summary */}
      <div className="mt-2 grid grid-cols-3 gap-1 px-1">
        <Kpi label="Universe" value={String(evaluation.universeCount)} />
        <Kpi label="Pass" value={String(evaluation.passCount)} tone="text-cyan-400" />
        <Kpi
          label="Pass rate"
          value={evaluation.passRate === null ? '—' : `${evaluation.passRate.toFixed(0)}%`}
        />
      </div>

      {/* Edge read */}
      <div className="mt-2 px-1">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Avg return: passing vs universe
        </div>
        <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
          {evaluation.returnReads.map((read) => (
            <div key={read.label} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 px-1 py-1">
              <div className="text-[var(--text-muted)]">{read.label}</div>
              <div className="font-semibold text-[var(--text-primary)]">
                {read.passAvg === null ? '—' : `${read.passAvg.toFixed(1)}%`}
              </div>
              <div
                className={
                  read.edge === null
                    ? 'text-[var(--text-muted)]'
                    : read.edge >= 0
                      ? 'text-emerald-400'
                      : 'text-red-400'
                }
              >
                {read.edge === null ? '—' : `${read.edge >= 0 ? '+' : ''}${read.edge.toFixed(1)}% edge`}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Passing names */}
      <div className="mt-2 flex-1 overflow-auto px-1">
        <table className="w-full text-[10px]">
          <thead className="sticky top-0 bg-[var(--bg-widget-header)]/90 text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
            <tr>
              <th className="px-1 py-1 text-left">Symbol</th>
              <th className="px-1 py-1 text-right">{signalLabel}</th>
              <th className="px-1 py-1 text-right">1M</th>
              <th className="px-1 py-1 text-right">3M</th>
            </tr>
          </thead>
          <tbody>
            {evaluation.passes.map((row) => (
              <tr key={row.symbol} className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)]/30">
                <td className="px-1 py-1">
                  <button
                    type="button"
                    onClick={() => onSymbolClick?.(row.symbol)}
                    className="font-bold text-[var(--accent-blue)] hover:underline"
                  >
                    {row.symbol}
                  </button>
                </td>
                <td className="px-1 py-1 text-right font-semibold text-[var(--text-primary)]">
                  {row.signal === null ? '—' : row.signal.toFixed(1)}
                </td>
                <td className={`px-1 py-1 text-right ${(row.perf1m ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {row.perf1m === null ? '—' : `${row.perf1m.toFixed(1)}%`}
                </td>
                <td className={`px-1 py-1 text-right ${(row.perf3m ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {row.perf3m === null ? '—' : `${row.perf3m.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-1 pt-1 text-[9px] leading-3 text-[var(--text-muted)]">
        Descriptive cross-sectional read on the current screener snapshot, not a backtest or forward prediction.
        Returns are realized trailing performance, not future returns.
      </p>

      <WidgetMeta className="px-1 pt-1" isFetching={isFetching} sourceLabel="Screener snapshot" align="right" />

      <QuantRunHistoryPanel
        widget="signal_robustness_lab"
        headlineKey="edge_1m_pct"
        headlineLabel="1M edge %"
        buildRun={() =>
          hasData
            ? {
                name: `${signalLabel} ${comparator === 'gte' ? '≥' : '≤'} ${threshold} · ${new Date().toLocaleDateString()}`,
                config: { signalKey, comparator, threshold },
                summary: {
                  universe: evaluation.universeCount,
                  pass: evaluation.passCount,
                  pass_rate_pct: evaluation.passRate,
                  edge_1m_pct: evaluation.returnReads.find((r) => r.label === '1M')?.edge ?? null,
                  edge_3m_pct: evaluation.returnReads.find((r) => r.label === '3M')?.edge ?? null,
                },
              }
            : null
        }
        onApply={(config) => {
          if (typeof config.signalKey === 'string') setSignalKey(config.signalKey as SignalKey)
          if (config.comparator === 'gte' || config.comparator === 'lte') setComparator(config.comparator)
          if (typeof config.threshold === 'number') setThreshold(config.threshold)
        }}
      />
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 px-1.5 py-1 text-center">
      <div className="text-[8px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className={`text-[12px] font-bold ${tone || 'text-[var(--text-primary)]'}`}>{value}</div>
    </div>
  )
}

export default SignalRobustnessLabWidget
