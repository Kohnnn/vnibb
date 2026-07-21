'use client';

import { useEffect, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { markAlertActivityRead, readAlertActivity, subscribeAlertActivity, type AlertActivity } from '@/lib/alertActivity';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import { normalizeTickerSymbol } from '@/lib/defaultTicker';
import type { WidgetGroupId } from '@/types/widget';

interface AlertActivityInboxWidgetProps {
    id?: string;
    widgetGroup?: WidgetGroupId;
}

export function AlertActivityInboxWidget({ id, widgetGroup }: AlertActivityInboxWidgetProps) {
    const [items, setItems] = useState<AlertActivity[]>([]);
    const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup, { widgetId: id, widgetType: 'alert_activity_inbox' });

    useEffect(() => {
        const refresh = () => setItems(readAlertActivity());
        refresh();
        return subscribeAlertActivity(refresh);
    }, []);

    const openActivity = (item: AlertActivity) => {
        markAlertActivityRead(item.id);
        const symbol = normalizeTickerSymbol(item.symbol);
        if (symbol) setLinkedSymbol(symbol);
    };

    return <div className="flex h-full flex-col gap-2" aria-label="Alert activity inbox">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Bell size={14} /><span>{items.filter((item) => !item.read).length} unread activity</span></div>
        <div className="text-[10px] text-[var(--text-muted)]">Local timeline of observed triggers. Browser delivery is not a durable email or push receipt.</div>
        {items.length === 0 ? <WidgetEmpty message="No observed alert activity" detail="Price, saved-screen, prediction-market, and insider activity appears after this browser observes it." /> : <div className="flex-1 space-y-2 overflow-auto">{items.map((item) => { const symbol = normalizeTickerSymbol(item.symbol); return <button key={item.id} type="button" onClick={() => openActivity(item)} aria-label={symbol ? `Open ${symbol} from ${item.title}` : `Mark ${item.title} read`} className={`min-h-11 w-full rounded border border-[var(--border-subtle)] p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${item.read ? 'bg-[var(--bg-primary)]' : 'bg-blue-500/10'}`}><div className="flex justify-between gap-2"><span className="font-semibold text-[var(--text-primary)]">{item.title}</span>{item.read ? <Check size={14} className="text-emerald-300" /> : <span className="text-[10px] text-blue-300">Unread</span>}</div>{item.detail && <div className="mt-1 text-xs text-[var(--text-secondary)]">{item.detail}</div>}<div className="mt-1 text-[10px] text-[var(--text-muted)]">{item.source.replace('_', ' ')} · {item.deliveryClass.replace('_', ' ')} · {item.serverBacked ? 'server-backed record' : 'browser-local record'} · {new Date(item.triggerTime).toLocaleString()}</div></button>; })}</div>}
    </div>;
}
