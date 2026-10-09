'use client'

import { buildWidgetRuntime } from '@/lib/widgetRuntime'

/**
 * Shared helpers for quant widgets (Phase 1 follow-up).
 *
 * The VNIBB `/quant` endpoints already compute a `warning` (staleness /
 * insufficient-history / merged-quote) and an `adjustment_mode` + `last_data_date`
 * on every response, but most quant widgets silently dropped them. These helpers
 * make it a one-liner to:
 *   1) extract the backend warning + data-quality note, and
 *   2) build a consistent `__widgetRuntime` payload (layoutHint + provenance) so
 *      the dashboard-wide source-health chip and source-aware exports work.
 */

export interface QuantResponseLike {
  data?: {
    symbol?: string
    period?: string
    adjustment_mode?: string | null
    computed_at?: string | null
    last_data_date?: string | null
    warning?: string | null
    data_quality_note?: string | null
    metrics?: Record<string, unknown>
    [key: string]: unknown
  } | null
  error?: string | null
}

/**
 * Pull a human-readable warning from a quant response. Checks the top-level
 * `warning`/`data_quality_note`, then a per-metric `warning`/`data_quality_note`
 * when a metric key is supplied.
 */
export function extractQuantWarning(response: QuantResponseLike | undefined, metricKey?: string): string | null {
  const data = response?.data
  if (!data) return null
  const direct = data.warning || data.data_quality_note
  if (direct) return String(direct)
  if (metricKey && data.metrics && typeof data.metrics === 'object') {
    const metric = (data.metrics as Record<string, unknown>)[metricKey]
    if (metric && typeof metric === 'object') {
      const m = metric as Record<string, unknown>
      const nested = m.warning || m.data_quality_note
      if (nested) return String(nested)
    }
  }
  return null
}

export interface QuantRuntimeInput {
  symbol: string
  empty: boolean
  compactHeight?: number
  endpoint: string
  sourceLabel?: string
  apiGroup?: string
  response?: QuantResponseLike
  fetchedAt?: number | string | Date | null
  /** Override adjustment mode when the widget computes it client-side. */
  adjustmentMode?: string
  /** Mark client-derived widgets so the chip reflects local computation. */
  derived?: boolean
  /** Extra fields to merge into the export payload. */
  extra?: Record<string, unknown>
}

/**
 * Build the `__widgetRuntime` payload (layoutHint + provenance) plus any extra
 * export fields. Provenance reads adjustment mode + last_data_date straight from
 * the quant response so exports/chips stay accurate.
 */
export function buildQuantRuntime(input: QuantRuntimeInput): Record<string, unknown> {
  const data = input.response?.data
  const lastDataDate = data?.last_data_date ?? null
  const adjustmentMode = input.adjustmentMode ?? data?.adjustment_mode ?? undefined
  return buildWidgetRuntime({
    empty: input.empty,
    compactHeight: input.compactHeight,
    apiGroup: input.apiGroup ?? '/quant',
    endpoint: input.endpoint,
    sourceLabel: input.sourceLabel ?? (input.derived ? 'Quant (derived)' : 'Quant metrics'),
    lastDataDate,
    fetchedAt: input.fetchedAt ?? data?.computed_at ?? null,
    adjustmentMode,
    derived: input.derived,
    extra: input.extra,
  })
}

export interface QuantBasisLike {
  include_latest_quote?: boolean | null
  period?: string | null
  start_date?: string | null
  end_date?: string | null
  adjustment_mode?: string | null
  source?: string | null
  fee_bps?: number | null
  initial_capital?: number | null
  execution?: string | null
  sharpe_convention?: string | null
  fast_window?: number | null
  slow_window?: number | null
  fast_windows?: number[] | null
  slow_windows?: number[] | null
}

/**
 * One-line disclosure of the session/parameter basis the server actually used.
 *
 * Issue #106: a backtest Sharpe and a sweep cell are only comparable when their
 * dates, data basis and adjustment match, so each widget states the basis instead
 * of leaving the reader to assume equivalence. Returns null when the response
 * carries no basis, so a caller never asserts a basis the server did not state.
 */
export function describeQuantBasis(basis?: QuantBasisLike | null): string | null {
  if (!basis || typeof basis !== 'object') return null
  const parts: string[] = []
  if (basis.start_date && basis.end_date) parts.push(`sessions ${basis.start_date}..${basis.end_date}`)
  if (basis.include_latest_quote ===false) parts.push('latest quote excluded')
  else if (basis.include_latest_quote ===true) parts.push('latest quote merged')
  if (basis.adjustment_mode) parts.push(`${basis.adjustment_mode} history`)
  if (basis.source) parts.push(`source ${basis.source}`)
  if (typeof basis.fee_bps === 'number') parts.push(`fee ${basis.fee_bps} bps`)
  if (typeof basis.initial_capital === 'number') parts.push(`capital ${basis.initial_capital}`)
  if (basis.execution) parts.push(basis.execution.replace(/_/g, ' '))
  if (typeof basis.fast_window === 'number' && typeof basis.slow_window === 'number') parts.push(`windows ${basis.fast_window}/${basis.slow_window}`)
  if (basis.fast_windows?.length && basis.slow_windows?.length) parts.push(`grid ${basis.fast_windows.join('/')} × ${basis.slow_windows.join('/')}`)
  if (basis.sharpe_convention) parts.push(basis.sharpe_convention)
  return parts.length > 0 ? parts.join(' · ') : null
}
