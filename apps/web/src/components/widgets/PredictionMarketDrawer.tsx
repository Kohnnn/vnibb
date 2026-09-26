'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, ExternalLink, X } from 'lucide-react';
import { WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap';
import { API_BASE_URL } from '@/lib/api';
import { ProbabilityBar } from './prediction-market-ui';
import { formatMarketAmount, formatMarketTime, formatProb, parsePredictionMarketPayload, type PredictionMarketRow } from './PredictionMarketSource';

export interface PredictionMarketDrawerProps {
    readonly source: string | null;
    readonly sourceId: string | null;
    readonly question: string | null;
    readonly market?: PredictionMarketRow | null;
    readonly open: boolean;
    readonly onClose: () => void;
}

type HistoryPoint = { readonly captured_at: string; readonly yes_price: number };
type RelatedMarket = { readonly source: string; readonly source_id: string; readonly question: string; readonly outcomeLabel: string; readonly yes_price: number | null; readonly url: string | null };
type HistoryState =
    | { readonly kind: 'loading'; readonly key: string }
    | { readonly kind: 'error'; readonly key: string; readonly error: Error }
    | { readonly kind: 'ready'; readonly key: string; readonly points: readonly HistoryPoint[] };
type RelatedState = { readonly key: string; readonly rows: readonly RelatedMarket[]; readonly error: boolean };

type HistoryResponse = { readonly points?: readonly { readonly captured_at?: unknown; readonly yes_price?: unknown }[] };

function parseHistory(value: unknown): HistoryPoint[] {
    const body = value as HistoryResponse | null;
    if (!Array.isArray(body?.points)) return [];
    const points = new Map<number, HistoryPoint>();
    for (const row of body.points) {
        if (!row || typeof row.captured_at !== 'string' || typeof row.yes_price !== 'number') continue;
        const timestamp = Date.parse(row.captured_at);
        if (!Number.isFinite(timestamp) || !Number.isFinite(row.yes_price) || row.yes_price < 0 || row.yes_price > 1) continue;
        points.set(timestamp, { captured_at: row.captured_at, yes_price: row.yes_price });
    }
    return [...points.values()].sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
}

function parseRelated(value: unknown): RelatedMarket[] {
    return parsePredictionMarketPayload(value).markets.map((market) => ({
        source: market.source,
        source_id: market.sourceId,
        question: market.question,
        outcomeLabel: market.outcomes[0] ?? 'First outcome',
        yes_price: market.prices[0] ?? null,
        url: market.url,
    }));
}

export function PredictionMarketDrawer({ source, sourceId, question, market: selectedMarket, open, onClose }: PredictionMarketDrawerProps) {
    const [days, setDays] = useState<1 | 7 | 30>(7);
    const [retry, setRetry] = useState(0);
    const [history, setHistory] = useState<HistoryState>({ kind: 'loading', key: '' });
    const [related, setRelated] = useState<RelatedState>({ key: '', rows: [], error: false });
    const [copied, setCopied] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [detail, setDetail] = useState<{ key: string; market: PredictionMarketRow | null; error: boolean }>({ key: '', market: null, error: false });
    const panelRef = useDialogFocusTrap<HTMLDivElement>({ enabled: open && mounted, onClose });
    const headingId = useId();
    const marketKey = `${source}:${sourceId}`;
    const historyKey = `${marketKey}:${days}:${retry}`;
    const market = selectedMarket ?? (detail.key === marketKey ? detail.market : null);

    useEffect(() => { setMounted(true); }, []);

    useEffect(() => {
        if (!open || !mounted) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = previous; };
    }, [open, mounted]);

    useEffect(() => {
        if (!open || selectedMarket || !source || !sourceId) return;
        const controller = new AbortController();
        const load = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/prediction-markets/${encodeURIComponent(source)}/${encodeURIComponent(sourceId)}`, { cache: 'no-store', signal: controller.signal });
                if (!response.ok) throw new Error('Selected market detail unavailable');
                const body = await response.json();
                const row = parsePredictionMarketPayload({ data: [body] }).markets[0] ?? null;
                if (!controller.signal.aborted) setDetail({ key: marketKey, market: row, error: row === null });
            } catch {
                if (!controller.signal.aborted) setDetail({ key: marketKey, market: null, error: true });
            }
        };
        void load();
        return () => controller.abort();
    }, [open, selectedMarket, source, sourceId, marketKey]);

    useEffect(() => {
        if (!open || !source || !sourceId) return;
        const controller = new AbortController();
        const load = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/prediction-markets/${encodeURIComponent(source)}/${encodeURIComponent(sourceId)}/history?days=${days}`, { cache: 'no-store', signal: controller.signal });
                if (!response.ok) throw new Error(`history API returned ${response.status}`);
                const points = parseHistory(await response.json());
                if (!controller.signal.aborted) setHistory({ kind: 'ready', key: historyKey, points });
            } catch (error: unknown) {
                if (!controller.signal.aborted) setHistory({ kind: 'error', key: historyKey, error: error instanceof Error ? error : new Error('History request failed') });
            }
        };
        void load();
        return () => controller.abort();
    }, [open, source, sourceId, days, historyKey]);

    useEffect(() => {
        if (!open || !source || !sourceId || !question) return;
        const controller = new AbortController();
        const load = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/prediction-markets?search=${encodeURIComponent(question.slice(0, 80))}&active=true&limit=20`, { cache: 'no-store', signal: controller.signal });
                if (!response.ok) throw new Error('Related markets unavailable');
                const rows = parseRelated(await response.json());
                if (!controller.signal.aborted) setRelated({ key: marketKey, rows, error: false });
            } catch {
                if (!controller.signal.aborted) setRelated({ key: marketKey, rows: [], error: true });
            }
        };
        void load();
        return () => controller.abort();
    }, [open, source, sourceId, question, marketKey]);

    const handleCopy = useCallback(async () => {
        if (!market?.url) return;
        try {
            await navigator.clipboard.writeText(market.url);
            setCopied(true);
        } catch {
            setCopied(false);
        }
    }, [market?.url]);

    if (!open || !mounted) return null;
    const points = history.key === historyKey && history.kind === 'ready' ? history.points : [];
    const first = points[0];
    const last = points[points.length - 1];
    const hasTrend = points.length >= 2;
    const change = hasTrend ? (last.yes_price - first.yes_price) * 100 : null;
    const prices = points.map((point) => point.yes_price);
    const historyOutcome = market?.outcomes[0] ?? 'first outcome';
    const span = hasTrend ? Date.parse(last.captured_at) - Date.parse(first.captured_at) : 0;
    const chartPoints = hasTrend ? points.map((point) => `${4 + ((Date.parse(point.captured_at) - Date.parse(first.captured_at)) / span) * 392},${96 - point.yes_price * 88}`).join(' ') : '';
    const providerTerms = ['rules_primary', 'rules_secondary', 'resolution_criteria', 'resolutionCriteria']
        .flatMap((key) => typeof market?.extra?.[key] === 'string' && market.extra[key] ? [market.extra[key] as string] : []);
    const relatedRows = related.key === marketKey ? related.rows.filter((row) => row.source !== source || row.source_id !== sourceId) : [];

    return createPortal(
        <div className="fixed inset-0 z-[150] flex items-end justify-end bg-black/40 p-3 sm:items-center sm:justify-center" onClick={onClose}>
            <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} className="flex max-h-[90dvh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-lg border border-default bg-[var(--bg-secondary)] p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
                <header className="flex items-start justify-between gap-3">
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300">Market analysis · {source ?? 'unknown'}</div>
                        <h3 id={headingId} className="text-sm font-semibold text-[var(--text-primary)]">{question ?? 'Prediction market'}</h3>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-md p-2 text-[var(--text-muted)] hover:bg-blue-500/10 hover:text-blue-300" aria-label="Close drawer"><X size={16} /></button>
                </header>

                {market ? <section className="flex flex-col gap-3" aria-label="Selected market context">
                    <dl className="grid grid-cols-2 gap-3 text-xs">
                        <div><dt className="text-[var(--text-muted)]">Provider updated</dt><dd>{formatMarketTime(market.lastSyncedAt)}</dd></div>
                        <div><dt className="text-[var(--text-muted)]">{market.closed ? 'Closed' : 'Closes'}</dt><dd>{formatMarketTime(market.endDate)}</dd></div>
                        <div><dt className="text-[var(--text-muted)]">Provider volume (cumulative)</dt><dd>{formatMarketAmount(market.volume, market.source, 'volume')}</dd></div>
                        <div><dt className="text-[var(--text-muted)]">{market.source === 'kalshi' ? 'Open interest' : 'Liquidity'}</dt><dd>{formatMarketAmount(market.liquidity, market.source, 'liquidity')}</dd></div>
                    </dl>
                    <div className="rounded-md border border-default p-3">
                        <h4 className="mb-2 text-xs font-semibold">Latest reported outcomes</h4>
                        <p className="mb-2 text-[11px] text-[var(--text-muted)]">Provider prices as of the update above; not forecasts or live quotes.</p>
                        {market.outcomes.length === 0 && <p className="text-xs text-[var(--text-muted)]">Outcome data not provided.</p>}
                        {market.outcomes.map((outcome, index) => <div key={`${outcome}:${index}`} className="mb-2 last:mb-0">
                            <div className="mb-1 flex justify-between gap-3 text-xs"><span>{outcome}</span><span className="font-mono">{formatProb(market.prices[index])}</span></div>
                            {typeof market.prices[index] === 'number' && <ProbabilityBar value={market.prices[index]} height={5} />}
                        </div>)}
                    </div>
                    <details className="rounded-md border border-default p-3" open>
                        <summary className="cursor-pointer text-xs font-semibold">Provider description &amp; terms</summary>
                        <div className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--text-secondary)]">
                            {market.description || providerTerms.length ? <>{market.description}{providerTerms.map((term, index) => <p className="mt-2" key={index}>{term}</p>)}</> : 'No description or resolution terms were supplied. Check the provider before interpreting this contract.'}
                        </div>
                    </details>
                </section> : <p role="status" className="text-xs text-[var(--text-muted)]">{detail.key !== marketKey ? 'Loading selected market context...' : detail.error ? 'Current market context is unavailable. Recorded observations below are not a current quote.' : 'No current market context is available.'}</p>}

                <section aria-label="Observed probability history" className="border-t border-default pt-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-xs font-semibold">Recorded {historyOutcome} probability</h4>
                        <div className="flex gap-1" aria-label="History window">{([1, 7, 30] as const).map((window) => <button key={window} type="button" aria-pressed={days === window} onClick={() => setDays(window)} className={`rounded-md border px-3 py-1.5 text-xs ${days === window ? 'border-blue-500/60 bg-blue-500/10 text-blue-300' : 'border-default text-[var(--text-muted)]'}`}>{window}d</button>)}</div>
                    </div>
                    {(history.key !== historyKey || history.kind === 'loading') && <WidgetLoading message="Loading recorded history..." />}
                    {history.key === historyKey && history.kind === 'error' && <WidgetError title="Could not load recorded history" error={history.error} onRetry={() => setRetry((value) => value + 1)} />}
                    {history.key === historyKey && history.kind === 'ready' && <>
                        {hasTrend ? <svg viewBox="0 0 400 104" role="img" aria-label={`Recorded ${historyOutcome} probability over observed timestamps, zero to one hundred percent`} className="h-28 w-full text-blue-400"><line x1="4" y1="96" x2="396" y2="96" stroke="currentColor" opacity="0.2" /><polyline points={chartPoints} fill="none" stroke="currentColor" strokeWidth="2" /></svg> : <p className="py-3 text-xs text-[var(--text-muted)]">Insufficient history: at least two distinct observations are needed to measure a change. No trend can be inferred yet.</p>}
                        <dl className="grid grid-cols-3 gap-2 text-xs">
                            <div><dt className="text-[var(--text-muted)]">Observed change</dt><dd className="font-mono">{change === null ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(1)} pp`}</dd></div>
                            <div><dt className="text-[var(--text-muted)]">Observed high</dt><dd className="font-mono">{prices.length ? formatProb(Math.max(...prices)) : '—'}</dd></div>
                            <div><dt className="text-[var(--text-muted)]">Observed low</dt><dd className="font-mono">{prices.length ? formatProb(Math.min(...prices)) : '—'}</dd></div>
                        </dl>
                        <dl className="mt-3 grid gap-1 text-[11px] text-[var(--text-muted)]">
                            <div className="flex justify-between gap-3"><dt>First observation</dt><dd>{formatMarketTime(first?.captured_at)}</dd></div>
                            <div className="flex justify-between gap-3"><dt>Last observation</dt><dd>{formatMarketTime(last?.captured_at)}</dd></div>
                            <div className="flex justify-between gap-3"><dt>Distinct observations</dt><dd>{points.length}</dd></div>
                            {last && <div className="flex justify-between gap-3"><dt>Last measured {historyOutcome}</dt><dd>{formatProb(last.yes_price)}</dd></div>}
                        </dl>
                        <p className="mt-2 text-[11px] text-[var(--text-muted)]">The {days}d window is a request, not guaranteed coverage. Change and range use only the observations shown; gaps are not measurements. Historical volume is not summed.</p>
                    </>}
                </section>

                <section className="border-t border-default pt-3" aria-label="Related markets">
                    <h4 className="text-xs font-semibold">Related markets</h4>
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">Question matching only. Wording, close times and resolution rules may differ; these are not equivalent contracts or a consensus.</p>
                    {related.key !== marketKey ? <p className="mt-2 text-xs text-[var(--text-muted)]">Loading related markets...</p> : related.error ? <p role="status" className="mt-2 text-xs text-amber-300">Related markets unavailable. Selected market history is unaffected.</p> : relatedRows.length === 0 ? <p className="mt-2 text-xs text-[var(--text-muted)]">No related markets found.</p> : <ul className="mt-2 space-y-2">{relatedRows.map((row, index) => <li key={`${row.source}:${row.source_id}:${index}`} className="rounded-md border border-default p-2 text-xs">
                        <div className="flex justify-between gap-3"><span className="font-semibold">{row.source}</span><span>{row.outcomeLabel} {row.yes_price === null ? 'No data' : formatProb(row.yes_price)}</span></div>
                        {row.url ? <a href={row.url} target="_blank" rel="noreferrer" className="mt-1 block text-blue-300 hover:underline">{row.question ?? 'View provider contract'}</a> : <p className="mt-1">{row.question ?? 'Contract wording not supplied'}</p>}
                    </li>)}</ul>}
                </section>
                {market?.url && <footer className="flex flex-wrap gap-2">
                    <a href={market.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md border border-default px-3 py-2 text-xs text-blue-300"><ExternalLink size={12} />View provider contract</a>
                    <button type="button" onClick={handleCopy} className="flex items-center gap-2 rounded-md border border-default px-3 py-2 text-xs text-[var(--text-primary)]"><Copy size={12} />{copied ? 'Link copied' : 'Copy market link'}</button>
                </footer>}
            </div>
        </div>,
        document.body,
    );
}
