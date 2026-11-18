import { getMarketState } from '@/lib/marketHours';
import type { ExportProvenance } from '@/lib/widgetProvenance';
import type { ForeignTradingResponse } from '@/types/equity';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const FOREIGN_FLOW_STALE_MS = 12 * 60 * 60 * 1000;
const LEGACY_REQUEST_FAILURE = /^(?:request timed out|live foreign trading feed (?:timed out|unavailable))\b/i;
const RETAINED_SNAPSHOT = /\busing cached database fallback\b/i;

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
}

export function describeForeignFlow(input: ForeignFlowObservation): Pick<ExportProvenance,
  'updatedAt' | 'fetchedAt' | 'coverage' | 'coverageDetail' | 'warnings' | 'cached' | 'stale' |
  'marketClosed' | 'expectedClosedSession' | 'observationStatus' | 'refreshStatus'
> {
  const { response, fetchedAt } = input;
  const meta = response?.meta;
  const hasRows = Boolean(response?.data.length);
  const warnings = [...new Set(meta?.warnings ?? [])];
  const envelope = response?.error;
  if (envelope && !warnings.includes(envelope) && envelope !== warnings.join('; ')) warnings.unshift(envelope);

  const refreshFailed = input.requestFailed || warnings.some(warning =>
    RETAINED_SNAPSHOT.test(warning) || LEGACY_REQUEST_FAILURE.test(warning),
  );
  const now = Date.now();
  const market = getMarketState(new Date(now));
  const updatedAt = hasRows ? meta?.last_data_date ?? null : null;
  const settledAt = parseForeignTradingSnapshotTime(updatedAt)?.getTime();
  const requestedEnd = meta?.requested_end_date;
  const lastValidated = meta?.last_validated_session;
  const verifiedWindow = meta?.window_contract === 'sessions' && meta.calendar_verified === true;
  const missedSession = Boolean(hasRows && verifiedWindow && requestedEnd && lastValidated && lastValidated < requestedEnd);
  const expectedClosedSession = !market.isOpen && Boolean(
    verifiedWindow && requestedEnd && lastValidated === requestedEnd && updatedAt === lastValidated
    && response?.data.some(row => row.date === lastValidated)
    && settledAt !== undefined && settledAt <= now,
  );
  const stale = missedSession || (!expectedClosedSession && settledAt !== undefined && now - settledAt >= FOREIGN_FLOW_STALE_MS);
  const coverage = meta?.coverage_status === 'complete' ? 'complete'
    : meta?.coverage_status === 'partial' || meta?.coverage_status === 'unavailable' ? 'partial' : 'unknown';

  return {
    updatedAt,
    fetchedAt: fetchedAt || null,
    coverage,
    coverageDetail: {
      requestedStart: meta?.requested_start_date,
      requestedEnd,
      observedStart: meta?.observed_start_date,
      observedEnd: meta?.observed_end_date,
      requestedSessions: meta?.requested_session_count ?? input.requestedSessions,
      observedSessions: meta?.observed_session_count,
      gapSessions: meta?.gap_session_count,
      lastValidatedSession: lastValidated,
      calendarVerified: meta?.calendar_verified,
    },
    marketClosed: !market.isOpen,
    expectedClosedSession,
    cached: hasRows && refreshFailed,
    stale,
    warnings,
    observationStatus: hasRows ? 'available' : input.isLoading ? 'loading' : refreshFailed ? 'unavailable' : 'empty',
    refreshStatus: input.isFetching ? 'refreshing' : refreshFailed ? 'failed' : response ? 'succeeded' : undefined,
  };
}
