'use client'

import type { ExportProvenance } from '@/lib/exportWidget'

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
  /** Concrete endpoint hit, e.g. '/equity/historical?symbol=FPT'. */
  endpoint: string
  /** Human-readable source label shown on the health chip / exports. */
  sourceLabel?: string
  /** Compact row height (grid units) when empty. */
  compactHeight?: number
  /** Last data timestamp from the response (drives "updated" + staleness). */
  lastDataDate?: number | string | Date | null
  /** Adjustment mode when relevant (e.g. 'adjusted' | 'raw'). */
  adjustmentMode?: string
  /** True when the widget computes its values client-side. */
  derived?: boolean
  /** Whether the served data is cached / stale (optional badges). */
  cached?: boolean
  stale?: boolean
  /** Extra fields merged into the onDataChange payload (e.g. rows for export). */
  extra?: Record<string, unknown>
}

export type WidgetDataPayload = Record<string, unknown>

/**
 * Build a `{ __widgetRuntime: { layoutHint, provenance }, ...extra }` payload.
 * Pass the result straight to `onDataChange?.(...)`.
 */
export function buildWidgetRuntime(input: WidgetRuntimeInput): WidgetDataPayload {
  const provenance: Partial<ExportProvenance> = {
    sourceLabel: input.sourceLabel ?? (input.derived ? 'Derived (client)' : undefined),
    apiGroup: input.apiGroup,
    endpoint: input.endpoint,
    adjustmentMode: input.adjustmentMode,
    updatedAt: input.lastDataDate ?? undefined,
    localOnly: input.derived || undefined,
    cached: input.cached,
    stale: input.stale,
  }
  return {
    __widgetRuntime: {
      layoutHint: { empty: input.empty, compactHeight: input.compactHeight },
      provenance,
    },
    ...(input.extra ?? {}),
  }
}
