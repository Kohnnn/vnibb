'use client';

/**
 * Global data-freshness banner for the dashboard shell.
 *
 * Renders a thin colored strip just below the header when at least one of
 * the tracked buckets (prices / foreign trading / news) is stale or
 * critically stale. Dismissible per-session via localStorage. Polls every
 * 10 min so the banner clears automatically once the operator runs the
 * recovery sync.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, X } from 'lucide-react';

import { useMarketFreshness } from '@/lib/queries';
import { cn } from '@/lib/utils';

const SESSION_KEY = 'vnibb-freshness-banner-dismissed';

function isCriticalLike(status: string): boolean {
  return status === 'critical' || status === 'stale';
}

export function FreshnessBanner() {
  const { data, isLoading } = useMarketFreshness();
  const [dismissed, setDismissed] = useState(false);

  // Hydrate dismissal flag from sessionStorage so the banner stays hidden
  // for the rest of the tab's life once the user closes it.
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored === '1') setDismissed(true);
    } catch {
      // sessionStorage may be unavailable (private mode); silently fall back.
    }
  }, []);

  const stale = useMemo(() => {
    if (!data) return null;
    if (data.overall === 'fresh') return null;
    return data.buckets.filter((bucket) => isCriticalLike(bucket.status));
  }, [data]);

  if (isLoading || dismissed || !stale || stale.length === 0) {
    return null;
  }

  const overall = data?.overall ?? 'stale';
  const isCritical = overall === 'critical';

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // ignore
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-start gap-3 border-b px-4 py-2 text-[12px] leading-5',
        isCritical
          ? 'border-rose-500/30 bg-rose-500/10 text-rose-100'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-100',
      )}
    >
      <AlertTriangle
        size={14}
        className={cn(
          'mt-0.5 shrink-0',
          isCritical ? 'text-rose-300' : 'text-amber-300',
        )}
      />
      <div className="flex flex-1 flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-semibold uppercase tracking-[0.16em]">
          {isCritical ? 'Data sync degraded' : 'Some data is stale'}
        </span>
        {stale.map((bucket) => (
          <span key={bucket.label} className="inline-flex items-center gap-1.5">
            <ChevronRight size={11} className="opacity-60" />
            <span className="font-medium">{bucket.label}:</span>
            <span className="opacity-80">
              {bucket.age_days !== null
                ? `${Math.floor(bucket.age_days)} day${Math.floor(bucket.age_days) === 1 ? '' : 's'} old`
                : 'unknown age'}
            </span>
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="rounded p-0.5 text-current/70 transition-colors hover:bg-white/10 hover:text-current"
        aria-label="Dismiss banner for this session"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export default FreshnessBanner;
