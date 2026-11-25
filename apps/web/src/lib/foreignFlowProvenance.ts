import type { ExportProvenance } from '@/lib/widgetProvenance';
import type { ForeignTradingData, ForeignTradingMeta, ForeignTradingResponse } from '@/types/equity';
import { parseForeignSessionDate, qualifyForeignFlowWindow, type ForeignFlowWindow } from '@/lib/foreignFlowWindow';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const FOREIGN_FLOW_STALE_MS = 12 * 60 * 60 * 1000;
const LEGACY_REQUEST_FAILURE = /^(?:request timed out|live foreign trading feed (?:timed out|unavailable))\b/i;
const RETAINED_SNAPSHOT = /\busing cached database fallback\b/i;

export function foreignFlowWarnings(response: ForeignTradingResponse | undefined, windowed: boolean): string[] {
  const raw = [...new Set(response?.meta?.warnings ?? [])];
  if (response?.error && !raw.includes(response.error) && response.error !== raw.join('; ')) {
    raw.unshift(response.error);
  }
  return windowed ? raw : raw.map(warning => `Retained packet: ${warning}`);
}

export function foreignFlowRefreshFailed(requestFailed: boolean, warnings: string[]): boolean {
  return requestFailed || warnings.some(warning => RETAINED_SNAPSHOT.test(warning)
    || LEGACY_REQUEST_FAILURE.test(warning.replace(/^Retained packet: /, '')));
}

export function parseForeignTradingSnapshotTime(value: string | null | undefined): Date | null {
  const text = value?.trim();
  if (!text) return null;
  const parsed = new Date(DATE_ONLY.test(text) ? `${text}T17:00:00+07:00` : text);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

interface ForeignFlowObservation {
  readonly response?: ForeignTradingResponse;
  readonly requestFailed: boolean;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly fetchedAt: number;
  readonly requestedSessions: number;
  readonly window?: ForeignFlowWindow<ForeignTradingData>;
}

function parseClosureTime(value: string): number {
  return typeof value === 'string' && TIMESTAMP_WITH_ZONE.test(value) ? Date.parse(value) : NaN;
}

function activeClosure(proof: ForeignTradingMeta['latest_closed_session'], now: number) {
  if (!proof || typeof proof.date !== 'string' || !DATE_ONLY.test(proof.date)) return null;
  const day = new Date(proof.date);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== proof.date) return null;
  const checkedAt = parseClosureTime(proof.checked_at);
  const expiresAt = parseClosureTime(proof.valid_until);
  return day.getTime() <= checkedAt && checkedAt <= now && now < expiresAt
    ? { session: proof.date, expiresAt }
    : null;
}

type ForeignFlowProvenance = Pick<ExportProvenance,
  'updatedAt' | 'fetchedAt' | 'coverage' | 'coverageDetail' | 'warnings' | 'cached' | 'stale' |
  'marketClosed' | 'expectedClosedSession' | 'observationStatus' | 'refreshStatus'
> & { closureExpiresAt?: number };

export function describeForeignFlow(input: ForeignFlowObservation, now = Date.now()): ForeignFlowProvenance {
  const { response, fetchedAt } = input;
  const meta = response?.meta;
  const window = input.window ?? qualifyForeignFlowWindow(response?.data, meta, input.requestedSessions);
  const hasRows = window.rows.length > 0;
  const warnings = foreignFlowWarnings(response, window.windowed);
  const refreshFailed = foreignFlowRefreshFailed(input.requestFailed, warnings);
  const verifiedWindow = window.windowed && window.calendarVerified;
  const closure = verifiedWindow ? activeClosure(meta?.latest_closed_session, now) : null;
  const sourceDate = parseForeignSessionDate(meta?.last_data_date);
  const updatedAt = verifiedWindow && sourceDate && sourceDate === window.lastValidated ? sourceDate : null;
  const settledAt = parseForeignTradingSnapshotTime(updatedAt)?.getTime();
  const requestedEnd = window.requestedEnd;
  const lastValidated = window.lastValidated;
  const missedSession = Boolean(hasRows && lastValidated && (
    (verifiedWindow && requestedEnd && lastValidated < requestedEnd)
    || (closure && lastValidated < closure.session)
  ));
  const expectedClosedSession = Boolean(
    closure && lastValidated === closure.session && updatedAt === closure.session
    && window.rows.some(row => parseForeignSessionDate(row.date) === closure.session),
  );
  const stale = missedSession || (!expectedClosedSession && settledAt !== undefined && now - settledAt >= FOREIGN_FLOW_STALE_MS);
  const coverage = window.complete ? 'complete' : window.windowed || hasRows ? 'partial' : 'unknown';

  return {
    updatedAt,
    fetchedAt: fetchedAt || null,
    coverage,
    coverageDetail: {
      requestedStart: window.requestedStart,
      requestedEnd,
      observedStart: window.observedStart,
      observedEnd: window.observedEnd,
      returnedStart: window.returnedStart,
      returnedEnd: window.returnedEnd,
      requestedSessions: input.requestedSessions,
      observedSessions: window.observed,
      gapSessions: window.gaps,
      nullSessions: window.nullSessions,
      lastValidatedSession: lastValidated,
      calendarVerified: window.windowed ? window.calendarVerified : null,
    },
    marketClosed: closure ? true : undefined,
    expectedClosedSession,
    closureExpiresAt: closure?.expiresAt,
    cached: hasRows && refreshFailed,
    stale,
    warnings,
    observationStatus: hasRows ? 'available' : input.isLoading ? 'loading' : refreshFailed ? 'unavailable' : 'empty',
    refreshStatus: input.isFetching ? 'refreshing' : refreshFailed ? 'failed' : response ? 'succeeded' : undefined,
  };
}
