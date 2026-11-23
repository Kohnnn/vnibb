// Quick Stats Widget - Summary statistics at a glance

'use client';

import { useEffect } from 'react';
import { Activity, TrendingUp, TrendingDown, BarChart2, DollarSign } from 'lucide-react';
import { useFinancialRatios, useHistoricalPrices, useStockQuote } from '@/lib/queries';
import { latestByFinancialPeriod } from '@/lib/financialPeriods';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { EMPTY_VALUE, formatPercent } from '@/lib/units';
import { signedToneClass, priceDirection } from '@/lib/priceColor';
import { isObservedVolume } from '@/lib/volumeObservation';

const VOLUME_BASIS = 'Average volume is the mean of observed volume in the returned bars, including measured zero.';
const volumeFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 });

interface QuickStatsWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: WidgetDataPayload) => void;
}

export function QuickStatsWidget({ symbol, onDataChange }: QuickStatsWidgetProps) {
    const pricesQuery = useHistoricalPrices(symbol, {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    });
    const quoteQuery = useStockQuote(symbol, !!symbol);
    const ratiosQuery = useFinancialRatios(symbol, { period: 'FY', enabled: !!symbol });

    const priceData = pricesQuery.data?.data || [];
    const latestQuote = quoteQuery.data;
    const latestRatio = latestByFinancialPeriod(ratiosQuery.data?.data);

    // Only per-row `price_unit` markers certify the history window; a
    // response-level `unit_status` cannot certify rows that carry no marker (QA #98).
    const historyUnitStatus = pricesQuery.data?.meta?.unit_status ?? '';
    const historyExpectedUnit = historyUnitStatus === 'confirmed_vnd' ? 'VND' : 'index_points';
    const historyCertified = priceData.length > 0
        && ['confirmed_vnd', 'index_points', 'not_applicable'].includes(historyUnitStatus)
        && priceData.every((row) => row.price_unit === historyExpectedUnit);
    const derivedWithheld = Boolean(pricesQuery.data) && !historyCertified;

    const latest = derivedWithheld ? undefined : priceData[priceData.length - 1];
    const prev = derivedWithheld ? undefined : priceData[priceData.length - 2];
    const change = latestQuote?.changePct ?? (latest && prev ? ((latest.close - prev.close) / prev.close * 100) : null);

    const closes = derivedWithheld ?[] : priceData.map((p) => p.close || 0);
    const high30 = closes.length > 0 ? Math.max(...closes) : 0;
    const low30 = closes.length > 0 ? Math.min(...closes.filter((c) => c > 0)) : 0;

    let volumeSum = 0;
    let observedVolumeCount = 0;
    if (historyCertified) {
        for (const { volume } of priceData) {
            if (!isObservedVolume(volume)) continue;
            volumeSum += volume;
            observedVolumeCount += 1;
        }
    }
    const avgVolume = observedVolumeCount > 0 ? volumeSum / observedVolumeCount : null;
    const returnedCount = pricesQuery.data ? priceData.length : null;
    const observationCount = historyCertified ? observedVolumeCount : null;
    const excludedVolumeCount = historyCertified ? priceData.length - observedVolumeCount : null;
    const volumeSample = historyCertified
        ? `${observationCount} of ${returnedCount} returned bars observed · ${excludedVolumeCount} excluded`
        : priceData.length > 0 ? 'Historical price units were not certified.' : 'No historical bars available.';
    const rawQuoteVolume = latestQuote?.volume;
    const quoteVolume = isObservedVolume(rawQuoteVolume) ? rawQuoteVolume : null;

    const isLoading = pricesQuery.isLoading || quoteQuery.isLoading || ratiosQuery.isLoading;
    const error = pricesQuery.error || quoteQuery.error || ratiosQuery.error;
    const isFetching = pricesQuery.isFetching || quoteQuery.isFetching || ratiosQuery.isFetching;
    const dataUpdatedAt =
        Math.max(pricesQuery.dataUpdatedAt || 0, quoteQuery.dataUpdatedAt || 0, ratiosQuery.dataUpdatedAt || 0) ||
        undefined;

    const hasData = Boolean(latest || latestQuote || latestRatio);
    const isFallback = Boolean(error && hasData);

    const lastDataDate = [
        pricesQuery.data?.meta?.freshness_as_of,
        pricesQuery.data?.meta?.last_data_date,
        latest?.time,
        latestQuote?.updatedAt,
    ].find((value) => value != null && value !== '' && !Number.isNaN(new Date(value).getTime())) ?? null;

    useEffect(() => {
        onDataChange?.(
            buildWidgetRuntime({
                empty: !hasData,
                apiGroup: '/equity',
                endpoint: `/equity/historical?symbol=${symbol}`,
                sourceLabel: '30-day window',
                basis: VOLUME_BASIS,
                lastDataDate,
                fetchedAt: dataUpdatedAt,
                stale: isFallback,
                derived: true,
                extra: hasData ? {
                    price: latestQuote?.price ?? latest?.close ?? null,
                    pe: latestRatio?.pe ?? null,
                    avgVolume, returnedCount, observationCount, excludedVolumeCount, quoteVolume,
                } : undefined,
            }),
        );
    }, [hasData, dataUpdatedAt, isFallback, lastDataDate, symbol, latestQuote?.price, latest?.close, latestRatio?.pe,
        avgVolume, returnedCount, observationCount, excludedVolumeCount, quoteVolume, onDataChange]);

    if (!symbol) {
        return <WidgetEmpty message="Select a symbol to view quick stats" />;
    }

    const stats = [
        {
            label: 'Price',
            value: (latestQuote?.price ?? latest?.close)?.toLocaleString() ?? EMPTY_VALUE,
            icon: DollarSign,
            color: 'text-[var(--text-primary)]',
        },
        {
            label: 'Change',
            value: change !== null ? formatPercent(change, { input: 'percent', decimals: 2, signed: true }) : EMPTY_VALUE,
            icon: priceDirection(change) === 'down' ? TrendingDown : priceDirection(change) === 'up' ? TrendingUp : Activity,
            color: signedToneClass(change),
        },
        {
            label: '30D High',
            value: high30 > 0 ? high30.toLocaleString() : EMPTY_VALUE,
            icon: TrendingUp,
            color: 'text-[var(--text-primary)]',
        },
        {
            label: '30D Low',
            value: low30 > 0 ? low30.toLocaleString() : EMPTY_VALUE,
            icon: TrendingDown,
            color: 'text-[var(--text-primary)]',
        },
        {
            label: 'Avg Volume',
            value: avgVolume === null ? EMPTY_VALUE : volumeFormatter.format(avgVolume),
            detail: volumeSample,
            quoteDetail: quoteVolume === null ? null : `Quote volume: ${volumeFormatter.format(quoteVolume)}`,
            icon: BarChart2,
            color: 'text-[var(--text-secondary)]',
        },
        {
            label: 'P/E Ratio',
            value: latestRatio?.pe?.toFixed(1) || EMPTY_VALUE,
            icon: Activity,
            color: 'text-[var(--text-secondary)]',
        },
    ];

    return (
        <div className="h-full flex flex-col">
            <div className="mb-2 flex items-center gap-2 px-1 py-1 text-xs text-[var(--text-secondary)]">
                <Activity size={12} className="text-[var(--color-accent-primary)]" />
                <span>Quick Stats - {symbol}</span>
            </div>

            <div className="border-b border-[var(--border-default)] pb-2">
                <WidgetMeta
                    updatedAt={lastDataDate}
                    fetchedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    isCached={isFallback}
                    note="30-day window"
                    align="right"
                />
            </div>

            <div className="flex-1 overflow-auto pt-2">
                {isLoading && !hasData ? (
                    <WidgetSkeleton lines={6} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => {
                        pricesQuery.refetch();
                        quoteQuery.refetch();
                        ratiosQuery.refetch();
                    }} />
                ) : !hasData ? (
                    <WidgetEmpty message={`No data for ${symbol}`} />
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        {stats.map((stat, i) => (
                            <div
                                key={i}
                                className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 transition-colors hover:bg-[var(--bg-hover)]"
                            >
                                <div className="flex items-center gap-1.5 mb-1">
                                    <stat.icon size={12} className={stat.color} />
                                    <span className="text-[10px] text-[var(--text-secondary)]">{stat.label}</span>
                                </div>
                                <div className={`text-lg font-bold ${stat.color}`}>{stat.value}</div>
                                {stat.detail && <p className="mt-1 text-[10px] text-[var(--text-secondary)]">{stat.detail}</p>}
                                {stat.quoteDetail && <p className="text-[10px] text-[var(--text-secondary)]">{stat.quoteDetail}</p>}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
