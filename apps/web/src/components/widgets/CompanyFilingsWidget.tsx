// Company Filings/Events Widget - Shows VN company corporate events

'use client';

import { useCompanyEvents } from '@/lib/queries';
import { Calendar, RefreshCw, AlertCircle, FileText } from 'lucide-react';

interface CompanyFilingsWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function getEventTypeColor(type: string): string {
    const typeLC = type?.toLowerCase() || '';
    if (typeLC.includes('dividend') || typeLC.includes('cổ tức')) {
        return 'text-green-400 bg-green-400/10';
    }
    if (typeLC.includes('agm') || typeLC.includes('đại hội')) {
        return 'text-blue-400 bg-blue-400/10';
    }
    if (typeLC.includes('rights') || typeLC.includes('phát hành')) {
        return 'text-yellow-400 bg-yellow-400/10';
    }
    if (typeLC.includes('bonus') || typeLC.includes('thưởng')) {
        return 'text-purple-400 bg-purple-400/10';
    }
    return 'text-gray-400 bg-gray-400/10';
}

function formatEventDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } catch {
        return dateStr;
    }
}

// Helper to get the best available date from event data
function getEventDate(event: Record<string, unknown>): string {
    return formatEventDate(
        (event.ex_date as string) ||
        (event.record_date as string) ||
        (event.event_date as string) ||
        (event.payment_date as string)
    );
}

// Helper to get event type label
function getEventTypeLabel(event: Record<string, unknown>): string {
    return (event.event_type as string) ||
        (event.event_name as string) ||
        'Event';
}

// Helper to get event description
function getEventDescription(event: Record<string, unknown>): string {
    return (event.description as string) ||
        (event.value as string) ||
        '-';
}

export function CompanyFilingsWidget({ symbol, isEditing, onRemove }: CompanyFilingsWidgetProps) {
    const {
        data: eventsData,
        isLoading,
        isError,
        refetch
    } = useCompanyEvents(symbol, { limit: 10, enabled: !!symbol });

    // Loading state
    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-32">
                <div className="animate-pulse flex flex-col items-center gap-2">
                    <div className="h-4 w-32 bg-gray-800 rounded" />
                    <div className="h-3 w-24 bg-gray-800 rounded" />
                </div>
            </div>
        );
    }

    // Error state
    if (isError) {
        return (
            <div className="flex flex-col items-center justify-center h-32 p-4 text-center">
                <AlertCircle size={24} className="text-red-500 mb-2" />
                <p className="text-sm text-gray-400">Failed to load events for {symbol}</p>
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

    const events = eventsData?.data || [];

    // Empty state
    if (events.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-32 p-4 text-center">
                <FileText size={28} className="text-gray-500 mb-2" />
                <p className="text-sm text-gray-400">No corporate events for {symbol}</p>
                <p className="text-xs text-gray-600 mt-1">Check back later for updates</p>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase">
                        <th className="pb-2 pr-4">Date</th>
                        <th className="pb-2 pr-4">Event</th>
                        <th className="pb-2">Details</th>
                    </tr>
                </thead>
                <tbody>
                    {events.map((event, idx) => {
                        const eventType = getEventTypeLabel(event as unknown as Record<string, unknown>);
                        const eventDesc = getEventDescription(event as unknown as Record<string, unknown>);
                        return (
                            <tr key={idx} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                                <td className="py-2 pr-4 text-gray-300 whitespace-nowrap">
                                    <div className="flex items-center gap-1.5">
                                        <Calendar size={12} className="text-gray-500" />
                                        {getEventDate(event as unknown as Record<string, unknown>)}
                                    </div>
                                </td>
                                <td className="py-2 pr-4">
                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${getEventTypeColor(eventType)}`}>
                                        {eventType}
                                    </span>
                                </td>
                                <td className="py-2 text-gray-400 text-xs max-w-[200px] truncate" title={eventDesc}>
                                    {eventDesc}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
