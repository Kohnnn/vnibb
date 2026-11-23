'use client';

import { useEffect, useMemo } from 'react';
import { useProfile, useDividends, useInsiderDeals, useScreenerData } from '@/lib/queries';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { marketCapExplanation, resolveMarketCap } from '@/lib/marketCap';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { CompanyLogo } from '@/components/ui/CompanyLogo';
import { Building2, Globe, Users, Calendar, MapPin, AlertTriangle } from 'lucide-react';
import { formatTimestamp } from '@/lib/formatDate';
import { DividendCoverageNotice } from './DividendCoverageNotice';
import { admittedDividendRows, dividendActionText, dividendCoverageBasis, dividendDistributionExport, dividendExport, dividendRowLabel, readDividendCoverage } from '@/lib/dividendHistory';
import { formatDividendPayout, formatNumber, formatVND } from '@/lib/formatters';
import { EMPTY_VALUE, formatLargeNumber } from '@/lib/units';
import { normalizeInsiderAction } from '@/lib/insiderActions';

interface TickerProfileWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: WidgetDataPayload) => void;
}


function cleanText(value: string | null | undefined): string | null {
    const trimmed = String(value ?? '').trim()
    return trimmed || null
}

function formatDateOnly(value: string | number | Date | null | undefined): string {
    const stamp = formatTimestamp(value)
    if (stamp === '-') return '-'
    return stamp.split(' ')[0] || stamp
}

function getYearFromDate(value: string | number | Date | null | undefined): number | null {
    if (!value) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        const match = String(value).match(/\b(19|20)\d{2}\b/)
        return match ? Number(match[0]) : null
    }
    return date.getFullYear()
}

function firstPositiveInteger(...values: unknown[]): number | null {
    for (const value of values) {
        const parsed = Number(value)
        if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed)
    }
    return null
}

function formatMarketCapCompact(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'Not disclosed'
    return `VND ${formatLargeNumber(value, { decimals: 2 })}`
}


