'use client'

import { memo, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Plus, Search, TrendingDown, TrendingUp, X } from 'lucide-react'

import { WidgetContainer } from '@/components/ui/WidgetContainer'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { CompanyLogo } from '@/components/ui/CompanyLogo'
import { PeriodToggle, type Period } from '@/components/ui/PeriodToggle'
import { ChartMountGuard } from '@/components/ui/ChartMountGuard'
import { compareStocks, getComparisonPerformance, getPeerCompanies } from '@/lib/api'
import { cn } from '@/lib/utils'
import { EMPTY_VALUE, formatNumber, formatPercent } from '@/lib/units'

const CATEGORY_DEFINITIONS = [
  {
    id: 'valuation',
    name: 'Valuation',
    metricIds: ['pe_ratio', 'pb_ratio', 'ps_ratio', 'ev_ebitda', 'market_cap'],
  },
  {
    id: 'liquidity',
    name: 'Liquidity',
    metricIds: ['current_ratio', 'quick_ratio'],
  },
  {
    id: 'efficiency',
    name: 'Efficiency',
    metricIds: ['asset_turnover', 'inventory_turnover'],
  },
  {
    id: 'profitability',
    name: 'Profitability',
    metricIds: ['roe', 'roa', 'gross_margin', 'net_margin', 'operating_margin'],
  },
  {
    id: 'leverage',
    name: 'Leverage',
    metricIds: ['debt_equity', 'debt_assets', 'interest_coverage'],
  },
  {
    id: 'cashflow',
    name: 'Cash Flow',
    metricIds: ['ocf_debt', 'fcf_yield', 'ocf_sales'],
  },
] as const

const COLOR_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#14b8a6', '#06b6d4']
const PERFORMANCE_PERIODS = ['1M', '3M', '6M', '1Y', '3Y', '5Y'] as const

type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number]

interface ComparisonAnalysisWidgetProps {
  id: string
  symbol?: string
  initialSymbols?: string[]
  onRemove?: () => void
}

