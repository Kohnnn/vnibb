'use client';

import { memo } from 'react';
import { FilterChip } from '@/components/ui/FilterChip';

export interface ScreenerFilter {
  id: string;
  label: string;
  field: string;
  operator: 'gt' | 'lt' | 'eq' | 'between';
  value: any;
}

interface QuickFiltersProps {
  activeFilterIds: string[];
  onFilterToggle: (filter: ScreenerFilter) => void;
}

const PRESET_FILTERS: ScreenerFilter[] = [
  { id: 'large_cap', label: 'Large Cap', field: 'market_cap', operator: 'gt', value: 10000000000000 },
  { id: 'high_dividend', label: 'High Yield', field: 'dividend_yield', operator: 'gt', value: 0.05 },
  { id: 'low_pe', label: 'Low P/E', field: 'pe', operator: 'lt', value: 10 },
  { id: 'growth', label: 'Growth', field: 'roe', operator: 'gt', value: 0.15 },
  { id: 'gainer', label: 'Gainers', field: 'change_1d', operator: 'gt', value: 0 },
  { id: 'loser', label: 'Losers', field: 'change_1d', operator: 'lt', value: 0 },
];

function QuickFiltersComponent({ activeFilterIds, onFilterToggle }: QuickFiltersProps) {
  return (
    <div className="flex flex-wrap gap-2 p-3 border-b border-gray-800 bg-[#050505]">
      {PRESET_FILTERS.map(filter => (
        <FilterChip
          key={filter.id}
          label={filter.label}
          active={activeFilterIds.includes(filter.id)}
          onToggle={() => onFilterToggle(filter)}
          color={filter.id === 'gainer' ? 'green' : filter.id === 'loser' ? 'red' : 'blue'}
        />
      ))}
    </div>
  );
}

export const QuickFilters = memo(QuickFiltersComponent);
export default QuickFilters;
