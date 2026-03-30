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
import { Sparkline } from '@/components/ui/Sparkline'
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout'
import {
  compareStocks,
  getComparisonPerformance,
  getFinancialRatios,
  getPeerCompanies,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { DEFAULT_TICKER } from '@/lib/defaultTicker'
import { EMPTY_VALUE, formatNumber, formatPercent } from '@/lib/units'
import type { FinancialRatioData } from '@/types/equity'

const CATEGORY_DEFINITIONS = [
  {
    id: 'valuation',
    name: 'Valuation',
    metricIds: ['pe_ratio', 'pb_ratio', 'ps_ratio', 'ev_ebitda', 'ev_sales', 'peg_ratio'],
  },
  {
    id: 'liquidity',
    name: 'Liquidity',
    metricIds: ['current_ratio', 'quick_ratio', 'cash_ratio'],
  },
  {
    id: 'efficiency',
    name: 'Efficiency',
    metricIds: ['asset_turnover', 'inventory_turnover', 'receivables_turnover'],
  },
  {
    id: 'profitability',
    name: 'Profitability',
    metricIds: ['roe', 'roa', 'roic', 'gross_margin', 'net_margin', 'operating_margin'],
  },
  {
    id: 'leverage',
    name: 'Leverage',
    metricIds: ['debt_equity', 'debt_assets', 'interest_coverage', 'equity_multiplier'],
  },
  {
    id: 'growth',
    name: 'Growth',
    metricIds: ['revenue_growth', 'earnings_growth'],
  },
] as const

const COLOR_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#14b8a6', '#06b6d4']
const PERFORMANCE_PERIODS = ['1M', '3M', '6M', '1Y', '3Y', '5Y', 'YTD', 'ALL'] as const
const MAX_SYMBOLS = 5
const MIN_SYMBOLS = 2
const LOWER_IS_BETTER_METRICS = new Set([
  'pe',
  'pe_ratio',
  'pb',
  'pb_ratio',
  'ps',
  'ps_ratio',
  'ev_ebitda',
  'ev_sales',
  'peg_ratio',
  'debt_equity',
  'debt_assets',
  'equity_multiplier',
])

function isLowerBetterMetric(metricId: string): boolean {
  return LOWER_IS_BETTER_METRICS.has(metricId)
}

type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number]

interface RatioColumn {
  key: keyof FinancialRatioData
  label: string
  format: 'ratio' | 'percent-auto' | 'percent'
}

const VALUATION_RATIO_COLUMNS: RatioColumn[] = [
  { key: 'pe', label: 'P/E', format: 'ratio' },
  { key: 'ps', label: 'P/S', format: 'ratio' },
  { key: 'pb', label: 'P/B', format: 'ratio' },
  { key: 'ev_sales', label: 'EV/Sales', format: 'ratio' },
  { key: 'ev_ebitda', label: 'EV/EBITDA', format: 'ratio' },
  { key: 'dividend_yield', label: 'Div Yield', format: 'percent' },
]

const FINANCIAL_RATIO_COLUMNS: RatioColumn[] = [
  { key: 'roe', label: 'ROE', format: 'percent-auto' },
  { key: 'roa', label: 'ROA', format: 'percent-auto' },
  { key: 'roic', label: 'ROIC', format: 'percent-auto' },
  { key: 'gross_margin', label: 'Gross Margin', format: 'percent-auto' },
  { key: 'operating_margin', label: 'Operating Margin', format: 'percent-auto' },
  { key: 'net_margin', label: 'Net Margin', format: 'percent-auto' },
  { key: 'current_ratio', label: 'Current Ratio', format: 'ratio' },
  { key: 'debt_equity', label: 'D/E', format: 'ratio' },
]

const LIQUIDITY_RATIO_COLUMNS: RatioColumn[] = [
  { key: 'current_ratio', label: 'Current Ratio', format: 'ratio' },
  { key: 'quick_ratio', label: 'Quick Ratio', format: 'ratio' },
  { key: 'cash_ratio', label: 'Cash Ratio', format: 'ratio' },
]

const LEVERAGE_RATIO_COLUMNS: RatioColumn[] = [
  { key: 'debt_equity', label: 'D/E', format: 'ratio' },
  { key: 'debt_assets', label: 'D/A', format: 'percent-auto' },
  { key: 'interest_coverage', label: 'Interest Coverage', format: 'ratio' },
  { key: 'equity_multiplier', label: 'Equity Multiplier', format: 'ratio' },
]

