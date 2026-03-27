'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts'
import { Sparkline } from '@/components/ui/Sparkline'
import { EMPTY_VALUE } from '@/lib/units'
import { cn } from '@/lib/utils'

export interface DenseTableColumn {
  key: string
  label: string
  align?: 'left' | 'right'
  width?: string
}

export interface DenseTableRow {
  id: string
  label: string
  values: Record<string, number | string | null | undefined>
  indent?: number
  isGroup?: boolean
  parentId?: string
}

interface DenseFinancialTableProps {
  columns: DenseTableColumn[]
  rows: DenseTableRow[]
  sortable?: boolean
  maxYears?: number
  showTrend?: boolean
  showGrowth?: boolean
  className?: string
  storageKey?: string
  footerNote?: string
  valueFormatter?: (
    value: number | string | null | undefined,
    row: DenseTableRow,
    columnKey: string
  ) => string
}

type SortDirection = 'asc' | 'desc'

function asNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function defaultFormatter(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return EMPTY_VALUE
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return EMPTY_VALUE
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  }
  return String(value)
}

function isEmphasisRow(row: DenseTableRow): boolean {
  if (row.isGroup) return true
  return /^(total|net income|gross profit|operating income|ebit|ebitda|shareholders'? equity|owners'? equity|cash and cash equivalents)/i.test(
    row.label.trim()
  )
}

function sortRowsByColumn(
  rowItems: DenseTableRow[],
  columnKey: string,
  direction: SortDirection
): DenseTableRow[] {
  return [...rowItems].sort((a, b) => {
    const aVal = asNumber(a.values[columnKey])
    const bVal = asNumber(b.values[columnKey])
    if (aVal === null && bVal === null) return 0
    if (aVal === null) return 1
    if (bVal === null) return -1
    return direction === 'asc' ? aVal - bVal : bVal - aVal
  })
}

