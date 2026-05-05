'use client';

import { memo } from 'react';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
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
    <div className="flex rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5">
      {MARKETS.map(market => (
        <button
          key={market.id}
          onClick={() => {
            captureAnalyticsEvent(ANALYTICS_EVENTS.widgetControlChanged, {
              control_type: 'market_toggle',
              previous_value: value,
              value: market.id,
            })
            onChange(market.id)
          }}
          className={cn(
            "px-3 py-1 text-[10px] font-black uppercase tracking-tighter rounded transition-all",
            value === market.id 
              ? "bg-blue-600 text-white shadow-sm" 
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
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
