'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sparkline } from '@/components/ui/Sparkline'
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
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '-'
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  }
  return String(value)
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
  valueFormatter,
}: DenseFinancialTableProps) {
  const visibleColumns = useMemo(() => columns.slice(0, Math.max(1, maxYears)), [columns, maxYears])
  const hasGroups = useMemo(() => rows.some((row) => row.isGroup), [rows])

  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
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
      if (expandedGroups[row.id] === false) continue

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
  }, [rows, expandedGroups, sortable, sortKey, hasGroups, sortDirection])

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

  return (
    <div className={cn('overflow-auto', className)}>
      <table className="data-table financial-dense freeze-first-col w-full text-[11px] text-left">
        <thead className="sticky top-0 z-10 bg-[var(--bg-primary)] text-[var(--text-muted)]">
          <tr className="border-b border-[var(--border-color)]">
            <th className="py-2 px-2 font-bold uppercase tracking-tighter">Metric</th>
            {visibleColumns.map((column) => {
              const isActiveSort = sortKey === column.key
              return (
                <th
                  key={column.key}
                  className={cn(
                    'py-2 px-2 font-bold',
                    column.align === 'left' ? 'text-left' : 'text-right',
                    sortable ? 'cursor-pointer select-none hover:text-[var(--text-primary)]' : ''
                  )}
                  style={column.width ? { width: column.width } : undefined}
                  onClick={() => onSort(column.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {column.label}
                    {isActiveSort ? <span>{sortDirection === 'asc' ? '↑' : '↓'}</span> : null}
                  </span>
                </th>
              )
            })}
            {showTrend ? (
              <th className="py-2 px-2 text-center font-bold uppercase tracking-tighter">Trend</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {displayedRows.map((row, rowIndex) => {
            const trendValues = visibleColumns
              .slice()
              .reverse()
              .map((column) => asNumber(row.values[column.key]))
              .filter((value): value is number => value !== null)

            return (
              <tr
                key={row.id}
                className={cn(
                  'border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-hover)]',
                  rowIndex % 2 === 1 && !row.isGroup ? 'bg-[var(--bg-secondary)]/30' : '',
                  row.isGroup ? 'bg-[var(--bg-surface)] font-semibold' : ''
                )}
              >
                <td
                  className="py-2 px-2 text-[var(--text-secondary)]"
                  style={row.indent ? { paddingLeft: `${8 + row.indent}px` } : undefined}
                >
                  {row.isGroup ? (
                    <button
                      className="inline-flex items-center gap-2 text-[var(--text-primary)]"
                      onClick={() => toggleGroup(row.id)}
                      onDoubleClick={toggleAllGroups}
                    >
                      <span>{expandedGroups[row.id] === false ? '▸' : '▾'}</span>
                      <span>{row.label}</span>
                    </button>
                  ) : (
                    row.label
                  )}
                </td>

                {visibleColumns.map((column, index) => {
                  const rawValue = row.values[column.key]
                  const displayValue = valueFormatter
                    ? valueFormatter(rawValue, row, column.key)
                    : defaultFormatter(rawValue)

                  const currentNumber = asNumber(rawValue)
                  const previousNumber =
                    showGrowth && index < visibleColumns.length - 1
                      ? asNumber(row.values[visibleColumns[index + 1].key])
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
                          'py-2 px-2 font-mono text-[var(--text-primary)]',
                          column.align === 'left' ? 'text-left' : 'text-right'
                        )}
                    >
                      <span>{displayValue}</span>
                      {growthPct !== null ? (
                        <span
                          className={cn(
                            'ml-1 inline-flex rounded px-1 py-0.5 text-[9px] font-semibold',
                            growthPct >= 0
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
                  <td className="py-2 px-2 text-center">
                    {trendValues.length < 2 ? (
                      <span className="text-[10px] text-[var(--text-muted)]">-</span>
                    ) : (
                      <Sparkline data={trendValues} width={74} height={18} />
                    )}
                  </td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default DenseFinancialTable
