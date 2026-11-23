import type { DividendCoverage, DividendDiscrepancy, DividendRecord, DividendsResponse } from '@/lib/api';
import { resolveDividendActionDay } from '@/lib/dividendLadder';

const EMPTY_DIVIDENDS: readonly DividendRecord[] = [];
export const dividendAggregateNote = 'Annual DPS and yield unavailable: no certified payout window or dated price basis. Yield requires cash DPS for a defined window divided by its reference share price.';
export const RAW_DIVIDEND_SCOPE = 'unreconciled_observations';
export const RAW_DIVIDEND_NOTE = 'Dividend events are unreconciled observations, not confirmed payouts or complete dividend history.';

const DATE_LABELS = {
    ex_date: 'ex date',
    record_date: 'record date',
    payment_date: 'payment date',
    event_date: 'event date',
    publication_date: 'publication date',
} as const;

const DISCREPANCY_LABELS: Record<string, string> = {
    ambiguous_event_identity: 'overlap without a shared event identity',
    cancelled_event: 'event cancelled',
    conflicting_date_basis: 'conflicting or unverified date basis',
    conflicting_observations: 'conflicting retained observations',
    issuer_mismatch: 'issuer does not match',
    missing_action_date: 'no typed action date',
    unsupported_cash_basis: 'cash amount, currency or per-share basis not established',
    unsupported_distribution_type: 'distribution type not established',
    unsupported_stock_basis: 'stock percentage not established',
    unverified_event: 'event not verified',
    unverified_event_identity: 'event identity not verified',
    unverified_fiscal_entitlement: 'fiscal entitlement not verified',
    unverified_revision: 'revision not verified',
    unverified_status: 'event status not verified',
};

export function dividendDiscrepancyText(item: DividendDiscrepancy): string {
    const day = item.observed_date && item.observed_date_type
        ? `Reported ${DATE_LABELS[item.observed_date_type]} ${item.observed_date}: `
        : '';
    const dataset = item.dataset === 'company_events' ? 'Calendar' : 'Dividend record';
    const kind = item.distribution_type ? ` ${item.distribution_type}` : '';
    const year = item.fiscal_year ? ` (FY ${item.fiscal_year})` : '';
    return `${day}${dataset}${kind}${year} — ${DISCREPANCY_LABELS[item.code] ?? 'not reconciled'}.`;
}

export function readDividendCoverage(response: DividendsResponse | undefined) {
    const supplied = response?.meta?.coverage;
    // Do not attach a pre-contract (possibly cached) response to a qualified history.
    return supplied?.scope === 'retained_observations' && supplied.payout_window_certified === false
        && Array.isArray(supplied.discrepancies) ? supplied : null;
}

export function admittedDividendRows(response: DividendsResponse | undefined): readonly DividendRecord[] {
    return readDividendCoverage(response)?.status === 'partial' ? response?.data ?? EMPTY_DIVIDENDS : EMPTY_DIVIDENDS;
}

export function dividendCoverageText(coverage: DividendCoverage | null): string {
    if (!coverage) return 'Dividend coverage unavailable: no qualified history was delivered.';
    if (coverage.status === 'unavailable') return 'Dividend coverage unavailable: no admissible observations.';
    const date = coverage.latest_covered_date;
    const role = coverage.latest_covered_date_type;
    return date && role
        ? `Partial dividend coverage. Latest covered ${DATE_LABELS[role]}: ${date}.`
        : 'Partial dividend coverage. Latest covered action date unknown.';
}

export function dividendCoverageBasis(coverage: DividendCoverage | null): string {
    const count = coverage?.discrepancy_count ?? 0;
    const first = coverage?.discrepancies[0];
    return [
        dividendCoverageText(coverage),
        count > 0 && `${count} ${count === 1 ? 'discrepancy' : 'discrepancies'}.`,
        first && dividendDiscrepancyText(first),
        dividendAggregateNote,
    ].filter(Boolean).join(' ');
}

export function dividendRowLabel(row: DividendRecord): string {
    const type = (row.dividend_type || row.type)?.toLowerCase();
    const kind = type === 'cash' ? 'Cash' : type === 'stock' ? 'Stock' : type === 'mixed' ? 'Mixed' : 'Dividend';
    const status = row.observation_basis === 'retained_dividend_record'
        ? 'Retained record'
        : row.status && row.status !== 'observed'
            ? `Verified event: ${row.status}`
            : 'Retained observation';
    return [kind, row.fiscal_year && `FY ${row.fiscal_year}`, status, row.source].filter(Boolean).join(' · ');
}

export function dividendActionText(row: DividendRecord): string[] {
    const ex = resolveDividendActionDay(row.ex_date);
    const record = resolveDividendActionDay(row.record_date);
    const pay = resolveDividendActionDay(row.payment_date);
    return [...(ex ? [`Ex ${ex}`] : []), ...(record ? [`Record ${record}`] : []), ...(pay ? [`Pay ${pay}`] : [])];
}

export function dividendSourceLink(row: DividendRecord): string | undefined {
    if (!row.source || !row.source_url) return undefined;
    try {
        const url = new URL(row.source_url);
        if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return row.source_url;
    } catch {
        // A retained record without a usable URL is not a linkable notice.
    }
    return undefined;
}

/** Explicit projection: no legacy annual/price fields or inferred dates in any export. */
export function dividendDistributionExport(row: DividendRecord) {
    return {
        type: row.dividend_type || row.type,
        fiscal_year: row.fiscal_year,
        status: row.status,
        observation_basis: row.observation_basis,
        dataset: row.dataset,
        observation_id: row.observation_id,
        ex_date: row.ex_date,
        record_date: row.record_date,
        payment_date: row.payment_date,
        cash_dividend: row.cash_dividend,
        cash_unit: row.cash_unit,
        currency: row.currency,
        stock_dividend: row.stock_dividend,
        stock_unit: row.stock_unit,
        source: row.source,
        source_event_id: row.source_event_id,
        revision: row.revision,
        source_url: dividendSourceLink(row),
        published_at: row.published_at,
        event_date: row.event_date,
        issue_year: row.issue_year,
        symbol: row.symbol,
    };
}

export function dividendExport(coverage: DividendCoverage | null, rows: readonly unknown[]) {
    return {
        dividend_coverage: coverage ?? { status: 'unavailable', payout_window_certified: false },
        dividend_basis: dividendCoverageBasis(coverage),
        dividends: rows,
    };
}
