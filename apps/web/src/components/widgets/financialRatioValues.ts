import { convertFinancialValueForUnit, type UnitConfig } from '@/lib/units';
import type { FinancialRatioData } from '@/types/equity';

export const PER_SHARE_METRICS = ['eps', 'bvps', 'dps'] as const;
type PerShareUnit = 'VND/share' | 'USD/share';

export function isPerShareMetric(key: string): key is (typeof PER_SHARE_METRICS)[number] {
    return PER_SHARE_METRICS.some(metric => metric === key);
}

const RATIO_FIELD_ALIASES: Readonly<Partial<Record<string, readonly string[]>>> = {
    pe: ['pe', 'pe_ratio', 'priceToEarning'],
    pb: ['pb', 'pb_ratio', 'priceToBook'],
    ps: ['ps', 'ps_ratio', 'priceToSales'],
    ev_ebitda: ['ev_ebitda', 'evToEbitda'],
    ev_sales: ['ev_sales', 'evToSales'],
};

const ZERO_PLACEHOLDER_MULTIPLES: ReadonlySet<string> = new Set([
    'pe', 'pb', 'ps', 'peg_ratio', 'ev_sales', 'ev_ebitda', 'pfcf', 'p_fcf', 'price_to_fcf',
]);
const ALWAYS_EXPORTED_PERCENT_FIELDS = ['payout_ratio', 'dividend_yield'] as const;

type SourceRatioRow = Readonly<FinancialRatioData> & { readonly period: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRatioMetric(entry: SourceRatioRow, metric: string): number | null {
    const fields: Readonly<Record<string, unknown>> = entry;
    const { unit_metadata: metadata, unavailable_reason: unavailableReason } = fields;
    const metricMetadata = isRecord(metadata) ? metadata[metric] : undefined;
    if (unavailableReason || (isRecord(metricMetadata) && metricMetadata.unavailable_reason)) return null;
    const sourceUnit = entry.ratio_units?.[metric];
    if (isPerShareMetric(metric)) {
        const value = entry[metric];
        return sourceUnit === 'VND/share' && typeof value === 'number' && Number.isFinite(value) ? value : null;
    }
    if (ALWAYS_EXPORTED_PERCENT_FIELDS.some(field => field === metric) && sourceUnit !== 'percent') return null;

    for (const key of RATIO_FIELD_ALIASES[metric] ?? [metric]) {
        const value = fields[key];
        if (value === null || value === undefined || value === '') continue;
        const numeric = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(numeric)) continue;
        if (numeric === 0 && ZERO_PLACEHOLDER_MULTIPLES.has(metric)) continue;
        return numeric;
    }
    return null;
}

export function projectFinancialRatios(ratios: readonly SourceRatioRow[], config: UnitConfig) {
    const perShareUnit: PerShareUnit = config.display === 'USD' ? 'USD/share' : 'VND/share';
    const readValue = (entry: SourceRatioRow | undefined, metric: string) => {
        if (!entry) return null;
        const value = readRatioMetric(entry, metric);
        return isPerShareMetric(metric) ? convertFinancialValueForUnit(value, config, entry.period) : value;
    };

    let hasPerShareObservations = false;
    const exportData = ratios.map(entry => {
        const fields: Readonly<Record<string, unknown>> = entry;
        const exportKeys = new Set([
            ...Object.keys(fields).filter(key => typeof fields[key] === 'number' || isPerShareMetric(key)),
            ...ALWAYS_EXPORTED_PERCENT_FIELDS,
        ]);
        const row: Record<string, string | number | null> = { period: entry.period };
        for (const key of exportKeys) {
            const value = readValue(entry, key);
            row[key] = value;
            if (isPerShareMetric(key)) {
                row[`${key}_unit`] = value === null ? null : perShareUnit;
                if (value !== null) hasPerShareObservations = true;
            }
        }
        return row;
    });
    const units = hasPerShareObservations ? `EPS/BVPS/DPS: ${perShareUnit}; P/E: dimensionless` : undefined;
    return { readValue, exportData, perShareUnit, units };
}

// Match the API's existing 20-key limit after reserving one key for period.
const AGENT_RATIO_VALUES_PER_ROW = 19;
const AGENT_RATIO_PRIORITY: ReadonlySet<string> = new Set(['pe', ...PER_SHARE_METRICS]);

/** Sample the admitted export rows, not raw provider values. Units travel once in dataProvenance. */
export function projectFinancialRatioAgentSample(exportRows: readonly unknown[]) {
    const dataSample: Readonly<Record<string, string | number>>[] = [];
    const omissions: [string, { readonly count: number; readonly fields: string }][] = [];
    for (const row of exportRows) {
        if (!isRecord(row) || typeof row.period !== 'string') continue;
        const observations = Object.entries(row).filter(
            (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
        );
        // Preserve producer order and reserve space only for priority observations that are present.
        const regular = observations.filter(([key]) => !AGENT_RATIO_PRIORITY.has(key));
        const priorityCount = observations.length - regular.length;
        const omitted = regular.slice(AGENT_RATIO_VALUES_PER_ROW - priorityCount).map(([key]) => key);
        const omittedFields = new Set(omitted);
        const included = observations.filter(([key]) => !omittedFields.has(key));
        dataSample.push({ period: row.period, ...Object.fromEntries(included) });
        if (omitted.length) {
            // Send field names and a count, not overflow observations; keep the note scalar at the sanitizer's depth limit.
            omissions.push([row.period, { count: omitted.length, fields: omitted.join(', ') }]);
        }
    }
    return { dataSample, dataSampleOmissions: omissions.length ? Object.fromEntries(omissions) : undefined };
}
