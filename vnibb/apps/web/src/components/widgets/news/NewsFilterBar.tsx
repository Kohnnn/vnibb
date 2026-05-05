'use client';

import { memo } from 'react';
import { TrendingUp, TrendingDown, Minus, X, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NewsFilters {
  symbols: string[];
  sentiment: string | null;
}

interface NewsFilterBarProps {
  filters: NewsFilters;
  onFiltersChange: (filters: NewsFilters) => void;
}

const SENTIMENTS = [
  { id: 'bullish', label: 'Bullish', icon: TrendingUp, color: 'text-green-400' },
  { id: 'neutral', label: 'Neutral', icon: Minus, color: 'text-[var(--text-secondary)]' },
  { id: 'bearish', label: 'Bearish', icon: TrendingDown, color: 'text-red-400' },
];

function NewsFilterBarComponent({ filters, onFiltersChange }: NewsFilterBarProps) {
  return (
    <div className="flex items-center gap-2 p-2 border-b border-[var(--border-default)] bg-[var(--bg-primary)]">
      <div className="flex items-center gap-1.5 shrink-0 px-1 border-r border-[var(--border-color)] mr-1">
          <Filter size={12} className="text-[var(--text-muted)]" />
          <span className="text-[10px] font-black uppercase text-[var(--text-muted)] tracking-widest hidden sm:inline">Filters</span>
      </div>

      {/* Symbol tags */}
      <div className="flex flex-wrap gap-1">
        {filters.symbols.map((symbol, index) => (
          <span 
            key={`${symbol}-${index}`}
            className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded text-[10px] font-bold"
          >
            {symbol}
            <button 
              onClick={() => onFiltersChange({
                ...filters,
                symbols: filters.symbols.filter(s => s !== symbol),
              })}
              className="hover:text-white transition-colors"
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>

      {/* Sentiment filters */}
      <div className="ml-auto flex bg-[var(--bg-secondary)] rounded p-0.5 border border-[var(--border-color)]">
        {SENTIMENTS.map(s => (
          <button
            key={s.id}
            onClick={() => onFiltersChange({
              ...filters,
              sentiment: filters.sentiment === s.id ? null : s.id,
            })}
            className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-black uppercase transition-all",
                filters.sentiment === s.id
                    ? "bg-[var(--bg-tertiary)] " + s.color
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            )}
          >
            <s.icon size={10} />
            <span className="hidden md:inline">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export const NewsFilterBar = memo(NewsFilterBarComponent);
export default NewsFilterBar;
