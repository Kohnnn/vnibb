'use client'

import { useEffect, useMemo, useState } from 'react'
import { Waves } from 'lucide-react'
import { useBlockTrades } from '@/lib/queries'
import { formatTimestamp } from '@/lib/format'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'

interface BigFlowMonitorWidgetProps {
  symbol?: string
  onSymbolClick?: (symbol: string) => void
  onDataChange?: (data: unknown) => void
}

// Minimum single-trade value thresholds, in VND billions.
const THRESHOLDS = [5, 10, 20] as const
type Threshold = (typeof THRESHOLDS)[number]

type ScopeFilter = 'all' | 'foreign' | 'proprietary'

const SCOPES: Array<{ value: ScopeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'foreign', label: 'Foreign' },
  { value: 'proprietary', label: 'Prop.' },
]

function fmtValue(value: number | null | undefined): string {
  const abs = Math.abs(value ?? 0)
  if (abs >= 1e12) return `${(abs / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(abs / 1e6).toFixed(1)}M`
  return abs.toFixed(0)
}

export function BigFlowMonitorWidget({ symbol, onSymbolClick, onDataChange }: BigFlowMonitorWidgetProps) {
  const [threshold, setThreshold] = useState<Threshold>(10)
  const [scope, setScope] = useState<ScopeFilter>('all')

  // No symbol filter: this is a market-wide tape of the largest prints.
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useBlockTrades({ limit: 100 })

  const trades = useMemo(() => {
    const minValue = threshold * 1e9
    return (data || [])
      .filter((trade) => (trade.value || 0) >= minValue)
      .filter((trade) => {
        if (scope === 'foreign') return trade.is_foreign
        if (scope === 'proprietary') return trade.is_proprietary
        return true
      })
      .sort((a, b) => (b.value || 0) - (a.value || 0))
  }, [data, threshold, scope])

  const totals = useMemo(() => {
    let buy = 0
    let sell = 0
    for (const trade of trades) {
      if (trade.side === 'BUY') buy += trade.value || 0
      else if (trade.side === 'SELL') sell += trade.value || 0
    }
    return { buy, sell, net: buy - sell }
  }, [trades])

  const hasData = trades.length > 0

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: { empty: !hasData, compactHeight: 5 },
        provenance: {
          sourceLabel: 'Block-trade tape',
          apiGroup: '/insider',
          endpoint: '/insider/block-trades',
          updatedAt: dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined,
        },
      },
      rows: trades.map((trade) => ({
        symbol: trade.symbol,
        side: trade.side,
        value: trade.value,
        quantity: trade.quantity,
        price: trade.price,
        trade_time: trade.trade_time,
        is_foreign: trade.is_foreign,
        is_proprietary: trade.is_proprietary,
        min_value_bn: threshold,
      })),
    })
  }, [trades, hasData, onDataChange, dataUpdatedAt, threshold])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-2 flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Waves size={12} className="text-cyan-400" />
          <span>Big Flow</span>
          <span className="text-[10px] text-[var(--text-muted)]">{trades.length} prints ≥ {threshold}B</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {THRESHOLDS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setThreshold(value)}
                className={
                  threshold === value
                    ? 'rounded bg-cyan-600/20 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300'
                    : 'rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }
              >
                {value}B
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {SCOPES.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setScope(item.value)}
                className={
                  scope === item.value
                    ? 'rounded bg-violet-600/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-300'
                    : 'rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-2 grid grid-cols-3 gap-2 px-1 text-[10px]">
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Buy</div>
          <div className="font-mono text-emerald-300">{fmtValue(totals.buy)}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Sell</div>
          <div className="font-mono text-red-300">{fmtValue(totals.sell)}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Net</div>
          <div className={`font-mono ${totals.net > 0 ? 'text-emerald-300' : totals.net < 0 ? 'text-red-300' : 'text-[var(--text-secondary)]'}`}>
            {totals.net >= 0 ? '+' : '-'}{fmtValue(totals.net)}
          </div>
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty
          message="No block trades above this threshold"
          icon={<Waves size={18} />}
          detail="Lower the minimum print size or switch the scope back to All."
        />
      ) : (
        <div className="flex-1 overflow-auto px-1">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-[var(--bg-widget-header)]/90 text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-1 py-1 text-left">Symbol</th>
                <th className="px-1 py-1 text-left">Side</th>
                <th className="px-1 py-1 text-right">Value</th>
                <th className="px-1 py-1 text-right">Price</th>
                <th className="px-1 py-1 text-left">Tags</th>
                <th className="px-1 py-1 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr key={trade.id} className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)]/30">
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => onSymbolClick?.(trade.symbol)}
                      className={`font-bold hover:underline ${trade.symbol === symbol ? 'text-cyan-300' : 'text-[var(--accent-blue)]'}`}
                    >
                      {trade.symbol}
                    </button>
                  </td>
                  <td className={`px-1 py-1 font-semibold ${trade.side === 'BUY' ? 'text-emerald-400' : trade.side === 'SELL' ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>
                    {trade.side || '—'}
                  </td>
                  <td className="px-1 py-1 text-right font-mono">{fmtValue(trade.value)}</td>
                  <td className="px-1 py-1 text-right font-mono">{trade.price ? trade.price.toLocaleString() : '—'}</td>
                  <td className="px-1 py-1">
                    <span className="inline-flex gap-1">
                      {trade.is_foreign && (
                        <span className="rounded border border-blue-500/25 bg-blue-500/10 px-1 text-[9px] font-bold uppercase text-blue-300">F</span>
                      )}
                      {trade.is_proprietary && (
                        <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1 text-[9px] font-bold uppercase text-amber-300">P</span>
                      )}
                    </span>
                  </td>
                  <td className="px-1 py-1 text-right text-[var(--text-muted)]">{formatTimestamp(trade.trade_time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <WidgetMeta
        className="px-1 pt-1"
        isFetching={isFetching && hasData}
        sourceLabel="Latest 100 block trades"
        align="right"
      />
    </div>
  )
}

export default BigFlowMonitorWidget
