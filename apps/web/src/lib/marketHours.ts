// HOSE/HNX/UPCOM market hours awareness.
// Single source of truth for "is the market open right now?" used by:
// - VWAPBandsWidget (QA-v3 T4 — copy must say 09:00–11:30 + 13:00–14:45,
//   NOT the inaccurate "09:00–15:00" / "08:00–13:00" wording).
// - FootprintProxyWidget (same).
// - IntradayTradesWidget (T6 — show last-session tape when in lunch break
//   or after-hours instead of an indistinct "no trades" message).
// - any other widget that needs market-state awareness.

export type MarketPhase =
  | 'pre-open'
  | 'morning'
  | 'lunch'
  | 'afternoon'
  | 'post-close-finalization'
  | 'after-close'
  | 'weekend';

export interface MarketState {
  phase: MarketPhase;
  isOpen: boolean;
  /** Human-readable label for the current phase. */
  label: string;
  /** Trading hours summary for display in copy. */
  scheduleSummary: string;
  /** ISO timestamp the state was sampled. */
  sampledAt: string;
}

const HOSE_TZ = 'Asia/Ho_Chi_Minh';
export const HOSE_SCHEDULE_SUMMARY = '09:00–11:30 + 13:00–14:45 ICT, Mon–Fri';

/**
 * Returns the current HH:MM (zero-padded) and weekday-index in
 * Asia/Ho_Chi_Minh time, regardless of the host's local timezone.
 */
function getVntClock(at: Date = new Date()): { hour: number; minute: number; weekday: number } {
  // Intl.DateTimeFormat with Asia/Ho_Chi_Minh gives us a stable read.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: HOSE_TZ,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = fmt.formatToParts(at);
  const lookup: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') lookup[p.type] = p.value;
  }
  const hour = Number(lookup.hour ?? '0');
  const minute = Number(lookup.minute ?? '0');
  const weekdayShort = (lookup.weekday ?? '').toLowerCase();
  const weekdayMap: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  const weekday = weekdayMap[weekdayShort.slice(0, 3)] ?? 0;
  return { hour, minute, weekday };
}

export function getMarketState(at: Date = new Date()): MarketState {
  const { hour, minute, weekday } = getVntClock(at);
  const minutesSinceMidnight = hour * 60 + minute;
  const sampledAt = at.toISOString();

  if (weekday === 0 || weekday === 6) {
    return {
      phase: 'weekend',
      isOpen: false,
      label: 'Weekend',
      scheduleSummary: HOSE_SCHEDULE_SUMMARY,
      sampledAt,
    };
  }

  if (minutesSinceMidnight < 540) {
    return {
      phase: 'pre-open',
      isOpen: false,
      label: 'Pre-open',
      scheduleSummary: HOSE_SCHEDULE_SUMMARY,
      sampledAt,
    };
  }
  if (minutesSinceMidnight < 690) {
    return {
      phase: 'morning',
      isOpen: true,
      label: 'Morning session',
      scheduleSummary: HOSE_SCHEDULE_SUMMARY,
      sampledAt,
    };
  }
  if (minutesSinceMidnight < 780) {
    return {
      phase: 'lunch',
      isOpen: false,
      label: 'Lunch break',
      scheduleSummary: HOSE_SCHEDULE_SUMMARY,
      sampledAt,
    };
  }
  if (minutesSinceMidnight < 885) {
    return {
      phase: 'afternoon',
      isOpen: true,
      label: 'Afternoon session',
      scheduleSummary: HOSE_SCHEDULE_SUMMARY,
      sampledAt,
    };
  }
  if (minutesSinceMidnight < 900) {
    return {
      phase: 'post-close-finalization',
      isOpen: false,
      label: 'Post-close finalization',
      scheduleSummary: HOSE_SCHEDULE_SUMMARY,
      sampledAt,
    };
  }
  return {
    phase: 'after-close',
    isOpen: false,
    label: 'After close',
    scheduleSummary: HOSE_SCHEDULE_SUMMARY,
    sampledAt,
  };
}

/** Backwards-compat helper used by IntradayTradesWidget. */
export function isMarketClosedNowVnt(at: Date = new Date()): boolean {
  return !getMarketState(at).isOpen;
}

/**
 * Returns a UI-friendly description for "data unavailable" copy on
 * intraday-only widgets (VWAP, Footprint, Order Book).
 */
export function describeIntradayUnavailable(state: MarketState | null = null): {
  primary: string;
  detail: string;
} {
  const s = state ?? getMarketState();
  switch (s.phase) {
    case 'pre-open':
      return {
        primary: 'Pre-open',
        detail: `Live ticks resume at 09:00 ICT (${HOSE_SCHEDULE_SUMMARY}).`,
      };
    case 'morning':
    case 'afternoon':
      return {
        primary: 'Waiting for ticks',
        detail: 'Market is open; widget is waiting for the next batch of trade ticks. Try refresh.',
      };
    case 'lunch':
      return {
        primary: 'Lunch break (11:30–13:00 ICT)',
        detail: `Live ticks resume at 13:00 ICT (${HOSE_SCHEDULE_SUMMARY}).`,
      };
    case 'post-close-finalization':
      return {
        primary: 'Post-close finalization (14:45–15:00 ICT)',
        detail: `Trading is closed while final prices settle (${HOSE_SCHEDULE_SUMMARY}).`,
      };
    case 'after-close':
      return {
        primary: 'After close',
        detail: `Live ticks resume at 09:00 ICT next trading day (${HOSE_SCHEDULE_SUMMARY}).`,
      };
    case 'weekend':
      return {
        primary: 'Market closed (weekend)',
        detail: `Live ticks resume Monday at 09:00 ICT (${HOSE_SCHEDULE_SUMMARY}).`,
      };
  }
}
