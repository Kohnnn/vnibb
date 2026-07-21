'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Link2, Save, StickyNote, Trash2, Unlink } from 'lucide-react';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useDashboard } from '@/contexts/DashboardContext';
import { useDashboardWidget } from '@/hooks/useDashboardWidget';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { isReviewDue, normalizeThesisConfig, type InvestmentThesis, type ThesisStatus } from '@/lib/investorWorkflow';
import { RESEARCH_NOTEBOOK_EVENT, readNotebookItems, type NotebookItem } from '@/lib/researchNotebook';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import type { WidgetGroupId } from '@/types/widget';

interface NotesWidgetProps {
    id: string;
    symbol: string;
    config?: Record<string, unknown>;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: WidgetDataPayload) => void;
    widgetGroup?: WidgetGroupId;
}

const emptyThesis: InvestmentThesis = {
    status: 'researching',
    thesis: '',
    catalysts: '',
    risks: '',
    invalidation: '',
    reviewDate: '',
};

export function NotesWidget({ id, symbol, config, onDataChange, widgetGroup }: NotesWidgetProps) {
    const { updateWidget } = useDashboard();
    const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup, { widgetId: id, widgetType: 'notes', symbol });
    const widgetLocation = useDashboardWidget(id);
    const persisted = useMemo(() => normalizeThesisConfig(config), [config]);
    const [notes, setNotes] = useState('');
    const [thesis, setThesis] = useState<InvestmentThesis>(emptyThesis);
    const [notebookItems, setNotebookItems] = useState<NotebookItem[]>([]);
    const [isSaved, setIsSaved] = useState(true);
    const [showDueOnly, setShowDueOnly] = useState(false);

    useEffect(() => {
        setNotes(persisted.notesBySymbol[symbol] || '');
        setThesis(persisted.thesesBySymbol[symbol] || emptyThesis);
        setIsSaved(true);
    }, [persisted, symbol]);

    useEffect(() => {
        const refresh = () => setNotebookItems(readNotebookItems());
        refresh();
        window.addEventListener(RESEARCH_NOTEBOOK_EVENT, refresh);
        return () => window.removeEventListener(RESEARCH_NOTEBOOK_EVENT, refresh);
    }, []);

    const dueTheses = useMemo(() => Object.entries(persisted.thesesBySymbol)
        .filter(([, value]) => isReviewDue(value.reviewDate))
        .sort(([, left], [, right]) => left.reviewDate.localeCompare(right.reviewDate)), [persisted.thesesBySymbol]);
    const linkedEvidence = useMemo(() => {
        const byId = new Map(notebookItems.map((item) => [item.id, item]));
        return (thesis.notebookItemIds || []).map((itemId) => ({ itemId, item: byId.get(itemId) ?? null }));
    }, [notebookItems, thesis.notebookItemIds]);
    const attachableEvidence = useMemo(() => notebookItems.filter((item) => (
        (item.symbol?.toUpperCase() === symbol.toUpperCase() || !item.symbol) && !(thesis.notebookItemIds || []).includes(item.id)
    )), [notebookItems, symbol, thesis.notebookItemIds]);

    useEffect(() => {
        onDataChange?.(buildWidgetRuntime({
            empty: !notes && !thesis.thesis,
            apiGroup: 'local',
            endpoint: 'local:dashboard-notes',
            sourceLabel: 'Browser-local dashboard notes',
            extra: { symbol, characters: notes.length, localOnly: true, dueReviewCount: dueTheses.length },
        }));
    }, [dueTheses.length, notes.length, onDataChange, symbol, thesis.thesis]);

    const save = () => {
        if (!widgetLocation) return;
        updateWidget(widgetLocation.dashboardId, widgetLocation.tabId, id, {
            config: {
                ...widgetLocation.widget.config,
                notesBySymbol: { ...persisted.notesBySymbol, [symbol]: notes },
                thesesBySymbol: { ...persisted.thesesBySymbol, [symbol]: thesis },
            },
        });
        setIsSaved(true);
    };

    const clearNote = () => {
        setNotes('');
        setIsSaved(false);
    };

    const updateThesis = <K extends keyof InvestmentThesis>(key: K, value: InvestmentThesis[K]) => {
        setThesis((current) => ({ ...current, [key]: value }));
        setIsSaved(false);
    };
    const attachEvidence = (itemId: string) => updateThesis('notebookItemIds', [...new Set([...(thesis.notebookItemIds || []), itemId])]);
    const detachEvidence = (itemId: string) => updateThesis('notebookItemIds', (thesis.notebookItemIds || []).filter((id) => id !== itemId));

    if (showDueOnly) {
        return (
            <div className="flex h-full flex-col gap-2">
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                    <span>Due for review</span>
                    <button type="button" onClick={() => setShowDueOnly(false)} className="rounded px-2 py-1 hover:bg-[var(--bg-tertiary)]">Edit {symbol}</button>
                </div>
                {dueTheses.length === 0 ? <div className="text-xs text-[var(--text-muted)]">No theses are due for review.</div> : (
                    <div className="space-y-2 overflow-auto">
                        {dueTheses.map(([dueSymbol, value]) => <button key={dueSymbol} type="button" onClick={() => setLinkedSymbol(dueSymbol)} aria-label={`View due thesis for ${dueSymbol}`} className="min-h-11 w-full rounded border border-[var(--border-subtle)] p-2 text-left text-xs hover:border-blue-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
                            <div className="font-semibold text-[var(--text-primary)]">{dueSymbol} · {value.reviewDate}</div>
                            <div className="mt-1 text-[var(--text-secondary)]">{value.thesis || 'No thesis recorded.'}</div>
                        </button>)}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col gap-2">
            <div className="flex items-center justify-between px-1 text-xs text-[var(--text-muted)]">
                <div className="flex items-center gap-2"><StickyNote size={12} className="text-yellow-400" /><span>Thesis · {symbol}</span>{!isSaved && <span className="text-orange-400">Unsaved</span>}</div>
                <div className="flex items-center gap-1">
                    <WidgetMeta note="Saved in dashboard" align="right" />
                    <button type="button" onClick={() => setShowDueOnly(true)} className="rounded px-2 py-1 hover:bg-[var(--bg-tertiary)]" aria-label="Show theses due for review">Due {dueTheses.length}</button>
                    <button type="button" onClick={save} className="rounded p-1 hover:bg-[var(--bg-tertiary)] hover:text-green-400" aria-label="Save thesis"><Save size={13} /></button>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="text-[var(--text-muted)]">Status<select value={thesis.status} onChange={(event) => updateThesis('status', event.target.value as ThesisStatus)} className="mt-1 w-full rounded bg-[var(--bg-tertiary)] p-1.5 text-[var(--text-primary)]"><option value="researching">Researching</option><option value="watching">Watching</option><option value="active">Active</option><option value="closed">Closed</option></select></label>
                <label className="text-[var(--text-muted)]">Review date<input type="date" value={thesis.reviewDate} onChange={(event) => updateThesis('reviewDate', event.target.value)} className="mt-1 w-full rounded bg-[var(--bg-tertiary)] p-1.5 text-[var(--text-primary)]" /></label>
            </div>
            <Field label="Thesis" value={thesis.thesis} onChange={(value) => updateThesis('thesis', value)} />
            <Field label="Catalysts" value={thesis.catalysts} onChange={(value) => updateThesis('catalysts', value)} />
            <Field label="Risks" value={thesis.risks} onChange={(value) => updateThesis('risks', value)} />
            <Field label="Invalidation" value={thesis.invalidation} onChange={(value) => updateThesis('invalidation', value)} />
            <div className="space-y-1 rounded border border-[var(--border-subtle)] p-2 text-xs">
                <div className="flex items-center justify-between text-[var(--text-muted)]"><span>Linked browser-local research</span><span>{linkedEvidence.length}</span></div>
                {linkedEvidence.map(({ itemId, item }) => item ? <EvidenceItem key={itemId} item={item} onDetach={() => detachEvidence(itemId)} /> : <div key={itemId} className="flex items-center justify-between gap-2 text-amber-300"><span>Evidence unavailable or deleted: {itemId}</span><button type="button" onClick={() => detachEvidence(itemId)} className="rounded p-1 hover:bg-[var(--bg-tertiary)]" aria-label={`Detach missing evidence ${itemId}`}><Unlink size={12} /></button></div>)}
                <label className="flex items-center gap-1 text-[var(--text-muted)]"><Link2 size={12} />Attach existing research<select value="" onChange={(event) => { if (event.target.value) attachEvidence(event.target.value); }} className="min-w-0 flex-1 rounded bg-[var(--bg-tertiary)] p-1 text-[var(--text-primary)]" aria-label="Attach browser-local research evidence"><option value="">Select evidence</option>{attachableEvidence.map((item) => <option key={item.id} value={item.id}>{item.symbol ? `${item.symbol} · ` : 'No symbol · '}{item.title}</option>)}</select></label>
                {attachableEvidence.length === 0 && linkedEvidence.length === 0 && <div className="text-[10px] text-[var(--text-muted)]">No matching browser-local research. Symbol-less items may be selected when available.</div>}
            </div>
            <div className="flex min-h-0 flex-1 flex-col"><div className="flex items-center justify-between text-xs text-[var(--text-muted)]"><label htmlFor={`${id}-notes`}>Legacy notes</label><button type="button" onClick={clearNote} className="rounded p-1 hover:bg-[var(--bg-tertiary)] hover:text-red-400" aria-label="Clear legacy notes"><Trash2 size={12} /></button></div><textarea id={`${id}-notes`} value={notes} onChange={(event) => { setNotes(event.target.value); setIsSaved(false); }} placeholder={`Write notes about ${symbol}...`} className="mt-1 min-h-16 flex-1 resize-none rounded bg-[var(--bg-tertiary)] p-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-blue-500" /></div>
        </div>
    );
}

function EvidenceItem({ item, onDetach }: { item: NotebookItem; onDetach: () => void }) {
    const source = item.sources?.[0];
    const sourceUrl = source?.url || source?.sourceUrl || source?.feedUrl;
    const provenance = [item.symbol, source?.sourceName || source?.label || source?.sourceSystem, source?.asOf || source?.publishedAt || item.createdAt].filter(Boolean).join(' · ');
    return <div className="flex items-start justify-between gap-2 rounded bg-[var(--bg-tertiary)] p-1.5"><div className="min-w-0"><div className="truncate text-[var(--text-primary)]">{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-blue-300">{item.title}<ExternalLink size={10} /></a> : item.title}</div><div className="truncate text-[10px] text-[var(--text-muted)]">{provenance || 'Browser-local research; provenance unavailable.'}</div></div><button type="button" onClick={onDetach} className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-red-300" aria-label={`Detach evidence ${item.title}`}><Unlink size={12} /></button></div>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} className="min-h-12 resize-y rounded bg-[var(--bg-tertiary)] p-1.5 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-blue-500" /></label>;
}
