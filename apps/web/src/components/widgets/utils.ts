/**
 * Shared utility functions for VNIBB widgets.
 *
 * These functions address widespread duplication across widget components:
 * - toPositiveNumber / toNumber: parse unknown values to finite numbers
 * - firstFinite / firstPositiveNumber: find first valid value from variadic args
 * - resolveMetric: cascade through candidate sources until one resolves
 * - clampPercent: bound a number to [0, 100]
 * - getChangeDirection: classify a numeric change as up/down/flat/unknown
 */

/** Parse any value to a positive, finite number. Returns null for non-numeric,
 * NaN, Infinity, zero, or negative values. */
export function toPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

/**
 * Parse a value to a finite number. Returns null for non-finite values and for
 * anything that is not a number or a non-blank numeric string.
 *
 * `Number(null) === 0`, `Number(undefined) === NaN` and `Number('') === 0`, so
 * coercing blindly turns a missing provider metric into a real-looking 0 (issue
 * #106: MSR screener P/E 0 / P/B 0 while the ratios source held 2394.64/2.22).
 * Missing stays missing; it never becomes a magnitude.
 */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Return the first finite (non-null, non-undefined, Number.isFinite) value. */
export function firstFinite<T extends number | null | undefined>(
  ...values: T[]
): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

/** Iterate through values, returning the first one that passes toPositiveNumber. */
export function firstPositiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = toPositiveNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

export type MetricSource = string;

export interface MetricCandidate {
  value: unknown;
  source: MetricSource;
  positiveOnly?: boolean;
}

export interface MetricResult {
  value: number | null;
  source: MetricSource;
}

/**
 * Resolve a metric by trying candidates in order. Each candidate is checked
 * with toNumber; if positiveOnly is set, zero and negatives are skipped.
 * Returns the first matching candidate, or { value: null, source: 'Unavailable' }.
 */
export function resolveMetric(candidates: MetricCandidate[]): MetricResult {
  for (const candidate of candidates) {
    const parsed = toNumber(candidate.value);
    if (parsed === null) continue;
    if (candidate.positiveOnly && parsed <= 0) continue;
    return { value: parsed, source: candidate.source };
  }
  return { value: null, source: 'Unavailable' };
}

export function certifiedProfileShares(profile: { outstanding_shares?: number | null; shares_unit?: string | null; shares_source?: string | null; share_basis?: string | null; shares_as_of?: string | null } | null | undefined): number | null {
  if (profile?.shares_unit !== 'shares' || profile.share_basis !== 'outstanding' || typeof profile.shares_source !== 'string' || !profile.shares_source.trim()) return null;
  const date = profile.shares_as_of;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(date)) return null;
  if (date.length > 10 && (Number(date.slice(11, 13)) > 23 || Number(date.slice(14, 16)) > 59 || Number(date.slice(17, 19)) > 59)) return null;
  const day = date.slice(0, 10);
  const calendarDate = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== day) return null;
  const marketDay = (value: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
    return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)?.value).join('-');
  };
  const timestamp = date.length === 10 ? null : new Date(/[Zz]|[+-]\d{2}:\d{2}$/.test(date) ? date : `${date}+07:00`);
  if (timestamp && !Number.isFinite(timestamp.getTime())) return null;
  if (day > marketDay(new Date())) return null;
  const value = profile.outstanding_shares;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Bound a percent value to the [0, 100] range, returning 0 for non-finite input. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export type ChangeDirection = 'up' | 'down' | 'flat' | 'unknown';

/** Classify a numeric change into a direction label. */
export function getChangeDirection(value: number | null | undefined): ChangeDirection {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'unknown';
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}
