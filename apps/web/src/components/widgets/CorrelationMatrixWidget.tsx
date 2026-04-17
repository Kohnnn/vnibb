'use client'

import { memo, useMemo, useState } from 'react'
import { Grid3X3, Link2, ShieldMinus, Shuffle } from 'lucide-react'

import { WidgetContainer } from '@/components/ui/WidgetContainer'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { useCorrelationMatrix } from '@/lib/queries'
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink'
import { cn } from '@/lib/utils'

interface CorrelationMatrixWidgetProps {
  id: string
  symbol: string
  onRemove?: () => void
}

function getCellColor(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'bg-slate-900/40 text-slate-500'
  if (value >= 0.8) return 'bg-emerald-500/45 text-emerald-50'
  if (value >= 0.55) return 'bg-emerald-500/28 text-emerald-100'
  if (value >= 0.2) return 'bg-cyan-500/18 text-cyan-100'
  if (value >= -0.15) return 'bg-slate-700/80 text-slate-100'
  if (value >= -0.45) return 'bg-rose-500/22 text-rose-100'
  return 'bg-rose-500/42 text-rose-50'
}

function formatCorrelation(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  return value.toFixed(2)
}

function getSectorRead(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return { label: 'Insufficient data', tone: 'text-[var(--text-muted)]' }
  }
  if (value >= 0.65) return { label: 'Tight cluster', tone: 'text-emerald-300' }
  if (value >= 0.35) return { label: 'Moderate cluster', tone: 'text-cyan-300' }
  return { label: 'Loose dispersion', tone: 'text-amber-200' }
}

