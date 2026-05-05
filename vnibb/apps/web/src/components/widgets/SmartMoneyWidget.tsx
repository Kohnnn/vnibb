'use client'

import { Landmark } from 'lucide-react'
import { useSmartMoneyFlow } from '@/lib/queries'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'

interface SmartMoneyWidgetProps {
  symbol: string
  isEditing?: boolean
  onRemove?: () => void
}

function formatBillions(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${value >= 0 ? '+' : '-'}${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${value >= 0 ? '+' : '-'}${(abs / 1e6).toFixed(1)}M`
  return `${value >= 0 ? '+' : '-'}${abs.toFixed(0)}`
}

function smartMoneyTone(score: number): string {
  if (score >= 2) return 'text-emerald-400'
  if (score >= 1) return 'text-cyan-400'
  if (score <= -2) return 'text-red-400'
  return 'text-amber-400'
}

function smartMoneyLabel(value: string, score: number): string {
  if (value === 'buying') return 'Accumulation'
  if (value === 'selling') return 'Distribution'
  if (score >= 1) return 'Mild Accumulation'
  return 'Mixed Flow'
}

export function SmartMoneyWidget({ symbol }: SmartMoneyWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useSmartMoneyFlow(
    upperSymbol,
    Boolean(upperSymbol)
  )

  const payload = data?.data
  const flowScore = payload?.flow_score ?? 0
  const blockTrades = payload?.block_trades ?? []
  const hasData = Boolean(payload)

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view smart money flow" icon={<Landmark size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Landmark size={12} className="text-cyan-400" />
          <span>Smart Money Flow</span>
        </div>
        <WidgetMeta
          updatedAt={dataUpdatedAt}
          isFetching={isFetching && hasData}
          note="Foreign + block signals"
          align="right"
        />
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={7} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty message="No smart money data available" icon={<Landmark size={18} />} />
      ) : (
        <>
          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 mb-2">
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Flow Regime</div>
            <div className={`text-lg font-semibold ${smartMoneyTone(flowScore)}`}>
              {smartMoneyLabel(payload?.net_institutional || 'neutral', flowScore)}
            </div>
            <div className="text-[10px] text-[var(--text-secondary)]">Score: {flowScore} / 3</div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] mb-2">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Foreign Net (20d)</div>
              <div
                className={
                  (payload?.net_foreign_20d_value || 0) >= 0
                    ? 'font-mono text-emerald-400'
                    : 'font-mono text-red-400'
                }
              >
                {formatBillions(Number(payload?.net_foreign_20d_value || 0))}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Block Net (20 trades)</div>
              <div
                className={
                  Number(payload?.block_buy_20d_value || 0) - Number(payload?.block_sell_20d_value || 0) >= 0
                    ? 'font-mono text-emerald-400'
                    : 'font-mono text-red-400'
                }
              >
                {formatBillions(
                  Number(payload?.block_buy_20d_value || 0) - Number(payload?.block_sell_20d_value || 0)
                )}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 text-[10px] space-y-1">
            <div className="uppercase tracking-widest text-[var(--text-muted)] mb-1">Recent Block Trades</div>
            {blockTrades.slice(0, 4).length === 0 ? (
              <div className="text-[var(--text-secondary)]">No recent institutional events.</div>
            ) : (
              blockTrades.slice(0, 4).map((row, index) => (
                <div key={`${row.date}-${index}`} className="flex items-center justify-between text-[var(--text-secondary)]">
                  <span>
                    {row.type === 'accumulation'
                      ? 'BUY'
                      : row.type === 'distribution'
                        ? 'SELL'
                        : 'BLOCK'}{' '}
                    • {row.date}
                  </span>
                  <span
                    className={
                      row.type === 'accumulation'
                        ? 'text-emerald-400 font-mono'
                        : row.type === 'distribution'
                          ? 'text-red-400 font-mono'
                          : 'text-[var(--text-secondary)] font-mono'
                    }
                  >
                    {formatBillions(Number(row.value || 0))}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default SmartMoneyWidget
