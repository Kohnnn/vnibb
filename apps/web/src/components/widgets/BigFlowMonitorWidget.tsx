'use client'

import { useEffect, useMemo, useState } from 'react'
import { Waves } from 'lucide-react'
import { useBlockTrades } from '@/lib/queries'
import { formatTimestamp } from '@/lib/formatDate'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { EMPTY_VALUE } from '@/lib/units'
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink'
import { useDashboardWidget } from '@/hooks/useDashboardWidget'
import { useWidgetGroups } from '@/contexts/WidgetGroupContext'
import { readTickerScope } from '@/lib/widgetScope'
import type { WidgetGroupId } from '@/types/widget'

interface BigFlowMonitorWidgetProps {
  id: string
  widgetGroup?: WidgetGroupId
  symbol?: string
  onSymbolClick?: (symbol: string) => void
  onDataChange?: (data: WidgetDataPayload) => void
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
  if (value == null || !Number.isFinite(value)) return 'n/a'
  const abs = Math.abs(value)
  if (abs >= 1e12) return `${(abs / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(abs / 1e6).toFixed(1)}M`
  return abs.toFixed(0)
}

export function BigFlowMonitorWidget({ id, symbol, widgetGroup, onSymbolClick, onDataChange }: BigFlowMonitorWidgetProps) {
  const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup, { widgetId: id, widgetType: 'big_flow_monitor', symbol })
  const { tickerOverrideFor } = useWidgetGroups()
  const widgetLocation = useDashboardWidget(id)
  const isDetached = Boolean(tickerOverrideFor(id)) || readTickerScope(widgetLocation?.widget.config).mode === 'override'
  const selectSymbol = onSymbolClick ?? (isDetached ? undefined : setLinkedSymbol)
  const [threshold, setThreshold] = useState<Threshold>(10)
  const [scope, setScope] = useState<ScopeFilter>('all')

  // No symbol filter: this is a market-wide tape of the largest prints.
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useBlockTrades({ limit: 100 })

  // A print whose value the source did not report cannot be ranked against the
  // threshold. Count them so the header never claims the tape was exhaustive.
  const { trades, unknownCount } = useMemo(() => {
    const minValue = threshold * 1e9
    const scoped = (data || []).filter((trade) => {
      if (scope === 'foreign') return trade.is_foreign
      if (scope === 'proprietary') return trade.is_proprietary
      return true
    })
    const unknownCount = scoped.filter((trade) => typeof trade.value !== 'number' || !Number.isFinite(trade.value)).length
    const trades = scoped
      .filter((trade) => typeof trade.value === 'number' && Number.isFinite(trade.value) && trade.value >= minValue)
      .sort((a, b) => b.value - a.value)
    return { trades, unknownCount }
  }, [data, threshold, scope])

  // A print with a valid value but no usable side still belongs in the tape, yet
  // it cannot be added to either leg. Counting it keeps Buy/Sell/Net from
  // reading as exhaustive when one leg is silently short.
  const sideUnknownCount = useMemo(
    () => trades.filter((trade) => trade.side !== 'BUY' && trade.side !== 'SELL').length,
    [trades],
  )

  const totals = useMemo(() => {
    let buy = 0
    let sell = 0
    for (const trade of trades) {
      if (trade.side === 'BUY') buy += trade.value
      else if (trade.side === 'SELL') sell += trade.value
    }
    return { buy, sell, net: buy - sell }
  }, [trades])

  // Value-side coverage is unknown when either kind of gap exists.
  const isPartial = unknownCount > 0 || sideUnknownCount > 0


  const receivedTrades = data ?? []
  const lastDataDate = receivedTrades.reduce<string | null>((latest, trade) => {
    const observedAt = new Date(trade.trade_time).getTime()
    return Number.isFinite(observedAt) && (latest === null || observedAt > new Date(latest).getTime())
      ? trade.trade_time
      : latest
  }, null)

  const hasData = trades.length > 0

  useEffect(() => {
    if (error) return
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: { empty: !hasData, compactHeight: 5 },
        provenance: {
          sourceLabel: 'Block-trade tape',
          apiGroup: '/insider',
          endpoint: '/insider/block-trades',
          updatedAt: lastDataDate,
          fetchedAt: dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined,
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
  }, [trades, hasData, onDataChange, dataUpdatedAt, lastDataDate, threshold, error])

  if (error && !data) return <WidgetError error={error as Error} onRetry={() => refetch()} />

  const awaitingFirstData = data === undefined

  // Brand §22: a pending request must not flash placeholder zeros. Nothing has
  // been reported yet, so the header counts and legs read as unavailable
  // instead of as a measured 0.
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-2 flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Waves size={12} className="text-[var(--color-accent-primary)]" />
          <span>Big Flow</span>
          <span className="text-[10px] text-[var(--text-muted)]">{error
              ? 'Latest tape unavailable'
              : awaitingFirstData
                  ? `Loading prints ≥ ${threshold}B…`
                  // `unknownCount` counts prints with no reported value, not prints
                  // that fell below the threshold, so the label names the real gap.
                  : `${trades.length} prints ≥ ${threshold}B${unknownCount ? ` · ${unknownCount} without a reported value` : ''}`}</span>
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
                    ? 'rounded bg-[var(--color-state-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-accent-primary)]'
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
                    ? 'rounded bg-[var(--color-state-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-accent-primary)]'
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
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Buy{isPartial ? ' · partial' : ''}</div>
          <div className="font-mono text-[var(--color-positive)]">{awaitingFirstData ? EMPTY_VALUE : fmtValue(totals.buy)}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Sell{isPartial ? ' · partial' : ''}</div>
          <div className="font-mono text-[var(--color-negative)]">{awaitingFirstData ? EMPTY_VALUE : fmtValue(totals.sell)}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Net{isPartial ? ' · partial' : ''}</div>
          <div className={`font-mono ${totals.net > 0 ? 'text-[var(--color-positive)]' : totals.net < 0 ? 'text-[var(--color-negative)]' : 'text-[var(--text-secondary)]'}`}>
            {awaitingFirstData
              ? EMPTY_VALUE
              : `${totals.net > 0 ? '+' : totals.net < 0 ? '-' : ''}${fmtValue(totals.net)}`}
          </div>
        </div>
      </div>

      {error && <div role="alert" className="px-1 text-[10px] text-[var(--color-warning)]">Latest block-trade tape unavailable; showing previously received trades. <button type="button" onClick={() => refetch()}>Retry</button></div>}
      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData && unknownCount ? (
        <WidgetEmpty
          message="No classified block trades above this threshold"
          icon={<Waves size={18} />}
          detail={`${unknownCount} print${unknownCount === 1 ? '' : 's'} had no finite reported value, so the tape may contain trades above this threshold.`}
        />
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
                    {selectSymbol ? (
                      <button
                        type="button"
                        onClick={() => selectSymbol(trade.symbol)}
                        className={`font-bold hover:underline ${trade.symbol === symbol ? 'text-[var(--color-accent-primary)]' : 'text-[var(--accent-blue)]'}`}
                      >
                        {trade.symbol}
                      </button>
                    ) : <span title="Ticker local to this widget; use its ticker selector to change it">{trade.symbol}</span>}
                  </td>
                  <td className={`px-1 py-1 font-semibold ${trade.side === 'BUY' ? 'text-[var(--color-positive)]' : trade.side === 'SELL' ? 'text-[var(--color-negative)]' : 'text-[var(--text-muted)]'}`}>
                    {trade.side || '—'}
                  </td>
                  <td className="px-1 py-1 text-right font-mono">{fmtValue(trade.value)}</td>
                  <td className="px-1 py-1 text-right font-mono">{typeof trade.price !== 'number' || !Number.isFinite(trade.price) ? 'n/a' : trade.price.toLocaleString()}</td>
                  <td className="px-1 py-1">
                    <span className="inline-flex gap-1">
                      {trade.is_foreign && (
                        <span className="rounded border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-1 text-[9px] font-bold uppercase text-[var(--color-accent-primary)]">F</span>
                      )}
                      {trade.is_proprietary && (
                        <span className="rounded border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-1 text-[9px] font-bold uppercase text-[var(--color-warning)]">P</span>
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
        updatedAt={lastDataDate}
        fetchedAt={dataUpdatedAt}
        isFetching={isFetching && hasData}
        sourceLabel="Latest 100 block trades"
        align="right"
      />
    </div>
  )
}

export default BigFlowMonitorWidget
