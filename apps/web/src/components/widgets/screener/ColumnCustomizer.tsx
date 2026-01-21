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
            isOpen ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
        )}
        title="Customize Columns"
      >
        <Settings size={14} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl z-[100] overflow-hidden">
          <div className="p-3 border-b border-gray-800 bg-gray-900/50">
            <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Customize Columns</h4>
          </div>
          <div className="max-h-72 overflow-y-auto p-1 scrollbar-hide">
            {columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 rounded cursor-pointer group"
                onClick={() => toggleColumn(column.id)}
              >
                <GripVertical size={12} className="text-gray-700 group-hover:text-gray-500" />
                {column.visible ? (
                  <Eye size={12} className="text-blue-400" />
                ) : (
                  <EyeOff size={12} className="text-gray-700" />
                )}
                <span className={cn(
                    "text-[11px] font-medium flex-1",
                    column.visible ? 'text-gray-200' : 'text-gray-600'
                )}>
                  {column.label}
                </span>
              </div>
            ))}
          </div>
          <div className="p-2 border-t border-gray-800 bg-gray-900/50 text-center">
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
