'use client'

import type { ExportProvenance } from '@/lib/exportWidget'

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
  const provenance: Partial<ExportProvenance> = {
    sourceLabel: input.sourceLabel ?? (input.derived ? 'Quant (derived)' : 'Quant metrics'),
    apiGroup: input.apiGroup ?? '/quant',
    endpoint: input.endpoint,
    adjustmentMode: adjustmentMode ?? undefined,
    updatedAt: lastDataDate ?? undefined,
  }
  return {
    __widgetRuntime: {
      layoutHint: { empty: input.empty, compactHeight: input.compactHeight },
      provenance,
    },
    ...(input.extra ?? {}),
  }
}
