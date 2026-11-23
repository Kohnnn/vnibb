import type { MicrostructureInput, MicrostructureResponse } from './api';
import type { IntradayProvenance } from '@/types/intraday';
import { currentSession, intradayFailure, sourceObservation } from './intradayAvailability';

const inputLabel: Record<MicrostructureInput, string> = {
  trade_ticks: 'Trade ticks', price_depth: 'Price depth', daily_prices: 'Daily prices',
};

type MicrostructureFailures = Partial<Record<MicrostructureInput | 'unscoped', string>>;

export function microstructureFailures(response?: MicrostructureResponse): MicrostructureFailures {
  const failures: MicrostructureFailures = {};
  const errors = response?.meta?.input_errors;
  for (const input of Object.keys(inputLabel) as MicrostructureInput[]) {
    if (errors?.[input]) failures[input] = `${inputLabel[input]}: ${errors[input]}`;
  }

  const legacyError = intradayFailure({ error: response?.error })?.message;
  for (const part of legacyError?.split('; ') ?? []) {
    const input = (Object.keys(inputLabel) as MicrostructureInput[])
      .find((name) => part.startsWith(`${inputLabel[name]}: `));
    if (input) failures[input] ??= part;
    else failures.unscoped = failures.unscoped ? `${failures.unscoped}; ${part}` : part;
  }

  const tickError = intradayFailure({ meta: { feed: response?.meta?.feed } });
  if (tickError) {
    failures.trade_ticks ??= `${inputLabel.trade_ticks}: ${tickError.message}`;
    if (failures.unscoped === tickError.message) delete failures.unscoped;
  }
  return failures;
}

export function microstructureTickFailure(response: MicrostructureResponse | undefined, failures: MicrostructureFailures) {
  const status = response?.meta?.feed?.status;
  return failures.trade_ticks ?? (status === undefined ? failures.unscoped : undefined);
}

function admittedTradeAsOf(response?: MicrostructureResponse): string | null {
  const feed = response?.meta?.feed;
  const clock = sourceObservation(feed?.source_as_of);
  if (response?.meta?.trade_as_of_basis === 'admitted_trade_time' && clock?.includes('T')) return clock;
  if (response?.meta?.trade_as_of_basis === 'completed_tick_session' && feed?.status === 'empty'
      && feed.covered_window?.basis === 'completed_tick_session' && clock === feed.covered_window.session_date) return clock;
  return null;
}

export function microstructureProvenance(
  response: MicrostructureResponse | undefined,
  input: 'trade_ticks' | 'price_depth',
  { hasData, failure, requestError }: { hasData: boolean; failure?: string; requestError?: Error | null },
): IntradayProvenance {
  const feed = input === 'trade_ticks' ? response?.meta?.feed : undefined;
  const sessionEvidence = currentSession(response?.meta?.market_session, Date.now());
  return {
    sessionState: sessionEvidence?.state ?? 'unknown',
    sessionEvidence,
    feedStatus: intradayFailure({ error: failure, meta: { feed } }, requestError)?.status
      ?? feed?.status ?? (hasData ? 'available' : undefined),
    requestedSource: feed?.requested_source,
    delivery: hasData ? 'retained' : feed?.delivery,
    fallback: hasData && (Boolean(failure || requestError) || feed?.fallback === true),
    snapshotAt: feed?.snapshot_at,
  };
}

export type MicrostructureResult = MicrostructureResponse & { retainedDepthProfile?: boolean };

export function retainMicrostructure(
  received: MicrostructureResponse, previous: MicrostructureResult | undefined,
): MicrostructureResult {
  const feed = received.meta?.feed;
  const clock = admittedTradeAsOf(received);
  if (feed && feed.source_as_of !== clock) {
    received = { ...received, meta: { ...received.meta, feed: { ...feed, source_as_of: clock } } };
  }
  const priorData = previous?.data;
  if (!priorData) return received;
  const failures = microstructureFailures(received);
  const tickError = microstructureTickFailure(received, failures);
  const depthError = failures.price_depth ?? failures.unscoped;
  const dailyError = failures.daily_prices ?? failures.unscoped;
  if (!tickError && !depthError && !dailyError) return received;

  const data = { ...received.data };
  const restored: (keyof MicrostructureResponse['data'])[] = [];
  function retain<K extends keyof typeof data>(key: K, receivedCount?: number, previousCount?: number) {
    if (!receivedCount && previousCount) {
      data[key] = priorData![key];
      restored.push(key);
    }
  }

  if (tickError) {
    retain('deep_trades', data.deep_trades?.bars?.length, priorData.deep_trades?.bars?.length);
    retain('vwap', data.vwap?.points?.length, priorData.vwap?.points?.length);
    retain('footprint', data.footprint?.bars?.length, priorData.footprint?.bars?.length);
  }
  let retainedTicks = restored.length > 0;
  const priorProfile = priorData.volume_profile;
  const profileFromDepth = priorProfile?.quality === 'volume_at_price';
  if (profileFromDepth ? depthError : tickError) {
    retain('volume_profile', data.volume_profile?.bins?.length, priorProfile?.bins?.length);
    retainedTicks ||= !profileFromDepth && restored.includes('volume_profile');
  }
  if (dailyError) {
    retain('price_action', data.price_action?.candles?.length, priorData.price_action?.candles?.length);
  }
  if (!restored.length) return received;

  data.data_quality = { ...data.data_quality };
  for (const key of restored) {
    const quality = priorData.data_quality?.[key];
    if (quality) data.data_quality[key] = quality;
  }
  const retainedDepthProfile = profileFromDepth && restored.includes('volume_profile');
  if (!retainedTicks) return { ...received, data, retainedDepthProfile };

  const priorFeed = previous?.meta?.feed;
  const failure = intradayFailure({ error: tickError, meta: { feed } });
  return {
    ...received,
    data,
    retainedDepthProfile,
    meta: {
      ...received.meta,
      trade_as_of_basis: admittedTradeAsOf(previous) ? previous?.meta?.trade_as_of_basis : null,
      feed: {
        status: failure?.status ?? 'unavailable',
        requested_source: feed?.requested_source ?? priorFeed?.requested_source ?? null,
        source: priorFeed?.source ?? null,
        source_as_of: admittedTradeAsOf(previous),
        fetched_at: feed?.fetched_at ?? new Date().toISOString(),
        snapshot_at: priorFeed?.snapshot_at ?? null,
        delivery: 'retained',
        fallback: true,
        covered_window: null,
      },
    },
  };
}
