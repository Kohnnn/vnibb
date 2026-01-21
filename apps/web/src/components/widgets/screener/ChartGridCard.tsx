'use client';

import { CompanyLogo } from '@/components/ui/CompanyLogo';
import { MiniChart } from '@/components/ui/MiniChart';
import { cn } from '@/lib/utils';

export interface ChartGridCardProps {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  priceHistory?: { date: string; close: number }[];
  onClick?: () => void;
}

export function ChartGridCard({
  symbol,
  name,
  price,
  change,
  changePercent,
  priceHistory = [],
  onClick,
}: ChartGridCardProps) {
  const isPositive = changePercent >= 0;

  return (
    <div
      onClick={onClick}
      className="p-3 bg-secondary/80 rounded-xl border border-gray-800/50 hover:border-blue-500/50 hover:bg-gray-800/50 cursor-pointer transition-all duration-300 group"
    >
      {/* Header: Logo + Ticker */}
      <div className="flex items-center gap-3 mb-3">
        <CompanyLogo symbol={symbol} size={32} className="shadow-lg group-hover:scale-105 transition-transform" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-black text-white truncate tracking-tight group-hover:text-blue-400 transition-colors uppercase">{symbol}</div>
          <div className="text-[10px] text-gray-500 truncate font-bold uppercase tracking-tighter">{name}</div>
        </div>
      </div>

      {/* Mini Chart */}
      <div className="my-3 -mx-1">
        <MiniChart data={priceHistory} height={60} positive={isPositive} />
      </div>

      {/* Price + Change */}
      <div className="flex items-baseline justify-between pt-1 border-t border-gray-800/20">
        <span className="text-sm font-mono font-bold text-gray-100">
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