export function DenseFinancialTable({
  columns,
  rows,
  sortable = true,
  maxYears = 10,
  showTrend = true,
  showGrowth = true,
  className,
  storageKey,
  footerNote,
  valueFormatter,
}: DenseFinancialTableProps) {
  const visibleColumns = useMemo(() => columns.slice(0, Math.max(1, maxYears)), [columns, maxYears])
  const metricColumnWidth = 168
  const yearColumnWidth = 104
  const trendColumnWidth = 88
  const tableMinWidth = metricColumnWidth + visibleColumns.length * yearColumnWidth + (showTrend ? trendColumnWidth : 0)
  const hasGroups = useMemo(() => rows.some((row) => row.isGroup), [rows])
  const groupChildCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const row of rows) {
      if (!row.parentId) continue
      counts[row.parentId] = (counts[row.parentId] || 0) + 1
    }
    return counts
  }, [rows])

  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [copiedCellKey, setCopiedCellKey] = useState<string | null>(null)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    if (storageKey && typeof window !== 'undefined') {
      try {
        const raw = window.sessionStorage.getItem(`dense_table:${storageKey}`)
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, boolean>
          if (parsed && typeof parsed === 'object') {
            return parsed
          }
        }
      } catch {
        // Ignore session storage parsing errors.
      }
    }

    const map: Record<string, boolean> = {}
    for (const row of rows) {
      if (row.isGroup) map[row.id] = true
    }
    return map
  })

  useEffect(() => {
    const groupIds = rows.filter((row) => row.isGroup).map((row) => row.id)
    if (!groupIds.length) return
    setExpandedGroups((prev) => {
      const next = { ...prev }
      let changed = false
      for (const groupId of groupIds) {
        if (!(groupId in next)) {
          next[groupId] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [rows])

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return
    try {
      window.sessionStorage.setItem(`dense_table:${storageKey}`, JSON.stringify(expandedGroups))
    } catch {
      // Ignore session storage failures.
    }
  }, [expandedGroups, storageKey])

  const displayedRows = useMemo(() => {
    if (!hasGroups) {
      if (!sortable || !sortKey) {
        return rows
      }
      return sortRowsByColumn(rows, sortKey, sortDirection)
    }

    const childrenByParent = new Map<string, DenseTableRow[]>()
    const topLevelRows: DenseTableRow[] = []

    for (const row of rows) {
      if (!row.parentId) {
        topLevelRows.push(row)
        continue
      }
      const siblings = childrenByParent.get(row.parentId) ?? []
      siblings.push(row)
      childrenByParent.set(row.parentId, siblings)
    }

    const topLevelIds = new Set(topLevelRows.map((row) => row.id))
    const result: DenseTableRow[] = []
    for (const row of topLevelRows) {
      result.push(row)

      const childRows = childrenByParent.get(row.id) ?? []
      if (!childRows.length) continue
      const isCollapsibleGroup = (groupChildCounts[row.id] || 0) > 3
      if (isCollapsibleGroup && expandedGroups[row.id] === false) continue

      if (sortable && sortKey) {
        result.push(...sortRowsByColumn(childRows, sortKey, sortDirection))
      } else {
        result.push(...childRows)
      }
    }

    const orphans = rows.filter((row) => row.parentId && !topLevelIds.has(row.parentId))
    if (orphans.length) {
      if (sortable && sortKey) {
        result.push(...sortRowsByColumn(orphans, sortKey, sortDirection))
      } else {
        result.push(...orphans)
      }
    }

    return result
  }, [rows, expandedGroups, sortable, sortKey, hasGroups, sortDirection, groupChildCounts])

  const onSort = (columnKey: string) => {
    if (!sortable) return
    if (sortKey === columnKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(columnKey)
    setSortDirection('desc')
  }

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  const toggleAllGroups = () => {
    const ids = rows.filter((row) => row.isGroup).map((row) => row.id)
    if (!ids.length) return
    const allExpanded = ids.every((id) => expandedGroups[id] !== false)
    const next: Record<string, boolean> = {}
    for (const id of ids) next[id] = !allExpanded
    setExpandedGroups((prev) => ({ ...prev, ...next }))
  }

  const handleCopyValue = async (cellKey: string, value: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText || value === EMPTY_VALUE) return

    try {
      await navigator.clipboard.writeText(value)
      setCopiedCellKey(cellKey)
      window.setTimeout(() => {
        setCopiedCellKey((current) => (current === cellKey ? null : current))
      }, 900)
    } catch {
      // Ignore clipboard failures.
    }
  }

  const toggleExpandedRow = (rowId: string) => {
    setExpandedRowId((current) => (current === rowId ? null : rowId))
  }

  return (
    <div className={cn('w-full', className)}>
      <div className="overflow-auto">
      <table className="data-table financial-dense freeze-first-col min-w-max w-full border-separate border-spacing-0 text-[10px] text-left leading-4" style={{ minWidth: `${tableMinWidth}px` }}>
        <thead className="sticky top-0 z-10 bg-[var(--bg-primary)] text-[var(--text-muted)]">
          <tr className="border-b border-[var(--border-color)]">
            <th className="px-2 py-1 font-bold uppercase tracking-tighter" style={{ minWidth: `${metricColumnWidth}px`, width: `${metricColumnWidth}px` }}>Metric</th>
            {visibleColumns.map((column) => {
              const isActiveSort = sortKey === column.key
              return (
                <th
                  key={column.key}
                  className={cn(
                    'px-2 py-1 font-bold',
                    column.align === 'left' ? 'text-left' : 'text-right',
                    sortable ? 'cursor-pointer select-none hover:text-[var(--text-primary)]' : ''
                  )}
                  style={column.width ? { minWidth: column.width, width: column.width } : { minWidth: `${yearColumnWidth}px`, width: `${yearColumnWidth}px` }}
                  aria-sort={isActiveSort ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                  tabIndex={sortable ? 0 : undefined}
                  onClick={() => onSort(column.key)}
                  onKeyDown={(event) => {
                    if (!sortable) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSort(column.key)
                    }
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    {column.label}
                    {isActiveSort ? <span>{sortDirection === 'asc' ? '↑' : '↓'}</span> : null}
                  </span>
                </th>
              )
            })}
            {showTrend ? (
              <th className="trend-col px-2 py-1 text-center font-bold uppercase tracking-tighter" style={{ minWidth: `${trendColumnWidth}px`, width: `${trendColumnWidth}px` }}>Trend</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {displayedRows.map((row, rowIndex) => {
            const trendValues = visibleColumns
              .map((column) => asNumber(row.values[column.key]))
              .filter((value): value is number => value !== null)
            const inlineChartData = visibleColumns
              .map((column) => ({ period: column.label, value: asNumber(row.values[column.key]) }))
              .filter((point): point is { period: string; value: number } => point.value !== null)

            return (
              <Fragment key={row.id}>
                <tr
                  key={row.id}
                  className={cn(
                    'h-6 border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-hover)]',
                    rowIndex % 2 === 1 && !row.isGroup ? 'bg-[var(--bg-secondary)]/25' : '',
                    row.isGroup ? 'section-header-row bg-[var(--bg-surface)] font-semibold' : '',
                    isEmphasisRow(row) && !row.isGroup ? 'border-t border-[var(--border-default)] bg-[var(--bg-surface)]/55 font-semibold' : ''
                  )}
                >
                  <td
                    className={cn(
                      'px-2 py-1 text-[var(--text-secondary)]',
                      isEmphasisRow(row) ? 'text-[var(--text-primary)]' : ''
                    )}
                    style={{ minWidth: `${metricColumnWidth}px`, width: `${metricColumnWidth}px`, ...(row.indent ? { paddingLeft: `${8 + row.indent}px` } : {}) }}
                  >
                    {row.isGroup ? (
                      (groupChildCounts[row.id] || 0) > 3 ? (
                        <button
                          className="inline-flex items-center gap-2 text-[var(--text-primary)]"
                          onClick={() => toggleGroup(row.id)}
                          onDoubleClick={toggleAllGroups}
                        >
                          <span>{expandedGroups[row.id] === false ? '▸' : '▾'}</span>
                          <span>{row.label}</span>
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-[var(--text-primary)]">
                          <span>{row.label}</span>
                        </span>
                      )
                    ) : (
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 text-left text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        onClick={() => toggleExpandedRow(row.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape' && expandedRowId === row.id) {
                            event.preventDefault()
                            setExpandedRowId(null)
                          }
                        }}
                        aria-expanded={expandedRowId === row.id}
                        aria-label={`Toggle ${row.label} trend chart`}
                      >
                        <span>{row.label}</span>
                        <span className="text-[10px] text-[var(--text-muted)]">{expandedRowId === row.id ? 'Hide' : 'Chart'}</span>
                      </button>
                    )}
                  </td>

                  {visibleColumns.map((column, index) => {
                    const rawValue = row.values[column.key]
                    const displayValue = row.isGroup
                      ? ''
                      : valueFormatter
                        ? valueFormatter(rawValue, row, column.key)
                        : defaultFormatter(rawValue)

                    const currentNumber = asNumber(rawValue)
                    const previousNumber =
                      showGrowth && !row.isGroup && index > 0
                        ? asNumber(row.values[visibleColumns[index - 1].key])
                        : null

                    let growthPct: number | null = null
                    if (
                      showGrowth &&
                      currentNumber !== null &&
                      previousNumber !== null &&
                      previousNumber !== 0
                    ) {
                      growthPct = ((currentNumber - previousNumber) / Math.abs(previousNumber)) * 100
                    }

                    return (
                      <td
                        key={`${row.id}:${column.key}`}
                        data-type="number"
                        className={cn(
                          'px-2 py-1 tabular-nums text-[var(--text-primary)]',
                          row.isGroup ? 'cursor-default' : 'cursor-copy',
                          copiedCellKey === `${row.id}:${column.key}` ? 'ring-1 ring-inset ring-blue-400/80' : '',
                          column.align === 'left' ? 'text-left' : 'text-right'
                        )}
                        style={column.width ? { minWidth: column.width, width: column.width } : { minWidth: `${yearColumnWidth}px`, width: `${yearColumnWidth}px` }}
                        onClick={() => {
                          if (!row.isGroup) {
                            void handleCopyValue(`${row.id}:${column.key}`, displayValue)
                          }
                        }}
                      >
                        <span>{displayValue}</span>
                        {growthPct !== null ? (
                          <span
                            className={cn(
                              'ml-1 inline-flex rounded px-1 py-0.5 text-[9px] font-semibold',
                              growthPct === 0
                                ? 'bg-slate-500/15 text-slate-300'
                                : growthPct >= 0
                                ? 'bg-emerald-500/15 text-emerald-500'
                                : 'bg-rose-500/15 text-rose-500'
                            )}
                          >
                            {growthPct >= 0 ? '+' : ''}
                            {growthPct.toFixed(1)}%
                          </span>
                        ) : null}
                      </td>
                    )
                  })}

                  {showTrend ? (
                    <td className="trend-col px-2 py-1 text-center">
                      {row.isGroup ? null : trendValues.length < 2 ? (
                        <span className="text-[10px] text-[var(--text-muted)]">{EMPTY_VALUE}</span>
                      ) : (
                        <Sparkline data={trendValues} width={74} height={18} />
                      )}
                    </td>
                  ) : null}
                </tr>
                {!row.isGroup && expandedRowId === row.id ? (
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/40">
                    <td colSpan={visibleColumns.length + 1 + (showTrend ? 1 : 0)} className="px-3 py-3">
                      {inlineChartData.length < 2 ? (
                        <div className="text-[11px] text-[var(--text-muted)]">Need at least two reported periods to draw a trend.</div>
                      ) : (
                        <div className="h-[120px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={inlineChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                              <XAxis dataKey="period" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={48} />
                              <RechartsTooltip
                                contentStyle={{
                                  background: 'var(--bg-secondary)',
                                  border: '1px solid var(--border-color)',
                                  borderRadius: '8px',
                                  fontSize: '11px',
                                }}
                                formatter={(value: number | undefined) => [defaultFormatter(value), row.label]}
                              />
                              <Area type="monotone" dataKey="value" stroke="#38bdf8" strokeWidth={2} fill="rgba(56,189,248,0.18)" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      </div>
      {footerNote ? <div className="px-2 pt-2 text-[10px] italic text-[var(--text-muted)]">{footerNote}</div> : null}
    </div>
  )
}

export default DenseFinancialTable
