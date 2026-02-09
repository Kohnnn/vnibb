// Company Filings/Events Widget - Shows VN company corporate events

'use client';

import { useCompanyEvents } from '@/lib/queries';
import { Calendar, FileText } from 'lucide-react';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import type { CompanyEventData } from '@/types/equity';

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
        return 'text-cyan-400 bg-cyan-400/10';
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
            year: 'numeric',
        });
    } catch {
        return dateStr;
    }
}

function getEventDate(event: CompanyEventData): string {
    return formatEventDate(
        event.ex_date ||
        event.record_date ||
        event.event_date ||
        event.payment_date
    );
}

function getEventTypeLabel(event: CompanyEventData): string {
    return event.event_type || event.event_name || 'Event';
}

function getEventDescription(event: CompanyEventData): string {
    return event.description || event.value || '-';
}

export function CompanyFilingsWidget({ symbol }: CompanyFilingsWidgetProps) {
    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useCompanyEvents(symbol, { limit: 10, enabled: !!symbol });

    const events = data?.data || [];
    const hasData = events.length > 0;
    const isFallback = Boolean(error && hasData);

    if (!symbol) {
        return <WidgetEmpty message="Select a symbol to view corporate events" icon={<FileText size={18} />} />;
    }

    return (
        <div className="h-full flex flex-col">
            <div className="pb-2 border-b border-gray-800/50">
                <WidgetMeta
                    updatedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    isCached={isFallback}
                    note="Corporate events"
                    align="right"
                />
            </div>

            <div className="flex-1 overflow-x-auto pt-2">
                {isLoading && !hasData ? (
                    <WidgetSkeleton variant="table" lines={6} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty message={`No corporate events for ${symbol}`} icon={<FileText size={18} />} />
                ) : (
                    <table className="w-full text-sm" aria-label="Corporate events">
                        <thead>
                            <tr className="text-left text-xs text-gray-500 uppercase">
                                <th className="pb-2 pr-4">Date</th>
                                <th className="pb-2 pr-4">Event</th>
                                <th className="pb-2">Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {events.map((event, idx) => {
                                const eventType = getEventTypeLabel(event);
                                const eventDesc = getEventDescription(event);

                                return (
                                    <tr key={idx} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                                        <td className="py-2 pr-4 text-gray-300 whitespace-nowrap">
                                            <div className="flex items-center gap-1.5">
                                                <Calendar size={12} className="text-gray-500" />
                                                {getEventDate(event)}
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
                )}
            </div>
        </div>
    );
}
