'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';

export type Period = 'FY' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'TTM';

interface PeriodToggleProps {
  value: Period;
  onChange: (period: Period) => void;
  compact?: boolean;
}

const PERIODS: Period[] = ['FY', 'Q1', 'Q2', 'Q3', 'Q4', 'TTM'];

function PeriodToggleComponent({ value, onChange, compact = false }: PeriodToggleProps) {
  return (
    <div className={cn(
        "flex bg-gray-900 rounded-md p-0.5 border border-gray-800",
        compact ? "gap-0.5" : "gap-1"
    )}>
      {PERIODS.map(period => (
        <button
          key={period}
          onClick={() => onChange(period)}
          className={cn(
            "rounded font-bold transition-all uppercase",
            compact ? "px-1.5 py-0.5 text-[9px]" : "px-2.5 py-1 text-[10px]",
            value === period
              ? "bg-blue-600 text-white shadow-sm"
              : "text-gray-500 hover:text-gray-300"
          )}
        >
          {period}
        </button>
      ))}
    </div>
  );
}

export const PeriodToggle = memo(PeriodToggleComponent);
export default PeriodToggle;
