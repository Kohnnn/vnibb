import type { PriceDepthResponse } from '@/lib/api';
import type { IntradayResponse, IntradayTradeData } from '@/types/equity';
import type { CoveredTradeWindow, IntradayEnvelope, IntradayFeed, IntradayMarketSession, MarketSessionState } from '@/types/intraday';
import { getVnDayKey } from './dividendLadder';

export interface IntradayFailure {
  status: 'timeout' | 'unsupported' | 'unusable' | 'unavailable';
  message: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ZONED_TIME = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const TAPE_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ]((?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?$/;

type DepthEntry = PriceDepthResponse['data']['entries'][number];
type PricedDepthEntry = DepthEntry & { price: number };
type IntradayDataEnvelope = IntradayEnvelope & { data: unknown };

const DEPTH_PRICE_FIELDS = ['price', 'bid_price', 'ask_price', 'bidPrice', 'askPrice', 'match_price', 'matchPrice'] as const;

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

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function positiveDepthPrice(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return isPositiveFiniteNumber(number) ? number : null;
}

function depthEntryPrice(entry: DepthEntry): number | null {
  if (!entry || typeof entry !== 'object') return null;
  const row = entry as DepthEntry & Record<string, unknown>;
  for (const field of DEPTH_PRICE_FIELDS) {
    const price = positiveDepthPrice(row[field]);
    if (price !== null) return price;
  }
  return null;
}

function depthEntries(response?: PriceDepthResponse) {
  const entries = response?.data?.entries;
  return Array.isArray(entries) ? entries : [];
}

function isReferenceLevel(response: PriceDepthResponse | undefined, entry: DepthEntry) {
  const delivery = response?.meta?.feed?.delivery;
  return delivery === 'reference' || response?.data?.price_source === 'latest_price' || entry?.price_status === 'reference';
}

function hasGenuineDepth(response: PriceDepthResponse): boolean {
  return depthEntries(response).some((entry) => !isReferenceLevel(response, entry) && depthEntryPrice(entry) !== null);
}

export function displayedDepth(response?: PriceDepthResponse) {
  const genuine: PricedDepthEntry[] = [];
  const reference: PricedDepthEntry[] = [];
  for (const entry of depthEntries(response)) {
    const price = depthEntryPrice(entry);
    if (price === null) continue;
    const levels = isReferenceLevel(response, entry) ? reference : genuine;
    levels.push({ ...entry, price });
  }
  return genuine.length ? { entries: genuine, referenceOnly: false }
    : { entries: reference, referenceOnly: reference.length > 0 };
}

function tapeObservation(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (DATE_ONLY.test(text)) return sourceObservation(text);
  const timestamp = TAPE_TIMESTAMP.exec(text);
  if (!timestamp) return null;
  const [, day, clock, offset] = timestamp;
  if (!sourceObservation(day)) return null;
  // A dated wall clock still reports its literal date; it does not establish an instant.
  return offset ? sourceObservation(`${day}T${clock}${offset.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')}`) : day;
}

export function tradeTapeAsOf(response?: IntradayResponse): string | null {
  const feed = response?.meta?.feed;
  if (feed) return sourceObservation(feed.source_as_of);
  const sourceDate = tapeObservation(response?.meta?.last_data_date);
  if (sourceDate) return sourceDate;
  if (!Array.isArray(response?.data)) return null;

  let latestInstant: string | null = null;
  let latestTime = -Infinity;
  let latestDate: string | null = null;
  for (const row of response.data) {
    const time = tapeObservation(row?.time);
    if (!time) continue;
    if (DATE_ONLY.test(time)) {
      if (latestDate === null || time > latestDate) latestDate = time;
      continue;
    }
    const instant = Date.parse(time);
    if (instant > latestTime) {
      latestInstant = time;
      latestTime = instant;
    }
  }
  // Prefer the latest qualified instant; a literal date is evidence only of its source calendar day.
  return latestInstant ?? latestDate;
}

function isPrintOnSession(row: IntradayTradeData, date: string): boolean {
  if (!isPositiveFiniteNumber(row?.price) || !isPositiveFiniteNumber(row.volume)) return false;
  const time = tapeObservation(row.time);
  return Boolean(time && !DATE_ONLY.test(time) && getVnDayKey(new Date(time)) === date);
}

function withRetainedObservations<T extends IntradayDataEnvelope>(
  received: T, previous: T, observation: Pick<IntradayFeed, 'status' | 'source_as_of'>,
): T {
  const previousFeed = previous.meta?.feed;
  const feed = received.meta?.feed;
  return {
    ...received,
    data: previous.data,
    meta: {
      ...received.meta,
      count: previous.meta?.count,
      last_data_date: observation.source_as_of,
      feed: {
        ...observation,
        requested_source: feed?.requested_source ?? previousFeed?.requested_source ?? null,
        source: previousFeed?.source ?? null,
        fetched_at: feed?.fetched_at ?? new Date().toISOString(),
        snapshot_at: previousFeed?.snapshot_at ?? null,
        delivery: 'retained',
        fallback: true,
        covered_window: null,
      },
    },
  };
}

/** HTTP-success failures must not evict the last priced levels of this exact query. */
export function retainPriceDepth(received: PriceDepthResponse, previous?: PriceDepthResponse): PriceDepthResponse {
  if (!previous || hasGenuineDepth(received)) return received;

  // Without genuine levels, priced legacy rows are references, not a successful depth read.
  const status = intradayFailure(received)?.status ?? (
    !received.meta?.feed && depthEntries(received).some((entry) => depthEntryPrice(entry) !== null) ? 'unusable' : undefined
  );
  if (!status || !hasGenuineDepth(previous)) return received;
  return withRetainedObservations(received, previous, {
    status,
    source_as_of: previous.meta?.feed?.source_as_of ?? null,
  });
}

export function retainTradeTape(received: IntradayResponse, previous?: IntradayResponse): IntradayResponse {
  const window = coveredTradeWindow(received);
  if (window?.basis === 'vietcap_board' && window.trade_count === 0 && Array.isArray(previous?.data)
      && previous.data.some((row) => isPrintOnSession(row, window.session_date))) {
    // The refresh succeeded, but its board evidence cannot replace the conflicting prints.
    return withRetainedObservations(received, previous, {
      status: received.meta?.feed?.status ?? 'empty',
      source_as_of: tradeTapeAsOf(previous),
    });
  }
  const failure = intradayFailure(received);
  if (!failure || !Array.isArray(previous?.data) || !previous.data.length
      || (Array.isArray(received.data) && received.data.length > 0)) return received;
  return withRetainedObservations(received, previous, {
    status: failure.status,
    source_as_of: tradeTapeAsOf(previous),
  });
}