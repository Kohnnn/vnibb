import { isUsableHistoricalOHLC } from '@/lib/historicalSessionAdmission';
import type { EquityHistoricalData } from '@/types/equity';

export const MIN_OPENING_GAP_PCT = 0.5;
export const FOLLOW_UP_TRADING_SESSIONS = 20;

type GapDirection = 'up' | 'down';
type GapOutcome = { observedThrough: string } & (
  | { outcome: 'filled'; sessionsToFill: number }
  | { outcome: 'unfilled' | 'censored'; sessionsToFill: null }
);

export type GapEvent = GapOutcome & { date: string; direction: GapDirection; gapPct: number };

interface GapComparisons {
  eligibleComparisons: number;
  excludedComparisons: number;
  comparisonStart: string | null;
  comparisonEnd: string | null;
}

interface GapOutcomeSummary {
  gaps: number;
  filledGaps: number;
  unfilledGaps: number;
  censoredGaps: number;
  resolvedGaps: number;
  fillRatePct: number | null;
  avgFillTradingSessions: number | null;
  upFilledGaps: number;
  upResolvedGaps: number;
  upFillRatePct: number | null;
  downFilledGaps: number;
  downResolvedGaps: number;
  downFillRatePct: number | null;
}

export interface GapFillAnalysis {
  events: GapEvent[];
  unusableRows: number;
  coverageDetail: {
    observedStart: string | null;
    observedEnd: string | null;
    requestedSessions: number;
    observedSessions: number;
    gapSessions: number;
  };
  missingLeadingSessions: number | null;
  missingInteriorSessions: number | null;
  missingTrailingSessions: number | null;
  metrics: GapComparisons & GapOutcomeSummary & { minGapPct: number; followUpTradingSessions: number };
}

type SessionBar = EquityHistoricalData | undefined;

function observeGap(
  bars: readonly SessionBar[],
  index: number,
  gap: { date: string; direction: GapDirection; priorClose: number },
): GapOutcome {
  let observedThrough = gap.date;
  for (let elapsed = 0; elapsed <= FOLLOW_UP_TRADING_SESSIONS; elapsed += 1) {
    const bar = bars[index + elapsed];
    if (!bar) return { outcome: 'censored', sessionsToFill: null, observedThrough };
    observedThrough = bar.time;
    const filled = gap.direction === 'up' ? bar.low <= gap.priorClose : bar.high >= gap.priorClose;
    if (filled) return { outcome: 'filled', sessionsToFill: elapsed, observedThrough };
  }
  return { outcome: 'unfilled', sessionsToFill: null, observedThrough };
}

function calculateGapEvents(bars: readonly SessionBar[]): GapComparisons & { events: GapEvent[] } {
  const events: GapEvent[] = [];
  let eligibleComparisons = 0;
  let comparisonStart: string | null = null;
  let comparisonEnd: string | null = null;
  for (let index = 1; index < bars.length; index += 1) {
    const previous = bars[index - 1];
    const current = bars[index];
    if (!previous || !current) continue;
    const gapPct = ((current.open - previous.close) / previous.close) * 100;
    if (!Number.isFinite(gapPct)) continue;
    eligibleComparisons += 1;
    comparisonStart ??= current.time;
    comparisonEnd = current.time;
    if (Math.abs(gapPct) < MIN_OPENING_GAP_PCT) continue;
    const date = current.time;
    const direction = gapPct > 0 ? 'up' : 'down';
    events.push({ date, direction, gapPct, ...observeGap(bars, index, { date, direction, priorClose: previous.close }) });
  }
  return {
    events, eligibleComparisons, comparisonStart, comparisonEnd,
    excludedComparisons: Math.max(0, bars.length - 1) - eligibleComparisons,
  };
}

function ratePct(filled: number, resolved: number): number | null {
  return resolved > 0 ? (filled / resolved) * 100 : null;
}

function summarizeGapOutcomes(events: readonly GapEvent[]): GapOutcomeSummary {
  const counts = { up: { filled: 0, resolved: 0 }, down: { filled: 0, resolved: 0 } };
  let totalTradingSessionsToFill = 0;
  for (const event of events) {
    if (event.outcome === 'censored') continue;
    const direction = counts[event.direction];
    direction.resolved += 1;
    if (event.outcome === 'filled') {
      direction.filled += 1;
      totalTradingSessionsToFill += event.sessionsToFill;
    }
  }
  const { up, down } = counts;
  const filledGaps = up.filled + down.filled;
  const resolvedGaps = up.resolved + down.resolved;
  return {
    gaps: events.length,
    filledGaps,
    unfilledGaps: resolvedGaps - filledGaps,
    censoredGaps: events.length - resolvedGaps,
    resolvedGaps,
    fillRatePct: ratePct(filledGaps, resolvedGaps),
    avgFillTradingSessions: filledGaps > 0 ? totalTradingSessionsToFill / filledGaps : null,
    upFilledGaps: up.filled,
    upResolvedGaps: up.resolved,
    upFillRatePct: ratePct(up.filled, up.resolved),
    downFilledGaps: down.filled,
    downResolvedGaps: down.resolved,
    downFillRatePct: ratePct(down.filled, down.resolved),
  };
}

/** Applies the gap rules to ordered daily rows already vetted by historical session admission. */
export function analyzeGapFillStats(rows: readonly EquityHistoricalData[], expectedSessionDates: readonly string[]): GapFillAnalysis {
  const usableBars = new Map<string, EquityHistoricalData>();
  let unusableRows = 0;
  for (const row of rows) {
    if (isUsableHistoricalOHLC(row)) usableBars.set(row.time, row);
    else unusableRows += 1;
  }
  // One slot per certified exchange session, including absent and unusable bars.
  const bars = expectedSessionDates.map(date => usableBars.get(date));
  const first = bars.findIndex(Boolean);
  const last = bars.findLastIndex(Boolean);
  const missingLeadingSessions = first < 0 ? null : first;
  const missingTrailingSessions = last < 0 ? null : bars.length - 1 - last;
  const gapSessions = bars.length - usableBars.size;
  const { events, ...comparisons } = calculateGapEvents(bars);

  return {
    events,
    unusableRows,
    coverageDetail: {
      observedStart: bars[first]?.time ?? null,
      observedEnd: bars[last]?.time ?? null,
      requestedSessions: bars.length,
      observedSessions: usableBars.size,
      gapSessions,
    },
    missingLeadingSessions,
    missingInteriorSessions: missingLeadingSessions === null || missingTrailingSessions === null
      ? null : gapSessions - missingLeadingSessions - missingTrailingSessions,
    missingTrailingSessions,
    metrics: {
      ...comparisons,
      ...summarizeGapOutcomes(events),
      minGapPct: MIN_OPENING_GAP_PCT,
      followUpTradingSessions: FOLLOW_UP_TRADING_SESSIONS,
    },
  };
}
