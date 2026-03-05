'use client';

import { CompanyLogo } from '@/components/ui/CompanyLogo';
import { MiniChart } from '@/components/ui/MiniChart';
import { cn } from '@/lib/utils';

export interface ChartGridCardProps {
  symbol: string;
  exchange?: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  onClick?: () => void;
}

export function ChartGridCard({
  symbol,
  exchange,
  name,
  price,
  change,
  changePercent,
  onClick,
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
        <div className="flex-1 min-w-0">
          <div className="text-sm font-black text-white truncate tracking-tight group-hover:text-blue-400 transition-colors uppercase">{symbol}</div>
          <div className="truncate text-[10px] font-bold uppercase tracking-tighter text-[var(--text-muted)]">{name}</div>
        </div>
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
