import { citationMatchesItem, normalizeThesisConfig, type InvestmentThesis, type ThesisCitation } from '@/lib/investorWorkflow';
import { MAX_NOTEBOOK_ITEMS, normalizeNotebookItem, type NotebookItem } from '@/lib/researchNotebook';

export const MAX_RESEARCH_BUNDLE_BYTES = 5 * 1024 * 1024;
export const MAX_RESEARCH_THESES = 50;

export interface BundledThesis {
    symbol: string;
    thesis: InvestmentThesis;
    note?: string;
}

export interface ResearchBundle {
    format: 'vnibb-thesis-evidence';
    version: 1;
    createdAt: string;
    theses: BundledThesis[];
    items: NotebookItem[];
}

export interface ResearchImportPlan {
    theses: BundledThesis[];
    items: NotebookItem[];
    summary: { theses: number; evidence: number; remappedIds: number; symbolConflicts: number; missingOriginals: number };
}

const validId = (id: string) => /^nb:[^\s]{1,200}$/.test(id);

function safeData(value: unknown, depth = 0): boolean {
    if (depth > 20) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every((entry) => safeData(entry, depth + 1));
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).every(([key, entry]) =>
        !['__proto__', 'prototype', 'constructor'].includes(key)
        && !/^(api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|auth[-_]?header|password|secret|client[-_]?secret|private[-_]?key|credentials)$/i.test(key)
        && safeData(entry, depth + 1));
}
function sameData(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
        && left.length === right.length && left.every((entry, index) => sameData(entry, right[index]));
    const first = left as Record<string, unknown>;
    const second = right as Record<string, unknown>;
    return Object.keys(first).length === Object.keys(second).length
        && Object.keys(first).every((key) => Object.hasOwn(second, key) && sameData(first[key], second[key]));
}


export function createResearchBundle(theses: BundledThesis[], items: NotebookItem[]): ResearchBundle {
    if (!theses.length || theses.length > MAX_RESEARCH_THESES) throw new Error('Select 1–50 theses to export.');
    const references = theses.flatMap(({ thesis }) => (thesis.notebookItemIds || []).map((id) => ({ id, citation: thesis.citations?.find((entry) => entry.itemId === id) })));
    const bundle: ResearchBundle = {
        format: 'vnibb-thesis-evidence', version: 1, createdAt: new Date().toISOString(),
        theses: theses.map(({ symbol, thesis, note }) => ({ symbol, thesis, ...(note !== undefined ? { note } : {}) })),
        items: items.filter((item) => references.some(({ id }) => id === item.id)
            && references.every(({ id, citation }) => id !== item.id || citationMatchesItem(citation, item))),
    };
    return parseResearchBundle(JSON.stringify(bundle));
}

