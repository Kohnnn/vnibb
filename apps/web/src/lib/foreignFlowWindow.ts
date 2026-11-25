import type { ForeignTradingMeta } from '@/types/equity';

type FlowRow = { date?: string | null; buy_volume?: number | null; sell_volume?: number | null };

export interface ForeignFlowWindow<T> {
  rows: T[];
  windowed: boolean;
  calendarVerified: boolean;
  observed: number | null;
  nullSessions: number | null;
  gaps: number | null;
  requestedStart: string | null;
  requestedEnd: string | null;
  observedStart: string | null;
  observedEnd: string | null;
  returnedStart: string | null;
  returnedEnd: string | null;
  lastValidated: string | null;
  complete: boolean;
  total: number | null;
}

/** The foreign-trading wire model supplies canonical date-only session labels. */
export function parseForeignSessionDate(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function hasVolumes(row: FlowRow): boolean {
  return typeof row.buy_volume === 'number' && Number.isFinite(row.buy_volume)
    && typeof row.sell_volume === 'number' && Number.isFinite(row.sell_volume);
}

/** Do not treat a legacy row-limited response as an exchange-session window. */
export function qualifyForeignFlowWindow<T extends FlowRow>(
  input: T[] | null | undefined,
  meta: ForeignTradingMeta | null | undefined,
  requestedSessions: number,
): ForeignFlowWindow<T> {
  const rows = input ?? [];
  const start = parseForeignSessionDate(meta?.requested_start_date);
  const end = parseForeignSessionDate(meta?.requested_end_date);
  const windowed = meta?.window_contract === 'sessions-v2'
    && meta.requested_session_count === requestedSessions && !!start && !!end && start <= end;
  const dates = rows.map(row => parseForeignSessionDate(row.date)).filter((day): day is string => day !== null).sort();
  if (!windowed) {
    return {
      rows, windowed: false, calendarVerified: false, observed: null, nullSessions: null, gaps: null,
      requestedStart: null, requestedEnd: null, observedStart: null, observedEnd: null,
      returnedStart: dates[0] ?? null, returnedEnd: dates.at(-1) ?? null,
      lastValidated: null, complete: false, total: null,
    };
  }

  const seen = new Set<string>();
  const admitted = rows.filter(row => {
    const day = parseForeignSessionDate(row.date);
    if (!day || day < start || day > end || seen.has(day)) return false;
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) return false;
    seen.add(day);
    return true;
  });
  const qualified = admitted.filter(hasVolumes);
  const nullSessions = admitted.length - qualified.length;
  const serverGaps = meta.gap_session_count;
  const gaps = typeof serverGaps === 'number' && Number.isInteger(serverGaps) && serverGaps >= 0
    && admitted.length + serverGaps === requestedSessions ? serverGaps : null;
  const complete = meta.calendar_verified === true && meta.coverage_status === 'complete'
    && gaps === 0 && nullSessions === 0 && qualified.length === requestedSessions
    && admitted.length === rows.length && meta.observed_session_count === qualified.length;
  const admittedDates = admitted.map(row => parseForeignSessionDate(row.date)!).sort();
  const qualifiedDates = qualified.map(row => parseForeignSessionDate(row.date)!).sort();
  const lastQualified = qualifiedDates.at(-1) ?? null;
  const lastValidated = meta.calendar_verified === true && lastQualified
    && parseForeignSessionDate(meta.last_validated_session) === lastQualified ? lastQualified : null;
  return {
    rows: admitted, windowed: true, calendarVerified: meta.calendar_verified === true, observed: qualified.length, nullSessions,
    gaps: meta.calendar_verified === true ? gaps : null,
    requestedStart: start, requestedEnd: end, observedStart: qualifiedDates[0] ?? null, observedEnd: lastQualified,
    returnedStart: admittedDates[0] ?? null, returnedEnd: admittedDates.at(-1) ?? null, lastValidated, complete,
    total: complete ? qualified.reduce((sum, row) => sum + row.buy_volume! - row.sell_volume!, 0) : null,
  };
}
