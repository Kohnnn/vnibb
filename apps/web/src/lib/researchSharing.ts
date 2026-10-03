import { fetchAPI } from '@/lib/api';
import type { ResearchBundle } from '@/lib/researchBundle';

export interface ResearchShareSummary {
    share_id: string;
    owner_id: string;
    recipient_ids: string[];
    created_at: string;
    expires_at: string;
    revoked_at: string | null;
    thesis_count: number;
    evidence_count: number;
}
export interface AuthorResearchPreview {
    bundle: ResearchBundle;
    excludedOriginals: number;
    excludedCitations: number;
}
export interface ResearchShareRead extends ResearchShareSummary { bundle: ResearchBundle }

const privateOptions = { auth: 'required' as const, cache: 'no-store' as const };
export const listResearchShares = () => fetchAPI<ResearchShareSummary[]>('/research-shares', privateOptions);
export const readResearchShare = (id: string, signal?: AbortSignal) => fetchAPI<ResearchShareRead>(`/research-shares/${encodeURIComponent(id)}`, { ...privateOptions, signal });
export const createResearchShare = (bundle: ResearchBundle, recipient_ids: string[], expires_at: string) => fetchAPI<ResearchShareSummary>('/research-shares', { ...privateOptions, method: 'POST', body: JSON.stringify({ bundle, recipient_ids, expires_at }) });
export const revokeResearchShare = (id: string) => fetchAPI<{ revoked: boolean }>(`/research-shares/${encodeURIComponent(id)}`, { ...privateOptions, method: 'DELETE' });

/** Explicit author-only preview, never a provider-origin attestation or rights grant. */
export function previewAuthorResearch(bundle: ResearchBundle): AuthorResearchPreview {
    const items = bundle.items.filter((item) => item.kind === 'note' && !item.sources?.length && !item.agent && !item.artifact && !item.provenance);
    const ids = new Set(items.map((item) => item.id));
    const snapshot: ResearchBundle = { ...bundle, items, theses: bundle.theses.map((entry) => {
        const { citations: _citations, notebookItemIds, ...thesis } = entry.thesis;
        const retained = notebookItemIds?.filter((id) => ids.has(id));
        return { ...entry, thesis: { ...thesis, ...(retained?.length ? { notebookItemIds: retained } : {}) } };
    }) };
    return {
        bundle: snapshot,
        excludedOriginals: bundle.items.length - items.length,
        excludedCitations: bundle.theses.reduce((count, entry) => count + (entry.thesis.citations?.length || 0), 0),
    };
}
