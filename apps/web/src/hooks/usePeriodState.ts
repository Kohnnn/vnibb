import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExtendedPeriod } from '@/components/ui/PeriodToggle';

const STORAGE_KEY_PREFIX = 'vnibb_period_v3_';
const SYNC_EVENT_NAME = 'vnibb:period-sync';

interface UsePeriodStateOptions {
  widgetId: string;
  defaultPeriod?: ExtendedPeriod;
  persist?: boolean;
  validPeriods?: ExtendedPeriod[];
  sharedKey?: string;
}

function readStoredPeriod(storageKey: string, validPeriods: ExtendedPeriod[]): ExtendedPeriod | null {
  if (typeof window === 'undefined') return null;

  const saved = window.localStorage.getItem(storageKey);
  if (saved && validPeriods.includes(saved as ExtendedPeriod)) {
    return saved as ExtendedPeriod;
  }
  if (saved) {
    window.localStorage.removeItem(storageKey);
  }
  return null;
}

function writeStoredPeriod(storageKey: string, period: ExtendedPeriod): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey, period);
}

export function usePeriodState({
  widgetId,
  defaultPeriod = 'FY',
  persist = true,
  validPeriods = ['FY', 'Q', 'Q1', 'Q2', 'Q3', 'Q4', 'TTM'],
  sharedKey,
}: UsePeriodStateOptions) {
  const widgetStorageKey = `${STORAGE_KEY_PREFIX}${widgetId}`;
  const sharedStorageKey = useMemo(
    () => (sharedKey ? `${STORAGE_KEY_PREFIX}shared_${sharedKey}` : null),
    [sharedKey],
  );

  const resolveStoredPeriod = useCallback((): ExtendedPeriod => {
    if (!persist) return defaultPeriod;

    const sharedPeriod = sharedStorageKey
      ? readStoredPeriod(sharedStorageKey, validPeriods)
      : null;
    if (sharedPeriod) return sharedPeriod;

    return readStoredPeriod(widgetStorageKey, validPeriods) ?? defaultPeriod;
  }, [defaultPeriod, persist, sharedStorageKey, validPeriods, widgetStorageKey]);

  const [period, setPeriodState] = useState<ExtendedPeriod>(resolveStoredPeriod);

  useEffect(() => {
    setPeriodState(resolveStoredPeriod());
  }, [resolveStoredPeriod]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handlePeriodSync = (event: Event) => {
      const customEvent = event as CustomEvent<{ keys?: string[]; period?: ExtendedPeriod }>;
      const keys = customEvent.detail?.keys || [];
      const nextPeriod = customEvent.detail?.period;
      if (!nextPeriod || !keys.includes(widgetStorageKey) && !(sharedStorageKey && keys.includes(sharedStorageKey))) {
        return;
      }
      if (validPeriods.includes(nextPeriod)) {
        setPeriodState(nextPeriod);
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (event.key !== widgetStorageKey && event.key !== sharedStorageKey) return;
      const nextPeriod = event.newValue;
      if (nextPeriod && validPeriods.includes(nextPeriod as ExtendedPeriod)) {
        setPeriodState(nextPeriod as ExtendedPeriod);
        return;
      }
      setPeriodState(defaultPeriod);
    };

    window.addEventListener(SYNC_EVENT_NAME, handlePeriodSync as EventListener);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(SYNC_EVENT_NAME, handlePeriodSync as EventListener);
      window.removeEventListener('storage', handleStorage);
    };
  }, [defaultPeriod, sharedStorageKey, validPeriods, widgetStorageKey]);

  const setPeriod = useCallback((newPeriod: ExtendedPeriod) => {
    setPeriodState(newPeriod);
    if (persist && typeof window !== 'undefined') {
      writeStoredPeriod(widgetStorageKey, newPeriod);
      const keys = [widgetStorageKey];
      if (sharedStorageKey) {
        writeStoredPeriod(sharedStorageKey, newPeriod);
        keys.push(sharedStorageKey);
      }
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENT_NAME, {
          detail: {
            keys,
            period: newPeriod,
          },
        }),
      );
    }
  }, [persist, sharedStorageKey, widgetStorageKey]);

  return { period, setPeriod };
}
