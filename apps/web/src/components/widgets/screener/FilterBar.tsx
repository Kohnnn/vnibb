'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, Filter } from 'lucide-react';
import { FilterPill } from './FilterPill';
import { cn } from '@/lib/utils';

const AVAILABLE_FILTERS = [
  {
    id: 'price',
    label: 'Price',
    presets: [
      { label: 'Under 10k', value: { lt: 10000 } },
      { label: '10k - 50k', value: { gte: 10000, lt: 50000 } },
      { label: 'Above 50k', value: { gte: 50000 } },
    ],
  },
  {
    id: 'market_cap',
    label: 'Market Cap',
    presets: [
      { label: 'Large (>10T)', value: { gte: 10e12 } },
      { label: 'Mid (1T-10T)', value: { gte: 1e12, lt: 10e12 } },
      { label: 'Small (<1T)', value: { lt: 1e12 } },
    ],
  },
  {
    id: 'pe_ratio',
    label: 'P/E',
    presets: [
      { label: 'Under 10', value: { lt: 10 } },
      { label: '10 - 20', value: { gte: 10, lt: 20 } },
      { label: 'Above 20', value: { gte: 20 } },
    ],
  },
  {
    id: 'change',
    label: 'Change %',
    presets: [
      { label: 'Gainers (+5%)', value: { gte: 5 } },
      { label: 'Losers (-5%)', value: { lt: -5 } },
      { label: 'Flat (±1%)', value: { gte: -1, lt: 1 } },
    ],
  },
  {
    id: 'sector',
    label: 'Sector',
    presets: [
      { label: 'Banks', value: 'banks' },
      { label: 'Real Estate', value: 'real_estate' },
      { label: 'Technology', value: 'technology' },
      { label: 'Consumer', value: 'consumer' },
    ],
  },
];

export interface ActiveFilter {
  id: string;
  value: any;
  displayValue: string;
}

interface FilterBarProps {
  filters: ActiveFilter[];
  onChange: (filters: ActiveFilter[]) => void;
}

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const activeFilterIds = filters.map(f => f.id);
  const availableToAdd = AVAILABLE_FILTERS.filter(f => !activeFilterIds.includes(f.id));

  const addFilter = (filterId: string) => {
    const filter = AVAILABLE_FILTERS.find(f => f.id === filterId);
    if (filter) {
      onChange([...filters, { id: filter.id, value: null, displayValue: '' }]);
    }
    setShowAddMenu(false);
  };

  const updateFilter = (id: string, value: any, displayValue: string) => {
    onChange(filters.map(f => f.id === id ? { ...f, value, displayValue } : f));
  };

  const removeFilter = (id: string) => {
    onChange(filters.filter(f => f.id !== id));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 p-2 bg-secondary/50 border-b border-gray-800">
      <div className="flex items-center gap-1.5 pr-2 mr-2 border-r border-gray-800 text-gray-500">
          <Filter size={12} />
          <span className="text-[10px] font-black uppercase tracking-widest">Filter</span>
      </div>
      
      {filters.map((filter) => {
        const config = AVAILABLE_FILTERS.find(f => f.id === filter.id);
        if (!config) return null;

        return (
          <FilterPill
            key={filter.id}
            label={config.label}
            value={filter.displayValue || null}
            presets={config.presets}
            onSelect={(presetValue) => {
              const displayValue = config.presets.find(p => p.value === presetValue)?.label || '';
              updateFilter(filter.id, presetValue, displayValue);
            }}
            onRemove={() => removeFilter(filter.id)}
          />
        );
      })}

      {/* Add Filter Button */}
      <div className="relative" ref={ref}>
        <button
          onClick={() => setShowAddMenu(!showAddMenu)}
          className={cn(
              "inline-flex items-center gap-1 px-3 h-7 text-[10px] font-bold border border-dashed rounded-full transition-all uppercase tracking-tight",
              showAddMenu 
                ? "bg-blue-600 border-blue-500 text-white"
                : "bg-transparent border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
          )}
        >
          <Plus size={12} />
          <span>Add</span>
        </button>

        {showAddMenu && (
          <div className="absolute top-full left-0 mt-2 w-48 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl z-[120] overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="p-2 border-b border-gray-800 bg-gray-950/50">
                <h4 className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Available Filters</h4>
            </div>
            <div className="p-1 max-h-64 overflow-y-auto scrollbar-hide">
                {availableToAdd.map((filter) => (
                <button
                    key={filter.id}
                    onClick={() => addFilter(filter.id)}
                    className="w-full px-3 py-2 text-left text-[11px] text-gray-400 hover:bg-blue-600 hover:text-white rounded transition-colors font-medium flex items-center justify-between"
                >
                    {filter.label}
                    <Plus size={10} className="opacity-30" />
                </button>
                ))}
                {availableToAdd.length === 0 && (
                    <div className="py-4 text-center text-[10px] text-gray-600 font-bold uppercase italic">All filters added</div>
                )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
