'use client'

export type WidgetHealthStatus =
  | 'cached'
  | 'stale'
  | 'limited'
  | 'coverage_gap'
  | 'awaiting_update'
  | 'live'

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
  /** Age in seconds beyond which a non-cached snapshot is considered stale. */
  staleThresholdSeconds?: number
  sourceLabel?: string
}

const DEFAULT_STALE_THRESHOLD_SECONDS = 60 * 60 * 6 // 6h default for EOD-style data

function toMillis(value?: number | string | Date | null): number | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  const ms = date.getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * Derive a `WidgetHealthState` from the common response signals widgets already
 * expose (the `cached` envelope flag, an `updated_at` timestamp, a local-only
 * flag). Returns `null` when data looks live and fresh, so the chip can be
 * hidden in the healthy case. This keeps the dashboard-wide source-health chip
 * consistent without each widget re-implementing the logic.
 */
export function deriveWidgetHealth(input: DeriveHealthInput): WidgetHealthState | null {
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
      detail: `Upstream feed is behind the latest expected update${detailSource}.`,
    }
  }

  const updatedMs = toMillis(updatedAt)
  if (updatedMs !== null) {
    const ageSeconds = (Date.now() - updatedMs) / 1000
    const threshold = input.staleThresholdSeconds ?? DEFAULT_STALE_THRESHOLD_SECONDS
    if (ageSeconds > threshold) {
      return {
        status: 'stale',
        label: 'Stale',
        detail: `Data is older than the freshness window${detailSource}.`,
      }
    }
  }

  if (cached) {
    return {
      status: 'cached',
      label: 'Cached',
      detail: `Served from a cached snapshot${detailSource}.`,
    }
  }

  if (updatedMs !== null) {
    return {
      status: 'live',
      label: 'Live',
      detail: `Fresh data${detailSource}.`,
    }
  }

  return null
}
