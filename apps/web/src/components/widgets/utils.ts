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

/** Parse any value to a finite number. Returns null for non-numeric or non-finite values. */
export function toNumber(value: unknown): number | null {
  // Must check for null/undefined first since Number(null) === 0 and
  // Number(undefined) === NaN — both would pass the isFinite check below.
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
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
