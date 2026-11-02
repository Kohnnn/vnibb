'use client';

import { X } from 'lucide-react';
import { CompanyLogo } from '@/components/ui/CompanyLogo';
import { cn } from '@/lib/utils';

interface TickerChipProps {
  symbol: string;
  name?: string;
  onRemove?: () => void;
  className?: string;
}

export function TickerChip({ symbol, name, onRemove, className }: TickerChipProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-2 py-1 text-xs font-bold text-[var(--color-accent-secondary)]',
        className
      )}
    >
      <CompanyLogo symbol={symbol} name={name} size={14} />
      <span>{symbol}</span>
      {name && <span className="hidden sm:inline text-[10px] text-[var(--color-accent-secondary)]">{name}</span>}
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="rounded-full p-0.5 text-[var(--color-accent-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--color-error)]"
          aria-label={`Remove ${symbol}`}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export default TickerChip;
