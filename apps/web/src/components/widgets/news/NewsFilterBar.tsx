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
  { id: 'neutral', label: 'Neutral', icon: Minus, color: 'text-gray-400' },
  { id: 'bearish', label: 'Bearish', icon: TrendingDown, color: 'text-red-400' },
];

function NewsFilterBarComponent({ filters, onFiltersChange }: NewsFilterBarProps) {
  return (
    <div className="flex items-center gap-2 p-2 border-b border-gray-800 bg-[#0a0a0a]">
      <div className="flex items-center gap-1.5 shrink-0 px-1 border-r border-gray-800 mr-1">
          <Filter size={12} className="text-gray-600" />
          <span className="text-[10px] font-black uppercase text-gray-500 tracking-widest hidden sm:inline">Filters</span>
      </div>

      {/* Symbol tags */}
      <div className="flex flex-wrap gap-1">
        {filters.symbols.map(symbol => (
          <span 
            key={symbol}
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
      <div className="ml-auto flex bg-gray-900 rounded p-0.5 border border-gray-800">
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
                    ? "bg-gray-800 " + s.color
                    : "text-gray-600 hover:text-gray-400"
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
