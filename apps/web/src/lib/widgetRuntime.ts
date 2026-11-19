'use client'

import type { ExportProvenance } from '@/lib/widgetProvenance'

/**
 * Shared `__widgetRuntime` payload builder for ALL dashboard widgets.
 *
 * `WidgetWrapper` reads `__widgetRuntime.layoutHint` (auto-compaction when empty)
 * and `__widgetRuntime.provenance` (the source-health chip + source-aware exports)
 * from each widget's `onDataChange` payload. Historically only ~24 of ~149 widgets
 * emitted this; this helper makes it a one-liner so the rest can opt in.
 *
 * For `/quant` widgets, `buildQuantRuntime` (quantWidgetHelpers.ts) delegates here.
 */

export interface WidgetRuntimeInput {
  /** Mark the widget empty so the wrapper can compact its grid row. */
  empty: boolean
  /** API group, e.g. '/equity', '/market', '/news'. */
  apiGroup: string
  /** Request endpoint, or a route name if marked as a summary. */
  endpoint: string
  endpointKind?: ExportProvenance['endpointKind']
  /** Human-readable source label shown on the health chip / exports. */
  sourceLabel?: string
  /** Compact row height (grid units) when empty. */
  compactHeight?: number
  /** Source observation/as-of only. Never pass query receipt or computation time. */
  lastDataDate?: number | string | Date | null
  /** Retrieval time; does not establish source freshness. */
  fetchedAt?: number | string | Date | null
  coverage?: ExportProvenance['coverage']
  coverageDetail?: ExportProvenance['coverageDetail']
  marketClosed?: boolean
  expectedClosedSession?: boolean
  observationStatus?: ExportProvenance['observationStatus']
  refreshStatus?: ExportProvenance['refreshStatus']
  adjustmentMode?: string
  /** Reporting period the figures belong to (e.g. 'FY', 'Q2', 'TTM'). */
  period?: string
  periodScope?: ExportProvenance['periodScope']
  units?: string
  basis?: string
  /** True when the widget computes its values client-side. */
  derived?: boolean
  /** Whether the served data is cached / stale (optional badges). */
  cached?: boolean
  stale?: boolean
  warnings?: string[]
  /** Extra fields merged into the onDataChange payload (e.g. rows for export). */
  extra?: Record<string, unknown>
  exportData?: unknown
  requestScope?: object
}

export interface WidgetRuntime<T = unknown> {
  readonly layoutHint?: { readonly empty?: boolean; readonly compactHeight?: number }
  readonly provenance?: Partial<ExportProvenance>
  readonly exportData?: unknown
  readonly requestScope?: object
  readonly data?: T
}

export type WidgetDataPayload = Record<string, unknown> & { __widgetRuntime?: WidgetRuntime }

export function getWidgetExportData(data: unknown): unknown {
  if (
    data
    && typeof data === 'object'
    && !Array.isArray(data)
    && '__widgetRuntime' in data
  ) {
    const payload = data as Record<string, unknown> & {
      __widgetRuntime?: { exportData?: unknown }
    }
    const runtimeData = payload.__widgetRuntime?.exportData
    if (runtimeData !== undefined) return runtimeData
    const { __widgetRuntime, ...rest } = payload
    return Object.keys(rest).length > 0 ? rest : undefined
  }
  return data
}

/**
 * Build a `{ __widgetRuntime: { layoutHint, provenance }, ...extra }` payload.
 * Pass the result straight to `onDataChange?.(...)`.
 */
export function buildWidgetRuntime(input: WidgetRuntimeInput): WidgetDataPayload {
  const provenance: Partial<ExportProvenance> = {
    sourceLabel: input.sourceLabel ?? (input.derived ? 'Derived (client)' : undefined),
    apiGroup: input.apiGroup,
    endpoint: input.endpoint,
    endpointKind: input.endpointKind,
    adjustmentMode: input.adjustmentMode,
    period: input.period,
    periodScope: input.periodScope,
    units: input.units,
    basis: input.basis,
    updatedAt: input.lastDataDate ?? null,
    fetchedAt: input.fetchedAt,
    coverage: input.coverage,
    coverageDetail: input.coverageDetail,
    marketClosed: input.marketClosed,
    expectedClosedSession: input.expectedClosedSession,
    observationStatus: input.observationStatus,
    refreshStatus: input.refreshStatus,
    localOnly: input.derived || undefined,
    cached: input.cached,
    stale: input.stale,
    warnings: input.warnings,
  }
  return {
    ...(input.extra ?? {}),
    __widgetRuntime: {
      layoutHint: { empty: input.empty, compactHeight: input.compactHeight },
      provenance,
      exportData: input.exportData,
      ...(input.requestScope !== undefined && { requestScope: input.requestScope }),
    },
  }
}
