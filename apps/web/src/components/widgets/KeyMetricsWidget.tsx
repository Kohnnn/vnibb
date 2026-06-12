'use client';

import { useState, useEffect } from 'react';
import { useScreenerData, useMetricsHistory, useFinancialRatios, useProfile, useStockQuote, useQuantMetrics } from '@/lib/queries';
import { formatDividendYield, formatRatio, formatPercent, normalizeDividendYield } from '@/lib/formatters';
import { formatUnitValue } from '@/lib/units';
import { useUnit } from '@/contexts/UnitContext';
import { TableSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { latestByFinancialPeriod } from '@/lib/financialPeriods';
import { RateLimitAlert } from '@/components/ui/RateLimitAlert';
import { RateLimitError } from '@/lib/api';
import { Sparkline } from '@/components/ui/Sparkline';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { QuantWarningBanner } from '@/components/ui/QuantWarningBanner';
import { extractQuantWarning } from '@/lib/quantWidgetHelpers';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';

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
    sparklineData?: (number | null)[];
    source?: string;
}

type MetricsCategory = 'valuation' | 'profitability' | 'health' | 'market';

const METRIC_TABS: Array<{ id: MetricsCategory; label: string }> = [
    { id: 'valuation', label: 'Valuation' },
    { id: 'profitability', label: 'Profitability' },
    { id: 'health', label: 'Health' },
    { id: 'market', label: 'Market' },
];

const CATEGORY_DESCRIPTIONS: Record<MetricsCategory, string> = {
    valuation: 'Pricing multiples and rerating risk versus history.',
    profitability: 'Return efficiency and margin quality at a glance.',
    health: 'Balance-sheet resilience and funding flexibility.',
    market: 'Capitalization, yield, and trading profile context.',
}

