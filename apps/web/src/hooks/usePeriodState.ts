import { useState, useCallback } from 'react';
import type { ExtendedPeriod } from '@/components/ui/PeriodToggle';

const STORAGE_KEY_PREFIX = 'vnibb_period_v2_';

interface UsePeriodStateOptions {
  widgetId: string;
  defaultPeriod?: ExtendedPeriod;
  persist?: boolean;
  validPeriods?: ExtendedPeriod[];
}

export function usePeriodState({
  widgetId,
  defaultPeriod = 'FY',
  persist = true,
  validPeriods = ['FY', 'Q', 'Q1', 'Q2', 'Q3', 'Q4', 'TTM'],
}: UsePeriodStateOptions) {
  const storageKey = `${STORAGE_KEY_PREFIX}${widgetId}`;
  
  const [period, setPeriodState] = useState<ExtendedPeriod>(() => {
    if (persist && typeof window !== 'undefined') {
      const saved = localStorage.getItem(storageKey);
      if (saved && validPeriods.includes(saved as ExtendedPeriod)) {
        return saved as ExtendedPeriod;
      }
      if (saved) {
        localStorage.removeItem(storageKey);
      }
    }
    return defaultPeriod;
  });

  const setPeriod = useCallback((newPeriod: ExtendedPeriod) => {
    setPeriodState(newPeriod);
    if (persist && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, newPeriod);
    }
  }, [storageKey, persist]);

  return { period, setPeriod };
}
