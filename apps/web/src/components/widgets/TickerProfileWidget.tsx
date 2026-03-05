'use client';

import { useProfile, useDividends, useInsiderDeals, useScreenerData } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { CompanyLogo } from '@/components/ui/CompanyLogo';
import { Building2, Globe, Users, Calendar, MapPin, AlertTriangle } from 'lucide-react';
import { formatTimestamp } from '@/lib/format';
import { formatNumber, formatPercent, formatVND } from '@/lib/formatters';
import type { DividendRecord } from '@/lib/api';

interface TickerProfileWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatDividendType(type: string | null | undefined): string {
    const normalized = String(type || '').toLowerCase();
    if (normalized === 'cash') return 'Cash';
    if (normalized === 'stock') return 'Stock';
    if (normalized === 'mixed') return 'Mixed';
    return 'Other';
}

function formatDividendValue(row: DividendRecord): string {
    if (row.cash_dividend !== null && row.cash_dividend !== undefined) {
        return formatVND(row.cash_dividend);
    }
    if (row.stock_dividend !== null && row.stock_dividend !== undefined) {
        return `${row.stock_dividend.toFixed(2)}% stock`;
    }
    if (row.dividend_ratio !== null && row.dividend_ratio !== undefined) {
        return String(row.dividend_ratio);
    }
    if (row.value !== null && row.value !== undefined) {
        return formatVND(row.value);
    }
    return '-';
}

export function TickerProfileWidget({ symbol }: TickerProfileWidgetProps) {
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
    const dividends = dividendsData?.data ?? [];
    const insiderDeals = insiderDealsData ?? [];
    const hasData = Boolean(profile);
    const isFallback = Boolean(error && hasData);
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData);
    const updatedAt = [dataUpdatedAt, dividendsUpdatedAt, insiderUpdatedAt]
        .filter(Boolean)
        .sort((a, b) => Number(b) - Number(a))[0];

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
    const marketCapValue =
        (typeof screenerRow?.market_cap === 'number' && Number.isFinite(screenerRow.market_cap)
            ? screenerRow.market_cap
            : null) ??
        (typeof profileData.market_cap === 'number' && Number.isFinite(profileData.market_cap)
            ? profileData.market_cap
            : null);
    const showDividendsSection = dividendsLoading || Boolean(dividendsError) || dividends.length > 0;
    const showInsiderDealsSection = insiderLoading || Boolean(insiderError) || insiderDeals.length > 0;
    // TODO V200+: wire in CAFEF/vietstock dividend scraper.
    const showCorporateActions = showDividendsSection || showInsiderDealsSection;

    return (
        <div className="space-y-4">
            <WidgetMeta
                updatedAt={updatedAt}
                isFetching={(isFetching || dividendsFetching || insiderFetching) && hasData}
                isCached={isFallback}
                note="Company profile"
                align="right"
            />

            <div>
                <div className="flex items-center gap-3">
                    <CompanyLogo
                        symbol={symbol}
                        name={profileData.company_name || profileData.short_name || symbol}
                        website={profileData.website}
                        size={34}
                    />
                    <div>
                        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                            {profileData.company_name || symbol}
                        </h3>
                        {profileData.short_name && (
                            <p className="text-sm text-[var(--text-muted)]">{profileData.short_name}</p>
                        )}
                    </div>
                </div>
                {profileData.short_name && (
                    <p className="text-sm text-[var(--text-muted)] sr-only">{profileData.short_name}</p>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
                {profileData.industry && (
                    <div className="flex items-center gap-2 text-[var(--text-muted)]">
                        <Building2 size={14} className="text-blue-400" />
                        <span>{profileData.industry}</span>
                    </div>
                )}
                {profileData.exchange && (
                    <div className="flex items-center gap-2 text-[var(--text-muted)]">
                        <MapPin size={14} className="text-blue-400" />
                        <span>{profileData.exchange}</span>
                    </div>
                )}
                {profileData.website && (
                    <div className="flex items-center gap-2 text-[var(--text-muted)]">
                        <Globe size={14} className="text-blue-400" />
                        <a
                            href={profileData.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-blue-400 truncate"
                        >
                            {profileData.website.replace(/^https?:\/\//, '')}
                        </a>
                    </div>
                )}
                {profileData.no_employees && (
                    <div className="flex items-center gap-2 text-[var(--text-muted)]">
                        <Users size={14} className="text-blue-400" />
                        <span>{profileData.no_employees.toLocaleString()} employees</span>
                    </div>
                )}
                {profileData.established_year && (
                    <div className="flex items-center gap-2 text-[var(--text-muted)]">
                        <Calendar size={14} className="text-blue-400" />
                        <span>Est. {profileData.established_year}</span>
                    </div>
                )}
                {marketCapValue !== null && (
                    <div className="flex items-center gap-2 text-[var(--text-muted)]">
                        <Building2 size={14} className="text-blue-400" />
                        <span>Mkt Cap {formatNumber(marketCapValue)}</span>
                    </div>
                )}
            </div>

            <div className="pt-2 border-t border-[var(--border-color)] space-y-3">
                <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                    {profileData.company_type || 'Company information'} operating in {profileData.industry || 'various sectors'}.
                    {profileData.listed_date && ` Listed since ${profileData.listed_date}.`}
                </p>

                {showCorporateActions && (
                    <div className="grid grid-cols-1 gap-3">
                        {showDividendsSection && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Dividends</span>
                                    <span className="text-[10px] text-[var(--text-muted)]">{dividends.length} records</span>
                                </div>
                                {dividendsLoading && dividends.length === 0 ? (
                                    <WidgetSkeleton lines={2} />
                                ) : dividendsError && dividends.length === 0 ? (
                                    <div className="flex items-center gap-2 text-xs text-red-400">
                                        <AlertTriangle size={12} />
                                        Unable to load dividends
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {dividends.slice(0, 2).map((dividend, idx) => (
                                            <div
                                                key={`${dividend.ex_date}-${idx}`}
                                                className="flex items-center justify-between rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2"
                                            >
                                                <div>
                                                    <div className="text-xs font-semibold text-[var(--text-primary)]">{formatDividendValue(dividend)}</div>
                                                    <div className="text-[10px] text-[var(--text-muted)]">
                                                        {formatDividendType(dividend.dividend_type || dividend.type)}
                                                        {dividend.dividend_yield !== null && dividend.dividend_yield !== undefined
                                                            ? ` • ${formatPercent(dividend.dividend_yield)}`
                                                            : ''}
                                                        {dividend.ex_date ? ` • Ex ${formatTimestamp(dividend.ex_date)}` : ''}
                                                    </div>
                                                </div>
                                                {dividend.payment_date && (
                                                    <div className="text-[10px] text-[var(--text-muted)]">Pay {formatTimestamp(dividend.payment_date)}</div>
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
                                    <div className="flex items-center gap-2 text-xs text-red-400">
                                        <AlertTriangle size={12} />
                                        Unable to load insider deals
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {insiderDeals.slice(0, 2).map((deal) => {
                                            const action = deal.deal_action?.toUpperCase() || 'DEAL';
                                            const isBuy = action.includes('BUY');
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
                                                        <div className={`text-[10px] font-bold ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
                                                            {action}
                                                        </div>
                                                        <div className="text-[10px] text-[var(--text-muted)]">
                                                            {formatNumber(deal.deal_quantity)} @ {formatVND(deal.deal_price)}
                                                        </div>
                                                        <div className="text-[10px] text-[var(--text-muted)]">{formatTimestamp(deal.announce_date)}</div>
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
