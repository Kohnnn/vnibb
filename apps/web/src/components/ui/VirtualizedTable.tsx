'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

export interface VirtualizedColumn<T> {
  id: string;
  header: string;
  accessor: keyof T | ((row: T) => ReactNode);
  width?: number;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
}

interface VirtualizedTableProps<T> {
  data: T[];
  columns: VirtualizedColumn<T>[];
  rowHeight?: number;
  headerHeight?: number;
  onRowClick?: (row: T, index: number) => void;
  interactiveCells?: boolean;
  className?: string;
  emptyMessage?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (field: string, order: 'asc' | 'desc') => void;
}

export function VirtualizedTable<T>({
  data,
  columns,
  rowHeight = 40,
  headerHeight = 40,
  onRowClick,
  interactiveCells = false,
  className = '',
  emptyMessage = 'No data available',
  sortField,
  sortOrder,
  onSort,
}: VirtualizedTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    // The sticky header precedes the row canvas in this scrollport.
    scrollMargin: headerHeight,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  const handleSort = (columnId: string) => {
    if (!onSort) return;
    const isSameField = sortField === columnId;
    const newOrder = isSameField && sortOrder === 'desc' ? 'asc' : 'desc';
    onSort(columnId, newOrder);
  };

  const getCellValue = (row: T, column: VirtualizedColumn<T>) => {
    if (typeof column.accessor === 'function') {
      return column.accessor(row);
    }
    return row[column.accessor] as ReactNode;
  };

  if (data.length === 0) {
    return (
      <div className={cn("flex h-40 items-center justify-center text-[var(--text-muted)]", className)}>
        {emptyMessage}
      </div>
    );
  }

  const flexibleColumnMinWidth = 80;
  const minWidth = columns.reduce((total, column) => total + (column.width ?? flexibleColumnMinWidth), 0);
  const gridTemplateColumns = columns.map(({ width }) => (
    width === undefined ? `minmax(${flexibleColumnMinWidth}px, 1fr)` : `${width}px`
  )).join(' ');

  return (
    <div
      ref={parentRef}
      className={cn("h-full overflow-auto scrollbar-hide", className)}
      style={{ scrollPaddingTop: headerHeight }}
    >
      <div style={{ minWidth }}>
        {/* Header */}
        <div
          className="sticky top-0 z-10 grid border-b border-[var(--border-color)] bg-[var(--bg-secondary)]"
          style={{ height: headerHeight, gridTemplateColumns }}
        >
          {columns.map(column => {
            const isSorted = sortField === column.id;
            const canSort = column.sortable !== false && !!onSort;

            return (
              <div
                key={column.id}
                onClick={() => canSort && handleSort(column.id)}
                className={cn(
                    "flex select-none items-center px-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] transition-colors",
                    canSort ? 'cursor-pointer hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]' : '',
                    column.align === 'right' ? 'justify-end text-right' :
                    column.align === 'center' ? 'justify-center text-center' : 'justify-start text-left'
                )}
              >
                <div className="flex items-center gap-1.5">
                  {column.header}
                  {canSort && (
                      <div className="flex flex-col opacity-30">
                          {isSorted ? (
                              sortOrder === 'asc' ? <ArrowUp size={10} className="text-[var(--color-accent-primary)]" /> : <ArrowDown size={10} className="text-[var(--color-accent-primary)]" />
                          ) : (
                              <ArrowUpDown size={10} />
                          )}
                      </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Virtualized Body */}
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map(virtualItem => {
            const row = data[virtualItem.index];
            if (!row) return null;
            const rowLabel = (row as any).symbol || (row as any).ticker || (row as any).name;
            const isClickable = Boolean(onRowClick);

            return (
              <div
                key={virtualItem.key}
                className={cn(
                    "absolute left-0 top-0 grid w-full items-center border-b border-[var(--border-subtle)] transition-colors",
                    isClickable ? 'cursor-pointer hover:bg-[var(--bg-tertiary)]' : '',
                    isClickable && !interactiveCells ? 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]' : '',
                    virtualItem.index % 2 ? 'bg-[var(--bg-secondary)]/40' : 'bg-transparent'
                )}
                style={{
                  height: `${virtualItem.size}px`,
                  gridTemplateColumns,
                  transform: `translateY(${virtualItem.start - headerHeight}px)`,
                }}
                role={isClickable && !interactiveCells ? 'button' : undefined}
                tabIndex={isClickable && !interactiveCells ? 0 : undefined}
                aria-label={isClickable && !interactiveCells ? `View ${rowLabel || 'row'}` : undefined}
                onClick={() => onRowClick?.(row, virtualItem.index)}
                onKeyDown={(event) => {
                  if (!isClickable || interactiveCells) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onRowClick?.(row, virtualItem.index);
                  }
                }}
              >
                {columns.map(column => (
                  <div
                    key={column.id}
                    className={cn(
                        "px-3 text-sm truncate",
                        column.align === 'right' ? 'text-right' : 
                        column.align === 'center' ? 'text-center' : 'text-left'
                    )}
                  >
                    {getCellValue(row, column)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default VirtualizedTable;
