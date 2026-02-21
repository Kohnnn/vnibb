'use client';

import { useState } from 'react';
import { useScreenerData, useMetricsHistory, useFinancialRatios, useProfile, useStockQuote } from '@/lib/queries';
import { formatRatio, formatPercent } from '@/lib/formatters';
import { formatUnitValue } from '@/lib/units';
import { useUnit } from '@/contexts/UnitContext';
import { TableSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { RateLimitAlert } from '@/components/ui/RateLimitAlert';
import { RateLimitError } from '@/lib/api';
import { Sparkline } from '@/components/ui/Sparkline';
import { WidgetContainer } from '@/components/ui/WidgetContainer';

interface KeyMetricsWidgetProps {
    id: string;
    symbol: string;
    isEditing?: boolean;
    hideHeader?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: any) => void;
}

interface MetricRowProps {
    label: string;
    value: string | number | null;
    sparklineData?: number[];
    source?: string;
}

type MetricsCategory = 'valuation' | 'profitability' | 'health' | 'market';

const METRIC_TABS: Array<{ id: MetricsCategory; label: string }> = [
    { id: 'valuation', label: 'Valuation' },
    { id: 'profitability', label: 'Profitability' },
    { id: 'health', label: 'Health' },
    { id: 'market', label: 'Market' },
];

function MetricRow({ label, value, sparklineData, source }: MetricRowProps) {
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
            <span className="text-gray-400 text-xs leading-tight pr-2 flex-1">{label}</span>
            <div className="flex items-center gap-2 shrink-0">
                {sparklineData && sparklineData.length > 0 && (
                    <Sparkline data={sparklineData} width={40} height={16} />
                )}
                {source && source !== 'Unavailable' && (
                    <span className="text-[9px] uppercase tracking-wider text-gray-500">{source}</span>
                )}
                <span className="text-white font-mono text-xs">{value ?? '-'}</span>
            </div>
        </div>
    );
}

function toNumber(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(parsed)) {
        return null
    }
    return parsed
}

function resolveMetric(
    candidates: Array<{ value: unknown; source: string; positiveOnly?: boolean }>
): { value: number | null; source: string } {
    for (const candidate of candidates) {
        const parsed = toNumber(candidate.value)
        if (parsed === null) continue
        if (candidate.positiveOnly && parsed <= 0) continue
        return { value: parsed, source: candidate.source }
    }
    return { value: null, source: 'Unavailable' }
}

