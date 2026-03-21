'use client'

import { memo, useMemo, useState } from 'react'
import { Grid3X3 } from 'lucide-react'

import { WidgetContainer } from '@/components/ui/WidgetContainer'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { useCorrelationMatrix } from '@/lib/queries'
import { formatNumber } from '@/lib/units'
import { cn } from '@/lib/utils'

interface CorrelationMatrixWidgetProps {
  id: string
  symbol: string
  onRemove?: () => void
}

function getCellColor(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'bg-slate-800/40 text-slate-300'
  if (value >= 0.75) return 'bg-emerald-500/35 text-emerald-100'
  if (value >= 0.35) return 'bg-emerald-500/20 text-emerald-100'
  if (value >= -0.15) return 'bg-slate-700/70 text-slate-100'
  if (value >= -0.5) return 'bg-rose-500/20 text-rose-100'
  return 'bg-rose-500/35 text-rose-100'
}

function CorrelationMatrixWidgetComponent({ id, symbol, onRemove }: CorrelationMatrixWidgetProps) {
  const [days, setDays] = useState(60)
  const [topN, setTopN] = useState(10)
  const upperSymbol = symbol?.toUpperCase() || ''

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useCorrelationMatrix(upperSymbol, {
    days,
    topN,
    enabled: Boolean(upperSymbol),
  })

  const payload = data?.data
  const tickers = payload?.symbols || []
  const matrix = payload?.matrix || []
  const matrixMap = useMemo(() => {
    const map = new Map<string, number | null>()
    matrix.forEach((cell) => map.set(`${cell.y}:${cell.x}`, cell.value ?? null))
    return map
  }, [matrix])

  const hasData = tickers.length > 1 && matrix.length > 0

  return (
    <WidgetContainer
      title="Correlation Matrix"
      subtitle="Sector peer return correlation heatmap"
      symbol={upperSymbol}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
      exportData={matrix}
      exportFilename={`correlation_matrix_${upperSymbol}`}
      widgetId={id}
      showLinkToggle
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {[60, 120, 252].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDays(value)}
                  className={cn(
                    'rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
                    days === value
                      ? 'bg-blue-600 text-white'
                      : 'border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  )}
                >
                  {value}D
                </button>
              ))}
              {[8, 10, 12].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTopN(value)}
                  className={cn(
                    'rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
                    topN === value
                      ? 'bg-fuchsia-600 text-white'
                      : 'border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  )}
                >
                  Top {value}
                </button>
              ))}
            </div>
            <WidgetMeta
              updatedAt={data?.meta?.last_data_date || dataUpdatedAt}
              isFetching={isFetching && hasData}
              note={`${payload?.sector || 'Sector'} · ${payload?.returns_count || 0} return rows`}
              align="right"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3 scrollbar-hide">
          {isLoading && !hasData ? (
            <WidgetSkeleton variant="table" lines={8} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message={`No peer correlation data available for ${upperSymbol}.`} icon={<Grid3X3 size={18} />} />
          ) : (
            <div className="space-y-3">
              <div className="text-[11px] text-[var(--text-muted)]">
                Positive correlation is green, negative correlation is red. Matrix uses close-to-close return correlation for sector peers.
              </div>

              <div className="overflow-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-2">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-[var(--bg-surface)] px-2 py-1 text-left text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        Ticker
                      </th>
                      {tickers.map((ticker) => (
                        <th key={ticker} className="min-w-[64px] px-2 py-1 text-center text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                          {ticker}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tickers.map((rowTicker) => (
                      <tr key={rowTicker}>
                        <th className="sticky left-0 z-10 bg-[var(--bg-surface)] px-2 py-1 text-left text-xs font-semibold text-[var(--text-primary)]">
                          {rowTicker}
                        </th>
                        {tickers.map((colTicker) => {
                          const value = matrixMap.get(`${rowTicker}:${colTicker}`) ?? null
                          return (
                            <td
                              key={`${rowTicker}:${colTicker}`}
                              className={cn('border border-[var(--border-subtle)] px-2 py-1 text-center font-mono', getCellColor(value))}
                              title={`${rowTicker} vs ${colTicker}: ${value == null ? 'N/A' : value.toFixed(4)}`}
                            >
                              {value == null ? '--' : formatNumber(value, { decimals: 2 })}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  )
}

export const CorrelationMatrixWidget = memo(CorrelationMatrixWidgetComponent)
export default CorrelationMatrixWidget
