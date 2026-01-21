import { useState, useCallback } from 'react';
import type { Period } from '@/components/ui/PeriodToggle';

const STORAGE_KEY_PREFIX = 'vnibb_period_v1_';

interface UsePeriodStateOptions {
  widgetId: string;
  defaultPeriod?: Period;
  persist?: boolean;
}

export function usePeriodState({
  widgetId,
  defaultPeriod = 'FY',
  persist = true,
}: UsePeriodStateOptions) {
  const storageKey = `${STORAGE_KEY_PREFIX}${widgetId}`;
  
  const [period, setPeriodState] = useState<Period>(() => {
    if (persist && typeof window !== 'undefined') {
      const saved = localStorage.getItem(storageKey);
      if (saved && ['FY', 'Q1', 'Q2', 'Q3', 'Q4', 'TTM'].includes(saved)) {
        return saved as Period;
      }
    }
    return defaultPeriod;
  });

  const setPeriod = useCallback((newPeriod: Period) => {
    setPeriodState(newPeriod);
    if (persist && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, newPeriod);
    }
  }, [storageKey, persist]);

  return { period, setPeriod };
}