export function TickerProfileWidget({ symbol, onDataChange }: TickerProfileWidgetProps) {
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useProfile(symbol);
    const {
        data: dividendsData,
        isLoading: dividendsLoading,
        error: dividendsError,
        isFetching: dividendsFetching,
        dataUpdatedAt: dividendsUpdatedAt,
    } = useDividends(symbol, Boolean(symbol));
    const {
        data: insiderDealsData,
        isLoading: insiderLoading,
        error: insiderError,
        isFetching: insiderFetching,
        dataUpdatedAt: insiderUpdatedAt,
    } = useInsiderDeals(symbol, { limit: 3, enabled: Boolean(symbol) });
    const { data: screenerData } = useScreenerData({
        symbol,
        limit: 1,
        enabled: Boolean(symbol),
    });

    const profile = data?.data;
    const screenerRow = screenerData?.data?.[0];
    const marketCap = useMemo(() => resolveMarketCap(
        { label: 'Profile', value: profile?.market_cap, provenance: profile?.market_cap_provenance },
        { label: 'Screener', value: screenerRow?.market_cap, provenance: screenerRow?.market_cap_provenance },
    ), [profile, screenerRow]);
    const dividendCoverage = readDividendCoverage(dividendsData);
    const dividends = admittedDividendRows(dividendsData);
    const dividendFailure = Boolean(dividendsError || dividendsData?.error);
    const insiderDeals = insiderDealsData ?? [];
    const hasData = Boolean(profile);
    const isFallback = Boolean(error && hasData);
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData);
    // Profile, dividend, and insider rows expose no source observation date —
    // only the query receipts, which say when we retrieved them. Freshness
    // therefore stays unknown and the receipts move to `fetchedAt`.
    const fetchedAt = [dataUpdatedAt, dividendsUpdatedAt, insiderUpdatedAt]
        .filter(Boolean)
        .sort((a, b) => Number(b) - Number(a))[0];
    const showInsiderDealsSection = insiderLoading || Boolean(insiderError) || insiderDeals.length > 0;
    const showCorporateActions = Boolean(symbol) || showInsiderDealsSection;

    useEffect(() => {
        onDataChange?.(buildWidgetRuntime({
            empty: !hasData,
            apiGroup: '/equity',
            endpoint: `/equity/${symbol}/profile`,
            lastDataDate: null,
            fetchedAt,
            stale: isFallback,
            basis: dividendCoverageBasis(dividendCoverage),
            exportData: {
                profile,
                marketCap,
                ...dividendExport(dividendCoverage, dividends.slice(0, 2).map(dividendDistributionExport)),
            },
            extra: { sections: showCorporateActions ? 3 : 1, marketCap },
        }));
    }, [dividendCoverage, dividends, fetchedAt, hasData, isFallback, marketCap, onDataChange, profile, showCorporateActions, symbol]);

    if (timedOut && isLoading && !hasData) {
        return (
            <WidgetError
                title="Loading timed out"
                error={new Error('Request timed out after 15 seconds.')}
                onRetry={() => {
                    resetTimeout();
                    refetch();
                }}
            />
        );
    }

    if (isLoading && !hasData) {
        return <WidgetSkeleton lines={4} />;
    }

    if (error && !hasData) {
        return <WidgetError error={error as Error} onRetry={() => refetch()} />;
    }

    if (!hasData) {
        return <WidgetEmpty message={`No profile data for ${symbol}`} />;
    }

    const profileData = profile;
    if (!profileData) {
        return <WidgetEmpty message={`No profile data for ${symbol}`} />;
    }
    const companyName = cleanText(profileData.company_name) || symbol
    const shortName = cleanText(profileData.short_name)
    const description = cleanText(profileData.description)
    // Fall back to the screener's ICB industry if the profile's industry is
    // missing (older/cached profiles), so the Industry field never shows a
    // legal entity type. (DEF-05)
    const industry =
        cleanText(profileData.industry) ||
        cleanText(screenerRow?.industry as string | undefined) ||
        cleanText(screenerRow?.industry_name as string | undefined)
    const exchange = cleanText(profileData.exchange)
    const website = cleanText(profileData.website)
    const companyType = cleanText(profileData.company_type) || cleanText(profileData.sector) || 'Company information'
    const listedDate = cleanText(profileData.listing_date) || cleanText(profileData.listed_date)
    const establishedDate = cleanText(profileData.established_date)
    const establishedYear = profileData.established_year || getYearFromDate(establishedDate)
    const employeeCount = firstPositiveInteger(
        profileData.no_employees,
        profileData.employees,
        profileData.employee_count,
        profileData.number_of_employees,
    )
    const infoCards = [
        { label: 'Industry', value: industry || 'Unavailable', icon: Building2 },
        { label: 'Exchange', value: exchange || 'Unavailable', icon: MapPin },
        { label: 'Website', value: website ? website.replace(/^https?:\/\//, '') : 'Unavailable', icon: Globe },
        { label: 'Employees', value: employeeCount ? employeeCount.toLocaleString() : 'Unavailable', icon: Users },
        { label: 'Established', value: establishedYear ? `${establishedYear}` : 'Unavailable', icon: Calendar },
        { label: 'Market Cap', value: marketCap.status === 'conflict' ? 'Conflict' : formatMarketCapCompact(marketCap.value), icon: Building2 },
    ] as Array<{ label: string; value: string; icon: typeof Building2 }>

    return (
        <div className="space-y-3">
            <WidgetMeta
                updatedAt={null}
                fetchedAt={fetchedAt}
                isFetching={(isFetching || dividendsFetching || insiderFetching) && hasData}
                isCached={isFallback}
                note="Company profile"
                align="right"
            />

            <div className="rounded-2xl border border-[var(--color-state-border)] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_48%),linear-gradient(180deg,rgba(15,23,42,0.18),transparent)] p-3">
                <div className="flex items-start gap-3">
                    <CompanyLogo
                        symbol={symbol}
                        name={companyName}
                        website={website || undefined}
                        size={36}
                    />
                    <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--color-accent-primary)]">{symbol}</div>
                        <h3 className="truncate text-lg font-semibold text-[var(--text-primary)]">
                            {companyName}
                        </h3>
                        {shortName && (
                            <p className="truncate text-sm text-[var(--text-muted)]">{shortName}</p>
                        )}
                    </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                    {exchange && (
                        <span className="inline-flex items-center rounded-full border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-accent-primary)]">
                            {exchange}
                        </span>
                    )}
                    {industry && (
                        <span className="inline-flex items-center rounded-full border border-[var(--color-state-border)] bg-[var(--color-positive-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-positive)]">
                            {industry}
                        </span>
                    )}
                    {companyType && (
                        <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                            {companyType}
                        </span>
                    )}
                </div>
            </div>

            <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2 text-sm">
                {infoCards.map((item) => {
                    const Icon = item.icon
                    return (
                        <div key={item.label} className="min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/55 px-3 py-2.5">
                            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                                <Icon size={12} className="text-[var(--color-accent-primary)]" />
                                <span>{item.label}</span>
                            </div>
                            <div className="break-words text-sm font-medium text-[var(--text-primary)]">
                                {item.value}
                            </div>
                            {item.label === 'Market Cap' && (
                                <details className="mt-1 text-[10px] text-[var(--text-muted)]">
                                    <summary className="cursor-pointer">Market cap provenance</summary>
                                    <p>{marketCapExplanation(marketCap)}</p>
                                </details>
                            )}
                        </div>
                    )
                })}
            </div>

            <div className="pt-2 border-t border-[var(--border-color)] space-y-2.5">
                <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                    {description || (industry
                        ? `${companyType} operating in ${industry}.`
                        : 'No company description available.')}
                    {listedDate && ` Listed since ${formatDateOnly(listedDate)}.`}
                </p>

                {showCorporateActions && (
                    <div className="grid grid-cols-1 gap-3">
                        {symbol && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Dividends</span>
                                    <span className="text-[10px] text-[var(--text-muted)]">{Math.min(dividends.length, 2)} shown</span>
                                </div>
                                {(!dividendsLoading || dividendCoverage) && (
                                    <DividendCoverageNotice coverage={dividendCoverage} failed={dividendFailure} />
                                )}
                                {dividendsLoading && dividends.length === 0 ? (
                                    <WidgetSkeleton lines={2} />
                                ) : dividends.length > 0 && (
                                    <div className="space-y-2">
                                        {dividends.slice(0, 2).map((dividend, idx) => (
                                            <div
                                                key={`${dividend.dataset}-${dividend.observation_id ?? idx}`}
                                                className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2"
                                            >
                                                <div>
                                                    <div className="text-xs font-semibold text-[var(--text-primary)]">{formatDividendPayout(dividend)}</div>
                                                    <div className="text-[10px] text-[var(--text-muted)]">
                                                        {dividendRowLabel(dividend)}
                                                    </div>
                                                </div>
                                                {dividendActionText(dividend).length > 0 && (
                                                    <div className="text-[10px] text-[var(--text-muted)]">{dividendActionText(dividend).join(' · ')}</div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {showInsiderDealsSection && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Insider Deals</span>
                                    <span className="text-[10px] text-[var(--text-muted)]">{insiderDeals.length} records</span>
                                </div>
                                {insiderLoading && insiderDeals.length === 0 ? (
                                    <WidgetSkeleton lines={2} />
                                ) : insiderError && insiderDeals.length === 0 ? (
                                    <div className="flex items-center gap-2 text-xs text-[var(--color-negative)]">
                                        <AlertTriangle size={12} />
                                        Unable to load insider deals
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {insiderDeals.slice(0, 2).map((deal) => {
                                            const actionToken = normalizeInsiderAction(deal.deal_action);
                                            const actionLabel = actionToken ?? 'UNKNOWN';
                                            const actionClass = actionToken === 'BUY' ? 'text-[var(--color-positive)]'
                                                : actionToken === 'SELL' ? 'text-[var(--color-negative)]' : 'text-[var(--text-muted)]';
                                            const priceText = deal.price_unit === 'VND' ? formatVND(deal.deal_price) : EMPTY_VALUE;
                                            return (
                                                <div
                                                    key={deal.id}
                                                    className="flex items-center justify-between rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2"
                                                >
                                                    <div>
                                                        <div className="text-xs font-semibold text-[var(--text-primary)]">
                                                            {deal.insider_name || 'Insider'}
                                                        </div>
                                                        <div className="text-[10px] text-[var(--text-muted)]">{deal.insider_position || '—'}</div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className={`text-[10px] font-bold ${actionClass}`}>
                                                            {actionLabel}
                                                        </div>
                                                        <div className="text-[10px] text-[var(--text-muted)]">
                                                            {formatNumber(deal.deal_quantity)} @ {priceText}
                                                        </div>
                                                        <div className="text-[10px] text-[var(--text-muted)]">{formatDateOnly(deal.announce_date)}</div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
