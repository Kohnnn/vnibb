'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';

export type Market = 'ALL' | 'HOSE' | 'HNX' | 'UPCOM';

interface MarketToggleProps {
  value: Market;
  onChange: (market: Market) => void;
}

const MARKETS: { id: Market; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'HOSE', label: 'HOSE' },
  { id: 'HNX', label: 'HNX' },
  { id: 'UPCOM', label: 'UPCOM' },
];

function MarketToggleComponent({ value, onChange }: MarketToggleProps) {
  return (
    <div className="flex bg-gray-900 rounded-lg p-0.5 border border-gray-800">
      {MARKETS.map(market => (
        <button
          key={market.id}
          onClick={() => onChange(market.id)}
          className={cn(
            "px-3 py-1 text-[10px] font-black uppercase tracking-tighter rounded transition-all",
            value === market.id 
              ? "bg-blue-600 text-white shadow-sm" 
              : "text-gray-500 hover:text-gray-300"
          )}
        >
          {market.label}
        </button>
      ))}
    </div>
  );
}

export const MarketToggle = memo(MarketToggleComponent);
export default MarketToggle;
