'use client';

/**
 * Global data-freshness banner for the dashboard shell.
 *
 * Keeps a fixed-height status slot below the header. Warning details scroll
 * within the slot, and neutral states report checking, unavailable, fresh,
 * or dismissed status without moving the dashboard. Dismissible per-session
 * via sessionStorage; the existing query polls for recovery.
 *
 * Dismissal is keyed to a status hash (overall + bucket statuses) so the
 * banner re-appears when the situation gets worse — e.g. user dismisses a
 * "stale" warning, then a fourth bucket flips to "critical": the banner
 * comes back. This avoids the U2 complaint that dismissal was permanent
 * even when conditions changed.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, X } from 'lucide-react';

import { useMarketFreshness } from '@/lib/queries';
import { cn } from '@/lib/utils';

const SESSION_KEY = 'vnibb-freshness-banner-dismissed-hash';

interface FreshnessBucketLike {
  label: string;
  status: string;
  reason?: string | null;
}

function buildStatusHash(
  overall: string | undefined,
  buckets: ReadonlyArray<FreshnessBucketLike>,
): string {
  const parts = [overall ?? 'unknown'];
  for (const bucket of [...buckets].sort((a, b) => a.label.localeCompare(b.label))) {
    parts.push(`${bucket.label}:${bucket.status}:${bucket.reason ?? 'none'}`);
  }
  return parts.join('|');
}

export function FreshnessBanner() {
  const { data, isLoading, isError } = useMarketFreshness();
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

  const affectedBuckets = useMemo(() => {
    if (!data) return null;
    return data.buckets.filter((bucket) => bucket.status !== 'fresh');
  }, [data]);

  const isCritical = affectedBuckets?.some((bucket) => bucket.status === 'critical') ?? false;
  const hasUnsettledSync = affectedBuckets?.some(
    (bucket) => bucket.reason === 'latest_sync_unsettled',
  ) ?? false;
  const heading = `${hasUnsettledSync ? 'Data validation' : 'Data sync'} ${
    isCritical ? 'degraded' : 'delayed'
  }`;

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

  const hasWarnings = Boolean(affectedBuckets?.length);
  const showWarning = !isLoading && hasWarnings && currentHash !== dismissedHash;
  const neutralMessage = isLoading
    ? 'Checking data freshness…'
    : isError || !data || data.buckets.length === 0
      ? 'Freshness status unavailable.'
      : hasWarnings
        ? 'Freshness warning dismissed for this session.'
        : data.overall === 'fresh'
          ? 'All tracked data sources report fresh data.'
          : 'Freshness status unavailable.';

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex h-[61px] shrink-0 items-start gap-3 border-b px-4 py-2 text-[12px] leading-5',
        !showWarning
          ? 'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
          : isCritical
            ? 'border-rose-500/30 bg-rose-500/10 text-rose-100'
            : 'border-amber-500/30 bg-amber-500/10 text-amber-100',
      )}
    >
      {showWarning && (
        <AlertTriangle
          size={14}
          className={cn(
            'mt-0.5 shrink-0',
            isCritical ? 'text-rose-300' : 'text-amber-300',
          )}
        />
      )}
      <div
        role="region"
        aria-label="Data freshness details"
        tabIndex={0}
        className="min-h-0 min-w-0 flex-1 self-stretch overflow-y-auto overscroll-contain focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current"
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {showWarning ? (
            <>
              {isError && <span>Freshness status unavailable; last reported warnings:</span>}
              <span className="font-semibold uppercase tracking-[0.16em]">{heading}</span>
              {affectedBuckets?.map((bucket) => (
                <span key={bucket.label} className="inline-flex flex-wrap items-baseline gap-x-1.5" title={bucket.detail ?? undefined}>
                  <ChevronRight size={11} className="shrink-0 opacity-60" />
                  <span className="font-medium">{bucket.label}{bucket.scope ? ` (${bucket.scope.replaceAll('_', ' ')})` : ''}:</span>
                  <span className="opacity-80">
                    {bucket.reason === 'latest_sync_unsettled' && bucket.raw_last_data_date
                      ? `current through ${bucket.raw_last_data_date}; validated through ${bucket.settled_last_data_date ?? 'unknown'}`
                      : bucket.age_days !== null && bucket.last_data_date !== null
                        ? `as of ${bucket.last_data_date} · ${Math.floor(bucket.age_days)} day${Math.floor(bucket.age_days) === 1 ? '' : 's'} old`
                        : 'unknown age'}
                  </span>
                </span>
              ))}
            </>
          ) : <span>{neutralMessage}</span>}
          <Link href="/settings" className="font-medium underline underline-offset-2 hover:text-current">
            View sources
          </Link>
        </div>
      </div>
      {showWarning && (
        <button
          type="button"
          onClick={handleDismiss}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-current/70 transition-colors hover:bg-white/10 hover:text-current"
          aria-label="Dismiss banner for this session"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export default FreshnessBanner;
