export type MarketSessionState = 'open' | 'closed' | 'holiday' | 'unknown';

export interface IntradayMarketSession {
  state: MarketSessionState;
  basis: 'exchange_status' | 'verified_calendar_interval' | 'market_calendar' | null;
  checked_at: string;
  valid_until: string | null;
}

export type FeedStatus = 'available' | 'empty' | 'timeout' | 'unsupported' | 'unavailable' | 'unusable' | 'not_requested';
export type FeedDelivery = 'provider' | 'cache' | 'retained' | 'reference';

export interface CoveredTradeWindow {
  session_date: string;
  trade_count: number;
  basis: 'completed_tick_session' | 'vietcap_board';
}

export interface IntradayFeed {
  status: FeedStatus;
  source: string | null;
  requested_source: string | null;
  source_as_of: string | null;
  fetched_at: string;
  snapshot_at: string | null;
  delivery: FeedDelivery;
  fallback: boolean;
  covered_window: CoveredTradeWindow | null;
}

export interface IntradayMeta {
  feed?: IntradayFeed | null;
  market_session?: IntradayMarketSession | null;
  count?: number;
  limit?: number;
  provider_limit?: number;
  symbol?: string | null;
  last_data_date?: string | null;
  lookback_days?: number;
}

export interface IntradayEnvelope {
  meta?: IntradayMeta | null;
  error?: string | boolean | null;
}

export interface IntradayProvenance {
  sessionState: MarketSessionState;
  sessionEvidence?: IntradayMarketSession;
  feedStatus?: FeedStatus;
  requestedSource?: string | null;
  delivery?: FeedDelivery;
  fallback: boolean;
  snapshotAt?: string | null;
  coveredWindow?: CoveredTradeWindow;
}
