'use client'

import { useEffect, useState } from 'react'
import { History, Pin, PinOff, Save, Trash2, Download, X } from 'lucide-react'
import {
  listRuns,
  saveRun,
  togglePin,
  deleteRun,
  clearUnpinned,
  runsToRows,
  QUANT_RUN_HISTORY_EVENT,
  type QuantRun,
  type QuantRunWidget,
} from '@/lib/quantRunHistory'
import { exportToCSV } from '@/lib/exportWidget'

interface QuantRunHistoryPanelProps {
  widget: QuantRunWidget
  /** Build the run to save from current widget state. Return null to skip (e.g. no data). */
  buildRun: () => { name: string; config: Record<string, unknown>; summary: Record<string, number | string | null> } | null
  /** Re-apply a saved run's config to the widget's knobs. */
  onApply: (config: Record<string, unknown>) => void
  /** Headline metric key to surface in the list (from summary). */
  headlineKey?: string
  headlineLabel?: string
}

function useRuns(widget: QuantRunWidget): QuantRun[] {
  const [runs, setRuns] = useState<QuantRun[]>([])
  useEffect(() => {
    const refresh = () => setRuns(listRuns(widget))
    refresh()
    window.addEventListener(QUANT_RUN_HISTORY_EVENT, refresh)
    return () => window.removeEventListener(QUANT_RUN_HISTORY_EVENT, refresh)
  }, [widget])
  return runs
}

function formatHeadline(run: QuantRun, key?: string): string {
  if (!key) return ''
  const value = run.summary[key]
  if (value === null || value === undefined) return '—'
  return typeof value === 'number' ? value.toFixed(2) : String(value)
}

/**
 * Shared Save-run / History panel for the quant lab widgets. Browser-local,
 * descriptive — re-applying a run only restores knobs; data refetches naturally.
 */
export function QuantRunHistoryPanel({
  widget,
  buildRun,
  onApply,
  headlineKey,
  headlineLabel,
}: QuantRunHistoryPanelProps) {
  const runs = useRuns(widget)
  const [open, setOpen] = useState(false)
  const [compare, setCompare] = useState<[string, string] | null>(null)

  const handleSave = () => {
    const payload = buildRun()
    if (!payload) return
    saveRun({ widget, ...payload })
    setOpen(true)
  }

  const handleExport = () => {
    if (!runs.length) return
    exportToCSV(runsToRows(runs), `quant-runs-${widget}`)
  }

  const compareRuns = compare
    ? [runs.find((r) => r.id === compare[0]), runs.find((r) => r.id === compare[1])]
    : null

  return (
    <div className="px-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="flex items-center gap-1 rounded bg-blue-600/20 px-1.5 py-0.5 text-[10px] font-semibold text-blue-200 hover:bg-blue-600/30"
        >
          <Save size={10} /> Save run
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <History size={10} /> History{runs.length ? ` (${runs.length})` : ''}
        </button>
        {open && runs.length > 0 && (
          <>
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <Download size={10} /> CSV
            </button>
            <button
              type="button"
              onClick={() => clearUnpinned(widget)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-red-300"
            >
              Clear unpinned
            </button>
          </>
        )}
      </div>

      {open && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 p-1">
          {runs.length === 0 ? (
            <div className="px-2 py-1.5 text-[10px] text-[var(--text-muted)]">
              No saved runs yet. Save the current configuration to reload it later.
            </div>
          ) : (
            <ul className="space-y-0.5">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] hover:bg-[var(--bg-hover)]"
                >
                  <button
                    type="button"
                    onClick={() => togglePin(run.id)}
                    title={run.pinned ? 'Unpin' : 'Pin'}
                    className={run.pinned ? 'text-amber-300' : 'text-[var(--text-muted)] hover:text-amber-300'}
                  >
                    {run.pinned ? <Pin size={10} /> : <PinOff size={10} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => onApply(run.config)}
                    className="flex-1 truncate text-left text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    title="Re-apply this configuration"
                  >
                    {run.name}
                  </button>
                  {headlineKey && (
                    <span className="font-mono text-[var(--text-muted)]" title={headlineLabel}>
                      {formatHeadline(run, headlineKey)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setCompare((prev) => {
                        if (!prev) return [run.id, run.id]
                        return [prev[1], run.id]
                      })
                    }
                    title="Add to compare"
                    className="text-[var(--text-muted)] hover:text-cyan-300"
                  >
                    cmp
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteRun(run.id)}
                    title="Delete"
                    className="text-[var(--text-muted)] hover:text-red-300"
                  >
                    <Trash2 size={10} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {compareRuns && compareRuns[0] && compareRuns[1] && compareRuns[0].id !== compareRuns[1].id && (
            <CompareTable a={compareRuns[0]} b={compareRuns[1]} onClose={() => setCompare(null)} />
          )}
        </div>
      )}
    </div>
  )
}

function CompareTable({ a, b, onClose }: { a: QuantRun; b: QuantRun; onClose: () => void }) {
  const keys = Array.from(new Set([...Object.keys(a.summary), ...Object.keys(b.summary)]))
  const num = (v: number | string | null | undefined): number | null =>
    typeof v === 'number' ? v : null
  return (
    <div className="mt-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-1 text-[10px]">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold text-[var(--text-secondary)]">Compare runs</span>
        <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-red-300">
          <X size={10} />
        </button>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 gap-y-0.5">
        <span className="text-[var(--text-muted)]">metric</span>
        <span className="truncate text-right text-[var(--text-muted)]" title={a.name}>A</span>
        <span className="truncate text-right text-[var(--text-muted)]" title={b.name}>B</span>
        <span className="text-right text-[var(--text-muted)]">Δ</span>
        {keys.map((key) => {
          const av = a.summary[key]
          const bv = b.summary[key]
          const an = num(av)
          const bn = num(bv)
          const delta = an !== null && bn !== null ? (bn - an).toFixed(2) : '—'
          return (
            <Row key={key} k={key} a={av ?? '—'} b={bv ?? '—'} d={delta} />
          )
        })}
      </div>
    </div>
  )
}

function Row({ k, a, b, d }: { k: string; a: number | string; b: number | string; d: string }) {
  const fmt = (v: number | string) => (typeof v === 'number' ? v.toFixed(2) : v)
  return (
    <>
      <span className="truncate text-[var(--text-secondary)]">{k}</span>
      <span className="text-right font-mono text-[var(--text-primary)]">{fmt(a)}</span>
      <span className="text-right font-mono text-[var(--text-primary)]">{fmt(b)}</span>
      <span className="text-right font-mono text-cyan-300">{d}</span>
    </>
  )
}

export default QuantRunHistoryPanel
