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
            isOpen ? "bg-blue-600 text-white" : "text-gray-500 hover:text-white hover:bg-white/10"
        )}
        title="Customize columns"
      >
        <Settings2 className="w-3.5 h-3.5" />
        <span>Columns</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-[#0a0a0a] border border-gray-800 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="p-3 border-b border-gray-800 flex items-center justify-between">
            <span className="text-xs font-bold text-white uppercase tracking-wider">Display Columns</span>
            <button onClick={() => setIsOpen(false)} className="text-gray-500 hover:text-white">
                <X size={14} />
            </button>
          </div>
          
          <div className="max-h-80 overflow-y-auto p-2 space-y-4">
            {categories.map(category => (
              <div key={category}>
                <div className="text-[9px] uppercase text-gray-500 font-bold mb-1.5 px-1 tracking-widest">
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
                          ? "bg-blue-600/10 text-blue-400 font-medium"
                          : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                      )}
                    >
                      <div className={cn(
                        "w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors",
                        selectedColumns.includes(column.id)
                          ? "bg-blue-600 border-blue-600"
                          : "border-gray-700 bg-gray-900"
                      )}>
                        {selectedColumns.includes(column.id) && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                      {column.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          
          <div className="p-2 border-t border-gray-800 flex justify-between items-center bg-gray-900/30">
            <button
              onClick={() => onColumnsChange(ALL_COLUMNS.slice(0, 7).map(c => c.id))}
              className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300 font-bold uppercase"
            >
              Reset
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="px-4 py-1 text-[10px] font-black uppercase bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
