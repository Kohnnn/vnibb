'use client';

import { memo } from 'react';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { cn } from '@/lib/utils';

export type Period = 'FY' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'TTM';
export type ExtendedPeriod = Period | 'Q';

interface PeriodToggleProps {
  value: ExtendedPeriod;
  onChange: (period: ExtendedPeriod) => void;
  compact?: boolean;
  options?: ExtendedPeriod[];
}

const PERIODS: Period[] = ['FY', 'Q1', 'Q2', 'Q3', 'Q4', 'TTM'];
const EXTENDED_PERIODS: ExtendedPeriod[] = ['FY', 'Q', 'Q1', 'Q2', 'Q3', 'Q4', 'TTM'];

function PeriodToggleComponent({ value, onChange, compact = false, options = EXTENDED_PERIODS }: PeriodToggleProps) {
  return (
    <div className={cn(
        "flex bg-[var(--bg-tertiary)] rounded-md p-0.5 border border-[var(--border-color)]",
        compact ? "gap-0.5" : "gap-1"
    )}>
      {options.map(period => (
        <button
          key={period}
          onClick={() => {
            captureAnalyticsEvent(ANALYTICS_EVENTS.widgetControlChanged, {
              control_type: 'period_toggle',
              previous_value: value,
              value: period,
              options_count: options.length,
            })
            onChange(period)
          }}
          className={cn(
            "rounded font-bold transition-all uppercase",
            compact ? "px-1.5 py-0.5 text-[9px]" : "px-2.5 py-1 text-[10px]",
            value === period
              ? "bg-blue-600 text-white shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
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
