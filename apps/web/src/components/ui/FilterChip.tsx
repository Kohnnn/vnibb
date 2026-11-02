'use client';

import { memo } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FilterChipProps {
  label: string;
  value?: string;
  active?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
  color?: 'blue' | 'green' | 'red' | 'gray';
  className?: string;
}

// `green`/`red` are financial direction (gain/loss) and use the shared
// direction tokens so colour-vision mode applies; chips also carry a label.
const COLORS = {
  blue: 'bg-[var(--color-state-bg)] text-[var(--color-accent-primary)] border-[var(--color-state-border)] hover:border-[var(--color-accent-primary)]',
  green: 'bg-price-up text-[var(--color-positive)] border-[var(--color-positive)] hover:border-[var(--color-positive)]',
  red: 'bg-price-down text-[var(--color-negative)] border-[var(--color-negative)] hover:border-[var(--color-negative)]',
  gray: 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-default)]',
};

function FilterChipComponent({
  label,
  value,
  active = false,
  onToggle,
  onRemove,
  color = 'blue',
  className,
}: FilterChipProps) {
  return (
    <div
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle?.();
        }
      }}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all cursor-pointer select-none",
        active ? COLORS[color] : 'border-[var(--border-subtle)] bg-transparent text-[var(--text-muted)] hover:border-[var(--border-color)] hover:text-[var(--text-secondary)]',
        active && "shadow-lg shadow-blue-900/10",
        className
      )}
    >
      <span>{label}</span>
      {value && <span className="ml-0.5 text-[var(--text-primary)]">{value}</span>}
      {onRemove && active && (
        <button 
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-1 transition-colors hover:text-[var(--text-primary)]"
          aria-label={`Remove ${label} filter`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export const FilterChip = memo(FilterChipComponent);
export default FilterChip;
