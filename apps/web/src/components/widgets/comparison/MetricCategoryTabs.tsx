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
    <div className="flex gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-1">
      {CATEGORIES.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onChange(cat.id)}
          className={cn(
              "px-3 py-1.5 text-[10px] font-bold uppercase tracking-tight rounded-md transition-all",
              activeCategory === cat.id
                ? "bg-blue-600 text-white shadow-lg"
                : "text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]"
          )}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}
