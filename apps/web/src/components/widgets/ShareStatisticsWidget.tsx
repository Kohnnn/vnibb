// Share Statistics Widget - Market cap, valuation, and liquidity with fallbacks

'use client'

import { useFinancialRatios, useProfile, useScreenerData, useStockQuote } from '@/lib/queries'
import { formatNumber, formatPercent, formatVND } from '@/lib/formatters'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { WidgetContainer } from '@/components/ui/WidgetContainer'

interface ShareStatisticsWidgetProps {
  id: string
  symbol: string
  hideHeader?: boolean
  isEditing?: boolean
  onRemove?: () => void
}

interface StatRowProps {
  label: string
  value: string
  source?: string
}

type MetricSource = 'Screener' | 'Ratios' | 'Profile+Quote' | 'Quote' | 'Unavailable'

function toNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return parsed
}

function resolveMetric(
  candidates: Array<{ value: unknown; source: MetricSource; positiveOnly?: boolean }>
): { value: number | null; source: MetricSource } {
  for (const candidate of candidates) {
    const parsed = toNumber(candidate.value)
    if (parsed === null) continue
    if (candidate.positiveOnly && parsed <= 0) continue
    return { value: parsed, source: candidate.source }
  }
  return { value: null, source: 'Unavailable' }
}

function StatRow({ label, value, source }: StatRowProps) {
  return (
    <div className="flex justify-between items-center py-1.5 gap-3">
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      <div className="flex items-center gap-2 shrink-0">
        {source && source !== 'Unavailable' && (
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{source}</span>
        )}
        <span className="text-sm font-medium text-[var(--text-primary)]">{value}</span>
      </div>
    </div>
  )
}