const EFFICIENCY_RATIO_COLUMNS: RatioColumn[] = [
  { key: 'asset_turnover', label: 'Asset Turnover', format: 'ratio' },
  { key: 'inventory_turnover', label: 'Inventory Turnover', format: 'ratio' },
  { key: 'receivables_turnover', label: 'Receivables Turnover', format: 'ratio' },
]

const GROWTH_RATIO_COLUMNS: RatioColumn[] = [
  { key: 'revenue_growth', label: 'Revenue Growth', format: 'percent-auto' },
  { key: 'earnings_growth', label: 'Earnings Growth', format: 'percent-auto' },
]

const CATEGORY_RATIO_COLUMNS: Record<string, RatioColumn[]> = {
  valuation: VALUATION_RATIO_COLUMNS,
  profitability: FINANCIAL_RATIO_COLUMNS,
  liquidity: LIQUIDITY_RATIO_COLUMNS,
  leverage: LEVERAGE_RATIO_COLUMNS,
  efficiency: EFFICIENCY_RATIO_COLUMNS,
  growth: GROWTH_RATIO_COLUMNS,
}

interface ComparisonAnalysisWidgetProps {
  id: string
  symbol?: string
  initialSymbols?: string[]
  onRemove?: () => void
}

function normalizePerformanceData(payload: unknown): Array<Record<string, string | number>> {
  const rawRows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as any).data)
      ? (payload as any).data
      : []

  return rawRows
    .map((row: any) => {
      if (!row || typeof row !== 'object') return null
      if (row.values && typeof row.values === 'object') {
        return {
          date: row.date || row.time || row.period || '',
          ...row.values,
        }
      }
      return row
    })
    .filter(
      (
        row: Record<string, string | number> | null
      ): row is Record<string, string | number> => {
      if (!row) return false
      const dateValue = row.date
      if (typeof dateValue !== 'string' || dateValue.length === 0) return false
      return Object.entries(row).some(
        ([key, value]) => key !== 'date' && typeof value === 'number' && Number.isFinite(value)
      )
      }
    )
}

