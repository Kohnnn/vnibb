'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Activity, AlertTriangle, Clock, X } from 'lucide-react';

import type { DashboardContextValue } from '@/contexts/DashboardContext/types';
import type { FreshnessBucket } from '@/lib/api';
import { probeBackendReadiness } from '@/lib/backendHealth';
import { formatAbsoluteTimestamp } from '@/lib/formatDate';
import { useMarketFreshness } from '@/lib/queries';
import { cn } from '@/lib/utils';

const SESSION_KEY = 'vnibb-freshness-banner-dismissed-hash';
const EMPTY_BUCKETS: readonly FreshnessBucket[] = [];

function describeBucket(bucket: FreshnessBucket) {
  if (bucket.reason === 'latest_sync_unsettled' && bucket.raw_last_data_date) {
    return `current through ${bucket.raw_last_data_date}; validated through ${bucket.settled_last_data_date ?? 'unknown'}`;
  }
  if (!bucket.last_data_date || bucket.age_days == null) return 'unknown age';
  const days = Math.floor(bucket.age_days);
  return `as of ${bucket.last_data_date} · ${days} day${days === 1 ? '' : 's'} old`;
}

type BackendState = 'checking' | 'healthy' | 'degraded' | 'offline';

const BACKEND_LABELS: Record<BackendState, string> = {
  checking: 'Checking',
  healthy: 'Reachable',
  degraded: 'Degraded',
  offline: 'Unreachable',
};

const SYNC_MESSAGES: Record<DashboardContextValue['backendSync']['status'], string> = {
  idle: 'Saved on this device',
  syncing: 'Syncing dashboard changes…',
  synced: 'Synced to the cloud',
  local: 'Saved on this device',
  error: 'Cloud sync failed. Check your connection and refresh to try again.',
};

interface DashboardHealthProps {
  backendSync: DashboardContextValue['backendSync'];
  migrationNotice?: DashboardContextValue['migrationNotice'];
  onDismissMigrationNotice?: () => void;
}

