import type { CompanyEventData } from '@/types/equity';
import type { NotebookItem } from '@/lib/researchNotebook';

export type ThesisStatus = 'researching' | 'watching' | 'active' | 'closed';
export interface ThesisCitation {
    itemId: string;
    title: string;
    source?: string;
    url?: string;
    sourceId?: string;
    symbol?: string;
    asOf?: string;
    capturedAt: string;
}

export const MAX_THESIS_CITATIONS = 50;

export function citeNotebookItem(item: NotebookItem): ThesisCitation {
    const source = item.sources?.[0];
    return {
        itemId: item.id,
        title: item.title.slice(0, 300),
        ...(source?.sourceName || source?.label || source?.sourceSystem ? { source: (source.sourceName || source.label || source.sourceSystem)!.slice(0, 200) } : {}),
        ...(source?.url || source?.sourceUrl || source?.feedUrl ? { url: (source.url || source.sourceUrl || source.feedUrl)!.slice(0, 2048) } : {}),
        ...(source?.id ? { sourceId: source.id.slice(0, 300) } : {}),
        ...(item.symbol ? { symbol: item.symbol.slice(0, 40) } : {}),
        ...(source?.asOf || source?.publishedAt ? { asOf: (source.asOf || source.publishedAt)!.slice(0, 100) } : {}),
        capturedAt: item.createdAt,
    };
}
export function citationMatchesItem(citation: ThesisCitation | undefined, item: NotebookItem): boolean {
    if (!citation) return true;
    const observed = citeNotebookItem(item);
    return citation.itemId === observed.itemId && citation.title === observed.title
        && citation.capturedAt === observed.capturedAt
        && citation.source === observed.source && citation.url === observed.url
        && citation.sourceId === observed.sourceId && citation.symbol === observed.symbol
        && citation.asOf === observed.asOf;
}


export interface InvestmentThesis {
    status: ThesisStatus;
    thesis: string;
    catalysts: string;
    risks: string;
    invalidation: string;
    reviewDate: string;
    notebookItemIds?: string[];
    citations?: ThesisCitation[];
}

export interface ThesisConfig {
    notesBySymbol: Record<string, string>;
    thesesBySymbol: Record<string, InvestmentThesis>;
}

export type InvestorEventClass = 'DIVIDEND' | 'MEETING' | 'SPLIT' | 'RIGHTS' | 'EARNINGS';

export interface InvestorCalendarEvent {
    symbol: string;
    eventClass: InvestorEventClass;
    effectiveDate: string;
    label: string;
    source: string;
    provider: string;
    detail?: string;
}

const THESIS_STATUSES: ThesisStatus[] = ['researching', 'watching', 'active', 'closed'];
const EVENT_CLASSES: InvestorEventClass[] = ['DIVIDEND', 'MEETING', 'SPLIT', 'RIGHTS'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSymbol(value: string): string {
    return value.trim().toUpperCase();
}

function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function normalizeReviewDate(value: unknown): string {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function normalizeNotebookItemIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((id): id is string => typeof id === 'string' && /^nb:[^\s]{1,200}$/.test(id)))].slice(0, MAX_THESIS_CITATIONS);
}
function normalizeCitations(value: unknown, ids: readonly string[]): ThesisCitation[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.slice(0, MAX_THESIS_CITATIONS).flatMap((entry): ThesisCitation[] => {
        if (!isRecord(entry) || typeof entry.itemId !== 'string' || !ids.includes(entry.itemId)
            || seen.has(entry.itemId) || typeof entry.title !== 'string' || !entry.title
            || typeof entry.capturedAt !== 'string' || !Number.isFinite(Date.parse(entry.capturedAt))) return [];
        seen.add(entry.itemId);
        const optional = (key: keyof ThesisCitation, max: number) =>
            typeof entry[key] === 'string' && entry[key] ? { [key]: (entry[key] as string).slice(0, max) } : {};
        return [{ itemId: entry.itemId, title: entry.title.slice(0, 300), capturedAt: entry.capturedAt.slice(0, 100),
            ...optional('source', 200), ...optional('url', 2048), ...optional('sourceId', 300),
            ...optional('symbol', 40), ...optional('asOf', 100) }];
    }).slice(0, MAX_THESIS_CITATIONS);
}

function normalizeThesis(value: unknown): InvestmentThesis {
    const record = isRecord(value) ? value : {};
    const notebookItemIds = normalizeNotebookItemIds(record.notebookItemIds);
    const citations = normalizeCitations(record.citations, notebookItemIds);
    return {
        status: THESIS_STATUSES.includes(record.status as ThesisStatus) ? record.status as ThesisStatus : 'researching',
        thesis: normalizeText(record.thesis),
        catalysts: normalizeText(record.catalysts),
        risks: normalizeText(record.risks),
        invalidation: normalizeText(record.invalidation),
        reviewDate: normalizeReviewDate(record.reviewDate),
        ...(notebookItemIds.length ? { notebookItemIds } : {}),
        ...(citations.length ? { citations } : {}),
    };
}

