'use client';

import { cn } from '@/lib/utils';

export type MetricCategory = 'valuation' | 'profitability' | 'liquidity' | 'efficiency' | 'growth';

interface MetricCategoryTabsProps {
  activeCategory: MetricCategory;
  onChange: (category: MetricCategory) => void;
}

const CATEGORIES: { id: MetricCategory; label: string }[] = [
  { id: 'valuation', label: 'Valuation' },
  { id: 'profitability', label: 'Profitability' },
  { id: 'liquidity', label: 'Liquidity' },
  { id: 'efficiency', label: 'Efficiency' },
  { id: 'growth', label: 'Growth' },
];

export function MetricCategoryTabs({ activeCategory, onChange }: MetricCategoryTabsProps) {
  return (
    <div className="flex gap-1 p-1 bg-gray-900/50 rounded-lg border border-gray-800">
      {CATEGORIES.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onChange(cat.id)}
          className={cn(
              "px-3 py-1.5 text-[10px] font-bold uppercase tracking-tight rounded-md transition-all",
              activeCategory === cat.id
                ? "bg-blue-600 text-white shadow-lg"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
          )}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}