export function DashboardHealth({ backendSync, migrationNotice, onDismissMigrationNotice }: DashboardHealthProps) {
  const { data, isLoading, isError } = useMarketFreshness();
  const [connection, setConnection] = useState<BackendState>('checking');
  const [dismissedHash, setDismissedHash] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const disclosure = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const details = useRef<HTMLElement>(null);
  const detailsId = useId();

  useEffect(() => {
    try {
      setDismissedHash(sessionStorage.getItem(SESSION_KEY));
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
    }
  }, []);

  useEffect(() => {
    let active = true;
    const checkBackend = async () => {
      const { healthOk, dataOk } = await probeBackendReadiness();
      if (active) setConnection(!healthOk ? 'offline' : dataOk ? 'healthy' : 'degraded');
    };
    void checkBackend();
    const timer = window.setInterval(checkBackend, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    details.current?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !disclosure.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const buckets = data?.buckets ?? EMPTY_BUCKETS;
  const warnings = buckets.filter((bucket) => bucket.status !== 'fresh');
  // Preserve tab-session dismissal identity across the banner-to-control change.
  const currentHash = [data?.overall ?? 'unknown', ...[...buckets]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((bucket) => `${bucket.label}:${bucket.status}:${bucket.reason ?? 'none'}`)].join('|');
  const dismissed = warnings.length > 0 && currentHash === dismissedHash;
  const warning = warnings.length > 0 && !dismissed;
  const critical = warnings.some((bucket) => bucket.status === 'critical');
  const unsettled = warnings.some((bucket) => bucket.reason === 'latest_sync_unsettled');
  const unavailable = isError || buckets.length === 0 || (!warnings.length && data?.overall !== 'fresh');
  const freshnessLabel = isLoading ? 'Checking' : unavailable ? 'Unavailable'
    : warning ? (critical ? 'Degraded' : 'Delayed') : dismissed ? 'Dismissed' : 'Fresh';
  const message = isLoading ? 'Checking data freshness…'
    : unavailable ? (warnings.length > 0 ? 'Freshness status unavailable; last reported warnings:' : 'Freshness status unavailable.')
      : warning ? `${unsettled ? 'Data validation' : 'Data sync'} ${freshnessLabel.toLowerCase()}.`
        : dismissed ? 'Freshness warning dismissed for this session.'
          : 'All tracked data sources report fresh data.';
  // Readiness, persistence and source observations are independent signals.
  // A successful probe covers one endpoint; it doesn't establish freshness.
  const syncMessage = SYNC_MESSAGES[backendSync.enabled ? backendSync.status : 'local'];
  const incident = connection === 'offline' ? 'Backend unreachable'
    : connection === 'degraded' ? 'Backend degraded'
      : backendSync.enabled && backendSync.status === 'error' ? 'Sync issue'
        : migrationNotice?.tone === 'warning' ? 'Storage notice' : null;
  const attention = Boolean(incident) || (!isLoading && (warning || unavailable));
  const label = incident ?? freshnessLabel;
  const Icon = attention ? AlertTriangle : isLoading ? Clock : Activity;

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function dismiss() {
    setDismissedHash(currentHash);
    try {
      sessionStorage.setItem(SESSION_KEY, currentHash);
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
    }
    close();
  }

  return (
    <div
      ref={disclosure}
      className="shrink-0"
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (!open || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={`Workspace health: ${label}`}
        aria-expanded={open}
        aria-controls={open ? detailsId : undefined}
        onClick={() => open ? close() : setOpen(true)}
        className={cn(
          'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-semibold transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]',
          attention
            ? 'border-[var(--color-state-border)] bg-[var(--color-state-bg)] text-[var(--color-warning)]'
            : 'border-[var(--border-strong)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
        )}
      >
        <Icon size={15} aria-hidden="true" />
        <span className="hidden xl:inline">{label}</span>
      </button>
      <span role="status" className="sr-only">{incident ? `${incident}. ` : ''}{message}</span>
      {open && (
        <section
          id={detailsId}
          ref={details}
          aria-label="Workspace health details"
          tabIndex={-1}
          className="absolute right-2 top-full z-[120] mt-1 max-h-[min(28rem,65dvh)] w-[min(24rem,calc(100%-1rem))] overflow-y-auto overscroll-contain rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3 text-xs leading-5 text-[var(--text-primary)] shadow-lg focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)]"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Workspace health</h2>
            <button type="button" onClick={close} aria-label="Close workspace health" className="grid size-11 shrink-0 place-items-center rounded-md hover:bg-[var(--bg-hover)]">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <dl className="mb-3 space-y-1 text-[var(--text-secondary)]">
            <div><dt className="inline font-semibold text-[var(--text-primary)]">API readiness: </dt><dd className="inline">{BACKEND_LABELS[connection]}</dd></div>
            <div><dt className="inline font-semibold text-[var(--text-primary)]">Layout storage: </dt><dd className="inline">{syncMessage}</dd></div>
          </dl>
          {backendSync.enabled && backendSync.loadPaused && (
            <p className="mb-2 text-[var(--text-secondary)]">
              Changes are uploaded, but this device won&apos;t automatically pull layouts while you have custom workspaces.
            </p>
          )}
          {migrationNotice && (
            <div className="mb-3 rounded-md border border-[var(--border-default)] p-2">
              <h3 className="font-semibold">{migrationNotice.message}</h3>
              <p className="text-[var(--text-secondary)]">{migrationNotice.detail}</p>
              {onDismissMigrationNotice && (
                <button type="button" onClick={() => { onDismissMigrationNotice(); close(); }} className="min-h-11 underline underline-offset-2">
                  Dismiss storage notice
                </button>
              )}
            </div>
          )}
          <h3 className="font-semibold">Data freshness</h3>
          <p className="text-[var(--text-secondary)]">{message}</p>
          {buckets.length > 0 && (
            <ul className="my-2 divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
              {buckets.map((bucket) => (
                <li key={bucket.label} className="py-2">
                  <p className="font-medium">{bucket.label}{bucket.scope ? ` (${bucket.scope.replaceAll('_', ' ')})` : ''}:</p>
                  <p className="text-[var(--text-secondary)]">{bucket.status === 'critical' ? 'Degraded' : bucket.status === 'stale' ? 'Delayed' : bucket.status === 'unknown' ? 'Unknown' : 'Fresh'} · <span>{describeBucket(bucket)}</span></p>
                  {bucket.fetched_at && <p className="text-[var(--text-secondary)]">Fetched at <time dateTime={bucket.fetched_at}>{formatAbsoluteTimestamp(bucket.fetched_at)}</time></p>}
                  {bucket.detail && <p className="text-[var(--text-secondary)]">{bucket.detail}</p>}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            <Link href="/settings" className="inline-flex min-h-11 items-center font-medium underline underline-offset-2">View sources</Link>
            {warning && !isLoading && (
              <button type="button" onClick={dismiss} className="min-h-11 rounded-md px-2 font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" aria-label="Dismiss freshness warning for this session">
                Dismiss for this session
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
