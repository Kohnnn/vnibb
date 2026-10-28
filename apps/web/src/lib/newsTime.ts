import { parseFlexibleDate } from './format'

export function normalizeNewsTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null

  if (typeof value === 'number') {
    const millis = value > 1_000_000_000_000 ? value : value * 1000
    const parsed = new Date(millis)
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
  }

  const text = String(value).trim()
  if (!text) return null

  if (/^\d+$/.test(text)) {
    const numeric = Number(text)
    const millis = numeric > 1_000_000_000_000 ? numeric : numeric * 1000
    const parsed = new Date(millis)
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
  }

  const parsed = new Date(text)
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString()

  const flexible = parseFlexibleDate(text)
  return flexible ? flexible.toISOString() : text
}

/**
 * Fields that carry a genuine source publication observation. Deliberately
 * excludes crawl/ingest aliases (`created_at`, `timestamp`, `date`) so runtime
 * freshness never reports when we merely retrieved the row.
 */
const PUBLISHED_OBSERVATION_KEYS = ['published_at', 'published_date', 'pubDate'] as const

/**
 * Minimal structural view of a displayed row: only the publication fields this
 * helper reads. API article types (`published_at?: string | null`) satisfy it
 * directly, so callers never need an `as unknown as Record<...>` cast.
 */
export interface PublicationObservation {
  published_at?: unknown
  published_date?: unknown
  pubDate?: unknown
}

function parseNewsObservation(value: unknown): string | null {
  const normalized = normalizeNewsTimestamp(value)
  if (!normalized) return null
  return Number.isNaN(new Date(normalized).getTime()) ? null : normalized
}

/**
 * Source publication timestamp for one article, or null when absent/unparseable.
 * Unparseable values are dropped rather than echoed so provenance cannot claim a
 * date the source never stated.
 */
export function newsItemObservation<T extends object>(item: (T & PublicationObservation) | null | undefined): string | null {
  if (!item) return null
  for (const key of PUBLISHED_OBSERVATION_KEYS) {
    const observation = parseNewsObservation(item[key])
    if (observation) return observation
  }
  return null
}

export interface NewsObservationOptions {
  /**
   * Query receipt instant. A value dated after retrieval cannot be a source
   * observation, so it is reported as unknown rather than as freshness.
   */
  receiptAt?: number | string | Date | null
}

export interface NewsObservationProvenance {
  /** Source observation only; null when no displayed row carries a publish date. */
  lastDataDate: string | null
  /** 'partial' when dated and undated rows are mixed. */
  coverage?: 'partial'
  /** Note naming undated rows, so one fresh article cannot imply the feed is fresh. */
  warning?: string
}

/**
 * Map displayed news rows onto runtime provenance. `lastDataDate` is the latest
 * genuine source publication date (never the query receipt), so re-fetching an
 * unchanged old article does not make it look fresh; rows without a publication
 * date are reported as partial coverage instead of being silently dropped.
 */
export function newsObservationProvenance<T extends object>(
  items: readonly (T & PublicationObservation)[] | null | undefined,
  options: NewsObservationOptions = {},
): NewsObservationProvenance {
  const receiptMs = options.receiptAt != null ? new Date(options.receiptAt).getTime() : NaN
  let latestMs: number | null = null
  let observedAt: string | null = null
  let datedCount = 0
  let unknownCount = 0
  for (const item of items ?? []) {
    const observation = newsItemObservation(item)
    if (!observation) {
      unknownCount += 1
      continue
    }
    const ms = new Date(observation).getTime()
    // A source cannot publish after we retrieved it; a value dated after receipt
    // is not a source observation, so it counts as unknown.
    if (receiptMs > 0 && ms > receiptMs) {
      unknownCount += 1
      continue
    }
    datedCount += 1
    if (latestMs === null || ms > latestMs) {
      latestMs = ms
      observedAt = observation
    }
  }
  const result: NewsObservationProvenance = { lastDataDate: observedAt }
  if (unknownCount > 0) {
    result.warning = `${unknownCount} of ${datedCount + unknownCount} articles have no source publication date`
    if (datedCount > 0) result.coverage = 'partial'
  }
  return result
}

/** Row view for timestamp normalization: publication aliases plus crawl aliases. */
export interface NewsTimestampFields extends PublicationObservation {
  publishedDate?: unknown
  created_at?: unknown
  timestamp?: unknown
  date?: unknown
}

export function normalizeNewsItemTimestamp<T extends object>(item: T & NewsTimestampFields): string | null {
  return normalizeNewsTimestamp(
    item.published_at
      ?? item.published_date
      ?? item.publishedDate
      ?? item.pubDate
      ?? item.created_at
      ?? item.timestamp
      ?? item.date
  )
}
