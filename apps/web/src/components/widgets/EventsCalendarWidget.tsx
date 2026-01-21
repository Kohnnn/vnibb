// Events Calendar Widget - Corporate events (dividends, AGMs, splits)

'use client';

import { useState } from 'react';
import { Calendar, DollarSign, Split, Users, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { useCompanyEvents } from '@/lib/queries';

interface EventsCalendarWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

const eventTypeIcons: Record<string, typeof Calendar> = {
    DIVIDEND: DollarSign,
    SPLIT: Split,
    AGM: Users,
    DEFAULT: Calendar,
};

const eventTypeColors: Record<string, string> = {
    DIVIDEND: 'text-green-400 bg-green-400/10',
    SPLIT: 'text-purple-400 bg-purple-400/10',
    AGM: 'text-blue-400 bg-blue-400/10',
    DEFAULT: 'text-gray-400 bg-gray-400/10',
};

function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr || dateStr === 'None' || dateStr === '') return '-';

    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('vi-VN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    } catch {
        return dateStr;
    }
}

function getEventTypeKey(type: string | null | undefined): string {
    if (!type) return 'DEFAULT';
    const upper = type.toUpperCase();
    if (upper.includes('DIVIDEND') || upper.includes('CO TUC')) return 'DIVIDEND';
    if (upper.includes('SPLIT') || upper.includes('CHIA')) return 'SPLIT';
    if (upper.includes('AGM') || upper.includes('DAI HOI')) return 'AGM';
    return 'DEFAULT';
}

export function EventsCalendarWidget({ symbol, isEditing, onRemove }: EventsCalendarWidgetProps) {
    const { data, isLoading, refetch, isRefetching } = useCompanyEvents(symbol, { limit: 20 });
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

    const events = data?.data || [];

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-1 py-1 mb-2">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Calendar size={12} />
                    <span>{events.length} events</span>
                </div>
                <button
                    onClick={() => refetch()}
                    disabled={isRefetching}
                    className="p-1 text-gray-500 hover:text-white hover:bg-gray-800 rounded transition-colors"
                    title="Refresh events"
                >
                    <RefreshCw size={12} className={isRefetching ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Events List */}
            <div className="flex-1 overflow-y-auto space-y-1">
                {isLoading ? (
                    <div className="space-y-3">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="animate-pulse p-2 bg-gray-800/30 rounded">
                                <div className="h-4 bg-gray-800 rounded w-3/4 mb-2" />
                                <div className="h-3 bg-gray-800 rounded w-1/2" />
                            </div>
                        ))}
                    </div>
                ) : events.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                        <Calendar size={24} className="mb-2 opacity-30" />
                        <p className="text-xs">No events for {symbol}</p>
                    </div>
                ) : (
                    events.map((event, index) => {
                        const typeKey = getEventTypeKey(event.event_type);
                        const Icon = eventTypeIcons[typeKey] || eventTypeIcons.DEFAULT;
                        const colorClass = eventTypeColors[typeKey] || eventTypeColors.DEFAULT;
                        const isExpanded = expandedIndex === index;

                        return (
                            <div
                                key={index}
                                className="p-2 rounded bg-gray-800/20 hover:bg-gray-800/40 cursor-pointer transition-colors border-l-2 border-transparent hover:border-blue-500"
                                onClick={() => setExpandedIndex(isExpanded ? null : index)}
                            >
                                {/* Event Header */}
                                <div className="flex items-start gap-2">
                                    <div className={`p-1.5 rounded ${colorClass}`}>
                                        <Icon size={12} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <span className={`text-[10px] font-medium uppercase ${colorClass.split(' ')[0]}`}>
                                                {event.event_type || 'Event'}
                                            </span>
                                            {isExpanded ? (
                                                <ChevronUp size={12} className="text-gray-500" />
                                            ) : (
                                                <ChevronDown size={12} className="text-gray-500" />
                                            )}
                                        </div>
                                        <p className={`text-sm text-gray-200 mt-0.5 ${isExpanded ? '' : 'line-clamp-1'}`}>
                                            {event.event_name || event.description || 'Unnamed event'}
                                        </p>
                                    </div>
                                </div>

                                {/* Dates Row */}
                                <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-500">
                                    {event.event_date && (
                                        <span>📅 {formatDate(event.event_date)}</span>
                                    )}
                                    {event.ex_date && (
                                        <span>Ex: {formatDate(event.ex_date)}</span>
                                    )}
                                </div>

                                {/* Expanded Details */}
                                {isExpanded && (
                                    <div className="mt-2 pt-2 border-t border-gray-700/50 space-y-1 text-xs">
                                        {event.value && (
                                            <div className="flex justify-between">
                                                <span className="text-gray-500">Value</span>
                                                <span className="text-white font-medium">{event.value}</span>
                                            </div>
                                        )}
                                        {event.record_date && event.record_date !== 'None' && (
                                            <div className="flex justify-between">
                                                <span className="text-gray-500">Record Date</span>
                                                <span className="text-gray-300">{formatDate(event.record_date)}</span>
                                            </div>
                                        )}
                                        {event.payment_date && event.payment_date !== 'None' && (
                                            <div className="flex justify-between">
                                                <span className="text-gray-500">Payment Date</span>
                                                <span className="text-gray-300">{formatDate(event.payment_date)}</span>
                                            </div>
                                        )}
                                        {event.description && event.description !== event.event_name && (
                                            <p className="text-gray-400 mt-1">{event.description}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
