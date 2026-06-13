'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { useSymbolsByGroup } from '@/lib/queries'
import * as api from '@/lib/api'
import type { TransactionFlowResponse } from '@/types/equity'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'

interface PositioningDashboardWidgetProps {
  symbol?: string
  onSymbolClick?: (symbol: string) => void
  onDataChange?: (data: WidgetDataPayload) => void
}

type UniverseGroup = 'VN30' | 'VN100' | 'HNX30'
const GROUPS: UniverseGroup[] = ['VN30', 'VN100', 'HNX30']
const WINDOWS = [5, 20] as const
type WindowDays = (typeof WINDOWS)[number]

// Keep the parallel per-symbol fetch bounded.
const MAX_SYMBOLS = 40

interface PositioningRow {
  symbol: string
  foreignNet: number | null
  proprietaryNet: number | null
  domesticNet: number | null
  totalNet: number | null
  hasData: boolean
}

function sumScope(points: TransactionFlowResponse['data']['data'], key: keyof (typeof points)[number]): number | null {
  let sum = 0
  let seen = false
  for (const point of points) {
    const raw = point[key]
    const value = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(value)) {
      sum += value
      seen = true
    }
  }
  return seen ? sum : null
}

function tone(value: number | null): string {
  if (value === null) return 'text-[var(--text-muted)]'
  if (value > 0) return 'text-emerald-400'
  if (value < 0) return 'text-red-400'
  return 'text-[var(--text-secondary)]'
}

function fmtNet(value: number | null): string {
  if (value === null) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  const abs = Math.abs(value)
  let scaled: string
  if (abs >= 1e12) scaled = `${(abs / 1e12).toFixed(1)}T`
  else if (abs >= 1e9) scaled = `${(abs / 1e9).toFixed(1)}B`
  else if (abs >= 1e6) scaled = `${(abs / 1e6).toFixed(1)}M`
  else if (abs >= 1e3) scaled = `${(abs / 1e3).toFixed(1)}K`
  else scaled = abs.toFixed(0)
  return `${sign}${scaled}`
}

export function PositioningDashboardWidget({ onSymbolClick, onDataChange }: PositioningDashboardWidgetProps) {
  const [group, setGroup] = useState<UniverseGroup>('VN30')
  const [windowDays, setWindowDays] = useState<WindowDays>(5)

  const { data: universe, isLoading: universeLoading } = useSymbolsByGroup(group)

  const symbols = useMemo(
    () => (universe?.data || []).map((row) => row.symbol).filter(Boolean).slice(0, MAX_SYMBOLS),
    [universe],
  )

  const flowQueries = useQueries({
    queries: symbols.map((sym) => ({
      queryKey: ['transactionFlow', sym, windowDays] as const,
      queryFn: () => api.getTransactionFlow(sym, { days: windowDays }),
      enabled: Boolean(sym),
      staleTime: 5 * 60 * 1000,
      gcTime: 15 * 60 * 1000,
    })),
  })

  const isLoading = universeLoading || flowQueries.some((q) => q.isLoading)
  const isFetching = flowQueries.some((q) => q.isFetching)

  const rows = useMemo<PositioningRow[]>(() => {
    return symbols.map((sym, index) => {
      const points = flowQueries[index]?.data?.data?.data || []
      const foreignNet = sumScope(points, 'foreign_net_value')
      const proprietaryNet = sumScope(points, 'proprietary_net_value')
      const domesticNet = sumScope(points, 'domestic_net_value')
      const totalNet = sumScope(points, 'total_net_value')
      const hasData = foreignNet !== null || proprietaryNet !== null || domesticNet !== null
      return { symbol: sym, foreignNet, proprietaryNet, domesticNet, totalNet, hasData }
    })
  }, [symbols, flowQueries])

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const av = a.foreignNet ?? Number.NEGATIVE_INFINITY
        const bv = b.foreignNet ?? Number.NEGATIVE_INFINITY
        return bv - av
      }),
    [rows],
  )

  const withData = sortedRows.filter((r) => r.hasData)

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: { empty: !withData.length, compactHeight: 6 },
        provenance: {
          sourceLabel: 'Investor-bucket flow',
          apiGroup: '/equity',
          endpoint: '/equity/{symbol}/transaction-flow',
        },
      },
      rows: withData.map((r) => ({
        symbol: r.symbol,
        foreign_net: r.foreignNet,
        proprietary_net: r.proprietaryNet,
        domestic_net: r.domesticNet,
        total_net: r.totalNet,
        window_days: windowDays,
      })),
    })
  }, [withData, onDataChange, windowDays])

  if (isLoading && !withData.length) return <WidgetSkeleton />

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-2 flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Users size={12} className="text-cyan-400" />
          <span>Positioning</span>
          <span className="text-[10px] text-[var(--text-muted)]">net value, {windowDays}D</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                className={
                  group === g
                    ? 'rounded bg-cyan-600/20 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300'
                    : 'rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }
              >
                {g}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWindowDays(w)}
                className={
                  windowDays === w
                    ? 'rounded bg-violet-600/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-300'
                    : 'rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }
              >
                {w}D
              </button>
            ))}
          </div>
        </div>
      </div>

      {!withData.length ? (
        <WidgetEmpty
          message="No investor-bucket flow available"
          icon={<Users size={18} />}
          detail="The selected universe has no foreign/proprietary/domestic net-flow data for this window yet."
        />
      ) : (
        <div className="flex-1 overflow-auto px-1">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-[var(--bg-widget-header)]/90 text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-1 py-1 text-left">Symbol</th>
                <th className="px-1 py-1 text-right">Foreign</th>
                <th className="px-1 py-1 text-right">Prop.</th>
                <th className="px-1 py-1 text-right">Domestic</th>
                <th className="px-1 py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr
                  key={row.symbol}
                  className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)]/30"
                >
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => onSymbolClick?.(row.symbol)}
                      className="font-bold text-[var(--accent-blue)] hover:underline"
                    >
                      {row.symbol}
                    </button>
                  </td>
                  <td className={`px-1 py-1 text-right font-semibold ${tone(row.foreignNet)}`}>{fmtNet(row.foreignNet)}</td>
                  <td className={`px-1 py-1 text-right ${tone(row.proprietaryNet)}`}>{fmtNet(row.proprietaryNet)}</td>
                  <td className={`px-1 py-1 text-right ${tone(row.domesticNet)}`}>{fmtNet(row.domesticNet)}</td>
                  <td className={`px-1 py-1 text-right font-semibold ${tone(row.totalNet)}`}>{fmtNet(row.totalNet)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <WidgetMeta
        className="px-1 pt-1"
        isFetching={isFetching}
        sourceLabel={`${withData.length}/${symbols.length} with flow`}
        align="right"
      />
    </div>
  )
}

export default PositioningDashboardWidget