export function parseResearchBundle(raw: string): ResearchBundle {
    if (new Blob([raw]).size > MAX_RESEARCH_BUNDLE_BYTES) throw new Error('Research bundle exceeds the 5 MB limit. Nothing was imported.');
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error('Research bundle is not valid JSON. Nothing was imported.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid research bundle. Nothing was imported.');
    const data = value as Record<string, unknown>;
    if (!safeData(data) || Object.keys(data).some((key) => !['format', 'version', 'createdAt', 'theses', 'items'].includes(key))) {
        throw new Error('Research bundle contains unsafe or unexpected data. Nothing was imported.');
    }
    if (data.format !== 'vnibb-thesis-evidence' || data.version !== 1) throw new Error('Unsupported research bundle format or version. Nothing was imported.');
    if (typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt)) || !Array.isArray(data.theses) || !Array.isArray(data.items)
        || !data.theses.length || data.theses.length > MAX_RESEARCH_THESES || data.items.length > MAX_NOTEBOOK_ITEMS) throw new Error('Invalid research bundle size or metadata. Nothing was imported.');
    const theses: BundledThesis[] = data.theses.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid thesis in research bundle. Nothing was imported.');
        const record = entry as Record<string, unknown>;
        if (Object.keys(record).some((key) => !['symbol', 'thesis', 'note'].includes(key))) throw new Error('Invalid thesis fields in research bundle. Nothing was imported.');
        if (typeof record.symbol !== 'string' || !/^[A-Z0-9]{3}$/.test(record.symbol)
            || !record.thesis || typeof record.thesis !== 'object' || Array.isArray(record.thesis)
            || (record.note !== undefined && typeof record.note !== 'string')) throw new Error('Invalid thesis in research bundle. Nothing was imported.');
        if (Object.keys(record.thesis as Record<string, unknown>).some((key) => !['status', 'thesis', 'catalysts', 'risks', 'invalidation', 'reviewDate', 'notebookItemIds', 'citations'].includes(key))) {
            throw new Error('Invalid thesis fields or citations in research bundle. Nothing was imported.');
        }
        const thesis = normalizeThesisConfig({ thesesBySymbol: { [record.symbol]: record.thesis } }).thesesBySymbol[record.symbol];
        if (!sameData(thesis, record.thesis)) throw new Error('Invalid thesis fields or citations in research bundle. Nothing was imported.');
        return { symbol: record.symbol, thesis, ...(record.note !== undefined ? { note: record.note as string } : {}) };
    });
    const items = data.items.map((entry: unknown) => {
        const item = normalizeNotebookItem(entry);
        if (!item || !validId(item.id) || !entry || typeof entry !== 'object' || Array.isArray(entry)
            || Object.keys(entry).some((key) => !['id', 'kind', 'title', 'body', 'symbol', 'tags', 'sources', 'agent', 'artifact', 'dedupeKey', 'provenance', 'createdAt'].includes(key))) {
            throw new Error('Invalid notebook evidence in research bundle. Nothing was imported.');
        }
        return item;
    });
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('Duplicate notebook IDs in research bundle. Nothing was imported.');
    return { format: 'vnibb-thesis-evidence', version: 1, createdAt: data.createdAt, theses, items };
}

export function planResearchImport(bundle: ResearchBundle, localItems: NotebookItem[], localSymbols: ReadonlySet<string>, newId: () => string = () => `nb:${crypto.randomUUID()}`): ResearchImportPlan {
    const usedIds = new Set([...localItems.map((item) => item.id), ...bundle.items.map((item) => item.id)]);
    const remap = new Map<string, string>();
    const items = bundle.items.map((item) => {
        let id: string;
        do { id = newId(); } while (!validId(id) || usedIds.has(id));
        usedIds.add(id);
        remap.set(item.id, id);
        return { ...item, id };
    });
    const missing = new Set<string>();
    const reserved = new Set<string>();
    const mapId = (oldId: string): string => {
        const existing = remap.get(oldId);
        if (existing) return existing;
        let id: string;
        do { id = newId(); } while (!validId(id) || usedIds.has(id) || reserved.has(id));
        reserved.add(id);
        remap.set(oldId, id);
        missing.add(oldId);
        return id;
    };
    const theses = bundle.theses.map(({ symbol, thesis, note }) => {
        const ids = thesis.notebookItemIds?.map(mapId);
        const citations = thesis.citations?.map((citation: ThesisCitation) => ({ ...citation, itemId: mapId(citation.itemId) }));
        return { symbol, thesis: { ...thesis, ...(ids ? { notebookItemIds: ids } : {}), ...(citations ? { citations } : {}) }, ...(note !== undefined ? { note } : {}) };
    });
    if (localItems.length + items.length > MAX_NOTEBOOK_ITEMS) throw new Error('Research notebook capacity exceeded. Nothing was imported.');
    return { theses, items, summary: { theses: theses.length, evidence: items.length, remappedIds: items.length,
        symbolConflicts: theses.filter(({ symbol }, index) => localSymbols.has(symbol) || theses.findIndex((entry) => entry.symbol === symbol) !== index).length, missingOriginals: missing.size } };
}
