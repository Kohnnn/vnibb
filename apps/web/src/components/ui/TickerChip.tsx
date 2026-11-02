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
        'inline-flex items-center gap-1.5 rounded border border-[var(--border-strong)] bg-[var(--bg-secondary)] px-2 py-1 text-xs font-bold text-[var(--text-primary)]',
        className
      )}
    >
      <CompanyLogo symbol={symbol} name={name} size={14} />
      <span>{symbol}</span>
      {name && <span className="hidden text-[10px] text-[var(--text-muted)] sm:inline">{name}</span>}
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="rounded-full p-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]"
          aria-label={`Remove ${symbol}`}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export default TickerChip;
