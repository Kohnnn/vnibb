'use client';

import { memo, useEffect, useMemo } from 'react';
import { CalendarClock, Newspaper, Sparkles } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { useUnit } from '@/contexts/UnitContext';
import { useCashFlow, useCompanyEvents, useCompanyNews, useEarningsQuality, useIncomeStatement } from '@/lib/queries';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { formatDate, formatRelativeTime } from '@/lib/formatDate';
import { hasNewsAssociationEvidence } from '@/lib/newsAssociation';
import { formatFinancialPeriodLabel, periodSortKey } from '@/lib/financialPeriods';
import { convertFinancialValueForUnit, formatNumber, formatPercent } from '@/lib/units';
import { percentToneClass } from '@/lib/priceColor';
import { incomparableReason, priorYearQuarterKey, quarterKey, rowForQuarter, withheldFieldReason } from '@/lib/statementAdmission';

interface EarningsReleaseRecapWidgetProps {
    id: string;
    symbol: string;
    hideHeader?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: WidgetDataPayload) => void;
}

/**
 * A margin needs a real denominator. Zero revenue makes the ratio undefined and
 * zero gross profit is a genuine 0% margin, so the numerator is not gated on
 * truthiness. The bridge row and the highlight tiles both read this (#200).
 */
function marginOfIncome(
    row: { revenue?: number | null; gross_profit?: number | null } | null | undefined,
): number | null {
    return typeof row?.revenue === 'number' && row.revenue !== 0 && typeof row.gross_profit === 'number'
        ? (row.gross_profit / row.revenue) * 100
        : null;
}

/**
 * One comparison rate, or the reason it cannot be stated. A zero base is not a
 * 100% increase, and a base whose basis differs from the current period is not
 * a rate at all.
 */
function growthOf(
    current: number | null | undefined,
    previous: number | null | undefined,
    reason: string | null,
): { value: number | null; reason: string | null } {
    if (reason) return { value: null, reason };
    if (current == null || previous == null) return { value: null, reason: 'value not reported for both periods' };
    if (previous === 0) return { value: null, reason: 'zero prior-period base' };
    return { value: ((current - previous) / Math.abs(previous)) * 100, reason: null };
}

