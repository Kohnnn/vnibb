'use client';

/**
 * Global data-freshness banner for the dashboard shell.
 *
 * Renders a thin colored strip just below the header when at least one of
 * the tracked buckets (prices / foreign trading / news) is stale or
 * critically stale. Dismissible per-session via sessionStorage. Polls every
 * 10 min so the banner clears automatically once the operator runs the
 * recovery sync.
 *
 * Dismissal is keyed to a status hash (overall + bucket statuses) so the
 * banner re-appears when the situation gets worse — e.g. user dismisses a
 * "stale" warning, then a fourth bucket flips to "critical": the banner
 * comes back. This avoids the U2 complaint that dismissal was permanent
 * even when conditions changed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, X } from 'lucide-react';

import { useMarketFreshness } from '@/lib/queries';
import { cn } from '@/lib/utils';

const SESSION_KEY = 'vnibb-freshness-banner-dismissed-hash';

interface FreshnessBucketLike {
  label: string;
  status: string;
}

function buildStatusHash(
  overall: string | undefined,
  buckets: ReadonlyArray<FreshnessBucketLike>,
): string {
  const parts = [overall ?? 'unknown'];
  for (const bucket of [...buckets].sort((a, b) => a.label.localeCompare(b.label))) {
    parts.push(`${bucket.label}:${bucket.status}`);
  }
  return parts.join('|');
}

export function FreshnessBanner() {
  const { data, isLoading } = useMarketFreshness();
  const [dismissedHash, setDismissedHash] = useState<string | null>(null);

  // Hydrate dismissal hash from sessionStorage so the banner stays hidden
  // for the same status pattern within this tab. A *different* hash (i.e.
  // status worsened) makes the banner re-render.
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) setDismissedHash(stored);
    } catch {
      // sessionStorage may be unavailable (private mode); silently fall back.
    }
  }, []);

  const critical = useMemo(() => {
    if (!data) return null;
    if (data.overall !== 'critical') return null;
    return data.buckets.filter((bucket) => bucket.status === 'critical');
  }, [data]);

  const currentHash = useMemo(
    () => (data ? buildStatusHash(data.overall, data.buckets) : null),
    [data],
  );

  const handleDismiss = useCallback(() => {
    if (!currentHash) return;
    setDismissedHash(currentHash);
    try {
      sessionStorage.setItem(SESSION_KEY, currentHash);
    } catch {
      // ignore
    }
  }, [currentHash]);

  if (
    isLoading ||
    !critical ||
    critical.length === 0 ||
    (currentHash !== null && currentHash === dismissedHash)
  ) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-start gap-3 border-b px-4 py-2 text-[12px] leading-5',
        'border-rose-500/30 bg-rose-500/10 text-rose-100',
      )}
    >
      <AlertTriangle
        size={14}
        className={cn(
          'mt-0.5 shrink-0',
          'text-rose-300',
        )}
      />
      <div className="flex flex-1 flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-semibold uppercase tracking-[0.16em]">
          Data sync degraded
        </span>
        {critical.map((bucket) => (
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
