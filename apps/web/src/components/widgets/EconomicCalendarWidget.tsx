// Economic Calendar Widget - Macro events and economic indicators

'use client';

import { useState, useEffect } from 'react';
import { Calendar, Clock, TrendingUp, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';

interface EconomicEvent {
    id: string;
    date: string;
    time: string;
    country: string;
    event: string;
    impact: 'high' | 'medium' | 'low';
    actual?: string;
    forecast?: string;
    previous?: string;
}

interface EconomicCalendarWidgetProps {
    isEditing?: boolean;
    onRemove?: () => void;
}

// Mock economic events
const ECONOMIC_EVENTS: EconomicEvent[] = [
    { id: '1', date: '2026-01-10', time: '09:00', country: 'VN', event: 'CPI YoY', impact: 'high', forecast: '3.2%', previous: '3.0%' },
    { id: '2', date: '2026-01-10', time: '14:00', country: 'VN', event: 'Trade Balance', impact: 'medium', forecast: '$2.1B', previous: '$1.8B' },
    { id: '3', date: '2026-01-10', time: '21:30', country: 'US', event: 'Nonfarm Payrolls', impact: 'high', forecast: '180K', previous: '199K' },
    { id: '4', date: '2026-01-11', time: '08:00', country: 'CN', event: 'GDP YoY', impact: 'high', forecast: '5.2%', previous: '4.9%' },
    { id: '5', date: '2026-01-11', time: '10:00', country: 'VN', event: 'Industrial Production', impact: 'medium', forecast: '6.5%', previous: '6.2%' },
    { id: '6', date: '2026-01-12', time: '15:00', country: 'US', event: 'Fed Interest Rate Decision', impact: 'high', forecast: '5.25%', previous: '5.25%' },
    { id: '7', date: '2026-01-13', time: '09:30', country: 'JP', event: 'BOJ Policy Rate', impact: 'high', forecast: '-0.1%', previous: '-0.1%' },
];

const COUNTRY_FLAGS: Record<string, string> = {
    VN: '🇻🇳',
    US: '🇺🇸',
    CN: '🇨🇳',
    JP: '🇯🇵',
    EU: '🇪🇺',
};

function getImpactColor(impact: string): string {
    switch (impact) {
        case 'high': return 'bg-red-500';
        case 'medium': return 'bg-yellow-500';
        case 'low': return 'bg-green-500';
        default: return 'bg-gray-500';
    }
}

function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function EconomicCalendarWidget({ isEditing, onRemove }: EconomicCalendarWidgetProps) {
    const [filter, setFilter] = useState<'all' | 'high' | 'vn'>('all');
    const [today, setToday] = useState<string>('');

    // Set today's date on client-side only to avoid hydration mismatch
    useEffect(() => {
        setToday(new Date().toISOString().split('T')[0]);
    }, []);

    const filteredEvents = ECONOMIC_EVENTS.filter(e => {
        if (filter === 'high') return e.impact === 'high';
        if (filter === 'vn') return e.country === 'VN';
        return true;
    });

    // Group events by date
    const groupedEvents = filteredEvents.reduce((acc, event) => {
        if (!acc[event.date]) acc[event.date] = [];
        acc[event.date].push(event);
        return acc;
    }, {} as Record<string, EconomicEvent[]>);

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-1 py-1 mb-2">
                <div className="flex items-center gap-2">
                    <Calendar size={12} className="text-blue-400" />
                    <div className="flex bg-gray-800 rounded text-[10px]">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-2 py-0.5 rounded ${filter === 'all' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}
                        >
                            All
                        </button>
                        <button
                            onClick={() => setFilter('high')}
                            className={`px-2 py-0.5 rounded ${filter === 'high' ? 'bg-red-600 text-white' : 'text-gray-400'}`}
                        >
                            High
                        </button>
                        <button
                            onClick={() => setFilter('vn')}
                            className={`px-2 py-0.5 rounded ${filter === 'vn' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}
                        >
                            🇻🇳
                        </button>
                    </div>
                </div>
            </div>

            {/* Events List */}
            <div className="flex-1 overflow-auto space-y-2">
                {Object.entries(groupedEvents).map(([date, events]) => (
                    <div key={date}>
                        <div className={`text-[10px] px-1 py-0.5 rounded mb-1 ${date === today ? 'bg-blue-500/20 text-blue-400' : 'text-gray-500'
                            }`}>
                            {formatDate(date)} {date === today && '(Today)'}
                        </div>
                        <div className="space-y-1">
                            {events.map((event) => (
                                <div
                                    key={event.id}
                                    className="flex items-start gap-2 p-2 rounded bg-gray-800/30 hover:bg-gray-800/50"
                                >
                                    <div className={`w-1 h-full min-h-[24px] rounded ${getImpactColor(event.impact)}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-sm">{COUNTRY_FLAGS[event.country] || '🌍'}</span>
                                            <span className="text-xs text-gray-400">{event.time}</span>
                                        </div>
                                        <div className="text-sm text-white font-medium truncate">{event.event}</div>
                                        <div className="flex gap-2 text-[10px] text-gray-400 mt-0.5">
                                            {event.forecast && <span>F: {event.forecast}</span>}
                                            {event.previous && <span>P: {event.previous}</span>}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
