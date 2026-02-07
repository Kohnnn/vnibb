'use client';

import { useProfile, useDividends, useInsiderDeals } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { CompanyLogo } from '@/components/ui/CompanyLogo';
import { Building2, Globe, Users, Calendar, MapPin, AlertTriangle } from 'lucide-react';
import { formatRelativeTime } from '@/lib/format';
import { formatNumber, formatVND } from '@/lib/formatters';

interface TickerProfileWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
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

    const profile = data?.data;
    const dividends = dividendsData?.data ?? [];
    const insiderDeals = insiderDealsData ?? [];
    const hasData = Boolean(profile);
    const isFallback = Boolean(error && hasData);
    const updatedAt = [dataUpdatedAt, dividendsUpdatedAt, insiderUpdatedAt]
        .filter(Boolean)
        .sort((a, b) => Number(b) - Number(a))[0];

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
                        <h3 className="text-lg font-semibold text-white">
                            {profileData.company_name || symbol}
                        </h3>
                        {profileData.short_name && (
                            <p className="text-sm text-gray-400">{profileData.short_name}</p>
                        )}
                    </div>
                </div>
                {profileData.short_name && (
                    <p className="text-sm text-gray-400 sr-only">{profileData.short_name}</p>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
                {profileData.industry && (
                    <div className="flex items-center gap-2 text-gray-400">
                        <Building2 size={14} className="text-blue-400" />
                        <span>{profileData.industry}</span>
                    </div>
                )}
                {profileData.exchange && (
                    <div className="flex items-center gap-2 text-gray-400">
                        <MapPin size={14} className="text-blue-400" />
                        <span>{profileData.exchange}</span>
                    </div>
                )}
                {profileData.website && (
                    <div className="flex items-center gap-2 text-gray-400">
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
                    <div className="flex items-center gap-2 text-gray-400">
                        <Users size={14} className="text-blue-400" />
                        <span>{profileData.no_employees.toLocaleString()} employees</span>
                    </div>
                )}
                {profileData.established_year && (
                    <div className="flex items-center gap-2 text-gray-400">
                        <Calendar size={14} className="text-blue-400" />
                        <span>Est. {profileData.established_year}</span>
                    </div>
                )}
            </div>

            <div className="pt-2 border-t border-gray-800 space-y-3">
                <p className="text-sm text-gray-400 leading-relaxed">
                    {profileData.company_type || 'Company information'} operating in {profileData.industry || 'various sectors'}.
                    {profileData.listed_date && ` Listed since ${profileData.listed_date}.`}
                </p>

                <div className="grid grid-cols-1 gap-3">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Dividends</span>
                            <span className="text-[10px] text-gray-500">{dividends.length} records</span>
                        </div>
                        {dividendsLoading && dividends.length === 0 ? (
                            <WidgetSkeleton lines={2} />
                        ) : dividendsError && dividends.length === 0 ? (
                            <div className="flex items-center gap-2 text-xs text-red-400">
                                <AlertTriangle size={12} />
                                Unable to load dividends
                            </div>
                        ) : dividends.length === 0 ? (
                            <div className="text-xs text-gray-500">No dividends available yet.</div>
                        ) : (
                            <div className="space-y-2">
                                {dividends.slice(0, 2).map((dividend, idx) => (
                                    <div
                                        key={`${dividend.ex_date}-${idx}`}
                                        className="flex items-center justify-between rounded-lg border border-gray-800/60 bg-black/20 px-3 py-2"
                                    >
                                        <div>
                                            <div className="text-xs font-semibold text-gray-200">{formatVND(dividend.value)}</div>
                                            <div className="text-[10px] text-gray-500">
                                                {dividend.dividend_type || 'Dividend'}
                                                {dividend.ex_date ? ` • Ex ${formatRelativeTime(dividend.ex_date)}` : ''}
                                            </div>
                                        </div>
                                        {dividend.payment_date && (
                                            <div className="text-[10px] text-gray-500">Pay {formatRelativeTime(dividend.payment_date)}</div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Insider Deals</span>
                            <span className="text-[10px] text-gray-500">{insiderDeals.length} records</span>
                        </div>
                        {insiderLoading && insiderDeals.length === 0 ? (
                            <WidgetSkeleton lines={2} />
                        ) : insiderError && insiderDeals.length === 0 ? (
                            <div className="flex items-center gap-2 text-xs text-red-400">
                                <AlertTriangle size={12} />
                                Unable to load insider deals
                            </div>
                        ) : insiderDeals.length === 0 ? (
                            <div className="text-xs text-gray-500">No insider deals available yet.</div>
                        ) : (
                            <div className="space-y-2">
                                {insiderDeals.slice(0, 2).map((deal) => {
                                    const action = deal.deal_action?.toUpperCase() || 'DEAL';
                                    const isBuy = action.includes('BUY');
                                    return (
                                        <div
                                            key={deal.id}
                                            className="flex items-center justify-between rounded-lg border border-gray-800/60 bg-black/20 px-3 py-2"
                                        >
                                            <div>
                                                <div className="text-xs font-semibold text-gray-200">
                                                    {deal.insider_name || 'Insider'}
                                                </div>
                                                <div className="text-[10px] text-gray-500">{deal.insider_position || '—'}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className={`text-[10px] font-bold ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
                                                    {action}
                                                </div>
                                                <div className="text-[10px] text-gray-500">
                                                    {formatNumber(deal.deal_quantity)} @ {formatVND(deal.deal_price)}
                                                </div>
                                                <div className="text-[10px] text-gray-500">{formatRelativeTime(deal.announce_date)}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
