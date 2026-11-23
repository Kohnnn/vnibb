import type { CoveredTradeWindow, IntradayEnvelope, IntradayMarketSession, MarketSessionState } from '@/types/intraday';

export interface IntradayFailure {
  status: 'timeout' | 'unsupported' | 'unusable' | 'unavailable';
  message: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ZONED_TIME = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

export const sessionLabels: Record<MarketSessionState, string> = {
  open: 'Market open',
  closed: 'Market closed',
  holiday: 'Market holiday',
  unknown: 'Market session unverified',
};

export function sourceObservation(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (DATE_ONLY.test(value)) return parsed.toISOString().slice(0, 10) === value ? value : null;
  return ZONED_TIME.test(value) ? value : null;
}

export function currentSession(evidence: IntradayMarketSession | null | undefined, now: number) {
  if (!evidence || !evidence.basis || !ZONED_TIME.test(evidence.checked_at)
      || !evidence.valid_until || !ZONED_TIME.test(evidence.valid_until)) return undefined;
  const checked = Date.parse(evidence.checked_at);
  const expires = Date.parse(evidence.valid_until);
  if (!(checked <= now && now < expires)) return undefined;
  if (evidence.state === 'open' && evidence.basis === 'exchange_status') return evidence;
  if (evidence.state === 'closed' && ['verified_calendar_interval', 'exchange_status'].includes(evidence.basis)) return evidence;
  if (evidence.state === 'holiday' && evidence.basis === 'market_calendar') return evidence;
  return undefined;
}

export function intradayFailure(response?: IntradayEnvelope, requestError?: Error | null): IntradayFailure | undefined {
  const feedStatus = response?.meta?.feed?.status;
  const envelopeError = response?.error;
  const error = requestError?.message || (typeof envelopeError === 'string' ? envelopeError.trim() : '');
  const timedOut = /timeout|timed out|\((?:408|504)\)/i.test(error);
  if (requestError) return { status: timedOut ? 'timeout' : 'unavailable', message: error || 'The request failed' };
  switch (feedStatus) {
    case 'timeout': return { status: feedStatus, message: 'Request timed out' };
    case 'unsupported': return { status: feedStatus, message: 'The configured provider does not support this feed' };
    case 'unusable': return { status: feedStatus, message: 'The feed returned no usable observations' };
    case 'unavailable': return { status: feedStatus, message: error || 'The feed could not be retrieved' };
    default: return error || envelopeError === true
      ? { status: timedOut ? 'timeout' : 'unavailable', message: error || 'The feed could not be retrieved' }
      : undefined;
  }
}

export function coveredTradeWindow(response: IntradayEnvelope | undefined): CoveredTradeWindow | undefined {
  const feed = response?.meta?.feed;
  const window = feed?.covered_window;
  if (!window || feed?.fallback || intradayFailure(response) || !['empty', 'available'].includes(feed?.status ?? '')) return undefined;
  if (window.basis !== 'completed_tick_session' && window.basis !== 'vietcap_board') return undefined;
  return DATE_ONLY.test(window.session_date) && sourceObservation(window.session_date)
    && Number.isInteger(window.trade_count) && window.trade_count >= 0 ? window : undefined;
}

/** HTTP-success failures must not evict the last observations of this exact query. */
export function retainIntraday<T extends IntradayEnvelope & { data: unknown }>(
  received: T, previous: T | undefined, hasRows: (data: T['data']) => boolean,
): T {
  const previousFeed = previous?.meta?.feed;
  const feed = received.meta?.feed;
  const failure = intradayFailure(received);
  if (!failure || !previous || !hasRows(previous.data) || hasRows(received.data)) return received;
  return {
    ...received,
    data: previous.data,
    meta: {
      ...received.meta,
      count: previous.meta?.count,
      last_data_date: previousFeed?.source_as_of,
      feed: {
        status: failure.status,
        requested_source: feed?.requested_source ?? previousFeed?.requested_source ?? null,
        source: previousFeed?.source ?? null,
        source_as_of: previousFeed?.source_as_of ?? null,
        fetched_at: feed?.fetched_at ?? new Date().toISOString(),
        snapshot_at: previousFeed?.snapshot_at ?? null,
        delivery: 'retained',
        fallback: true,
        covered_window: null,
      },
    },
  };
}