function ComparisonAnalysisWidgetComponent({
  id,
  symbol,
  initialSymbols = [DEFAULT_TICKER, 'FPT'],
  onRemove,
}: ComparisonAnalysisWidgetProps) {
  const [symbols, setSymbols] = useState<string[]>(() => {
    const seeded = [symbol, ...initialSymbols]
      .map((item) => item?.trim().toUpperCase())
      .filter((item): item is string => Boolean(item))
    return Array.from(new Set(seeded)).slice(0, MAX_SYMBOLS)
  })
  const [period, setPeriod] = useState<Period>('FY')
  const [performancePeriod, setPerformancePeriod] = useState<PerformancePeriod>('1M')
  const [activeCategory, setActiveCategory] = useState('valuation')
  const [newSymbol, setNewSymbol] = useState('')

  const comparisonQuery = useQuery({
    queryKey: ['comparison-analysis', symbols.join(','), period],
    queryFn: () => compareStocks(symbols, period),
    enabled: symbols.length >= MIN_SYMBOLS,
  })

  const performanceQuery = useQuery({
    queryKey: ['comparison-performance', symbols.join(','), performancePeriod],
    queryFn: () => getComparisonPerformance(symbols, performancePeriod),
    enabled: symbols.length >= MIN_SYMBOLS,
    staleTime: 60 * 1000,
  })

  const peersQuery = useQuery({
    queryKey: ['comparison-peers', symbols[0]],
    queryFn: () => getPeerCompanies(symbols[0], 6),
    enabled: Boolean(symbols[0]),
    staleTime: 30 * 60 * 1000,
  })

  const ratioGridQuery = useQuery({
    queryKey: ['comparison-ratio-grid', symbols.join(','), period],
    queryFn: async () => {
      const entries = await Promise.all(
        symbols.map(async (ticker) => {
          try {
            const response = await getFinancialRatios(ticker, { period })
            const latest = Array.isArray(response?.data) ? response.data.at(-1) ?? null : null
            return { symbol: ticker, ratios: latest as FinancialRatioData | null }
          } catch {
            return { symbol: ticker, ratios: null }
          }
        })
      )

      return entries
    },
    enabled: symbols.length >= MIN_SYMBOLS,
    staleTime: 5 * 60 * 1000,
  })

  const ratioGridRows = ratioGridQuery.data ?? []
  const comparisonStocks = comparisonQuery.data?.stocks ?? []
  const hasData = comparisonStocks.length > 0
  const hasRatioGridData =
    ratioGridRows.length > 0 && ratioGridRows.some((entry) => Boolean(entry.ratios))
  const isFallback = Boolean(comparisonQuery.error && hasData)
  const stockBySymbol = useMemo(() => {
    return comparisonStocks.reduce<Record<string, any>>((acc, row: any) => {
      if (row?.symbol) {
        acc[String(row.symbol).toUpperCase()] = row
      }
      return acc
    }, {})
  }, [comparisonStocks])

  const ratioRowBySymbol = useMemo(() => {
    return ratioGridRows.reduce<Record<string, FinancialRatioData | null>>((acc, row) => {
      acc[row.symbol.toUpperCase()] = row.ratios
      return acc
    }, {})
  }, [ratioGridRows])

  const symbolColors = useMemo(() => {
    return symbols.reduce<Record<string, string>>((acc, ticker, index) => {
      acc[ticker] = COLOR_PALETTE[index % COLOR_PALETTE.length]
      return acc
    }, {})
  }, [symbols])

  const performanceSeries = useMemo(
    () => normalizePerformanceData(performanceQuery.data),
    [performanceQuery.data]
  )
  const symbolTrendMap = useMemo(() => {
    return symbols.reduce<Record<string, number[]>>((acc, ticker) => {
      const series = performanceSeries
        .map((row) => row[ticker])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
        .slice(-12)
      acc[ticker] = series
      return acc
    }, {})
  }, [performanceSeries, symbols])
  const hasPerformanceData = performanceSeries.length > 0
  const { timedOut: comparisonTimedOut, resetTimeout: resetComparisonTimeout } =
    useLoadingTimeout(comparisonQuery.isLoading && !hasData)
  const { timedOut: performanceTimedOut, resetTimeout: resetPerformanceTimeout } =
    useLoadingTimeout(performanceQuery.isLoading && !hasPerformanceData)
  const { timedOut: ratioGridTimedOut, resetTimeout: resetRatioGridTimeout } = useLoadingTimeout(
    ratioGridQuery.isLoading && !hasRatioGridData
  )

  const filteredMetrics = useMemo(() => {
    const selected = CATEGORY_DEFINITIONS.find((category) => category.id === activeCategory)
    if (!selected || !comparisonQuery.data?.metrics) return []

    const selectedMetricIds = new Set<string>(selected.metricIds as readonly string[])

    return comparisonQuery.data.metrics.filter((metric: any) => {
      const metricId = metric?.id ?? metric?.key
      return selectedMetricIds.has(String(metricId))
    })
  }, [comparisonQuery.data?.metrics, activeCategory])

  const activeRatioColumns = useMemo(
    () => CATEGORY_RATIO_COLUMNS[activeCategory] ?? VALUATION_RATIO_COLUMNS,
    [activeCategory]
  )

  const addSymbol = () => {
    const cleaned = newSymbol.trim().toUpperCase()
    if (!cleaned || symbols.includes(cleaned) || symbols.length >= MAX_SYMBOLS) return
    setSymbols((prev) => [...prev, cleaned])
    setNewSymbol('')
  }

  const removeSymbol = (ticker: string) => {
    if (symbols.length <= MIN_SYMBOLS) return
    setSymbols((prev) => prev.filter((item) => item !== ticker))
  }

  const addPeerSuggestion = (ticker: string) => {
    if (symbols.includes(ticker) || symbols.length >= MAX_SYMBOLS) return
    setSymbols((prev) => [...prev, ticker])
  }

  const getBestWorst = (metricId: string) => {
    if (!comparisonStocks.length) return { best: null, worst: null }
    const values = comparisonStocks
      .map((stock: any) => stock.metrics?.[metricId])
      .filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value))

    if (values.length === 0) return { best: null, worst: null }
    if (isLowerBetterMetric(metricId)) {
      return { best: Math.min(...values), worst: Math.max(...values) }
    }
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
        ratioGridQuery.refetch()
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
                  {symbols.length > MIN_SYMBOLS && (
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

            {symbols.length < MAX_SYMBOLS && (
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
          {performanceTimedOut && performanceQuery.isLoading ? (
            <WidgetError
              title="Loading timed out"
              error={new Error('Request timed out after 15 seconds.')}
              onRetry={() => {
                resetPerformanceTimeout()
                performanceQuery.refetch()
              }}
            />
          ) : performanceQuery.isLoading ? (
            <WidgetSkeleton variant="chart" />
          ) : performanceQuery.error ? (
            <WidgetError error={performanceQuery.error as Error} onRetry={() => performanceQuery.refetch()} />
          ) : performanceSeries.length === 0 ? (
            <WidgetEmpty message="No performance series available for selected symbols." />
          ) : (
            <ChartMountGuard className="h-full" minHeight={120}>
              <ResponsiveContainer width="99%" height="100%" minWidth={260} minHeight={120}>
                <LineChart data={performanceSeries}>
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
          {symbols.length < MIN_SYMBOLS ? (
            <WidgetEmpty
              message="Comparison matrix requires 2-5 symbols."
              action={{
                label: 'Add Peer',
                onClick: () =>
                  setSymbols((prev) => {
                    const fallback = ['FPT', 'HPG', 'TCB', 'VNM'].find((ticker) => !prev.includes(ticker))
                    if (!fallback || prev.length >= MAX_SYMBOLS) return prev
                    return [...prev, fallback]
                  }),
              }}
            />
          ) : comparisonTimedOut && comparisonQuery.isLoading && !hasData ? (
            <WidgetError
              title="Loading timed out"
              error={new Error('Request timed out after 15 seconds.')}
              onRetry={() => {
                resetComparisonTimeout()
                comparisonQuery.refetch()
              }}
            />
          ) : comparisonQuery.isLoading && !hasData ? (
            <WidgetSkeleton variant="table" lines={8} />
          ) : comparisonQuery.error && !hasData ? (
            <WidgetError error={comparisonQuery.error as Error} onRetry={() => comparisonQuery.refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="No comparison data available." />
          ) : (
            <table className="data-table financial-dense freeze-first-col w-full text-[11px]">
              <thead className="sticky top-0 z-20 bg-[var(--bg-secondary)]/95">
                <tr className="border-b border-[var(--border-color)]">
                  <th className="w-[180px] bg-[var(--bg-secondary)] text-left">Metric</th>
                  {symbols.map((ticker) => (
                    <th key={`comparison-head-${ticker}`} className="text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: symbolColors[ticker] }}
                        />
                        {ticker}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMetrics.map((metric: any) => {
                  const metricId = metric?.id ?? metric?.key
                  const metricFormat = metric?.format ?? 'number'
                  const metricName = metric?.name ?? metric?.label ?? metricId
                  const { best, worst } = getBestWorst(metricId)

                  return (
                    <tr
                      key={`metric-row-${metricId}`}
                      className="border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-tertiary)]/40"
                    >
                      <td className="bg-[var(--bg-secondary)] font-semibold text-[var(--text-primary)]">
                        {metricName}
                      </td>
                      {symbols.map((ticker) => {
                        const stock = stockBySymbol[ticker]
                        const value = stock?.metrics?.[metricId]
                        const label = formatMetric(value, metricFormat, metricId)
                        const isMissing = label === EMPTY_VALUE
                        const isBest = value !== null && value !== undefined && value === best && symbols.length > 1
                        const isWorst = value !== null && value !== undefined && value === worst && symbols.length > 1

                        return (
                          <td
                            key={`metric-cell-${metricId}-${ticker}`}
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
                              <span className="font-semibold">{label}</span>
                              {!isMissing && isBest && <TrendingUp size={10} className="opacity-70" />}
                              {!isMissing && isWorst && <TrendingDown size={10} className="opacity-70" />}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t border-[var(--border-color)]">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                {CATEGORY_DEFINITIONS.find((category) => category.id === activeCategory)?.name ?? 'Valuation'}
              </div>
              <div className="text-xs text-[var(--text-secondary)]">
                Snapshot ratio grid for the selected comparison category
              </div>
            </div>
            <span className="text-[10px] text-[var(--text-muted)]">
              Period: {period}
            </span>
          </div>

          <div className="max-h-[220px] overflow-auto border-t border-[var(--border-color)]">
            {ratioGridTimedOut && ratioGridQuery.isLoading && !hasRatioGridData ? (
              <WidgetError
                title="Loading timed out"
                error={new Error('Request timed out after 15 seconds.')}
                onRetry={() => {
                  resetRatioGridTimeout()
                  ratioGridQuery.refetch()
                }}
              />
            ) : ratioGridQuery.isLoading && !hasRatioGridData ? (
              <WidgetSkeleton variant="table" lines={5} />
            ) : ratioGridQuery.error && !hasRatioGridData ? (
              <WidgetError
                error={ratioGridQuery.error as Error}
                onRetry={() => ratioGridQuery.refetch()}
              />
            ) : !hasRatioGridData ? (
              <WidgetEmpty message="No ratio snapshot data available for selected symbols." />
            ) : (
              <table className="data-table financial-dense freeze-first-col w-full text-[11px]">
                <thead className="sticky top-0 z-20 bg-[var(--bg-secondary)]/95">
                  <tr className="border-b border-[var(--border-color)]">
                    <th className="w-[180px] bg-[var(--bg-secondary)] text-left">Metric</th>
                    {symbols.map((ticker) => (
                      <th key={`ratio-head-${ticker}`} className="text-right">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: symbolColors[ticker] }}
                          />
                          {ticker}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeRatioColumns.map((column) => {
                    const numericValues = symbols
                      .map((ticker) => ratioRowBySymbol[ticker]?.[column.key])
                      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
                    const best = numericValues.length
                      ? isLowerBetterMetric(String(column.key))
                        ? Math.min(...numericValues)
                        : Math.max(...numericValues)
                      : null
                    const worst = numericValues.length
                      ? isLowerBetterMetric(String(column.key))
                        ? Math.max(...numericValues)
                        : Math.min(...numericValues)
                      : null

                    return (
                      <tr
                        key={`ratio-row-${column.key}`}
                        className="border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-tertiary)]/40"
                      >
                        <td className="bg-[var(--bg-secondary)] font-semibold text-[var(--text-primary)]">
                          {column.label}
                        </td>

                        {symbols.map((ticker) => {
                          const rawValue = ratioRowBySymbol[ticker]?.[column.key]
                          const numericValue =
                            typeof rawValue === 'number' && Number.isFinite(rawValue)
                              ? rawValue
                              : null
                          const label = formatRatioGridValue(numericValue, column.format, String(column.key))
                          const isBest = numericValue !== null && best !== null && numericValue === best
                          const isWorst = numericValue !== null && worst !== null && numericValue === worst
                          const trendSeries = symbolTrendMap[ticker] || []

                          return (
                            <td
                              key={`ratio-cell-${column.key}-${ticker}`}
                              data-type="number"
                              className={cn(
                                'font-mono',
                                label === EMPTY_VALUE
                                  ? 'text-[var(--text-muted)]'
                                  : isBest
                                    ? 'text-green-500'
                                    : isWorst
                                      ? 'text-red-500'
                                      : 'text-[var(--text-primary)]'
                              )}
                            >
                              <div className="inline-flex items-center gap-2">
                                <span className="font-semibold">{label}</span>
                                {label !== EMPTY_VALUE && isBest && <TrendingUp size={10} className="opacity-70" />}
                                {label !== EMPTY_VALUE && isWorst && <TrendingDown size={10} className="opacity-70" />}
                                {trendSeries.length >= 2 ? <Sparkline data={trendSeries} width={48} height={14} /> : null}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </WidgetContainer>
  )
}

function formatRatioGridValue(
  value: number | null | undefined,
  format: RatioColumn['format'],
  metricKey: string
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return EMPTY_VALUE
  }

  const clamp = metricKey === 'dividend_yield'
    ? 'yield'
    : metricKey === 'revenue_growth' || metricKey === 'earnings_growth'
      ? 'yoy_change'
      : 'margin'

  if (format === 'percent-auto') {
    return formatPercent(value, { decimals: 2, input: 'auto', clamp })
  }

  if (format === 'percent') {
    return formatPercent(value, { decimals: 2, input: 'auto', clamp })
  }

  return formatNumber(value, { decimals: 2 })
}

function formatMetric(value: number | null | undefined, format: string, metricKey: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return EMPTY_VALUE
  }

  const clamp = metricKey === 'dividend_yield'
    ? 'yield'
    : metricKey === 'revenue_growth' || metricKey === 'earnings_growth'
      ? 'yoy_change'
      : 'margin'

  if (format === 'percent') {
    return formatPercent(value, { decimals: 2, input: 'auto', clamp })
  }

  if (format === 'currency' || format === 'large_number') {
    return formatNumber(value, { decimals: 2 })
  }

  return formatNumber(value, { decimals: 2 })
}

export const ComparisonAnalysisWidget = memo(ComparisonAnalysisWidgetComponent)
export default ComparisonAnalysisWidget
