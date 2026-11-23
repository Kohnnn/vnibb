import type { EquityHistoricalData, EquityHistoricalResponse } from '@/types/equity';

const DISPLAY_LIMIT = 10;
const DAY_MS = 86_400_000;
type HistoryMeta = EquityHistoricalResponse['meta'];
type HistoricalCoverage = {
    calendarVerified: boolean | null;
    expectedDates: string[] | null;
    missingSessionCount: number | null;
    unresolvedExcludedDates: string[] | null;
    unresolvedSessionCount: number | null;
    replacedExcludedDates: string[] | null;
};

export type VolumeBar = {
    date: string | null;
    volume: number | null;
    closeChange: number | null;
};

export const VOLUME_SAMPLE_BASIS = 'Mean of all valid returned volumes. Includes the latest returned bar when observed. Comparison needs at least two observations and a positive mean.';
export const VOLUME_UNCERTIFIED = 'Volume analysis unavailable: historical price units were not certified.';

export function volumeHistoryWindow(now: number) {
    return {
        startDate: new Date(now - 30 * DAY_MS).toISOString().slice(0, 10),
        endDate: new Date(now).toISOString().slice(0, 10),
    };
}

function isSessionDate(value: unknown): value is string {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        && new Date(value).toJSON()?.slice(0, 10) === value;
}

function readSessionDates(value: unknown): string[] | null {
    return Array.isArray(value) && value.every((day, index) => isSessionDate(day) && (index === 0 || day > value[index - 1]))
        ? value : null;
}

function observedCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readHistoricalCoverage(meta: HistoryMeta): HistoricalCoverage {
    // Older historical responses need not supply #281's session evidence.
    const verified = meta && 'calendar_verified' in meta ? meta.calendar_verified : null;
    const calendarVerified = typeof verified === 'boolean' ? verified : null;
    const expectedDates = calendarVerified && meta && 'expected_session_dates' in meta
        ? readSessionDates(meta.expected_session_dates) : null;
    const missingSessionCount = calendarVerified && meta && 'missing_session_count' in meta
        ? observedCount(meta.missing_session_count) : null;
    const unresolvedExcludedDates = meta && 'unresolved_excluded_dates' in meta
        ? readSessionDates(meta.unresolved_excluded_dates) : null;
    const unresolvedCount = meta && 'unresolved_session_count' in meta
        ? observedCount(meta.unresolved_session_count) : null;
    const replacedExcludedDates = meta && 'replaced_excluded_dates' in meta
        ? readSessionDates(meta.replaced_excluded_dates) : null;
    return {
        calendarVerified, expectedDates, missingSessionCount, unresolvedExcludedDates,
        unresolvedSessionCount: unresolvedCount ?? unresolvedExcludedDates?.length ?? null,
        replacedExcludedDates,
    };
}

function readSourceDate(meta: HistoryMeta, returnedEnd: string | null, endDate: string) {
    return [meta?.freshness_as_of, meta?.last_data_date, returnedEnd].find(value => {
        if (typeof value !== 'string') return false;
        const day = value.slice(0, 10);
        return isSessionDate(day) && day <= endDate && Number.isFinite(Date.parse(value));
    }) ?? null;
}

function getCloseChange(
    current: EquityHistoricalData, previous: EquityHistoricalData | undefined,
    coverage: HistoricalCoverage,
): number | null {
    if (!previous || !Number.isFinite(previous.close) || previous.close <= 0
        || !Number.isFinite(current.close) || current.close <= 0) return null;
    if (!isSessionDate(previous.time) || !isSessionDate(current.time) || previous.time >= current.time) return null;
    if (coverage.unresolvedExcludedDates?.some(day => previous.time < day && day < current.time)) return null;
    if (coverage.expectedDates) {
        const index = coverage.expectedDates.indexOf(previous.time);
        if (index < 0 || coverage.expectedDates[index + 1] !== current.time) return null;
    }
    return current.close - previous.close;
}

