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
        'inline-flex items-center gap-1.5 rounded border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-xs font-bold text-blue-300',
        className
      )}
    >
      <CompanyLogo symbol={symbol} name={name} size={14} />
      <span>{symbol}</span>
      {name && <span className="hidden sm:inline text-[10px] text-blue-200/70">{name}</span>}
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="rounded-full p-0.5 text-blue-200/60 transition-colors hover:bg-red-500/10 hover:text-red-300"
          aria-label={`Remove ${symbol}`}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export default TickerChip;