function CorrelationMatrixWidgetComponent({ id, symbol, onRemove }: CorrelationMatrixWidgetProps) {
  const [days, setDays] = useState(60)
  const [topN, setTopN] = useState(10)
  const [hoverTicker, setHoverTicker] = useState<string | null>(null)
  const upperSymbol = symbol?.toUpperCase() || ''
  const { setLinkedSymbol } = useWidgetSymbolLink(undefined, { widgetType: 'correlation_matrix' })

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

  const peerPairs = useMemo(() => {
    return tickers
      .filter((ticker) => ticker !== upperSymbol)
      .map((ticker) => ({
        ticker,
        value: matrixMap.get(`${upperSymbol}:${ticker}`) ?? matrixMap.get(`${ticker}:${upperSymbol}`) ?? null,
      }))
      .sort((left, right) => (right.value ?? -999) - (left.value ?? -999))
  }, [matrixMap, tickers, upperSymbol])

  const orderedTickers = useMemo(() => [upperSymbol, ...peerPairs.map((pair) => pair.ticker)].filter(Boolean), [upperSymbol, peerPairs])

  const clusterScore = useMemo(() => {
    const valid = peerPairs.map((pair) => pair.value).filter((value): value is number => value !== null)
    if (!valid.length) return null
    return valid.reduce((sum, value) => sum + value, 0) / valid.length
  }, [peerPairs])

  const mostCorrelated = peerPairs.find((pair) => pair.value !== null) || null
  const leastCorrelated = [...peerPairs].reverse().find((pair) => pair.value !== null) || null
  const hasData = orderedTickers.length > 1 && matrix.length > 0
  const clusterRead = getSectorRead(clusterScore)

  return (
    <WidgetContainer
      title="Correlation Matrix"
      subtitle="Peer return alignment and diversification map"
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
        <div className="border-b border-[var(--border-subtle)] px-3 py-2.5">
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
          <div className="mt-2 text-[11px] text-[var(--text-secondary)]">
            Read this as a peer-behavior map: greener names tend to travel with `{upperSymbol}`, weaker or negative names can act as dispersion candidates.
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
              <div className="grid grid-cols-1 gap-2 xl:grid-cols-4">
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                  <div className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    <Link2 size={11} className="text-emerald-300" />
                    Most Correlated
                  </div>
                  <div className="text-sm font-semibold text-emerald-200">{mostCorrelated?.ticker || '--'}</div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">{formatCorrelation(mostCorrelated?.value)}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                  <div className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    <ShieldMinus size={11} className="text-rose-300" />
                    Diversifier
                  </div>
                  <div className="text-sm font-semibold text-rose-200">{leastCorrelated?.ticker || '--'}</div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">{formatCorrelation(leastCorrelated?.value)}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                  <div className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    <Shuffle size={11} className="text-cyan-300" />
                    Sector State
                  </div>
                  <div className={cn('text-sm font-semibold', clusterRead.tone)}>{clusterRead.label}</div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">Avg corr {formatCorrelation(clusterScore)}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Coverage</div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">{orderedTickers.length} symbols</div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">Window {days} trading days</div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[220px_minmax(0,1fr)]">
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                  <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    Ranked vs {upperSymbol}
                  </div>
                  <div className="space-y-2">
                    {peerPairs.map((pair) => {
                      const fillWidth = pair.value == null ? 0 : Math.max(4, ((pair.value + 1) / 2) * 100)
                      return (
                        <button
                          key={pair.ticker}
                          type="button"
                          onMouseEnter={() => setHoverTicker(pair.ticker)}
                          onMouseLeave={() => setHoverTicker(null)}
                        className={cn(
                          'w-full rounded-md border border-transparent px-2 py-1.5 text-left transition-colors',
                          hoverTicker === pair.ticker ? 'bg-[var(--bg-hover)] border-[var(--border-default)]' : 'hover:bg-[var(--bg-hover)]/70'
                        )}
                        onClick={() => setLinkedSymbol(pair.ticker)}
                        aria-label={`Set symbol to ${pair.ticker}`}
                      >
                          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-[var(--text-primary)]">{pair.ticker}</span>
                            <span className={cn('font-mono', pair.value != null && pair.value >= 0 ? 'text-emerald-200' : 'text-rose-200')}>
                              {formatCorrelation(pair.value)}
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
                            <div
                              className={cn('h-full rounded-full', pair.value != null && pair.value >= 0 ? 'bg-emerald-400/80' : 'bg-rose-400/80')}
                              style={{ width: `${fillWidth}%` }}
                            />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Peer Matrix</div>
                      <div className="text-xs text-[var(--text-secondary)]">Upper triangle only to reduce duplicate noise</div>
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">Hover a peer to cross-highlight</div>
                  </div>

                  <div className="overflow-auto">
                    <table className="w-full border-separate border-spacing-1 text-[11px]">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-10 bg-[var(--bg-surface)] px-2 py-1 text-left text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                            Ticker
                          </th>
                          {orderedTickers.map((ticker) => (
                            <th
                              key={ticker}
                              className={cn(
                                'min-w-[72px] px-1 py-1 text-center text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]',
                                (hoverTicker === ticker || ticker === upperSymbol) && 'text-[var(--text-primary)]'
                              )}
                              onClick={() => ticker !== upperSymbol ? setLinkedSymbol(ticker) : undefined}
                            >
                              {ticker}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {orderedTickers.map((rowTicker, rowIndex) => (
                          <tr key={rowTicker}>
                            <th
                              className={cn(
                                'sticky left-0 z-10 px-2 py-1.5 text-left text-xs font-semibold bg-[var(--bg-surface)]',
                                (hoverTicker === rowTicker || rowTicker === upperSymbol) ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                              )}
                              onMouseEnter={() => setHoverTicker(rowTicker)}
                              onMouseLeave={() => setHoverTicker(null)}
                              onClick={() => rowTicker !== upperSymbol ? setLinkedSymbol(rowTicker) : undefined}
                            >
                              {rowTicker}
                            </th>
                            {orderedTickers.map((colTicker, colIndex) => {
                              const value = matrixMap.get(`${rowTicker}:${colTicker}`) ?? null
                              const isDiagonal = rowTicker === colTicker
                              const isMutedLowerTriangle = colIndex < rowIndex
                              const isHighlighted = hoverTicker === rowTicker || hoverTicker === colTicker

                              return (
                                <td
                                  key={`${rowTicker}:${colTicker}`}
                                  onMouseEnter={() => setHoverTicker(rowTicker === upperSymbol ? colTicker : rowTicker)}
                                  onMouseLeave={() => setHoverTicker(null)}
                                  className={cn(
                                    'rounded px-2 py-1.5 text-center font-mono transition-colors',
                                    isDiagonal
                                      ? 'bg-blue-600/18 text-blue-100'
                                      : isMutedLowerTriangle
                                        ? 'bg-transparent text-transparent'
                                        : getCellColor(value),
                                    !isDiagonal && !isMutedLowerTriangle && isHighlighted && 'ring-1 ring-inset ring-white/20'
                                  )}
                                  title={`${rowTicker} vs ${colTicker}: ${value == null ? 'N/A' : value.toFixed(4)}`}
                                >
                                  {isDiagonal ? '1.00' : isMutedLowerTriangle ? '·' : formatCorrelation(value)}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
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