function EarningsReleaseRecapWidgetComponent({ id, symbol, hideHeader, onRemove, onDataChange }: EarningsReleaseRecapWidgetProps) {
    const { config: unitConfig } = useUnit();
    const incomeQuery = useIncomeStatement(symbol, { period: 'quarter', limit: 8, enabled: Boolean(symbol) });
    const cashFlowQuery = useCashFlow(symbol, { period: 'quarter', limit: 8, enabled: Boolean(symbol) });
    const earningsQualityQuery = useEarningsQuality(symbol, Boolean(symbol));
    const newsQuery = useCompanyNews(symbol, { limit: 5, enabled: Boolean(symbol) });
    const eventsQuery = useCompanyEvents(symbol, { limit: 8, enabled: Boolean(symbol) });
    const relatedNews = useMemo(() => (newsQuery.data?.data || []).filter(item => hasNewsAssociationEvidence(item, false)), [newsQuery.data?.data]);

    const orderedIncomeRows = useMemo(
        () => [...(incomeQuery.data?.data || [])].sort((left, right) => periodSortKey(right.period) - periodSortKey(left.period)),
        [incomeQuery.data?.data]
    );
    const orderedCashRows = useMemo(
        () => [...(cashFlowQuery.data?.data || [])].sort((left, right) => periodSortKey(right.period) - periodSortKey(left.period)),
        [cashFlowQuery.data?.data]
    );
    const latestIncome = orderedIncomeRows[0] || null;
    const latestQuarterKey = quarterKey(latestIncome?.period);
    const comparisonKey = priorYearQuarterKey(latestQuarterKey);

    // Only the same quarter one year earlier is a YoY comparison. The second
    // newest row is a different period, so it is never substituted for the
    // missing prior-year row (issue #258).
    const comparableIncome = useMemo(
        () => rowForQuarter(orderedIncomeRows, comparisonKey),
        [comparisonKey, orderedIncomeRows]
    );
    const comparisonReason = useMemo(() => {
        if (!latestIncome) return null;
        if (!latestQuarterKey) return 'current period is not a fiscal quarter';
        if (!comparableIncome) return `prior-year quarter ${comparisonKey} not reported`;
        return incomparableReason(latestIncome, comparableIncome);
    }, [comparableIncome, comparisonKey, latestIncome, latestQuarterKey]);

    // Cash figures must belong to the recap's own quarter. Another period's row
    // is disclosed as a mismatch, never shown as this quarter's cash.
    const latestCash = useMemo(
        () => rowForQuarter(orderedCashRows, latestQuarterKey),
        [latestQuarterKey, orderedCashRows]
    );
    const cashMismatchPeriod = !latestCash && orderedCashRows.length > 0
        ? orderedCashRows[0]?.period ?? null
        : null;

    /** A YoY rate for one field, or the reason it stays unavailable. */
    const yoyFor = (field: string, current: number | null | undefined, previous: number | null | undefined) => growthOf(
        current,
        previous,
        comparisonReason
            ?? withheldFieldReason(latestIncome, field)
            ?? withheldFieldReason(comparableIncome, field)
    );

    // The per-metric admission results every bridge row uses, published verbatim
    // to the widget context so an export cannot describe a withheld rate as
    // growth (#258). Net income, EPS and gross margin cover the headline tiles.
    const metricReasons = useMemo(() => {
        if (!latestIncome) return {};
        const describe = (field: string, current: number | null | undefined, previous: number | null | undefined) => {
            const result = yoyFor(field, current, previous);
            return { value: result.value, unavailable_reason: result.reason };
        };
        // Gross margin is a ratio of two admitted fields on both periods, and
        // the bridge publishes its *delta*. A current margin with an unbuildable
        // prior one is not an available comparison, so the export carries the
        // delta (or its reason) plus both sides explicitly.
        const currentMargin = marginOfIncome(latestIncome);
        const previousMargin = marginOfIncome(comparableIncome);
        // Both margins must also be on one reporting basis: a consolidated
        // current margin beside a separate prior one is not a comparable delta,
        // whatever the numbers are (#258).
        const marginDelta = comparisonReason === null && currentMargin !== null && previousMargin !== null
            ? currentMargin - previousMargin
            : null;
        const marginReason = marginDelta !== null
            ? null
            : comparisonReason
                ?? (currentMargin === null
                    ? withheldFieldReason(latestIncome, 'gross_profit') ?? 'current gross margin unavailable'
                    : withheldFieldReason(comparableIncome, 'gross_profit') ?? 'comparison gross margin unavailable');
        return {
            revenue: describe('revenue', latestIncome.revenue, comparableIncome?.revenue),
            gross_profit: describe('gross_profit', latestIncome.gross_profit, comparableIncome?.gross_profit),
            operating_income: describe('operating_income', latestIncome.operating_income, comparableIncome?.operating_income),
            pre_tax_profit: describe('pre_tax_profit', latestIncome.pre_tax_profit ?? latestIncome.profit_before_tax, comparableIncome?.pre_tax_profit ?? comparableIncome?.profit_before_tax),
            net_income: describe('net_income', latestIncome.net_income, comparableIncome?.net_income),
            eps: describe('eps', latestIncome.eps, comparableIncome?.eps),
            // `value` is the bridge's own delta, so the export and the rendered
            // row cannot disagree about what was compared.
            gross_margin: {
                value: marginDelta,
                unavailable_reason: marginReason,
                current: currentMargin,
                previous: previousMargin,
            },
        };
    }, [comparableIncome, latestIncome, comparisonReason]);

    const qualityReportedReason = earningsQualityQuery.data?.error
        ?? earningsQualityQuery.data?.data?.coverage?.unavailable_reason
        ?? null;

    const recapRows = useMemo(() => {
        if (!latestIncome) return [];
        const metric = (
            label: string,
            field: string,
            current: number | null | undefined,
            previous: number | null | undefined,
            decimals: number
        ) => {
            const { value } = yoyFor(field, current, previous);
            return {
                label,
                current: convertFinancialValueForUnit(current ?? null, unitConfig, latestIncome.period),
                previous: convertFinancialValueForUnit(previous ?? null, unitConfig, comparableIncome?.period),
                change: value,
                formatter: (value: number | null) => formatNumber(value, { decimals }),
            };
        };
        const grossMargin = marginOfIncome(latestIncome);
        const previousMargin = marginOfIncome(comparableIncome);
        const comparableMargins = comparisonReason === null && grossMargin !== null && previousMargin !== null;
        return [
            metric('Revenue', 'revenue', latestIncome.revenue, comparableIncome?.revenue, 0),
            metric('Gross Profit', 'gross_profit', latestIncome.gross_profit, comparableIncome?.gross_profit, 0),
            metric('Operating Income', 'operating_income', latestIncome.operating_income, comparableIncome?.operating_income, 0),
            metric(
                'Pre-tax Profit', 'pre_tax_profit',
                latestIncome.pre_tax_profit ?? latestIncome.profit_before_tax,
                comparableIncome?.pre_tax_profit ?? comparableIncome?.profit_before_tax, 0
            ),
            metric('Net Income', 'net_income', latestIncome.net_income, comparableIncome?.net_income, 0),
            metric('EPS', 'eps', latestIncome.eps, comparableIncome?.eps, 2),
            {
                label: 'Gross Margin',
                current: grossMargin,
                previous: previousMargin,
                change: comparableMargins && grossMargin !== null && previousMargin !== null
                    ? grossMargin - previousMargin
                    : null,
                formatter: (value: number | null) => formatPercent(value, { decimals: 1, input: 'percent', unit: 'pp', clamp: 'margin' }),
            },
        ];
    }, [comparableIncome, comparisonReason, latestIncome, unitConfig]);

    const highlights = useMemo(() => {
        if (!latestIncome) return [];
        const grossMargin = marginOfIncome(latestIncome);
        const previousMargin = marginOfIncome(comparableIncome);
        const marginComparable = comparisonReason === null && grossMargin !== null && previousMargin !== null;

        // All four tiles are signed deltas, so all four take their tone from the
        // sign. Two used a fixed gain/warning colour, which painted a falling
        // net income or a shrinking margin as favourable.
        return [
            { label: 'Revenue YoY', value: yoyFor('revenue', latestIncome.revenue, comparableIncome?.revenue).value },
            { label: 'Net Income YoY', value: yoyFor('net_income', latestIncome.net_income, comparableIncome?.net_income).value },
            { label: 'EPS YoY', value: yoyFor('eps', latestIncome.eps, comparableIncome?.eps).value },
            {
                label: 'Gross Margin Delta',
                value: marginComparable && grossMargin !== null && previousMargin !== null ? grossMargin - previousMargin : null,
            },
        ];
    }, [comparableIncome, comparisonReason, latestIncome]);

    const narrative = useMemo(() => {
        if (!latestIncome) return null;

        const revenue = yoyFor('revenue', latestIncome.revenue, comparableIncome?.revenue);
        const earnings = yoyFor('net_income', latestIncome.net_income, comparableIncome?.net_income);
        const quality = earningsQualityQuery.data?.data;
        const qualityReason = earningsQualityQuery.data?.error || quality?.coverage?.unavailable_reason || null;

        const describe = (value: number | null, reason: string | null, up: string, down: string, sparse: string) => {
            if (value === null) return reason ? `${sparse} (${reason})` : sparse;
            return value >= 0
                ? `${up} ${formatPercent(value, { decimals: 1, input: 'percent', clamp: 'yoy_change' })}`
                : `${down} ${formatPercent(Math.abs(value), { decimals: 1, input: 'percent', clamp: 'yoy_change' })}`;
        };
        const revenueText = describe(revenue.value, revenue.reason, 'revenue grew', 'revenue contracted', 'revenue YoY is unavailable');
        const earningsText = describe(earnings.value, earnings.reason, 'net income improved', 'net income fell', 'net income YoY is unavailable');
        // A grade or trend is only quoted when it exists: an unavailable
        // scorecard must not be described as Stable (issue #257).
        const qualityText = quality?.grade
            ? `earnings quality is ${quality.grade.toLowerCase()}${quality.trend ? ` with a ${quality.trend.toLowerCase()} trend` : ' with an unknown trend'}`
            : `earnings quality is unavailable${qualityReason ? ` (${qualityReason})` : ''}`;

        return `${revenueText}, ${earningsText}, and ${qualityText}.`;
        // The memo must observe the admission decision, not just the numbers:
        // a refetch can withhold a rate while the amounts stay identical.
    }, [
        comparableIncome,
        comparisonReason,
        earningsQualityQuery.data?.data,
        earningsQualityQuery.data?.error,
        latestIncome,
    ]);

    const hasData = Boolean(latestIncome || latestCash || earningsQualityQuery.data?.data || relatedNews.length || eventsQuery.data?.data?.length);
    const isLoading = incomeQuery.isLoading && cashFlowQuery.isLoading && newsQuery.isLoading && eventsQuery.isLoading;
    const combinedError = incomeQuery.error || cashFlowQuery.error || newsQuery.error || eventsQuery.error || earningsQualityQuery.error;
    const fetchedAt = Math.max(
        incomeQuery.dataUpdatedAt,
        cashFlowQuery.dataUpdatedAt,
        newsQuery.dataUpdatedAt,
        eventsQuery.dataUpdatedAt,
        earningsQualityQuery.dataUpdatedAt
    );

    useEffect(() => {
        onDataChange?.(buildWidgetRuntime({
            empty: !hasData,
            apiGroup: '/equity',
            endpoint: `/equity/${symbol}/income-statement?period=quarter&limit=8`,
            sourceLabel: 'vnstock',
            lastDataDate: null,
            fetchedAt,
            derived:true,
            stale: Boolean(combinedError && hasData),
            extra: {
                feeds: 5,
                // The selected periods and every unavailable reason travel with
                // the widget context, so a downstream agent cannot describe a
                // substituted or non-comparable period as YoY (#258).
                current_period: latestIncome?.period ?? null,
                comparison_period: comparableIncome?.period ?? null,
                expected_comparison_period: comparisonKey,
                comparison_unavailable_reason: comparisonReason,
                metric_unavailable_reasons: metricReasons,
                cash_period: latestCash?.period ?? null,
                cash_mismatch_period: cashMismatchPeriod,
                quality_unavailable_reason: qualityReportedReason,
            },
        }));
    }, [cashMismatchPeriod, combinedError, comparableIncome?.period, comparisonKey, comparisonReason, earningsQualityQuery.data?.error, fetchedAt, hasData, latestCash?.period, latestIncome?.period, metricReasons, onDataChange, qualityReportedReason, symbol]);

    return (
        <WidgetContainer
            title="Earnings Release Recap"
            symbol={symbol}
            widgetId={id}
            onRefresh={() => {
                void incomeQuery.refetch();
                void cashFlowQuery.refetch();
                void newsQuery.refetch();
                void eventsQuery.refetch();
                void earningsQualityQuery.refetch();
            }}
            onClose={onRemove}
            isLoading={isLoading && !hasData}
            hideHeader={hideHeader}
            noPadding
        >
            <div className="flex h-full flex-col bg-[var(--bg-primary)]">
                <div className="border-b border-[var(--border-subtle)] px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <div className="text-xs font-semibold text-[var(--text-primary)]">
                                {latestIncome?.period ? formatFinancialPeriodLabel(latestIncome.period, { mode: 'quarter' }) : 'Latest quarter'}
                            </div>
                            <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                                {narrative || 'Use this recap to review the latest quarter before drilling into the full statements.'}
                            </div>
                        </div>
                        <WidgetMeta updatedAt={null} fetchedAt={fetchedAt} isFetching={incomeQuery.isFetching || cashFlowQuery.isFetching || newsQuery.isFetching || eventsQuery.isFetching} note="Quarter recap" align="right" />
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
                        {highlights.map((item) => (
                            <div key={item.label} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
                                <div className="text-[9px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{item.label}</div>
                                <div className={`mt-1 text-sm font-semibold ${percentToneClass(item.value, item.label.includes('Delta') ? 'margin' : 'yoy_change')}`}>
                                    {formatPercent(item.value, { decimals: 1, input: 'percent', signed: true, unit: item.label.includes('Delta') ? 'pp' : '%', clamp: item.label.includes('Delta') ? 'margin' : 'yoy_change' })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex-1 overflow-auto p-3">
                    {isLoading && !hasData ? (
                        <WidgetSkeleton lines={8} />
                    ) : combinedError && !hasData ? (
                        <WidgetError error={combinedError as Error} onRetry={() => {
                            void incomeQuery.refetch();
                            void cashFlowQuery.refetch();
                            void newsQuery.refetch();
                            void eventsQuery.refetch();
                            void earningsQualityQuery.refetch();
                        }} />
                    ) : !hasData ? (
                        <WidgetEmpty message={`No earnings recap data available for ${symbol}.`} icon={<Sparkles size={18} />} />
                    ) : (
                        <div className="space-y-3">
                            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                                    <div className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">Quarter bridge</div>
                                    <div className="mb-2 text-[10px] text-[var(--text-muted)]" data-testid="recap-comparison-note">
                                        {comparisonReason
                                            ? `YoY unavailable: ${comparisonReason}${comparisonKey ? ` (expected ${comparisonKey})` : ''}.`
                                            : `YoY compares ${formatFinancialPeriodLabel(latestIncome?.period, { mode: 'quarter' })} with ${formatFinancialPeriodLabel(comparableIncome?.period, { mode: 'quarter' })}.`}
                                    </div>
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-[var(--border-subtle)] text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                                                <th className="py-2 text-left">Metric</th>
                                                <th className="py-2 text-right">Latest</th>
                                                <th className="py-2 text-right">Prev comp</th>
                                                <th className="py-2 text-right">YoY / Delta</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {recapRows.map((row) => (
                                                <tr key={row.label} className="border-b border-[var(--border-subtle)] last:border-0">
                                                    <td className="py-2 text-[var(--text-secondary)]">{row.label}</td>
                                                    <td className="py-2 text-right text-[var(--text-primary)]">{row.formatter(row.current)}</td>
                                                    <td className="py-2 text-right text-[var(--text-secondary)]">{row.formatter(row.previous)}</td>
                                                    <td className={`py-2 text-right font-medium ${percentToneClass(row.change, row.label.includes('Margin') ? 'margin' : 'yoy_change')}`}>
                                                        {formatPercent(row.change, { decimals: 1, input: 'percent', signed: true, unit: row.label.includes('Margin') ? 'pp' : '%', clamp: row.label.includes('Margin') ? 'margin' : 'yoy_change' })}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="space-y-3">
                                    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                                        <div className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">Cash & quality</div>
                                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                                            <MiniMetric label="Operating CF" value={formatNumber(convertFinancialValueForUnit(latestCash?.operating_cash_flow ?? null, unitConfig, latestCash?.period), { decimals: 0 })} />
                                            <MiniMetric label="Free CF" value={formatNumber(convertFinancialValueForUnit(latestCash?.free_cash_flow ?? null, unitConfig, latestCash?.period), { decimals: 0 })} />
                                            <MiniMetric label="Net cash change" value={formatNumber(convertFinancialValueForUnit(latestCash?.net_change_in_cash ?? latestCash?.net_cash_flow ?? null, unitConfig, latestCash?.period), { decimals: 0 })} />
                                            <MiniMetric label="Quality grade" value={earningsQualityQuery.data?.data?.grade || '-'} />
                                        </div>
                                        <div className="mt-2 text-[10px] text-[var(--text-muted)]" role="status">
                                            {latestCash?.period
                                                ? `Cash flow period: ${formatFinancialPeriodLabel(latestCash.period, { mode: 'quarter' })}`
                                                : cashMismatchPeriod
                                                    ? `Unavailable: no cash flow statement for ${formatFinancialPeriodLabel(latestIncome?.period, { mode: 'quarter' })}. The latest retained period is ${formatFinancialPeriodLabel(cashMismatchPeriod, { mode: 'quarter' })} and is not shown here.`
                                                    : 'Unavailable: no cash flow statement reported.'}
                                        </div>
                                        {earningsQualityQuery.data?.data?.grade ? (
                                            <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                                                <div className="font-semibold text-[var(--text-primary)]">
                                                    {earningsQualityQuery.data.data.trend ?? 'Unknown'} trend · score {formatNumber(earningsQualityQuery.data.data.quality_score, { decimals: 1 })}
                                                </div>
                                                <ul className="mt-2 space-y-1">
                                                    {(earningsQualityQuery.data.data.checks ?? []).slice(0, 3).map((check) => (
                                                        <li key={check}>• {check}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ) : (
                                            <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                                                Earnings quality unavailable
                                                {earningsQualityQuery.data?.error ? `: ${earningsQualityQuery.data.error}` : '.'}
                                            </div>
                                        )}
                                    </div>

                                    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                                        <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                                            <CalendarClock size={12} />
                                            Event context
                                        </div>
                                        <div className="space-y-2 text-[11px]">
                                            {(eventsQuery.data?.data || []).slice(0, 4).map((event, index) => (
                                                <div key={`${event.event_name || event.event_type || 'event'}-${index}`} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2">
                                                    <div className="font-medium text-[var(--text-primary)]">{event.event_name || event.event_type || 'Company event'}</div>
                                                    <div className="mt-1 text-[var(--text-secondary)]">{event.description || event.value || 'No extra description'}</div>
                                                    <div className="mt-1 text-[10px] text-[var(--text-muted)]">{event.event_date ? formatDate(event.event_date) : 'No event date'}</div>
                                                </div>
                                            ))}
                                            {(eventsQuery.data?.data || []).length === 0 ? <div className="text-[var(--text-muted)]">No recent event context.</div> : null}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                                <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                                    <Newspaper size={12} />
                                    Related news
                                </div>
                                <div className="space-y-2">
                                    {relatedNews.slice(0, 5).map((news) => (
                                        <a
                                            key={`${news.url || news.title}`}
                                            href={news.url || '#'}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 transition-colors hover:border-[var(--color-state-border)]"
                                        >
                                            <div className="font-medium text-[var(--text-primary)]">{news.title}</div>
                                            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--text-muted)]">
                                                <span>{news.source || 'News source'}</span>
                                                <span>{news.published_at ? formatRelativeTime(news.published_at) : 'Date unavailable'}</span>
                                            </div>
                                        </a>
                                    ))}
                                    {relatedNews.length === 0 ? (
                                        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-4 text-[11px] text-[var(--text-muted)]">
                                            No linked earnings news yet.
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</div>
            <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{value}</div>
        </div>
    );
}

export const EarningsReleaseRecapWidget = memo(EarningsReleaseRecapWidgetComponent);
export default EarningsReleaseRecapWidget;
