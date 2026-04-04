'use client';

import { memo, useMemo } from 'react';
import { CalendarClock, FileText, Newspaper, Sparkles } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { useUnit } from '@/contexts/UnitContext';
import { useCashFlow, useCompanyEvents, useCompanyNews, useEarningsQuality, useIncomeStatement } from '@/lib/queries';
import { formatDate, formatRelativeTime } from '@/lib/format';
import { formatFinancialPeriodLabel, periodSortKey } from '@/lib/financialPeriods';
import { convertFinancialValueForUnit, formatNumber, formatPercent } from '@/lib/units';

interface EarningsReleaseRecapWidgetProps {
    id: string;
    symbol: string;
    hideHeader?: boolean;
    onRemove?: () => void;
}

function yoyChange(current: number | null | undefined, previous: number | null | undefined): number | null {
    if (current == null || previous == null || previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
}

function normalizeQuarterPeriod(period: string | undefined): string | null {
    const label = String(period || '').trim().toUpperCase();
    if (!label) return null;
    const yearMatch = label.match(/(20\d{2})/);
    const quarterMatch = label.match(/Q([1-4])/);
    if (yearMatch && quarterMatch) {
        return `${yearMatch[1]}-Q${quarterMatch[1]}`;
    }
    return yearMatch ? yearMatch[1] : label;
}

function EarningsReleaseRecapWidgetComponent({ id, symbol, hideHeader, onRemove }: EarningsReleaseRecapWidgetProps) {
    const { config: unitConfig } = useUnit();
    const incomeQuery = useIncomeStatement(symbol, { period: 'quarter', limit: 8, enabled: Boolean(symbol) });
    const cashFlowQuery = useCashFlow(symbol, { period: 'quarter', limit: 8, enabled: Boolean(symbol) });
    const earningsQualityQuery = useEarningsQuality(symbol, Boolean(symbol));
    const newsQuery = useCompanyNews(symbol, { limit: 5, enabled: Boolean(symbol) });
    const eventsQuery = useCompanyEvents(symbol, { limit: 8, enabled: Boolean(symbol) });

    const orderedIncomeRows = useMemo(
        () => [...(incomeQuery.data?.data || [])].sort((left, right) => periodSortKey(right.period) - periodSortKey(left.period)),
        [incomeQuery.data?.data]
    );
    const orderedCashRows = useMemo(
        () => [...(cashFlowQuery.data?.data || [])].sort((left, right) => periodSortKey(right.period) - periodSortKey(left.period)),
        [cashFlowQuery.data?.data]
    );

    const latestIncome = orderedIncomeRows[0] || null;
    const comparableIncome = useMemo(() => {
        if (!latestIncome?.period) return orderedIncomeRows[1] || null;
        const latestPeriod = normalizeQuarterPeriod(latestIncome.period);
        if (!latestPeriod) return orderedIncomeRows[1] || null;
        const yearMatch = latestPeriod.match(/(20\d{2})-Q([1-4])/);
        if (!yearMatch) return orderedIncomeRows[1] || null;
        const comparableKey = `${Number(yearMatch[1]) - 1}-Q${yearMatch[2]}`;
        return orderedIncomeRows.find((row) => normalizeQuarterPeriod(row.period) === comparableKey) || orderedIncomeRows[1] || null;
    }, [latestIncome?.period, orderedIncomeRows]);

    const latestCash = useMemo(() => {
        if (!latestIncome?.period) return orderedCashRows[0] || null;
        const targetKey = normalizeQuarterPeriod(latestIncome.period);
        return orderedCashRows.find((row) => normalizeQuarterPeriod(row.period) === targetKey) || orderedCashRows[0] || null;
    }, [latestIncome?.period, orderedCashRows]);

    const recapRows = useMemo(() => {
        if (!latestIncome) return [];
        return [
            {
                label: 'Revenue',
                current: convertFinancialValueForUnit(latestIncome.revenue ?? null, unitConfig, latestIncome.period),
                previous: convertFinancialValueForUnit(comparableIncome?.revenue ?? null, unitConfig, comparableIncome?.period),
                change: yoyChange(
                    convertFinancialValueForUnit(latestIncome.revenue, unitConfig, latestIncome.period),
                    convertFinancialValueForUnit(comparableIncome?.revenue, unitConfig, comparableIncome?.period)
                ),
                formatter: (value: number | null) => formatNumber(value, { decimals: 0 }),
            },
            {
                label: 'Gross Profit',
                current: convertFinancialValueForUnit(latestIncome.gross_profit ?? null, unitConfig, latestIncome.period),
                previous: convertFinancialValueForUnit(comparableIncome?.gross_profit ?? null, unitConfig, comparableIncome?.period),
                change: yoyChange(
                    convertFinancialValueForUnit(latestIncome.gross_profit, unitConfig, latestIncome.period),
                    convertFinancialValueForUnit(comparableIncome?.gross_profit, unitConfig, comparableIncome?.period)
                ),
                formatter: (value: number | null) => formatNumber(value, { decimals: 0 }),
            },
            {
                label: 'Operating Income',
                current: convertFinancialValueForUnit(latestIncome.operating_income ?? null, unitConfig, latestIncome.period),
                previous: convertFinancialValueForUnit(comparableIncome?.operating_income ?? null, unitConfig, comparableIncome?.period),
                change: yoyChange(
                    convertFinancialValueForUnit(latestIncome.operating_income, unitConfig, latestIncome.period),
                    convertFinancialValueForUnit(comparableIncome?.operating_income, unitConfig, comparableIncome?.period)
                ),
                formatter: (value: number | null) => formatNumber(value, { decimals: 0 }),
            },
            {
                label: 'Pre-tax Profit',
                current: convertFinancialValueForUnit(latestIncome.pre_tax_profit ?? latestIncome.profit_before_tax ?? null, unitConfig, latestIncome.period),
                previous: convertFinancialValueForUnit(comparableIncome?.pre_tax_profit ?? comparableIncome?.profit_before_tax ?? null, unitConfig, comparableIncome?.period),
                change: yoyChange(
                    convertFinancialValueForUnit(latestIncome.pre_tax_profit ?? latestIncome.profit_before_tax, unitConfig, latestIncome.period),
                    convertFinancialValueForUnit(comparableIncome?.pre_tax_profit ?? comparableIncome?.profit_before_tax, unitConfig, comparableIncome?.period)
                ),
                formatter: (value: number | null) => formatNumber(value, { decimals: 0 }),
            },
            {
                label: 'Net Income',
                current: convertFinancialValueForUnit(latestIncome.net_income ?? null, unitConfig, latestIncome.period),
                previous: convertFinancialValueForUnit(comparableIncome?.net_income ?? null, unitConfig, comparableIncome?.period),
                change: yoyChange(
                    convertFinancialValueForUnit(latestIncome.net_income, unitConfig, latestIncome.period),
                    convertFinancialValueForUnit(comparableIncome?.net_income, unitConfig, comparableIncome?.period)
                ),
                formatter: (value: number | null) => formatNumber(value, { decimals: 0 }),
            },
            {
                label: 'EPS',
                current: convertFinancialValueForUnit(latestIncome.eps ?? null, unitConfig, latestIncome.period),
                previous: convertFinancialValueForUnit(comparableIncome?.eps ?? null, unitConfig, comparableIncome?.period),
                change: yoyChange(
                    convertFinancialValueForUnit(latestIncome.eps, unitConfig, latestIncome.period),
                    convertFinancialValueForUnit(comparableIncome?.eps, unitConfig, comparableIncome?.period)
                ),
                formatter: (value: number | null) => formatNumber(value, { decimals: 2 }),
            },
            {
                label: 'Gross Margin',
                current: latestIncome.revenue && latestIncome.gross_profit ? (latestIncome.gross_profit / latestIncome.revenue) * 100 : null,
                previous: comparableIncome?.revenue && comparableIncome?.gross_profit ? (comparableIncome.gross_profit / comparableIncome.revenue) * 100 : null,
                change: latestIncome.revenue && latestIncome.gross_profit && comparableIncome?.revenue && comparableIncome?.gross_profit
                    ? ((latestIncome.gross_profit / latestIncome.revenue) - (comparableIncome.gross_profit / comparableIncome.revenue)) * 100
                    : null,
                formatter: (value: number | null) => formatPercent(value, { decimals: 1, input: 'percent', clamp: 'margin' }),
            },
        ];
    }, [comparableIncome, latestIncome, unitConfig]);

    const highlights = useMemo(() => {
        if (!latestIncome) return [];
        const grossMargin = latestIncome.revenue && latestIncome.gross_profit ? (latestIncome.gross_profit / latestIncome.revenue) * 100 : null;
        const previousMargin = comparableIncome?.revenue && comparableIncome?.gross_profit
            ? (comparableIncome.gross_profit / comparableIncome.revenue) * 100
            : null;
        const marginDelta = grossMargin !== null && previousMargin !== null ? grossMargin - previousMargin : null;

        return [
            {
                label: 'Revenue YoY',
                value: yoyChange(latestIncome.revenue, comparableIncome?.revenue),
                tone: 'text-cyan-300',
            },
            {
                label: 'Net Income YoY',
                value: yoyChange(latestIncome.net_income, comparableIncome?.net_income),
                tone: 'text-emerald-300',
            },
            {
                label: 'EPS YoY',
                value: yoyChange(latestIncome.eps, comparableIncome?.eps),
                tone: 'text-blue-300',
            },
            {
                label: 'Gross Margin Delta',
                value: marginDelta,
                tone: 'text-amber-300',
            },
        ];
    }, [comparableIncome, latestIncome]);

    const narrative = useMemo(() => {
        if (!latestIncome) return null;

        const revenueYoY = yoyChange(latestIncome.revenue, comparableIncome?.revenue);
        const earningsYoY = yoyChange(latestIncome.net_income, comparableIncome?.net_income);
        const quality = earningsQualityQuery.data?.data;

        const revenueText = revenueYoY === null
            ? 'revenue trend is not comparable yet'
            : revenueYoY >= 0
                ? `revenue grew ${formatPercent(revenueYoY, { decimals: 1, input: 'percent', clamp: 'yoy_change' })}`
                : `revenue contracted ${formatPercent(Math.abs(revenueYoY), { decimals: 1, input: 'percent', clamp: 'yoy_change' })}`;
        const earningsText = earningsYoY === null
            ? 'earnings trend is still sparse'
            : earningsYoY >= 0
                ? `net income improved ${formatPercent(earningsYoY, { decimals: 1, input: 'percent', clamp: 'yoy_change' })}`
                : `net income fell ${formatPercent(Math.abs(earningsYoY), { decimals: 1, input: 'percent', clamp: 'yoy_change' })}`;
        const qualityText = quality
            ? `earnings quality is ${quality.grade.toLowerCase()} with a ${quality.trend.toLowerCase()} trend`
            : 'earnings quality context is not available yet';

        return `${revenueText}, ${earningsText}, and ${qualityText}.`;
    }, [comparableIncome?.net_income, comparableIncome?.revenue, earningsQualityQuery.data?.data, latestIncome]);

    const hasData = Boolean(latestIncome || latestCash || earningsQualityQuery.data?.data || newsQuery.data?.data?.length || eventsQuery.data?.data?.length);
    const isLoading = incomeQuery.isLoading && cashFlowQuery.isLoading && newsQuery.isLoading && eventsQuery.isLoading;
    const combinedError = incomeQuery.error || cashFlowQuery.error || newsQuery.error || eventsQuery.error || earningsQualityQuery.error;
    const updatedAt = Math.max(
        incomeQuery.dataUpdatedAt,
        cashFlowQuery.dataUpdatedAt,
        newsQuery.dataUpdatedAt,
        eventsQuery.dataUpdatedAt,
        earningsQualityQuery.dataUpdatedAt
    );

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
                        <WidgetMeta updatedAt={updatedAt} isFetching={incomeQuery.isFetching || cashFlowQuery.isFetching || newsQuery.isFetching || eventsQuery.isFetching} note="Quarter recap" align="right" />
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
                        {highlights.map((item) => (
                            <div key={item.label} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
                                <div className="text-[9px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{item.label}</div>
                                <div className={`mt-1 text-sm font-semibold ${item.tone}`}>
                                    {formatPercent(item.value, { decimals: 1, input: 'percent', clamp: item.label.includes('Delta') ? 'margin' : 'yoy_change' })}
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
                                                    <td className={`py-2 text-right font-medium ${row.change !== null && row.change >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                                                        {row.change === null ? '-' : formatPercent(row.change, { decimals: 1, input: 'percent', clamp: row.label.includes('Margin') ? 'margin' : 'yoy_change' })}
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
                                        {earningsQualityQuery.data?.data ? (
                                            <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                                                <div className="font-semibold text-[var(--text-primary)]">
                                                    {earningsQualityQuery.data.data.trend} trend · score {formatNumber(earningsQualityQuery.data.data.quality_score, { decimals: 1 })}
                                                </div>
                                                <ul className="mt-2 space-y-1">
                                                    {earningsQualityQuery.data.data.checks.slice(0, 3).map((check) => (
                                                        <li key={check}>• {check}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ) : null}
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
                                    {(newsQuery.data?.data || []).slice(0, 5).map((news) => (
                                        <a
                                            key={`${news.url || news.title}`}
                                            href={news.url || '#'}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 transition-colors hover:border-blue-500/30"
                                        >
                                            <div className="font-medium text-[var(--text-primary)]">{news.title}</div>
                                            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--text-muted)]">
                                                <span>{news.source || 'News source'}</span>
                                                <span>{news.published_at ? formatRelativeTime(news.published_at) : '-'}</span>
                                            </div>
                                        </a>
                                    ))}
                                    {(newsQuery.data?.data || []).length === 0 ? (
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
