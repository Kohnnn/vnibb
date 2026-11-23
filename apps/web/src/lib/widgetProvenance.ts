import { deriveWidgetHealth } from '@/lib/widgetHealth';
import type { IntradayProvenance } from '@/types/intraday';

export type WidgetObservationStatus = 'loading' | 'available' | 'empty' | 'unsupported' | 'unavailable';
export type WidgetRefreshStatus = 'refreshing' | 'failed' | 'succeeded';
export type WidgetPeriodScope = 'shared' | 'local' | 'default';

export type WidgetCoverageDetail = {
  readonly requestedStart?: string | null;
  readonly requestedEnd?: string | null;
  readonly observedStart?: string | null;
  readonly observedEnd?: string | null;
  readonly requestedSessions?: number | null;
  readonly observedSessions?: number | null;
  readonly gapSessions?: number | null;
  readonly lastValidatedSession?: string | null;
  readonly calendarVerified?: boolean | null;
};

export interface ExportProvenance {
  widgetType?: string;
  widgetTitle?: string;
  symbol?: string;
  sourceLabel?: string;
  apiGroup?: string;
  endpoint?: string;
  /** A route name, not the complete request or the lineage of the displayed data. */
  endpointKind?: 'route_summary';
  cached?: boolean;
  stale?: boolean;
  warnings?: string[];
  /** Source observation/as-of only; retrieval belongs in fetchedAt. */
  updatedAt?: number | string | Date | null;
  fetchedAt?: number | string | Date | null;
  coverage?: 'complete' | 'partial' | 'unknown';
  coverageDetail?: WidgetCoverageDetail;
  marketClosed?: boolean;
  /** True only when the admitted observation is the expected closed session. */
  expectedClosedSession?: boolean;
  observationStatus?: WidgetObservationStatus;
  refreshStatus?: WidgetRefreshStatus;
  intraday?: IntradayProvenance;
  adjustmentMode?: string;
  /** Effective reporting period; separate from request scope and source time. */
  period?: string;
  periodScope?: WidgetPeriodScope;
  units?: string;
  basis?: string;
  localOnly?: boolean;
  capturedAt?: string;
  appVersion?: string;
}

function normalizeTimestamp(value?: number | string | Date | null): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function buildExportProvenance(input: ExportProvenance): ExportProvenance {
  const observation = typeof input.updatedAt === 'string' ? input.updatedAt.trim() : input.updatedAt;
  const timestamp = normalizeTimestamp(observation);
  // ISO session dates carry no source time. Round-trip the date so impossible days are not exported.
  const sourceDate = typeof observation === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(observation);
  const updatedAt = sourceDate ? (timestamp?.slice(0, 10) === observation ? observation : null) : timestamp;
  return {
    ...input,
    updatedAt,
    fetchedAt: normalizeTimestamp(input.fetchedAt),
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  };
}

function provenanceEntries(input: ExportProvenance) {
  const resolved = buildExportProvenance(input);
  const rows: readonly [string, string, string | number | boolean | null | undefined][] = [
    ['widget', 'Widget', resolved.widgetTitle || resolved.widgetType],
    ['symbol', 'Symbol', resolved.symbol],
    ['period', 'Period', resolved.period],
    ['period_scope', 'Period scope', resolved.periodScope],
    ['source', 'Source', resolved.sourceLabel],
    ['api_group', 'API group', resolved.apiGroup],
    resolved.endpointKind === 'route_summary'
      ? ['route_summary', 'Route summary', resolved.endpoint]
      : ['endpoint', 'Endpoint', resolved.endpoint],
    ['source_as_of', 'Source as of', resolved.updatedAt == null ? 'unknown' : String(resolved.updatedAt)],
    ['fetched_at', 'Fetched at', resolved.fetchedAt == null ? null : String(resolved.fetchedAt)],
    ['units', 'Units', resolved.units],
    ['basis', 'Basis', resolved.basis],
    ['coverage', 'Coverage', resolved.coverage],
    ['requested_start', 'Requested start', resolved.coverageDetail?.requestedStart],
    ['requested_end', 'Requested end', resolved.coverageDetail?.requestedEnd],
    ['observed_start', 'Observed start', resolved.coverageDetail?.observedStart],
    ['observed_end', 'Observed end', resolved.coverageDetail?.observedEnd],
    ['requested_sessions', 'Requested sessions', resolved.coverageDetail?.requestedSessions],
    ['observed_sessions', 'Observed sessions', resolved.coverageDetail?.observedSessions],
    ['gap_sessions', 'Missing sessions', resolved.coverageDetail?.gapSessions],
    ['last_validated_session', 'Last validated session', resolved.coverageDetail?.lastValidatedSession],
    ['calendar_verified', 'Calendar verified', resolved.coverageDetail?.calendarVerified],
    ['cached', 'Delivery', resolved.cached],
    ['stale', 'Stale', resolved.stale],
    ['market_closed', 'Market closed', resolved.marketClosed],
    ['expected_closed_session', 'Expected closed session', resolved.expectedClosedSession],
    ['market_session', 'Market session', resolved.intraday?.sessionState],
    ['session_basis', 'Session evidence', resolved.intraday?.sessionEvidence?.basis],
    ['session_checked_at', 'Session checked at', resolved.intraday?.sessionEvidence?.checked_at],
    ['session_valid_until', 'Session evidence expires', resolved.intraday?.sessionEvidence?.valid_until],
    ['feed_status', 'Feed result', resolved.intraday?.feedStatus],
    ['requested_source', 'Requested feed', resolved.intraday?.requestedSource],
    ['feed_delivery', 'Feed delivery', resolved.intraday?.delivery],
    ['retained_fallback', 'Retained fallback', resolved.intraday?.fallback],
    ['snapshot_at', 'Snapshot stored at', resolved.intraday?.snapshotAt],
    ['covered_session', 'Covered session', resolved.intraday?.coveredWindow?.session_date],
    ['covered_trade_count', 'Trades in covered session', resolved.intraday?.coveredWindow?.trade_count],
    ['covered_session_basis', 'Coverage evidence', resolved.intraday?.coveredWindow?.basis],
    ['observation_status', 'Observations', resolved.observationStatus],
    ['refresh_status', 'Refresh', resolved.refreshStatus],
    ['adjustment_mode', 'Adjustment mode', resolved.adjustmentMode],
    ['warnings', 'Warnings', resolved.warnings?.join(' · ')],
    ['data_status', 'Data status', deriveWidgetHealth(input).label],
    ['captured_at', 'Captured at', resolved.capturedAt],
  ];
  return rows.filter(([, , value]) => value != null && value !== '');
}

export function provenanceToMarkdown(provenance?: ExportProvenance): string {
  if (!provenance) return '';
  const rows = provenanceEntries(provenance).map(([key, label, value]) =>
    `- ${label}: ${key === 'cached' ? value ? 'cached snapshot' : 'not marked cached' : value}`,
  );
  return `## Source & provenance\n\n${rows.join('\n')}\n`;
}

export function provenanceLines(provenance?: ExportProvenance): Array<[string, string]> {
  return provenance ? provenanceEntries(provenance).map(([key, , value]) => [key, String(value).replace(/[\r\n]+/g, ' ')]) : [];
}
