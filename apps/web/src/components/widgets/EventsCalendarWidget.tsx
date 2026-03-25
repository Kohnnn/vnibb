// Events Calendar Widget - Corporate events (dividends, AGMs, splits)

'use client';

import { useMemo, useState } from 'react';
import { Calendar, DollarSign, Split, Users, RefreshCw } from 'lucide-react';
import { useCompanyEvents } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';

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
    SPLIT: 'text-cyan-400 bg-cyan-400/10',
    AGM: 'text-blue-400 bg-blue-400/10',
    DEFAULT: 'text-[var(--text-secondary)] bg-[var(--bg-tertiary)]',
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

export function EventsCalendarWidget({ symbol }: EventsCalendarWidgetProps) {
    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useCompanyEvents(symbol, { limit: 20, enabled: !!symbol });

    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
    const events = useMemo(() => {
        const items = [...(data?.data || [])];
        const getEventTime = (value: string | null | undefined) => {
            const parsed = new Date(value || '');
            return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
        };
        return items.sort((left, right) => {
            const leftTime = getEventTime(
                left.event_date || left.ex_date || left.record_date || left.payment_date
            );
            const rightTime = getEventTime(
                right.event_date || right.ex_date || right.record_date || right.payment_date
            );
            return rightTime - leftTime;
        });
    }, [data?.data]);
    const hasData = events.length > 0;
    const isFallback = Boolean(error && hasData);
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 });

    if (!symbol) {
        return <WidgetEmpty message="Select a symbol to view events" icon={<Calendar size={18} />} />;
    }

    return (
        <div aria-label="Events calendar" className="h-full flex flex-col">
            <div className="flex items-center justify-between px-1 py-1 mb-2">
                <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <Calendar size={12} />
                    <span>{events.length} events</span>
                </div>
                <button
                    onClick={() => refetch()}
                    disabled={isFetching}
                    aria-label="Refresh events"
                    className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
                    title="Refresh events"
                    type="button"
                >
                    <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
                </button>
            </div>

            <div className="pb-2 border-b border-[var(--border-subtle)]">
                <WidgetMeta
                    updatedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    isCached={isFallback}
                    note="Company events"
                    align="right"
                />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 pt-2">
                {timedOut && isLoading && !hasData ? (
                    <WidgetError
                        title="Loading timed out"
                        error={new Error('Events data took too long to load.')}
                        onRetry={() => {
                            resetTimeout();
                            refetch();
                        }}
                    />
                ) : isLoading && !hasData ? (
                    <WidgetSkeleton lines={5} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty
                        message={`No events for ${symbol}`}
                        detail="Upcoming filings, dividends, and meetings appear here when scheduled."
                        icon={<Calendar size={18} />}
                        size="compact"
                    />
                ) : (
                    events.map((event, index) => {
                        const typeKey = getEventTypeKey(event.event_type);
                        const Icon = eventTypeIcons[typeKey] || eventTypeIcons.DEFAULT;
                        const colorClass = eventTypeColors[typeKey] || eventTypeColors.DEFAULT;
                        const isExpanded = expandedIndex === index;

                        return (
                            <div
                                key={index}
                                className="p-2 rounded bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors border-l-2 border-transparent hover:border-blue-500"
                                onClick={() => setExpandedIndex(isExpanded ? null : index)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(eventKey) => {
                                    if (eventKey.key === 'Enter' || eventKey.key === ' ') {
                                        eventKey.preventDefault();
                                        setExpandedIndex(isExpanded ? null : index);
                                    }
                                }}
                            >
                                <div className="flex items-start gap-2">
                                    <div className={`p-1.5 rounded ${colorClass}`}>
                                        <Icon size={12} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <span className={`text-[10px] font-medium uppercase ${colorClass.split(' ')[0]}`}>
                                                {event.event_type || 'Event'}
                                            </span>
                                        </div>
                                        <p className={`text-sm text-[var(--text-primary)] mt-0.5 ${isExpanded ? '' : 'line-clamp-1'}`}>
                                            {event.event_name || event.description || 'Unnamed event'}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 mt-2 text-[10px] text-[var(--text-muted)]">
                                    {event.event_date && <span>📅 {formatDate(event.event_date)}</span>}
                                    {event.ex_date && <span>Ex: {formatDate(event.ex_date)}</span>}
                                </div>

                                {isExpanded && (
                                    <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] space-y-1 text-xs">
                                        {event.value && (
                                            <div className="flex justify-between">
                                                <span className="text-[var(--text-muted)]">Value</span>
                                                <span className="text-[var(--text-primary)] font-medium">{event.value}</span>
                                            </div>
                                        )}
                                        {event.record_date && event.record_date !== 'None' && (
                                            <div className="flex justify-between">
                                                <span className="text-[var(--text-muted)]">Record Date</span>
                                                <span className="text-[var(--text-secondary)]">{formatDate(event.record_date)}</span>
                                            </div>
                                        )}
                                        {event.payment_date && event.payment_date !== 'None' && (
                                            <div className="flex justify-between">
                                                <span className="text-[var(--text-muted)]">Payment Date</span>
                                                <span className="text-[var(--text-secondary)]">{formatDate(event.payment_date)}</span>
                                            </div>
                                        )}
                                        {event.description && event.description !== event.event_name && (
                                            <p className="text-[var(--text-secondary)] mt-1">{event.description}</p>
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