export function ShareStatisticsWidget({ id, symbol, hideHeader, onRemove }: ShareStatisticsWidgetProps) {
  const {
    data: screenerData,
    isLoading: screenerLoading,
    error: screenerError,
    refetch: refetchScreener,
    isFetching: screenerFetching,
    dataUpdatedAt: screenerUpdatedAt,
  } = useScreenerData({ symbol, limit: 1, enabled: !!symbol })

  const {
    data: profile,
    isLoading: profileLoading,
    error: profileError,
    refetch: refetchProfile,
    isFetching: profileFetching,
  } = useProfile(symbol, !!symbol)

  const {
    data: quote,
    isLoading: quoteLoading,
    error: quoteError,
    refetch: refetchQuote,
    isFetching: quoteFetching,
  } = useStockQuote(symbol, !!symbol)

  const {
    data: ratios,
    isLoading: ratiosLoading,
    error: ratiosError,
    refetch: refetchRatios,
    isFetching: ratiosFetching,
  } = useFinancialRatios(symbol, { period: 'FY', enabled: !!symbol })

  const stock = screenerData?.data?.[0] ?? null
  const latestRatio = ratios?.data?.[0] ?? null
  const profileData = profile?.data ?? null

  const outstandingShares = resolveMetric([
    { value: profileData?.outstanding_shares, source: 'Profile+Quote', positiveOnly: true },
  ])

  const marketCap = resolveMetric([
    { value: stock?.market_cap, source: 'Screener', positiveOnly: true },
    {
      value:
        outstandingShares.value && quote?.price && quote.price > 0
          ? outstandingShares.value * quote.price
          : null,
      source: 'Profile+Quote',
      positiveOnly: true,
    },
  ])

  const pe = resolveMetric([
    { value: stock?.pe, source: 'Screener' },
    { value: latestRatio?.pe, source: 'Ratios' },
  ])

  const pb = resolveMetric([
    { value: stock?.pb, source: 'Screener' },
    { value: latestRatio?.pb, source: 'Ratios' },
  ])

  const roe = resolveMetric([
    { value: stock?.roe, source: 'Screener' },
    { value: latestRatio?.roe, source: 'Ratios' },
  ])

  const volume = resolveMetric([
    { value: stock?.volume, source: 'Screener', positiveOnly: true },
    { value: quote?.volume, source: 'Quote', positiveOnly: true },
  ])

  const dayChange = resolveMetric([
    { value: stock?.change_1d, source: 'Screener' },
    { value: quote?.changePct, source: 'Quote' },
  ])

  const beta = resolveMetric([{ value: stock?.beta, source: 'Screener' }])
  const dividendYield = resolveMetric([{ value: stock?.dividend_yield, source: 'Screener' }])

  const exchange =
    profileData?.exchange ||
    (stock?.exchange as string | undefined) ||
    null

  const industry =
    profileData?.industry ||
    (stock?.industry as string | undefined) ||
    (stock?.industry_name as string | undefined) ||
    null

  const hasData =
    marketCap.value !== null ||
    pe.value !== null ||
    pb.value !== null ||
    volume.value !== null ||
    roe.value !== null

  const isLoading = screenerLoading || profileLoading || quoteLoading || ratiosLoading
  const isFetching = screenerFetching || profileFetching || quoteFetching || ratiosFetching
  const error = screenerError || profileError || quoteError || ratiosError
  const isFallback = Boolean(error && hasData)

  const handleRefresh = () => {
    refetchScreener()
    refetchProfile()
    refetchQuote()
    refetchRatios()
  }

  if (!symbol) {
    return <WidgetEmpty message="Select a symbol to view statistics" />
  }

  return (
    <WidgetContainer
      title="Share Statistics"
      symbol={symbol}
      onRefresh={handleRefresh}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      widgetId={id}
      hideHeader={hideHeader}
      showLinkToggle
      exportData={{
        marketCap: marketCap.value,
        outstandingShares: outstandingShares.value,
        pe: pe.value,
        pb: pb.value,
        roe: roe.value,
        volume: volume.value,
      }}
      exportFilename={`share_stats_${symbol}`}
    >
      <div className="h-full flex flex-col">
      <div className="pb-2 border-b border-gray-800/50">
        <WidgetMeta
          updatedAt={screenerUpdatedAt}
          isFetching={isFetching && hasData}
          isCached={isFallback}
          sourceLabel="Screener + profile + ratios"
          align="right"
        />
      </div>
      <div className="flex-1 overflow-auto pt-2">
        {isLoading && !hasData ? (
          <WidgetSkeleton lines={7} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={handleRefresh} />
        ) : !hasData ? (
          <WidgetEmpty
            message={`No share statistics available for ${symbol} yet.`}
            action={{ label: 'Retry sync', onClick: handleRefresh }}
          />
        ) : (
          <div className="space-y-1">
            <div className="flex flex-wrap gap-1.5 pb-2">
              {exchange && (
                <span className="inline-flex items-center rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                  {exchange}
                </span>
              )}
              {industry && (
                <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  {industry}
                </span>
              )}
              {marketCap.source === 'Profile+Quote' && (
                <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                  MCap derived
                </span>
              )}
            </div>

            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider pb-1">Valuation</div>
            <StatRow
              label="Market Cap"
              value={formatVND(marketCap.value)}
              source={marketCap.source}
            />
            <StatRow
              label="Shares Outstanding"
              value={formatNumber(outstandingShares.value)}
              source={outstandingShares.source}
            />
            <StatRow label="P/E Ratio" value={pe.value !== null ? pe.value.toFixed(2) : '-'} source={pe.source} />
            <StatRow label="P/B Ratio" value={pb.value !== null ? pb.value.toFixed(2) : '-'} source={pb.source} />

            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider pt-3 pb-1">Market Activity</div>
            <StatRow
              label="Last Price"
              value={quote?.price !== null && quote?.price !== undefined ? quote.price.toLocaleString() : '-'}
              source={quote?.price ? 'Quote' : undefined}
            />
            <StatRow label="Last Volume" value={formatNumber(volume.value)} source={volume.source} />
            <StatRow label="1D Change" value={formatPercent(dayChange.value)} source={dayChange.source} />

            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider pt-3 pb-1">Risk & Yield</div>
            <StatRow label="ROE" value={formatPercent(roe.value)} source={roe.source} />
            <StatRow
              label="Dividend Yield"
              value={formatPercent(dividendYield.value)}
              source={dividendYield.source}
            />
            <StatRow
              label="Beta"
              value={beta.value !== null ? beta.value.toFixed(2) : '-'}
              source={beta.source}
            />
          </div>
        )}
      </div>
      </div>
    </WidgetContainer>
  )
}
