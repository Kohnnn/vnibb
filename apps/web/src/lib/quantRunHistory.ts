'use client'

/**
 * Browser-local run history for the quant lab widgets.
 *
 * Pattern mirrors `researchNotebook.ts`: versioned storage key, SSR guard,
 * JSON-parse safety, a change event so open widgets can refresh without a shared
 * global store. Each "run" captures a widget config + headline summary metrics so
 * a computation can be re-applied later. We store summaries only — never full
 * equity/return series — to keep localStorage bounded.
 */

export const QUANT_RUN_HISTORY_KEY = 'vnibb-quant-run-history-v1'
export const QUANT_RUN_HISTORY_EVENT = 'vnibb:quant-run-history:changed'

export type QuantRunWidget =
  | 'signal_robustness_lab'
  | 'monte_carlo_lab'
  | 'edge_half_life'
  | 'pair_lab'

export interface QuantRun {
  id: string
  widget: QuantRunWidget
  name: string
  createdAt: string
  pinned: boolean
  /** Widget-specific knobs needed to re-apply the run (symbol, period, window, threshold, …). */
  config: Record<string, unknown>
  /** Headline metrics only — NOT full series. */
  summary: Record<string, number | string | null>
}

/** Total run budget across all widgets; prune oldest unpinned first. */
const MAX_RUNS = 50

function safeRandomId(): string {
  return `qr:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

function readRaw(): QuantRun[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(QUANT_RUN_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return (parsed as QuantRun[]).filter(
      (run) => run && typeof run.id === 'string' && typeof run.widget === 'string',
    )
  } catch {
    return []
  }
}

/** Prune to the budget: keep all pinned, then newest unpinned up to the cap. */
function pruneToBudget(runs: QuantRun[]): QuantRun[] {
  if (runs.length <= MAX_RUNS) return runs
  const pinned = runs.filter((run) => run.pinned)
  const unpinned = runs
    .filter((run) => !run.pinned)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
  const slots = Math.max(0, MAX_RUNS - pinned.length)
  return [...pinned, ...unpinned.slice(0, slots)]
}

function write(runs: QuantRun[]): void {
  if (typeof window === 'undefined') return
  const next = pruneToBudget(runs)
  try {
    window.localStorage.setItem(QUANT_RUN_HISTORY_KEY, JSON.stringify(next))
  } catch {
    // best-effort: drop unpinned entirely if storage is full
    try {
      window.localStorage.setItem(
        QUANT_RUN_HISTORY_KEY,
        JSON.stringify(next.filter((run) => run.pinned)),
      )
    } catch {
      // give up silently
    }
  }
  window.dispatchEvent(new CustomEvent(QUANT_RUN_HISTORY_EVENT))
}

/** All runs (optionally filtered to one widget), newest first. */
export function listRuns(widget?: QuantRunWidget): QuantRun[] {
  const all = readRaw().sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
  return widget ? all.filter((run) => run.widget === widget) : all
}

export function saveRun(input: Omit<QuantRun, 'id' | 'createdAt' | 'pinned'> & { pinned?: boolean }): QuantRun {
  const run: QuantRun = {
    ...input,
    id: safeRandomId(),
    createdAt: new Date().toISOString(),
    pinned: input.pinned ?? false,
  }
  write([run, ...readRaw()])
  return run
}

export function togglePin(id: string): QuantRun[] {
  const next = readRaw().map((run) => (run.id === id ? { ...run, pinned: !run.pinned } : run))
  write(next)
  return listRuns()
}

export function deleteRun(id: string): QuantRun[] {
  write(readRaw().filter((run) => run.id !== id))
  return listRuns()
}

/** Remove all unpinned runs (optionally only for one widget). */
export function clearUnpinned(widget?: QuantRunWidget): QuantRun[] {
  const next = readRaw().filter((run) => run.pinned || (widget ? run.widget !== widget : false))
  write(next)
  return listRuns()
}

/** CSV-friendly flattening of a run list for export. */
export function runsToRows(runs: QuantRun[]): Array<Record<string, string | number>> {
  return runs.map((run) => {
    const row: Record<string, string | number> = {
      widget: run.widget,
      name: run.name,
      createdAt: run.createdAt,
      pinned: run.pinned ? 'yes' : 'no',
    }
    for (const [key, value] of Object.entries(run.summary)) {
      row[`summary.${key}`] = value === null ? '' : value
    }
    for (const [key, value] of Object.entries(run.config)) {
      if (typeof value === 'number' || typeof value === 'string') row[`config.${key}`] = value
    }
    return row
  })
}
