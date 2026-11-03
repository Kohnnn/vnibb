'use client';

import { useState } from 'react';
import { Settings2, Check, X } from 'lucide-react';
import { ALL_COLUMNS, type ScreenerColumn } from '@/types/screener';
import { cn } from '@/lib/utils';

interface ColumnPickerProps {
  selectedColumns: string[];
  onColumnsChange: (columns: string[]) => void;
}

export function ColumnPicker({ selectedColumns, onColumnsChange }: ColumnPickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const categories: ('basic' | 'valuation' | 'fundamentals' | 'technical' | 'performance')[] = 
    ['basic', 'valuation', 'fundamentals', 'technical', 'performance'];

  const toggleColumn = (columnId: string) => {
    if (selectedColumns.includes(columnId)) {
      if (selectedColumns.length > 1) {
        onColumnsChange(selectedColumns.filter(id => id !== columnId));
      }
    } else {
      onColumnsChange([...selectedColumns, columnId]);
    }
  };

  const columnsByCategory = categories.reduce((acc, category) => {
    acc[category] = ALL_COLUMNS.filter(col => col.category === category);
    return acc;
  }, {} as Record<string, ScreenerColumn[]>);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
            "flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase rounded transition-colors",
            isOpen ? "bg-[var(--color-accent-fill)] text-[var(--color-on-accent)]" : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        )}
        title="Customize columns"
      >
        <Settings2 className="w-3.5 h-3.5" />
        <span>Columns</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--bg-dropdown)] shadow-lg">
          <div className="p-3 border-b border-[var(--border-default)] flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">Display Columns</span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label="Close column picker"
            >
                <X size={14} />
            </button>
          </div>
          
          <div className="max-h-80 overflow-y-auto p-2 space-y-4">
            {categories.map(category => (
              <div key={category}>
                <div className="text-[9px] uppercase text-[var(--text-muted)] font-bold mb-1.5 px-1 tracking-widest">
                  {category}
                </div>
                <div className="grid grid-cols-1 gap-0.5">
                  {columnsByCategory[category].map(column => (
                    <button
                      key={column.id}
                      onClick={() => toggleColumn(column.id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-all",
                        selectedColumns.includes(column.id)
                          ? "bg-[var(--color-state-bg)] font-medium text-[var(--color-info)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      )}
                    >
                      <div className={cn(
                        "w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors",
                        selectedColumns.includes(column.id)
                          ? "border-[var(--color-accent-fill)] bg-[var(--color-accent-fill)]"
                          : "border-[var(--border-default)] bg-[var(--bg-secondary)]"
                      )}>
                        {selectedColumns.includes(column.id) && <Check className="w-2.5 h-2.5 text-[var(--color-on-accent)]" />}
                      </div>
                      {column.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          
          <div className="p-2 border-t border-[var(--border-default)] flex justify-between items-center bg-[var(--bg-secondary)]/60">
            <button
              onClick={() => onColumnsChange(ALL_COLUMNS.slice(0, 7).map(c => c.id))}
              className="px-2 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] font-bold uppercase"
            >
              Reset
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded bg-[var(--color-accent-fill)] px-4 py-1 text-[10px] font-bold uppercase text-[var(--color-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