function MetricRow({ label, value, sparklineData, source }: MetricRowProps) {
    // Sparkline data may now contain nulls (gaps for pre-coverage periods). Plot only
    // the finite points so a missing year doesn't render as a misleading 0.
    const finiteSpark = sparklineData
        ? sparklineData.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
        : [];
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/55 px-3 py-2 transition-colors hover:border-[var(--border-color)] hover:bg-[var(--bg-tertiary)]/80">
            <div className="min-w-0">
                <div className="break-words whitespace-normal text-[11px] font-semibold text-[var(--text-secondary)]">{label}</div>
                {source && source !== 'Unavailable' && (
                    <div className="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                        {source}
                    </div>
                )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {finiteSpark.length > 0 && (
                    <Sparkline data={finiteSpark} width={40} height={16} />
                )}
                <span className="text-[var(--text-primary)] font-mono text-xs tabular-nums">{value ?? '-'}</span>
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
    // QA-v3 F5: Dividend Yield in Key Metrics MARKET tab was reading
    // 0.00% from the screener snapshot while the Financial Ratios widget
    // showed TTM=3.00%. Pull a TTM ratios slice so we can resolve from the
    // same source.
    const { data: ratiosTtmData } = useFinancialRatios(symbol, { period: 'TTM', enabled: !!symbol });
    const { data: profile } = useProfile(symbol, !!symbol);
    const { data: quote } = useStockQuote(symbol, !!symbol);
    // QA-v3 F6: Beta 63D was already computed for the Quant tab
    // (`/api/v1/quant/{symbol}` returns it) but Key Metrics MARKET tab
    // showed "–". Surface it from the same source.
    // QA-v4 F4: Explicitly request the `benchmark_risk` metric so the
    // backend includes `current_beta_63d` in the response (defaults to
    // `volume_delta` only and would never expose beta).
    const { data: quantMetrics } = useQuantMetrics(symbol, {
        enabled: !!symbol,
        metrics: ['benchmark_risk'],
    });

    const stock = screenData?.data?.[0];
    const latestRatio = latestByFinancialPeriod(ratiosData?.data);
    // QA-v3 F5: Prefer TTM dividend yield from the same Financial Ratios
    // pipeline that powers the FY/Q/TTM toggle. The screener snapshot
    // dividend_yield is a stale field that frequently reads 0.00% even
    // when the TTM is clearly populated.
    const ttmRatio = (ratiosTtmData?.data || []).find((row) =>
        String((row as { period?: string }).period || '').toUpperCase() === 'TTM'
    ) || null;
    // QA-v3 F6: Pull Beta 63D from the same source that powers the
    // Quant tab Risk Dashboard.
    const quantBeta63d = (() => {
        const benchmarkRisk = (quantMetrics as any)?.data?.metrics?.benchmark_risk;
        const value = benchmarkRisk?.current_beta_63d;
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    })();
    const quantWarning = extractQuantWarning(quantMetrics, 'benchmark_risk');
    const derivedMarketCap =
        toNumber(profile?.data?.outstanding_shares) && toNumber(quote?.price)
            ? (toNumber(profile?.data?.outstanding_shares) || 0) * (toNumber(quote?.price) || 0)
            : null

    const metricMap = {
        pe: resolveMetric([
            { value: stock?.pe, source: 'Screener', positiveOnly: true },
            { value: latestRatio?.pe, source: 'Ratios', positiveOnly: true },
        ]),
        pb: resolveMetric([
            { value: stock?.pb, source: 'Screener', positiveOnly: true },
            { value: latestRatio?.pb, source: 'Ratios', positiveOnly: true },
        ]),
        ps: resolveMetric([
            { value: stock?.ps, source: 'Screener', positiveOnly: true },
            { value: latestRatio?.ps, source: 'Ratios', positiveOnly: true },
        ]),
        evEbitda: resolveMetric([
            { value: stock?.ev_ebitda, source: 'Screener', positiveOnly: true },
            { value: latestRatio?.ev_ebitda, source: 'Ratios', positiveOnly: true },
        ]),
        roe: resolveMetric([
            { value: latestRatio?.roe, source: 'Ratios' },
            { value: stock?.roe, source: 'Screener' },
        ]),
        roa: resolveMetric([
            { value: latestRatio?.roa, source: 'Ratios' },
            { value: stock?.roa, source: 'Screener' },
        ]),
        roic: resolveMetric([{ value: (latestRatio as any)?.roic, source: 'Ratios' }]),
        netMargin: resolveMetric([
            { value: latestRatio?.net_margin, source: 'Ratios' },
            { value: stock?.net_margin, source: 'Screener' },
        ]),
        grossMargin: resolveMetric([
            { value: latestRatio?.gross_margin, source: 'Ratios' },
            { value: stock?.gross_margin, source: 'Screener' },
        ]),
        debtToEquity: resolveMetric([
            { value: latestRatio?.debt_equity, source: 'Ratios' },
            { value: stock?.debt_to_equity, source: 'Screener' },
        ]),
        currentRatio: resolveMetric([
            { value: latestRatio?.current_ratio, source: 'Ratios', positiveOnly: true },
            { value: stock?.current_ratio, source: 'Screener', positiveOnly: true },
        ]),
        marketCap: resolveMetric([
            { value: stock?.market_cap, source: 'Screener', positiveOnly: true },
            { value: derivedMarketCap, source: 'Profile+Quote', positiveOnly: true },
        ]),
        dividendYield: resolveMetric([
            { value: normalizeDividendYield((ttmRatio as any)?.dividend_yield), source: 'Ratios TTM' },
            { value: normalizeDividendYield(latestRatio?.dividend_yield), source: 'Ratios' },
            { value: normalizeDividendYield(stock?.dividend_yield), source: 'Screener' },
        ]),
        beta: resolveMetric([
            { value: quantBeta63d, source: 'Quant 63D' },
            // QA-v4 F4: A literal beta=0 in the screener row means "no value
            // computed yet" rather than a real beta of zero (which would
            // imply zero correlation to market - extremely rare). Treat 0
            // as missing so it doesn't mask a legitimate Quant 63D fetch
            // that might land later.
            { value: stock?.beta, source: 'Screener', positiveOnly: true },
        ]),
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
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 });

    useEffect(() => {
        onDataChange?.(
            buildWidgetRuntime({
                empty: !hasData,
                apiGroup: '/screener',
                endpoint: `/screener/?symbol=${symbol}&limit=1`,
                sourceLabel: 'Key metrics',
                lastDataDate: dataUpdatedAt,
                stale: isFallback,
                extra: hasData ? { metrics: mergedStock } : undefined,
            }),
        );
    }, [onDataChange, hasData, isFallback, dataUpdatedAt, symbol, mergedStock]);

    const highlightCards = activeCategory === 'valuation'
        ? [
            { label: 'P/E', value: formatRatio(mergedStock?.pe) },
            { label: 'P/B', value: formatRatio(mergedStock?.pb) },
            { label: 'EV/EBITDA', value: formatRatio(mergedStock?.ev_ebitda) },
        ]
        : activeCategory === 'profitability'
            ? [
                { label: 'ROE', value: formatPercent(mergedStock?.roe) },
                { label: 'ROA', value: formatPercent(mergedStock?.roa) },
                { label: 'Net Margin', value: formatPercent(mergedStock?.net_margin) },
            ]
            : activeCategory === 'health'
                ? [
                    { label: 'Debt/Equity', value: formatRatio(mergedStock?.debt_to_equity) },
                    { label: 'Current Ratio', value: formatRatio(mergedStock?.current_ratio) },
                    { label: 'Gross Margin', value: formatPercent(mergedStock?.gross_margin) },
                ]
                : [
                    { label: 'Market Cap', value: formatUnitValue(mergedStock?.market_cap, unitConfig) },
                    { label: 'Dividend Yield', value: formatDividendYield(mergedStock?.dividend_yield) },
                    { label: 'Beta', value: formatRatio(mergedStock?.beta) },
                ]

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
                    <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">
                        Trend data not available yet.
                    </div>
                )}

                {timedOut && isLoading && !hasData ? (
                    <div className="p-2">
                        <WidgetError
                            title="Loading timed out"
                            error={new Error('Key metrics took too long to load.')}
                            onRetry={() => {
                                resetTimeout();
                                refetch();
                            }}
                        />
                    </div>
                ) : isLoading && !hasData ? (
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
                    <div className="flex h-full min-h-0 flex-col gap-2">
                        <div className="flex flex-wrap gap-1 pb-1">
                            {METRIC_TABS.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveCategory(tab.id)}
                                    className={`px-2 py-1 text-[10px] font-bold uppercase rounded-md transition-colors ${
                                        activeCategory === tab.id
                                            ? 'bg-blue-600/15 text-blue-300 border border-blue-500/30'
                                            : 'text-[var(--text-muted)] border border-[var(--border-color)] hover:text-[var(--text-secondary)] hover:border-[var(--border-subtle)]'
                                    }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        <div className="rounded-2xl border border-blue-500/15 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_52%),linear-gradient(180deg,rgba(15,23,42,0.18),transparent)] px-3 py-2.5">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-300/80">
                                {METRIC_TABS.find((tab) => tab.id === activeCategory)?.label}
                            </div>
                            <div className="mt-1 text-xs text-[var(--text-secondary)]">
                                {CATEGORY_DESCRIPTIONS[activeCategory]}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                            {highlightCards.map((card) => (
                                <div key={card.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/55 px-3 py-2.5">
                                    <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                                        {card.label}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold font-mono text-[var(--text-primary)] tabular-nums">
                                        {card.value}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="min-h-0 flex-1 overflow-auto pr-1 scrollbar-hide">
                            {activeCategory === 'valuation' && (
                                <div className="space-y-2">
                                    <MetricRow label="P/E Ratio" value={formatRatio(mergedStock?.pe)} sparklineData={history?.pe_ratio} source={metricMap.pe.source} />
                                    <MetricRow label="P/B Ratio" value={formatRatio(mergedStock?.pb)} sparklineData={history?.pb_ratio} source={metricMap.pb.source} />
                                    <MetricRow label="P/S Ratio" value={formatRatio(mergedStock?.ps)} source={metricMap.ps.source} />
                                    <MetricRow label="EV/EBITDA" value={formatRatio(mergedStock?.ev_ebitda)} source={metricMap.evEbitda.source} />
                                </div>
                            )}

                            {activeCategory === 'profitability' && (
                                <div className="space-y-2">
                                    <MetricRow label="ROE" value={formatPercent(mergedStock?.roe)} sparklineData={history?.roe} source={metricMap.roe.source} />
                                    <MetricRow label="ROA" value={formatPercent(mergedStock?.roa)} sparklineData={history?.roa} source={metricMap.roa.source} />
                                    <MetricRow label="ROIC" value={formatPercent(mergedStock?.roic)} source={metricMap.roic.source} />
                                    <MetricRow label="Net Margin" value={formatPercent(mergedStock?.net_margin)} source={metricMap.netMargin.source} />
                                    <MetricRow label="Gross Margin" value={formatPercent(mergedStock?.gross_margin)} source={metricMap.grossMargin.source} />
                                </div>
                            )}

                            {activeCategory === 'health' && (
                                <div className="space-y-2">
                                    <MetricRow label="Debt/Equity" value={formatRatio(mergedStock?.debt_to_equity)} source={metricMap.debtToEquity.source} />
                                    <MetricRow label="Current Ratio" value={formatRatio(mergedStock?.current_ratio)} source={metricMap.currentRatio.source} />
                                </div>
                            )}

                            {activeCategory === 'market' && (
                                <div className="space-y-2">
                                    <QuantWarningBanner warning={quantWarning} className="mb-2" />
                                    <MetricRow label="Market Cap" value={formatUnitValue(mergedStock?.market_cap, unitConfig)} source={metricMap.marketCap.source} />
                                    <MetricRow label="Dividend Yield" value={formatDividendYield(mergedStock?.dividend_yield)} source={metricMap.dividendYield.source} />
                                    <MetricRow label="Beta" value={formatRatio(mergedStock?.beta)} source={metricMap.beta.source} />
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </WidgetContainer>
    );
}
