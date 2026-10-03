'use client';

import { useMemo, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDashboard } from '@/contexts/DashboardContext';
import { normalizeThesisConfig } from '@/lib/investorWorkflow';
import { createResearchBundle, MAX_RESEARCH_BUNDLE_BYTES, parseResearchBundle, planResearchImport, type BundledThesis, type ResearchBundle } from '@/lib/researchBundle';
import { readNotebookItems } from '@/lib/researchNotebook';
import { ResearchShareControls } from '@/components/research/ResearchShareControls';

export function ResearchBundleModal({ onClose }: { onClose: () => void }) {
    const { state, importResearchBundle } = useDashboard();
    const [selected, setSelected] = useState<string[]>([]);
    const [incoming, setIncoming] = useState<ResearchBundle | null>(null);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const available = useMemo(() => {
        const records: { key: string; label: string; value: BundledThesis }[] = [];
        for (const dashboard of state.dashboards) for (const tab of dashboard.tabs) for (const widget of tab.widgets) {
            if (widget.type !== 'notes' || dashboard.isEditable === false) continue;
            const config = normalizeThesisConfig(widget.config);
            for (const [symbol, thesis] of Object.entries(config.thesesBySymbol)) {
                if (!/^[A-Z0-9]{3}$/.test(symbol)) continue;
                records.push({
                    key: `${dashboard.id}/${tab.id}/${widget.id}/${symbol}`,
                    label: `${symbol} · ${dashboard.name} / ${tab.name}`,
                    value: { symbol, thesis, ...(config.notesBySymbol[symbol] !== undefined ? { note: config.notesBySymbol[symbol] } : {}) },
                });
            }
        }
        return records;
    }, [state.dashboards]);

    const handleExport = () => {
        setError('');
        try {
            const chosen = available.filter(({ key }) => selected.includes(key)).map(({ value }) => value);
            const bundle = createResearchBundle(chosen, readNotebookItems());
            const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `vnibb-research-bundle-${new Date().toISOString().slice(0, 10)}.json`;
            anchor.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            setMessage(`Downloaded ${bundle.theses.length} theses and ${bundle.items.length} original notebook items. Missing originals remain citations only.`);
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not export research bundle.'); }
    };

    const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
        setIncoming(null);
        setMessage('');
        setError('');
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        try {
            if (file.size > MAX_RESEARCH_BUNDLE_BYTES) throw new Error('Research bundle exceeds the 5 MB import limit.');
            setIncoming(parseResearchBundle(await file.text()));
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read research bundle.'); }
    };

    const handleImport = () => {
        if (!incoming) return;
        setError('');
        try {
            const localSymbols = new Set(available.map(({ value }) => value.symbol));
            const plan = planResearchImport(incoming, readNotebookItems(), localSymbols);
            importResearchBundle(plan);
            setIncoming(null);
            setMessage(`Imported ${plan.summary.theses} theses into a new local research dashboard and ${plan.summary.evidence} notebook originals. ${plan.summary.remappedIds} evidence IDs remapped; ${plan.summary.symbolConflicts} existing-symbol conflicts kept separately; ${plan.summary.missingOriginals} originals missing (citations retained).`);
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Research import failed.'); }
    };

    return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="presentation" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="research-bundle-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-5 text-[var(--text-primary)] shadow-2xl">
            <div className="flex items-center justify-between"><h2 id="research-bundle-title" className="text-base font-semibold">Transfer Thesis &amp; Evidence</h2><button type="button" aria-label="Close research transfer" onClick={onClose} className="rounded p-2 hover:bg-[var(--bg-tertiary)] focus-visible:ring-2 focus-visible:ring-blue-500"><X size={18} aria-hidden="true" /></button></div>
            <p className="mt-3 text-xs leading-5 text-amber-300">Sensitive research: the JSON contains selected thesis text, notes and full linked notebook originals, including sources and URLs. Review before sharing. This is separate from workspace configuration backup; holdings are not included.</p>
            <fieldset className="mt-4 space-y-1"><legend className="text-sm font-semibold">Select theses to export (up to 50)</legend>
                {available.length ? available.map(({ key, label }) => <label key={key} className="flex min-h-9 items-center gap-2 text-xs"><input type="checkbox" checked={selected.includes(key)} disabled={!selected.includes(key) && selected.length >= 50} onChange={() => setSelected((current) => current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key])} />{label}</label>) : <p className="text-xs">No saved Investment Theses in personal workspaces.</p>}
            </fieldset>
            <button type="button" onClick={handleExport} disabled={!selected.length} className="mt-2 rounded border border-emerald-500 px-3 py-2 text-xs hover:bg-emerald-500/20 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-40">Download Research Bundle JSON</button>
            <div className="mt-5 border-t border-[var(--border-color)] pt-3"><label className="text-sm font-semibold">Import research bundle JSON (up to 5 MB)<input type="file" accept="application/json,.json" onChange={handleFile} className="mt-2 block w-full text-xs" /></label>
                {incoming && <div className="mt-2 text-xs">Ready to import {incoming.theses.length} theses and {incoming.items.length} originals as new local records. References without originals stay citation-only. Existing research will not be overwritten.<button type="button" onClick={handleImport} className="mt-2 block rounded border border-blue-500 px-3 py-2 hover:bg-blue-500/20 focus-visible:ring-2 focus-visible:ring-blue-400">Import Into New Research Dashboard</button></div>}
            </div>
            <ResearchShareControls buildBundle={() => createResearchBundle(available.filter(({ key }) => selected.includes(key)).map(({ value }) => value), readNotebookItems())} />
            {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
            {message && <p role="status" className="mt-3 text-xs text-emerald-300">{message}</p>}
        </section>
    </div>, document.body);
}