function ComparisonAnalysisWidgetComponent({
  id,
  symbol,
  initialSymbols = ['VNM', 'FPT'],
  onRemove,
}: ComparisonAnalysisWidgetProps) {
  const [symbols, setSymbols] = useState<string[]>(() => {
    const seeded = [symbol, ...initialSymbols]
      .map((item) => item?.trim().toUpperCase())
      .filter((item): item is string => Boolean(item))
    return Array.from(new Set(seeded)).slice(0, 6)
  })
  const [period, setPeriod] = useState<Period>('FY')
  const [performancePeriod, setPerformancePeriod] = useState<PerformancePeriod>('1M')
  const [activeCategory, setActiveCategory] = useState('valuation')
  const [newSymbol, setNewSymbol] = useState('')

  const comparisonQuery = useQuery({
    queryKey: ['comparison-analysis', symbols.join(','), period],
    queryFn: () => compareStocks(symbols, period),
    enabled: symbols.length >= 2,
  })

  const performanceQuery = useQuery({
    queryKey: ['comparison-performance', symbols.join(','), performancePeriod],
    queryFn: () => getComparisonPerformance(symbols, performancePeriod),
    enabled: symbols.length >= 2,
    staleTime: 60 * 1000,
  })

  const peersQuery = useQuery({
    queryKey: ['comparison-peers', symbols[0]],
    queryFn: () => getPeerCompanies(symbols[0], 6),
    enabled: Boolean(symbols[0]),
    staleTime: 30 * 60 * 1000,
  })

  const hasData = Boolean(comparisonQuery.data?.stocks?.length)
  const isFallback = Boolean(comparisonQuery.error && hasData)

  const symbolColors = useMemo(() => {
    return symbols.reduce<Record<string, string>>((acc, ticker, index) => {
      acc[ticker] = COLOR_PALETTE[index % COLOR_PALETTE.length]
      return acc
    }, {})
  }, [symbols])

  const filteredMetrics = useMemo(() => {
    const selected = CATEGORY_DEFINITIONS.find((category) => category.id === activeCategory)
    if (!selected || !comparisonQuery.data?.metrics) return []

    const selectedMetricIds = new Set<string>(selected.metricIds as readonly string[])

    return comparisonQuery.data.metrics.filter((metric: any) => {
      const metricId = metric?.id ?? metric?.key
      return selectedMetricIds.has(String(metricId))
    })
  }, [comparisonQuery.data?.metrics, activeCategory])

  const addSymbol = () => {
    const cleaned = newSymbol.trim().toUpperCase()
    if (!cleaned || symbols.includes(cleaned) || symbols.length >= 6) return
    setSymbols((prev) => [...prev, cleaned])
    setNewSymbol('')
  }

  const removeSymbol = (ticker: string) => {
    if (symbols.length <= 2) return
    setSymbols((prev) => prev.filter((item) => item !== ticker))
  }

  const addPeerSuggestion = (ticker: string) => {
    if (symbols.includes(ticker) || symbols.length >= 6) return
    setSymbols((prev) => [...prev, ticker])
  }

  const getBestWorst = (metricId: string) => {
    if (!comparisonQuery.data?.stocks) return { best: null, worst: null }
    const values = comparisonQuery.data.stocks
      .map((stock: any) => stock.metrics?.[metricId])
      .filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value))

    if (values.length === 0) return { best: null, worst: null }
    return { best: Math.max(...values), worst: Math.min(...values) }
  }

  const peerSuggestions = useMemo(() => {
    return (
      peersQuery.data?.peers
        ?.map((peer) => peer.symbol)
        ?.filter((peer): peer is string => Boolean(peer) && !symbols.includes(peer))
        ?.slice(0, 4) || []
    )
  }, [peersQuery.data?.peers, symbols])

  return (
    <WidgetContainer
      title="Comparison Analysis"
      widgetId={id}
      onRefresh={() => {
        comparisonQuery.refetch()
        performanceQuery.refetch()
        peersQuery.refetch()
      }}
      onClose={onRemove}
      isLoading={comparisonQuery.isLoading && !hasData}
      exportData={comparisonQuery.data}
      exportFilename={`comparison_analysis_${symbols.join('_')}_${period}`}
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <div className="border-b border-[var(--border-color)] px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            {symbols.map((ticker) => {
              const color = symbolColors[ticker]
              return (
                <div
                  key={ticker}
                  className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-semibold"
                  style={{
                    borderColor: `${color}66`,
                    backgroundColor: `${color}1f`,
                    color,
                  }}
                >
                  <CompanyLogo symbol={ticker} name={ticker} size={14} />
                  <span>{ticker}</span>
                  {symbols.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeSymbol(ticker)}
                      className="rounded p-0.5 text-current/80 transition-colors hover:bg-[var(--bg-hover)]"
                      aria-label={`Remove ${ticker}`}
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              )
            })}

            {symbols.length < 6 && (
              <div className="inline-flex items-center gap-1 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1.5 py-1">
                <Search size={11} className="text-[var(--text-muted)]" />
                <input
                  value={newSymbol}
                  onChange={(event) => setNewSymbol(event.target.value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addSymbol()
                    }
                  }}
                  placeholder="Add ticker"
                  className="w-20 bg-transparent text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                  aria-label="Add ticker"
                />
                <button
                  type="button"
                  onClick={addSymbol}
                  className="rounded p-0.5 text-[var(--text-muted)] transition-colors hover:text-blue-400"
                  aria-label="Confirm add ticker"
                >
                  <Plus size={12} />
                </button>
              </div>
            )}

            <div className="ml-auto flex items-center gap-2">
              <PeriodToggle value={period} onChange={setPeriod} compact />
              <WidgetMeta
                updatedAt={comparisonQuery.dataUpdatedAt}
                isFetching={(comparisonQuery.isFetching || performanceQuery.isFetching) && hasData}
                isCached={isFallback}
                note={`${period} fundamentals`}
                align="right"
              />
            </div>
          </div>

          {peerSuggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Peer suggestions
              </span>
              {peerSuggestions.map((ticker) => (
                <button
                  key={ticker}
                  type="button"
                  onClick={() => addPeerSuggestion(ticker)}
                  className="rounded border border-blue-500/30 bg-blue-600/10 px-2 py-0.5 text-[10px] font-semibold text-blue-300 hover:bg-blue-600/20"
                >
                  + {ticker}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-b border-[var(--border-color)] px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {PERFORMANCE_PERIODS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPerformancePeriod(option)}
                className={cn(
                  'rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wide',
                  performancePeriod === option
                    ? 'bg-blue-600 text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                )}
              >
                {option}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-[var(--text-muted)]">
              Normalized performance from first point
            </span>
          </div>
        </div>

        <div className="h-[180px] border-b border-[var(--border-color)] px-2 py-1">
          {performanceQuery.isLoading ? (
            <WidgetSkeleton variant="chart" />
          ) : performanceQuery.error ? (
            <WidgetError error={performanceQuery.error as Error} onRetry={() => performanceQuery.refetch()} />
          ) : !performanceQuery.data || performanceQuery.data.length === 0 ? (
            <WidgetEmpty message="No performance series available for selected symbols." />
          ) : (
            <ChartMountGuard className="h-full" minHeight={120}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={performanceQuery.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `${(Number(value) - 100).toFixed(0)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                    }}
                    formatter={(value, name) => {
                      const numeric = typeof value === 'number' ? value : Number(value)
                      return [`${(numeric - 100).toFixed(2)}%`, String(name || '')]
                    }}
                  />
                  {symbols.map((ticker) => (
                    <Line
                      key={ticker}
                      type="monotone"
                      dataKey={ticker}
                      stroke={symbolColors[ticker]}
                      dot={false}
                      strokeWidth={2}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </ChartMountGuard>
          )}
        </div>

        <div className="border-b border-[var(--border-color)] px-2 py-2">
          <div className="flex flex-wrap gap-1 overflow-x-auto">
            {CATEGORY_DEFINITIONS.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setActiveCategory(category.id)}
                className={cn(
                  'rounded px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors',
                  activeCategory === category.id
                    ? 'bg-blue-600/15 text-blue-300 border border-blue-500/35'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                )}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {symbols.length < 2 ? (
            <WidgetEmpty
              message="Comparison requires at least two tickers."
              action={{ label: 'Add FPT', onClick: () => setSymbols((prev) => [...prev, 'FPT']) }}
            />
          ) : comparisonQuery.isLoading && !hasData ? (
            <WidgetSkeleton variant="table" lines={8} />
          ) : comparisonQuery.error && !hasData ? (
            <WidgetError error={comparisonQuery.error as Error} onRetry={() => comparisonQuery.refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="No comparison data available." />
          ) : (
            <table className="data-table financial-dense freeze-first-col w-full text-[11px]">
              <thead className="sticky top-0 z-20 bg-[var(--bg-secondary)]/95 backdrop-blur">
                <tr className="border-b border-[var(--border-color)]">
                  <th className="w-[172px] bg-[var(--bg-secondary)] text-left">Ticker</th>
                  {filteredMetrics.map((metric: any) => (
                    <th key={metric?.id ?? metric?.key} className="text-right">
                      {metric?.name ?? metric?.label ?? metric?.id ?? metric?.key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonQuery.data?.stocks?.map((stock: any) => (
                  <tr
                    key={stock.symbol}
                    className="border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-tertiary)]/40"
                  >
                    <td className="bg-[var(--bg-secondary)]">
                      <div className="flex items-center gap-2">
                        <CompanyLogo symbol={stock.symbol} name={stock.company_name || stock.symbol} size={16} />
                        <span className="font-semibold text-[var(--text-primary)]">{stock.symbol}</span>
                      </div>
                    </td>

                    {filteredMetrics.map((metric: any) => {
                      const metricId = metric?.id ?? metric?.key
                      const metricFormat = metric?.format ?? 'number'
                      const value = stock.metrics?.[metricId]
                      const { best, worst } = getBestWorst(metricId)

                      const isBest = value !== null && value === best && symbols.length > 1
                      const isWorst = value !== null && value === worst && symbols.length > 1

                      const label = formatMetric(value, metricFormat)
                      const isMissing = label === EMPTY_VALUE

                      return (
                        <td
                          key={`${stock.symbol}-${metricId}`}
                          data-type="number"
                          className={cn(
                            'font-mono',
                            isMissing
                              ? 'text-[var(--text-muted)]'
                              : isBest
                                ? 'text-green-500'
                                : isWorst
                                  ? 'text-red-500'
                                  : 'text-[var(--text-primary)]'
                          )}
                        >
                          <div className="inline-flex items-center gap-1">
                            <span>{label}</span>
                            {!isMissing && isBest && <TrendingUp size={10} className="opacity-70" />}
                            {!isMissing && isWorst && <TrendingDown size={10} className="opacity-70" />}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </WidgetContainer>
  )
}

function formatMetric(value: number | null | undefined, format: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return EMPTY_VALUE
  }

  if (format === 'percent') {
    return formatPercent(value, { decimals: 2, input: 'ratio' })
  }

  if (format === 'currency' || format === 'large_number') {
    return formatNumber(value, { decimals: 2 })
  }

  return formatNumber(value, { decimals: 2 })
}

export const ComparisonAnalysisWidget = memo(ComparisonAnalysisWidgetComponent)
export default ComparisonAnalysisWidget
