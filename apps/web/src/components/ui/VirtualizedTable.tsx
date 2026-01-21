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
  className?: string;
  emptyMessage?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (field: string, order: 'asc' | 'desc') => void;
}

export function VirtualizedTable<T extends { id?: string | number | any }>({
  data,
  columns,
  rowHeight = 40,
  headerHeight = 40,
  onRowClick,
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
      <div className={cn("flex items-center justify-center h-40 text-gray-500", className)}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full overflow-hidden", className)}>
      {/* Header */}
      <div 
        className="flex bg-gray-900 border-b border-gray-800 sticky top-0 z-10 shrink-0"
        style={{ height: headerHeight }}
      >
        {columns.map(column => {
          const isSorted = sortField === column.id;
          const canSort = column.sortable !== false && !!onSort;

          return (
            <div
              key={column.id}
              onClick={() => canSort && handleSort(column.id)}
              className={cn(
                  "flex items-center px-3 text-[10px] font-black text-gray-500 uppercase tracking-wider transition-colors select-none",
                  canSort ? 'cursor-pointer hover:text-gray-300 hover:bg-white/5' : '',
                  column.align === 'right' ? 'justify-end text-right' : 
                  column.align === 'center' ? 'justify-center text-center' : 'justify-start text-left'
              )}
              style={{ width: column.width || 'auto', flex: column.width ? 'none' : 1 }}
            >
              <div className="flex items-center gap-1.5">
                {column.header}
                {canSort && (
                    <div className="flex flex-col opacity-30">
                        {isSorted ? (
                            sortOrder === 'asc' ? <ArrowUp size={10} className="text-blue-500" /> : <ArrowDown size={10} className="text-blue-500" />
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
        ref={parentRef}
        className="flex-1 overflow-auto scrollbar-hide"
      >
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

            return (
              <div
                key={virtualItem.key}
                className={cn(
                    "absolute top-0 left-0 w-full flex items-center border-b border-gray-800/30 transition-colors",
                    onRowClick ? 'cursor-pointer hover:bg-white/5' : '',
                    virtualItem.index % 2 ? 'bg-gray-900/10' : 'bg-transparent'
                )}
                style={{
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                onClick={() => onRowClick?.(row, virtualItem.index)}
              >
                {columns.map(column => (
                  <div
                    key={column.id}
                    className={cn(
                        "px-3 text-sm truncate",
                        column.align === 'right' ? 'text-right' : 
                        column.align === 'center' ? 'text-center' : 'text-left'
                    )}
                    style={{ width: column.width || 'auto', flex: column.width ? 'none' : 1 }}
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
