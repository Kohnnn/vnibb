'use client';

import { useState, useRef, useEffect } from 'react';
import { GripVertical, Eye, EyeOff, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Column {
  id: string;
  label: string;
  visible: boolean;
  width?: number;
}

interface ColumnCustomizerProps {
  columns: Column[];
  onChange: (columns: Column[]) => void;
}

export function ColumnCustomizer({ columns, onChange }: ColumnCustomizerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const toggleColumn = (id: string) => {
    onChange(columns.map(c => c.id === id ? { ...c, visible: !c.visible } : c));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
            "p-1.5 rounded transition-colors",
            isOpen ? "bg-blue-600 text-white" : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        )}
        title="Customize Columns"
      >
        <Settings size={14} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-[100] mt-2 w-56 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-2xl">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Customize Columns</h4>
          </div>
          <div className="max-h-72 overflow-y-auto p-1 scrollbar-hide">
            {columns.map((column) => (
              <div
                key={column.id}
                className="group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--bg-tertiary)]"
                onClick={() => toggleColumn(column.id)}
              >
                <GripVertical size={12} className="text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]" />
                {column.visible ? (
                  <Eye size={12} className="text-blue-400" />
                ) : (
                  <EyeOff size={12} className="text-[var(--text-muted)]" />
                )}
                <span className={cn(
                    "text-[11px] font-medium flex-1",
                    column.visible ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                )}>
                  {column.label}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2 text-center">
              <button 
                onClick={() => onChange(columns.map(c => ({ ...c, visible: true })))}
                className="text-[9px] font-bold text-blue-500 hover:text-blue-400 uppercase tracking-tighter"
              >
                  Reset to Default
              </button>
          </div>
        </div>
      )}
    </div>
  );
}
