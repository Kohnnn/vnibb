'use client';

import { useState } from 'react';
import { Plus, X, ChevronDown } from 'lucide-react';

interface Filter {
  id: string;
  field: string;
  operator: 'gt' | 'lt' | 'eq' | 'between' | 'in';
  value: number | string | [number, number] | string[];
}

interface FilterBuilderProps {
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
  availableFields: { id: string; label: string; type: 'number' | 'string' }[];
}

export function FilterBuilder({ filters, onChange, availableFields }: FilterBuilderProps) {
  const addFilter = () => {
    const newFilter: Filter = {
      id: crypto.randomUUID(),
      field: availableFields[0]?.id || '',
      operator: 'gt',
      value: 0,
    };
    onChange([...filters, newFilter]);
  };

  const removeFilter = (id: string) => {
    onChange(filters.filter(f => f.id !== id));
  };

  const updateFilter = (id: string, updates: Partial<Filter>) => {
    onChange(filters.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  return (
    <div className="space-y-2 p-3 bg-gray-900/50 rounded-lg border border-gray-800">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Filters</span>
        <button
          onClick={addFilter}
          className="flex items-center gap-1 text-[10px] font-bold text-blue-400 hover:text-blue-300 uppercase"
        >
          <Plus size={12} /> Add Filter
        </button>
      </div>

      {filters.map((filter, index) => (
        <div key={filter.id} className="flex items-center gap-2">
          {index > 0 && (
            <span className="text-[10px] font-black text-gray-700 w-6">AND</span>
          )}
          
          <select
            value={filter.field}
            onChange={(e) => updateFilter(filter.id, { field: e.target.value })}
            className="flex-1 bg-gray-800 text-white text-[11px] rounded px-2 py-1.5 border border-gray-700 outline-none focus:border-blue-500"
          >
            {availableFields.map(f => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>

          <select
            value={filter.operator}
            onChange={(e) => updateFilter(filter.id, { operator: e.target.value as Filter['operator'] })}
            className="bg-gray-800 text-white text-[11px] rounded px-2 py-1.5 border border-gray-700 outline-none focus:border-blue-500"
          >
            <option value="gt">&gt;</option>
            <option value="lt">&lt;</option>
            <option value="eq">=</option>
            <option value="between">Between</option>
          </select>

          <input
            type="number"
            value={filter.value as number}
            onChange={(e) => updateFilter(filter.id, { value: parseFloat(e.target.value) })}
            className="w-20 bg-gray-800 text-white text-[11px] rounded px-2 py-1.5 border border-gray-700 outline-none focus:border-blue-500 font-mono"
          />

          <button
            onClick={() => removeFilter(filter.id)}
            className="p-1 text-gray-600 hover:text-red-400 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      ))}

      {filters.length === 0 && (
        <p className="text-[10px] text-gray-600 text-center py-2 italic">No filters applied. Showing all results.</p>
      )}
    </div>
  );
}
