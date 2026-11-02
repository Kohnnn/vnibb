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

/* The `color` prop is kept for call-site compatibility, but every tone now
   resolves to the same neutral selected state: red/green are reserved for
   financial direction, and decorative chip colours were retired (#199). */
const COLORS = {
  blue: 'bg-[var(--color-state-bg)] text-[var(--text-primary)] border-[var(--color-accent-primary)]',
  green: 'bg-[var(--color-state-bg)] text-[var(--text-primary)] border-[var(--color-accent-primary)]',
  red: 'bg-[var(--color-state-bg)] text-[var(--text-primary)] border-[var(--color-accent-primary)]',
  gray: 'bg-[var(--color-state-bg)] text-[var(--text-primary)] border-[var(--color-accent-primary)]',
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
        "inline-flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]",
        active ? COLORS[color] : 'border-[var(--border-strong)] bg-transparent text-[var(--text-muted)] hover:border-[var(--text-secondary)] hover:text-[var(--text-secondary)]',
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
