'use client';

import { CompanyLogo } from '@/components/ui/CompanyLogo';
import { MiniChart } from '@/components/ui/MiniChart';
import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';

export interface ChartGridCardProps {
  symbol: string;
  exchange?: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  onClick?: () => void;
  onAddToWatchlist?: () => void;
}

export function ChartGridCard({
  symbol,
  exchange,
  name,
  price,
  change,
  changePercent,
  onClick,
  onAddToWatchlist,
}: ChartGridCardProps) {
  const isPositive = changePercent >= 0;

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 transition-all duration-300 hover:border-blue-500/50 hover:bg-[var(--bg-tertiary)]"
    >
      {/* Header: Logo + Ticker */}
      <div className="flex items-center gap-3 mb-3">
        <CompanyLogo symbol={symbol} size={32} className="shadow-lg group-hover:scale-105 transition-transform" />
        <button type="button" onClick={(event) => { event.stopPropagation(); onClick?.(); }} aria-label={`View ${symbol}`} className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
          <div className="truncate text-sm font-black uppercase tracking-tight text-white transition-colors group-hover:text-blue-400">{symbol}</div>
          <div className="truncate text-[10px] font-bold uppercase tracking-tighter text-[var(--text-muted)]">{name}</div>
        </button>
        {onAddToWatchlist && <button type="button" onClick={(event) => { event.stopPropagation(); onAddToWatchlist(); }} aria-label={`Add ${symbol} to Watchlist`} className="min-h-9 min-w-9 rounded p-2 text-[var(--text-muted)] hover:bg-blue-500/10 hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"><Plus size={14} /></button>}
      </div>

      {/* Mini Chart */}
      <div className="my-3 -mx-1">
        <MiniChart symbol={symbol} exchange={exchange} height={60} />
      </div>

      {/* Price + Change */}
      <div className="flex items-baseline justify-between border-t border-[var(--border-subtle)] pt-1">
        <span className="text-sm font-mono font-bold text-[var(--text-primary)]">
          {price.toLocaleString()}
        </span>
        <span className={cn(
            "text-[10px] font-black px-1.5 py-0.5 rounded",
            isPositive ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
        )}>
          {isPositive ? '▲' : '▼'}{Math.abs(changePercent).toFixed(2)}%
        </span>
      </div>
    </div>
  );
}
