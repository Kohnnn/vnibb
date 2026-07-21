'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { useDashboard } from '@/contexts/DashboardContext';
import { useDashboardWidget } from '@/hooks/useDashboardWidget';
import { usePortfolio } from '@/lib/hooks/usePortfolio';
import { getCompanyEvents } from '@/lib/api';
import { equityQueryKeys } from '@/lib/queries/equity';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import { aggregateInvestorEvents, boundedSymbols, companyEventToInvestorEvent, type InvestorCalendarEvent } from '@/lib/investorWorkflow';
import { parseWatchlistSymbols } from './WatchlistWidget';
import type { WidgetGroupId } from '@/types/widget';

interface InvestorEventCalendarWidgetProps {
    id: string;
    config?: Record<string, unknown>;
    widgetGroup?: WidgetGroupId;
    onDataChange?: (data: WidgetDataPayload) => void;
}

function parseManualSymbols(config: Record<string, unknown> | undefined): string[] {
    return Array.isArray(config?.manualSymbols) ? config.manualSymbols.filter((value): value is string => typeof value === 'string') : [];
}

export function InvestorEventCalendarWidget({ id, config, widgetGroup, onDataChange }: InvestorEventCalendarWidgetProps) {
    const { state, updateWidget } = useDashboard();
    const widgetLocation = useDashboardWidget(id);
    const { symbols: portfolioSymbols } = usePortfolio();
    const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup, { widgetType: 'investor_event_calendar' });
    const manualSymbols = useMemo(() => parseManualSymbols(config), [config]);
    const [manualInput, setManualInput] = useState(manualSymbols.join(', '));
    const watchlistSymbols = useMemo(() => state.dashboards.flatMap((dashboard) => dashboard.tabs.flatMap((tab) => tab.widgets.filter((widget) => widget.type === 'watchlist').flatMap((widget) => parseWatchlistSymbols(widget.config)))), [state.dashboards]);
    const symbols = useMemo(() => boundedSymbols([portfolioSymbols, watchlistSymbols, manualSymbols]), [manualSymbols, portfolioSymbols, watchlistSymbols]);

    useEffect(() => setManualInput(manualSymbols.join(', ')), [manualSymbols]);

    const saveManualSymbols = () => {
        if (!widgetLocation) return;
        const nextManualSymbols = manualInput.split(',').map((value) => value.trim()).filter(Boolean);
        updateWidget(widgetLocation.dashboardId, widgetLocation.tabId, id, {
            config: { ...widgetLocation.widget.config, manualSymbols: nextManualSymbols },
        });
    };
    const eventQueries = useQueries({ queries: symbols.map((symbol) => ({ queryKey: equityQueryKeys.companyEvents(symbol), queryFn: () => getCompanyEvents(symbol, { limit: 30 }), staleTime: 10 * 60 * 1000 })) });
    const events = useMemo(() => {
        const corporate = eventQueries.flatMap((query) => query.data?.data?.map(companyEventToInvestorEvent).filter((event): event is InvestorCalendarEvent => Boolean(event)) || []);
        return aggregateInvestorEvents(corporate);
    }, [eventQueries]);
    const failedSymbols = symbols.filter((_, index) => eventQueries[index]?.isError);
    const loading = eventQueries.some((query) => query.isLoading);
    const error = eventQueries.find((query) => query.error)?.error;

    useEffect(() => {
        onDataChange?.({ __widgetRuntime: { data: { eventCount: events.length, symbolCount: symbols.length, unavailableSymbols: failedSymbols } } });
    }, [events.length, failedSymbols, onDataChange, symbols.length]);

    if (loading && events.length === 0) return <WidgetLoading message="Loading event coverage..." />;
    if (error && events.length === 0) return <WidgetError error={error as Error} />;

    return <div className="flex h-full flex-col gap-2" aria-label="Holdings and watchlist event calendar">
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)]"><span className="flex items-center gap-1"><CalendarDays size={14} /> {events.length} upcoming events</span><span>{symbols.length}/10 symbols</span></div>
        <div className="flex gap-1">
            <input value={manualInput} onChange={(event) => setManualInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveManualSymbols(); }} placeholder="Add symbols: FPT, VNM" className="min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]" aria-label="Manual event calendar symbols" />
            <button type="button" onClick={saveManualSymbols} className="rounded border border-[var(--border-subtle)] px-2 py-1 text-xs hover:bg-[var(--bg-tertiary)]">Save</button>
        </div>
        <div className="text-[10px] text-[var(--text-muted)]">Company events: {symbols.length - failedSymbols.length}/{symbols.length} symbols</div>
        {failedSymbols.length > 0 && <div className="text-[10px] text-amber-300">Unavailable company-event coverage: {failedSymbols.join(', ')}</div>}
        {events.length === 0 ? <WidgetEmpty message="No upcoming events in current coverage" detail="Missing provider data is shown as unavailable; this does not mean no events are scheduled." /> : <div className="flex-1 space-y-2 overflow-auto">{events.map((event) => <button key={`${event.symbol}-${event.eventClass}-${event.effectiveDate}`} type="button" onClick={() => setLinkedSymbol(event.symbol)} className="w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2 text-left hover:bg-[var(--bg-tertiary)]"><div className="flex justify-between gap-2"><span className="font-semibold text-blue-300">{event.symbol} · {event.eventClass}</span><time className="text-[var(--text-muted)]">{event.effectiveDate}</time></div><div className="mt-1 text-xs text-[var(--text-primary)]">{event.label}</div><div className="mt-1 text-[10px] text-[var(--text-muted)]">{event.source} · {event.provider}</div></button>)}</div>}
    </div>;
}