export function KeyMetricsWidget({ id, symbol, hideHeader, onRemove, onDataChange }: KeyMetricsWidgetProps) {
    const [activeCategory, setActiveCategory] = useState<MetricsCategory>('valuation');
    const {
        data: screenData,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useScreenerData({ symbol, limit: 1, enabled: !!symbol });
    const { config: unitConfig } = useUnit();

    const { data: history, isFetching: historyFetching } = useMetricsHistory(symbol, { enabled: !!symbol });
    const { data: ratiosData } = useFinancialRatios(symbol, { period: 'FY', enabled: !!symbol });
    const { data: profile } = useProfile(symbol, !!symbol);
    const { data: quote } = useStockQuote(symbol, !!symbol);

    const stock = screenData?.data?.[0];
    const latestRatio = ratiosData?.data?.[0];
    const derivedMarketCap =
        toNumber(profile?.data?.outstanding_shares) && toNumber(quote?.price)
            ? (toNumber(profile?.data?.outstanding_shares) || 0) * (toNumber(quote?.price) || 0)
            : null

    const metricMap = {
        pe: resolveMetric([
            { value: stock?.pe, source: 'Screener' },
            { value: latestRatio?.pe, source: 'Ratios' },
        ]),
        pb: resolveMetric([
            { value: stock?.pb, source: 'Screener' },
            { value: latestRatio?.pb, source: 'Ratios' },
        ]),
        ps: resolveMetric([
            { value: stock?.ps, source: 'Screener' },
            { value: latestRatio?.ps, source: 'Ratios' },
        ]),
        evEbitda: resolveMetric([
            { value: stock?.ev_ebitda, source: 'Screener' },
            { value: latestRatio?.ev_ebitda, source: 'Ratios' },
        ]),
        roe: resolveMetric([
            { value: stock?.roe, source: 'Screener' },
            { value: latestRatio?.roe, source: 'Ratios' },
        ]),
        roa: resolveMetric([
            { value: stock?.roa, source: 'Screener' },
            { value: latestRatio?.roa, source: 'Ratios' },
        ]),
        roic: resolveMetric([{ value: (latestRatio as any)?.roic, source: 'Ratios' }]),
        netMargin: resolveMetric([
            { value: stock?.net_margin, source: 'Screener' },
            { value: latestRatio?.net_margin, source: 'Ratios' },
        ]),
        grossMargin: resolveMetric([
            { value: stock?.gross_margin, source: 'Screener' },
            { value: latestRatio?.gross_margin, source: 'Ratios' },
        ]),
        debtToEquity: resolveMetric([
            { value: stock?.debt_to_equity, source: 'Screener' },
            { value: latestRatio?.debt_equity, source: 'Ratios' },
        ]),
        currentRatio: resolveMetric([
            { value: stock?.current_ratio, source: 'Screener' },
            { value: latestRatio?.current_ratio, source: 'Ratios' },
        ]),
        marketCap: resolveMetric([
            { value: stock?.market_cap, source: 'Screener', positiveOnly: true },
            { value: derivedMarketCap, source: 'Profile+Quote', positiveOnly: true },
        ]),
        dividendYield: resolveMetric([{ value: stock?.dividend_yield, source: 'Screener' }]),
        beta: resolveMetric([{ value: stock?.beta, source: 'Screener' }]),
    }

    const mergedStock: any = {
        pe: metricMap.pe.value,
        pb: metricMap.pb.value,
        ps: metricMap.ps.value,
        ev_ebitda: metricMap.evEbitda.value,
        roe: metricMap.roe.value,
        roa: metricMap.roa.value,
        roic: metricMap.roic.value,
        net_margin: metricMap.netMargin.value,
        gross_margin: metricMap.grossMargin.value,
        debt_to_equity: metricMap.debtToEquity.value,
        current_ratio: metricMap.currentRatio.value,
        market_cap: metricMap.marketCap.value,
        dividend_yield: metricMap.dividendYield.value,
        beta: metricMap.beta.value,
    }
    const hasData = Boolean(mergedStock && Object.values(mergedStock).some((v) => v !== null && v !== undefined));
    const isFallback = Boolean(error && hasData);
    const hasHistory = Boolean(
        history && (history.roe?.length || history.roa?.length || history.pe_ratio?.length || history.pb_ratio?.length)
    );

    return (
        <WidgetContainer
            title="Key Metrics"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading && !hasData}
            exportData={mergedStock ? { ...mergedStock, history } : undefined}
            exportFilename={`metrics_${symbol}`}
            widgetId={id}
            showLinkToggle={true}
            hideHeader={hideHeader}
        >
            <div className="space-y-2">
                <WidgetMeta
                    updatedAt={dataUpdatedAt}
                    isFetching={(isFetching || historyFetching) && hasData}
                    isCached={isFallback}
                    note={metricMap.marketCap.source === 'Profile+Quote' ? 'Market cap derived from profile shares x quote' : 'Ratios & health'}
                    sourceLabel="Screener + ratios"
                    align="right"
                />

                {!historyFetching && hasData && !hasHistory && (
                    <div className="text-[10px] text-gray-500 uppercase tracking-widest">
                        Trend data not available yet.
                    </div>
                )}

                {isLoading && !hasData ? (
                    <TableSkeleton rows={8} />
                ) : error && !hasData ? (
                    <div className="p-2">
                        {error instanceof RateLimitError ? (
                            <RateLimitAlert retryAfter={error.retryAfter} onRetry={() => refetch()} />
                        ) : (
                            <WidgetError error={error as Error} onRetry={() => refetch()} />
                        )}
                    </div>
                ) : !hasData ? (
                    <WidgetEmpty
                        message={`No key metrics available for ${symbol}. Try refreshing or check back later.`}
                        action={{ label: 'Refresh', onClick: () => refetch() }}
                    />
                ) : (
                    <div className="space-y-1">
                        <div className="flex flex-wrap gap-1 pb-2 border-b border-gray-800/50">
                            {METRIC_TABS.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveCategory(tab.id)}
                                    className={`px-2 py-1 text-[10px] font-bold uppercase rounded-md transition-colors ${
                                        activeCategory === tab.id
                                            ? 'bg-blue-600/15 text-blue-300 border border-blue-500/30'
                                            : 'text-gray-500 border border-gray-800 hover:text-gray-300 hover:border-gray-700'
                                    }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {activeCategory === 'valuation' && (
                            <>
                                <MetricRow label="P/E Ratio" value={formatRatio(mergedStock?.pe)} sparklineData={history?.pe_ratio} source={metricMap.pe.source} />
                                <MetricRow label="P/B Ratio" value={formatRatio(mergedStock?.pb)} sparklineData={history?.pb_ratio} source={metricMap.pb.source} />
                                <MetricRow label="P/S Ratio" value={formatRatio(mergedStock?.ps)} source={metricMap.ps.source} />
                                <MetricRow label="EV/EBITDA" value={formatRatio(mergedStock?.ev_ebitda)} source={metricMap.evEbitda.source} />
                            </>
                        )}

                        {activeCategory === 'profitability' && (
                            <>
                                <MetricRow label="ROE" value={formatPercent(mergedStock?.roe)} sparklineData={history?.roe} source={metricMap.roe.source} />
                                <MetricRow label="ROA" value={formatPercent(mergedStock?.roa)} sparklineData={history?.roa} source={metricMap.roa.source} />
                                <MetricRow label="ROIC" value={formatPercent(mergedStock?.roic)} source={metricMap.roic.source} />
                                <MetricRow label="Net Margin" value={formatPercent(mergedStock?.net_margin)} source={metricMap.netMargin.source} />
                                <MetricRow label="Gross Margin" value={formatPercent(mergedStock?.gross_margin)} source={metricMap.grossMargin.source} />
                            </>
                        )}

                        {activeCategory === 'health' && (
                            <>
                                <MetricRow label="Debt/Equity" value={formatRatio(mergedStock?.debt_to_equity)} source={metricMap.debtToEquity.source} />
                                <MetricRow label="Current Ratio" value={formatRatio(mergedStock?.current_ratio)} source={metricMap.currentRatio.source} />
                            </>
                        )}

                        {activeCategory === 'market' && (
                            <>
                                <MetricRow label="Market Cap" value={formatUnitValue(mergedStock?.market_cap, unitConfig)} source={metricMap.marketCap.source} />
                                <MetricRow label="Dividend Yield" value={formatPercent(mergedStock?.dividend_yield)} source={metricMap.dividendYield.source} />
                                <MetricRow label="Beta" value={formatRatio(mergedStock?.beta)} source={metricMap.beta.source} />
                            </>
                        )}
                    </div>
                )}
            </div>
        </WidgetContainer>
    );
}
