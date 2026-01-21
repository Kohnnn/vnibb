// Ticker Profile Widget - Full company description (OpenBB-style)

'use client';

import { useProfile } from '@/lib/queries';

import { Building2, Globe, Users, Calendar, MapPin, AlertCircle, RefreshCw } from 'lucide-react';

interface TickerProfileWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

export function TickerProfileWidget({ symbol, isEditing, onRemove }: TickerProfileWidgetProps) {
    const { data, isLoading, isError, refetch } = useProfile(symbol);
    const profile = data?.data;

    // Error state with retry
    if (isError) {
        return (
            <div className="flex flex-col items-center justify-center h-full min-h-[120px] p-4 text-center">
                <AlertCircle size={24} className="text-red-500 mb-2" />
                <p className="text-sm text-gray-400">Failed to load profile for {symbol}</p>
                <button
                    onClick={() => refetch()}
                    className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded transition-colors"
                >
                    <RefreshCw size={12} />
                    Retry
                </button>
            </div>
        );
    }

    return (
        <>
            {isLoading ? (
                <div
                    className="space-y-3 animate-pulse"
                    role="status"
                    aria-label="Loading profile"
                >
                    <div className="h-6 bg-gray-800 rounded w-48" />
                    <div className="h-4 bg-gray-800 rounded w-full" />
                    <div className="h-4 bg-gray-800 rounded w-3/4" />
                </div>
            ) : !profile ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[120px] p-4 text-center">
                    <AlertCircle size={24} className="text-gray-500 mb-2" />
                    <p className="text-sm text-gray-400">No profile data for {symbol}</p>
                    <p className="text-xs text-gray-600 mt-1">Symbol may be invalid or data unavailable</p>
                    <button
                        onClick={() => refetch()}
                        className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded transition-colors"
                    >
                        <RefreshCw size={12} />
                        Refresh
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Company Name */}
                    <div>
                        <h3 className="text-lg font-semibold text-white">
                            {profile.company_name || symbol}
                        </h3>
                        {profile.short_name && (
                            <p className="text-sm text-gray-400">{profile.short_name}</p>
                        )}
                    </div>

                    {/* Quick Facts */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        {profile.industry && (
                            <div className="flex items-center gap-2 text-gray-400">
                                <Building2 size={14} className="text-blue-400" />
                                <span>{profile.industry}</span>
                            </div>
                        )}
                        {profile.exchange && (
                            <div className="flex items-center gap-2 text-gray-400">
                                <MapPin size={14} className="text-blue-400" />
                                <span>{profile.exchange}</span>
                            </div>
                        )}
                        {profile.website && (
                            <div className="flex items-center gap-2 text-gray-400">
                                <Globe size={14} className="text-blue-400" />
                                <a
                                    href={profile.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:text-blue-400 truncate"
                                >
                                    {profile.website.replace(/^https?:\/\//, '')}
                                </a>
                            </div>
                        )}
                        {profile.no_employees && (
                            <div className="flex items-center gap-2 text-gray-400">
                                <Users size={14} className="text-blue-400" />
                                <span>{profile.no_employees.toLocaleString()} employees</span>
                            </div>
                        )}
                        {profile.established_year && (
                            <div className="flex items-center gap-2 text-gray-400">
                                <Calendar size={14} className="text-blue-400" />
                                <span>Est. {profile.established_year}</span>
                            </div>
                        )}
                    </div>

                    {/* Description - would need to be added to backend */}
                    <div className="pt-2 border-t border-gray-800">
                        <p className="text-sm text-gray-400 leading-relaxed">
                            {profile.company_type || 'Company information'} operating in {profile.industry || 'various sectors'}.
                            {profile.listed_date && ` Listed since ${profile.listed_date}.`}
                        </p>
                    </div>
                </div>
            )}
        </>
    );
}
