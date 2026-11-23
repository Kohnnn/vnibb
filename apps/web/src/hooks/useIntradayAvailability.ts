'use client';

import { useEffect, useMemo, useState } from 'react';
import { coveredTradeWindow, currentSession, intradayFailure, sessionLabels, sourceObservation } from '@/lib/intradayAvailability';
import type { IntradayFailure } from '@/lib/intradayAvailability';
import type { WidgetRuntimeInput } from '@/lib/widgetRuntime';
import type { CoveredTradeWindow, IntradayEnvelope } from '@/types/intraday';

interface IntradayObservation {
  response?: IntradayEnvelope;
  error?: Error | null;
  hasData: boolean;
  isLoading: boolean;
  isFetching: boolean;
  dataUpdatedAt?: number;
  legacyRetained?: boolean;
  legacyAsOf?: string | null;
}

type IntradayRuntime = Pick<WidgetRuntimeInput,
  'lastDataDate' | 'fetchedAt' | 'coverage' | 'observationStatus' | 'refreshStatus' | 'cached' | 'warnings' | 'intraday'
>;

export interface IntradayAvailability {
  runtime: IntradayRuntime;
  failure?: IntradayFailure;
  window?: CoveredTradeWindow;
  retained: boolean;
  sessionLabel: string;
  source?: string;
}

export function useIntradayAvailability({
  response, error, hasData, isLoading, isFetching, dataUpdatedAt, legacyRetained, legacyAsOf,
}: IntradayObservation): IntradayAvailability {
  const [lastExpiry, setLastExpiry] = useState(0);
  const result = useMemo(() => {
    const evidence = currentSession(response?.meta?.market_session, Math.max(lastExpiry, Date.now()));
    const sessionState = evidence?.state ?? 'unknown';
    const feed = response?.meta?.feed;
    const failure = intradayFailure(response, error);
    const covered = failure ? undefined : coveredTradeWindow(response);
    const fallback = Boolean(feed?.fallback || (hasData && (failure || legacyRetained)));
    const retained = Boolean(fallback || feed?.delivery === 'retained' || legacyRetained);
    const delivery = feed?.delivery === 'reference' ? 'reference' : fallback ? 'retained' : feed?.delivery;
    const lastDataDate = sourceObservation(feed ? feed.source_as_of : legacyAsOf);
    const fetchedAt = (sourceObservation(feed?.fetched_at) ?? dataUpdatedAt) || undefined;
    const warnings = [
      failure && (hasData ? `Refresh failed: ${failure.message}. Showing retained observations.` : failure.message),
      !failure && fallback && hasData && 'Refresh returned no usable new observations. Showing retained observations.',
    ].filter((warning): warning is string => Boolean(warning));
    const runtime: IntradayRuntime = {
      lastDataDate,
      fetchedAt,
      coverage: 'unknown', // A single covered session does not prove coverage of a wider lookback.
      observationStatus: hasData || covered?.trade_count === 0 ? 'available' : isLoading ? 'loading'
        : failure?.status === 'unsupported' ? 'unsupported' : failure ? 'unavailable' : 'empty',
      refreshStatus: failure ? 'failed' : isFetching ? 'refreshing' : response ? 'succeeded' : undefined,
      cached: hasData ? Boolean(retained || feed?.delivery === 'cache') : undefined,
      warnings: warnings.length ? warnings : undefined,
      intraday: {
        sessionState,
        sessionEvidence: evidence,
        feedStatus: failure?.status ?? feed?.status ?? (response ? hasData ? 'available' : 'empty' : undefined),
        requestedSource: feed?.requested_source,
        delivery,
        fallback,
        snapshotAt: feed?.snapshot_at,
        coveredWindow: covered,
      },
    };
    return {
      runtime,
      failure,
      window: covered,
      retained,
      sessionLabel: sessionLabels[sessionState],
      sessionExpires: evidence?.valid_until ? Date.parse(evidence.valid_until) : undefined,
      source: feed?.source ?? undefined,
    };
  }, [response, error, hasData, isLoading, isFetching, dataUpdatedAt, legacyRetained, legacyAsOf, lastExpiry]);

  useEffect(() => {
    if (result.sessionExpires === undefined) return;
    const delay = Math.min(Math.max(0, result.sessionExpires - Date.now()), 2 ** 31 - 1);
    const timer = window.setTimeout(() => setLastExpiry(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [result.sessionExpires, lastExpiry]);

  return result;
}