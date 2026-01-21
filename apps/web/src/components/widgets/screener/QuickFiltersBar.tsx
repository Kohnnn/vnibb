'use client';

import { cn } from '@/lib/utils';

interface QuickFilter {
  id: string;
  label: string;
  filters: any[];
}

const PRESET_FILTERS: QuickFilter[] = [
  { id: 'large_cap', label: 'Large Cap', filters: [{ field: 'marketCap', operator: 'gt', value: 10e12 }] },
  { id: 'small_cap', label: 'Small Cap', filters: [{ field: 'marketCap', operator: 'lt', value: 1e12 }] },
  { id: 'high_dividend', label: 'High Dividend', filters: [{ field: 'dividendYield', operator: 'gt', value: 5 }] },
  { id: 'growth', label: 'Growth', filters: [{ field: 'revenueGrowth', operator: 'gt', value: 20 }] },
  { id: 'value', label: 'Value', filters: [{ field: 'pe', operator: 'lt', value: 15 }] },
  { id: 'vn30', label: 'VN30', filters: [{ field: 'index', operator: 'eq', value: 'VN30' }] },
];

interface QuickFiltersBarProps {
  activeFilter: string | null;
  onFilterSelect: (filter: QuickFilter | null) => void;
}

export function QuickFiltersBar({ activeFilter, onFilterSelect }: QuickFiltersBarProps) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-hide px-3">
      {PRESET_FILTERS.map((filter) => (
        <button
          key={filter.id}
          onClick={() => onFilterSelect(activeFilter === filter.id ? null : filter)}
          className={cn(
              "px-3 py-1 text-[10px] font-bold rounded-full whitespace-nowrap transition-all uppercase tracking-tighter border",
              activeFilter === filter.id
                ? "bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-900/20"
                : "bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-gray-200"
          )}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}
