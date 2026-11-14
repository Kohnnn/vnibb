/**
 * Period and basis checks shared by the earnings widgets.
 *
 * Two statement rows can both be individually valid and still not form a
 * comparison: the earlier row may be a different quarter, a different
 * reporting basis, or an explicitly withheld field. Deciding that here keeps
 * the Recap, Quality and Growth widgets on one rule instead of each
 * re-deriving it (issues #246/#257/#258).
 */

export interface StatementLike {
    period?: string | null;
    raw_data?: Record<string, unknown> | null;
    unit_metadata?: Record<string, unknown> | null;
    currency?: string | null;
    value_unit?: string | null;
    consolidation_basis?: string | null;
    flow_basis?: string | null;
    source?: string | null;
    unavailable_reason?: string | null;
}

const QUARTER_PERIOD = /(20\d{2})\s*[-_/ ]?\s*Q([1-4])|Q([1-4])\s*[-_/ ]?\s*(20\d{2})/i;

/** `2025-Q2` for any spelling of that fiscal quarter, else null. */
export function quarterKey(period: string | null | undefined): string | null {
    const text = String(period ?? '').trim().toUpperCase();
    if (!text) return null;
    const match = text.match(QUARTER_PERIOD);
    if (!match) return null;
    const year = match[1] ?? match[4];
    const quarter = match[2] ?? match[3];
    return year && quarter ? `${year}-Q${quarter}` : null;
}

/** The same quarter one fiscal year earlier, or null when not a quarter. */
export function priorYearQuarterKey(key: string | null): string | null {
    const match = key?.match(/^(20\d{2})-Q([1-4])$/);
    return match ? `${Number(match[1]) - 1}-Q${match[2]}` : null;
}

/** The single row for an exact fiscal quarter, or null. No fallback. */
export function rowForQuarter<T extends StatementLike>(rows: T[] | null | undefined, key: string | null): T | null {
    if (!key) return null;
    return (rows ?? []).find((row) => quarterKey(row.period) === key) ?? null;
}

/** The field-level rejection recorded for a metric, in any evidence location. */
export function withheldFieldReason(row: StatementLike | null | undefined, field: string): string | null {
    if (!row) return null;
    const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
    const lineageSource = (raw as Record<string, unknown>)._financial_lineage;
    const lineage = lineageSource && typeof lineageSource === 'object'
        ? (lineageSource as Record<string, unknown>)
        : {};
    const canonicalSource = lineage.canonical_data;
    const canonical = canonicalSource && typeof canonicalSource === 'object'
        ? (canonicalSource as Record<string, unknown>)
        : {};
    for (const source of [row.unit_metadata, canonical.unit_metadata, lineage.unit_metadata]) {
        if (!source || typeof source !== 'object') continue;
        const metadata = (source as Record<string, unknown>)[field];
        if (metadata && typeof metadata === 'object') {
            const reason = (metadata as Record<string, unknown>).unavailable_reason;
            if (typeof reason === 'string' && reason.trim()) return reason;
        }
    }
    return null;
}

const COMPARABLE_BASIS = ['currency', 'value_unit', 'consolidation_basis', 'flow_basis'] as const;

/**
 * Why two rows may not be compared, or null when they may.
 *
 * A missing or `unknown` declaration on either side is not agreement: two
 * unknowns are not evidence of a shared basis.
 */
export function incomparableReason(
    current: StatementLike | null | undefined,
    previous: StatementLike | null | undefined,
): string | null {
    if (!current || !previous) return 'missing comparison period';
    if (current.unavailable_reason) return `current period unavailable (${current.unavailable_reason})`;
    if (previous.unavailable_reason) return `comparison period unavailable (${previous.unavailable_reason})`;
    for (const key of COMPARABLE_BASIS) {
        const left = current[key];
        const right = previous[key];
        if (left == null || right == null || left === 'unknown' || right === 'unknown') {
            return `reporting basis not confirmed (${key.replace(/_/g, ' ')})`;
        }
        if (left !== right) return `reporting basis differs (${key.replace(/_/g, ' ')})`;
    }
    if (current.source && previous.source && current.source !== previous.source) {
        return `source differs (${current.source} vs ${previous.source})`;
    }
    return null;
}
