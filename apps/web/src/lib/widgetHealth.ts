'use client'

export type WidgetHealthStatus =
  | 'cached'
  | 'stale'
  | 'limited'
  | 'coverage_gap'
  | 'awaiting_update'
  | 'live'
  | 'unknown'

export interface WidgetHealthState {
  status: WidgetHealthStatus
  label: string
  detail?: string
}

export interface DeriveHealthInput {
  cached?: boolean
  stale?: boolean
  localOnly?: boolean
  isFetching?: boolean
  updatedAt?: number | string | Date | null
  coverage?: 'complete' | 'partial' | 'unknown'
  marketClosed?: boolean
  /** Age in seconds beyond which a non-cached snapshot is considered stale. */
  staleThresholdSeconds?: number
  sourceLabel?: string
}

const DEFAULT_STALE_THRESHOLD_SECONDS = 60 * 60 * 6
// Date-only observations identify a session, not an intraday instant (#105).
const DATE_ONLY_STALE_THRESHOLD_SECONDS = 60 * 60 * 24
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function toMillis(value?: number | string | Date | null): number | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  const ms = date.getTime()
  return Number.isNaN(ms) ? null : ms
}

/** Derive source health from observation age; acquisition time never resets it. */
export function deriveWidgetHealth(input: DeriveHealthInput): WidgetHealthState {
  const { cached, stale, localOnly, updatedAt } = input
  const detailSource = input.sourceLabel ? ` (${input.sourceLabel})` : ''

  if (localOnly) {
    return {
      status: 'limited',
      label: 'Local only',
      detail: `Browser-local data, not synced to the VNIBB backend${detailSource}.`,
    }
  }

  if (stale) {
    return {
      status: 'stale',
      label: 'Stale',
      detail: `Snapshot is marked stale${detailSource}.${cached ? ' Served from a cached snapshot.' : ''}`,
    }
  }

  const updatedMs = toMillis(updatedAt)
  if (updatedMs !== null) {
    const ageSeconds = (Date.now() - updatedMs) / 1000
    const dateOnly = typeof updatedAt === 'string' && DATE_ONLY_PATTERN.test(updatedAt.trim())
    const threshold = input.staleThresholdSeconds
      ?? (dateOnly ? DATE_ONLY_STALE_THRESHOLD_SECONDS : DEFAULT_STALE_THRESHOLD_SECONDS)
    if (ageSeconds > threshold) {
      return {
        status: 'stale',
        label: 'Stale',
        detail: `Source observation is older than the freshness window${detailSource}.${cached ? ' Served from a cached snapshot.' : ''}${input.marketClosed ? ' Market is closed; closure does not reset source age.' : ''}`,
      }
    }
  }
  if (input.coverage === 'partial') {
    return {
      status: 'coverage_gap',
      label: 'Partial coverage',
      detail: `Only part of the requested coverage is available${detailSource}.${updatedMs === null ? ' Source as-of is unknown.' : ''}${cached ? ' Served from a cached snapshot.' : ''}`,
    }
  }
  if (updatedMs !== null && input.marketClosed) {
    return {
      status: 'awaiting_update',
      label: 'Market closed',
      detail: `No new trading observation is expected during the declared market closure${detailSource}.${cached ? ' Served from a cached snapshot.' : ''}`,
    }
  }

  if (cached) {
    return {
      status: 'cached',
      label: 'Cached',
      detail: `Served from a cached snapshot${detailSource}.${updatedMs === null ? ' Source as-of is unknown.' : ''}`,
    }
  }

  if (updatedMs !== null) {
    return {
      status: 'live',
      label: 'Live',
      detail: `Source observation is within the freshness window${detailSource}.${input.coverage === 'unknown' ? ' Coverage is unknown.' : ''}`,
    }
  }

  return {
    status: 'unknown',
    label: 'As-of unknown',
    detail: `Source observation time is unavailable${detailSource}. A successful fetch does not establish freshness.`,
  }
}
