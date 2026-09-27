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
  label?: string;
}

const EXTENDED_PERIODS: ExtendedPeriod[] = ['FY', 'Q', 'Q1', 'Q2', 'Q3', 'Q4', 'TTM'];

function PeriodToggleComponent({ value, onChange, compact = false, options = EXTENDED_PERIODS, label = 'Financial period' }: PeriodToggleProps) {
  return (
    <div role="group" aria-label={label} className={cn(
        "flex max-w-full overflow-x-auto bg-[var(--bg-tertiary)] rounded-md p-0.5 border border-[var(--border-color)]",
        compact ? "gap-0.5" : "gap-1"
    )}>
      {options.map(period => (
        <button
          key={period}
          type="button"
          aria-pressed={value === period}
          title={period === 'FY' ? 'Full financial year' : period === 'Q' ? 'Quarterly' : period === 'TTM' ? 'Trailing twelve months' : `Quarter ${period.slice(1)}`}
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
            "shrink-0 rounded font-bold transition-all uppercase focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-offset-1",
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