export function normalizeThesisConfig(config: Record<string, unknown> | undefined): ThesisConfig {
    const notesBySymbol: Record<string, string> = {};
    const thesesBySymbol: Record<string, InvestmentThesis> = {};
    const rawNotes = isRecord(config?.notesBySymbol) ? config.notesBySymbol : {};
    const rawTheses = isRecord(config?.thesesBySymbol) ? config.thesesBySymbol : {};

    for (const [symbol, note] of Object.entries(rawNotes)) {
        if (typeof note === 'string' && normalizeSymbol(symbol)) notesBySymbol[normalizeSymbol(symbol)] = note;
    }
    for (const [symbol, thesis] of Object.entries(rawTheses)) {
        if (normalizeSymbol(symbol)) thesesBySymbol[normalizeSymbol(symbol)] = normalizeThesis(thesis);
    }
    if (typeof config?.notes === 'string' && typeof config?.symbol === 'string' && normalizeSymbol(config.symbol)) {
        const symbol = normalizeSymbol(config.symbol);
        if (!(symbol in notesBySymbol)) notesBySymbol[symbol] = config.notes;
    }

    return { notesBySymbol, thesesBySymbol };
}

export function isThesisComplete(thesis: InvestmentThesis, availableEvidenceIds: ReadonlySet<string>): boolean {
    return Boolean(
        thesis.thesis.trim()
        && thesis.catalysts.trim()
        && thesis.risks.trim()
        && thesis.invalidation.trim()
        && /^\d{4}-\d{2}-\d{2}$/.test(thesis.reviewDate)
        && thesis.notebookItemIds?.some((id) => availableEvidenceIds.has(id))
    );
}

export function isReviewDue(reviewDate: string, today = new Date().toISOString().slice(0, 10)): boolean {
    return Boolean(reviewDate) && reviewDate <= today;
}

export function classifyInvestorEvent(event: CompanyEventData): InvestorEventClass | null {
    const value = [event.action_category, event.action_subtype, event.event_type, event.event_name, event.description]
        .filter((item): item is string => typeof item === 'string')
        .join(' ')
        .toUpperCase();
    if (value.includes('DIVIDEND') || value.includes('CỔ TỨC') || value.includes('CO TUC')) return 'DIVIDEND';
    if (value.includes('RIGHT') || value.includes('QUYỀN MUA') || value.includes('QUYEN MUA')) return 'RIGHTS';
    if (value.includes('SPLIT') || value.includes('CHIA TÁCH') || value.includes('CHIA TACH')) return 'SPLIT';
    if (value.includes('AGM') || value.includes('MEETING') || value.includes('ĐẠI HỘI') || value.includes('DAI HOI')) return 'MEETING';
    return null;
}

function calendarDate(value: string | null | undefined): string | null {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
    return value.slice(0, 10);
}

export function companyEventToInvestorEvent(event: CompanyEventData): InvestorCalendarEvent | null {
    const eventClass = classifyInvestorEvent(event);
    const effectiveDate = calendarDate(event.effective_date) || calendarDate(event.event_date) || calendarDate(event.ex_date) || calendarDate(event.record_date) || calendarDate(event.payment_date);
    const symbol = normalizeSymbol(event.symbol);
    if (!eventClass || !effectiveDate || !symbol) return null;
    return {
        symbol,
        eventClass,
        effectiveDate,
        label: event.event_name || event.action_subtype || event.event_type || eventClass,
        source: 'Company events endpoint',
        provider: 'VNIBB company events',
        detail: event.description || undefined,
    };
}

export function aggregateInvestorEvents(events: InvestorCalendarEvent[], today = new Date().toISOString().slice(0, 10)): InvestorCalendarEvent[] {
    const seen = new Set<string>();
    return events
        .filter((event) => event.effectiveDate >= today)
        .filter((event) => {
            const key = `${normalizeSymbol(event.symbol)}:${event.eventClass}:${event.effectiveDate}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate) || left.symbol.localeCompare(right.symbol) || EVENT_CLASSES.indexOf(left.eventClass) - EVENT_CLASSES.indexOf(right.eventClass));
}

export function boundedSymbols(groups: readonly string[][], max = 10): string[] {
    const seen = new Set<string>();
    for (const group of groups) {
        for (const rawSymbol of group) {
            const symbol = normalizeSymbol(rawSymbol);
            if (!symbol || seen.has(symbol)) continue;
            seen.add(symbol);
            if (seen.size === max) return [...seen];
        }
    }
    return [...seen];
}