function summarizeVolumes(bars: VolumeBar[]) {
    let observationCount = 0;
    let observedStart: string | null = null;
    let observedEnd: string | null = null;
    let sum = 0;
    let maxVolume = 1;
    const observedDates = new Set<string>();
    for (const { date, volume } of bars) {
        if (volume !== null && date !== null) observedDates.add(date);
        if (volume === null) continue;
        if (observationCount === 0) observedStart = date;
        observedEnd = date;
        observationCount += 1;
        sum += volume;
        maxVolume = Math.max(maxVolume, volume);
    }
    const avgVolume = observationCount > 0 ? sum / observationCount : null;
    return { observationCount, observedStart, observedEnd, avgVolume, maxVolume, observedDates };
}

export function analyzeVolume(response: EquityHistoricalResponse | undefined, startDate: string, endDate: string) {
    const returned = response?.data ?? [];
    const meta = response?.meta;
    const expectedUnit = meta?.unit_status === 'confirmed_vnd' ? 'VND' : 'index_points';
    const unitsWithheld = returned.length > 0 && (
        !['confirmed_vnd', 'index_points', 'not_applicable'].includes(meta?.unit_status ?? '')
        || !returned.every(row => row.price_unit === expectedUnit)
    );
    const historicalCoverage = readHistoricalCoverage(meta);
    const bars = unitsWithheld ? [] : returned.map((row, index) => ({
        date: isSessionDate(row.time) ? row.time : null,
        volume: observedCount(row.volume),
        closeChange: getCloseChange(row, returned[index - 1], historicalCoverage),
    }));
    const observed = summarizeVolumes(bars);
    const { avgVolume, maxVolume, observedStart, observedEnd } = observed;
    const latestVolume = bars.at(-1)?.volume ?? null;
    const volumeChangePct = latestVolume !== null && observed.observationCount >= 2 && avgVolume !== null && avgVolume > 0
        ? (latestVolume - avgVolume) / avgVolume * 100 : null;
    const recent = bars.slice(-DISPLAY_LIMIT);
    const returnedStart = isSessionDate(returned[0]?.time) ? returned[0].time : null;
    const lastReturnedDate = returned.at(-1)?.time;
    const returnedEnd = isSessionDate(lastReturnedDate) ? lastReturnedDate : null;
    const sourceAsOf = readSourceDate(meta, returnedEnd, endDate);
    const sourceAgeDays = sourceAsOf ? (Date.parse(endDate) - Date.parse(sourceAsOf.slice(0, 10))) / DAY_MS : null;
    const observationCount = response && !unitsWithheld ? observed.observationCount : null;
    const excludedVolumeCount = observationCount === null ? null : bars.length - observationCount;
    const { calendarVerified, expectedDates, missingSessionCount, unresolvedSessionCount, unresolvedExcludedDates,
        replacedExcludedDates } = historicalCoverage;
    const hasKnownOmissions = (excludedVolumeCount ?? 0) > 0 || (missingSessionCount ?? 0) > 0
        || (unresolvedSessionCount ?? 0) > 0;
    const complete = expectedDates !== null && observationCount === expectedDates.length
        && expectedDates.every(day => observed.observedDates.has(day))
        && missingSessionCount === 0 && unresolvedSessionCount === 0;
    const coverage = hasKnownOmissions ? 'partial' : complete ? 'complete' : 'unknown';
    return {
        unitsWithheld, recent, sourceAsOf, coverage, maxVolume,
        coverageDetail: {
            requestedStart: startDate, requestedEnd: endDate, requestedSessions: expectedDates?.length ?? null,
            observedStart, observedEnd,
            observedSessions: observed.observedDates.size === observationCount ? observationCount : null,
            gapSessions: missingSessionCount, calendarVerified,
        },
        summary: {
            avgVolume, observationCount, excludedVolumeCount, latestVolume, volumeChangePct,
            returnedCount: response ? returned.length : null, returnedStart, returnedEnd, displayedCount: recent.length,
            expectedSessionCount: expectedDates?.length ?? null, missingSessionCount, unresolvedSessionCount,
            unresolvedExcludedDates, replacedExcludedDates,
            replacedExclusionCount: replacedExcludedDates?.length ?? null,
            sourceAgeDays,
        },
    } as const;
}
