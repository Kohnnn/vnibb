'use client';

/**
 * Per-source freshness panel for Settings → Data Sources.
 *
 * Drives the "live data sync health dashboard" idea (#1 high-priority)
 * from `docs/evaluationreprot.md`. Reads the public freshness payload
 * from `GET /api/v1/market/data-sources/freshness` and renders one row
 * per backend table with last sync, age in days, status pill, and the
 * scheduled next sync window.
 *
 * Status colors:
 *   - fresh:    emerald
 *   - stale:    amber
 *   - critical: rose
 *   - unknown:  slate (no timestamp signal — table empty or schema drift)
 */

import { CheckCircle2, AlertTriangle, AlertCircle, RefreshCw, HelpCircle } from 'lucide-react';

import { useDataSourcesFreshness } from '@/lib/queries';
import { cn } from '@/lib/utils';
import type { DataSourceEntry } from '@/lib/api';

function StatusPill({ status }: { status: DataSourceEntry['status'] }) {
  const map: Record<
    DataSourceEntry['status'],
    { label: string; className: string; Icon: typeof CheckCircle2 }
  > = {
    fresh: {
      label: 'Fresh',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
      Icon: CheckCircle2,
    },
    stale: {
      label: 'Stale',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      Icon: AlertTriangle,
    },
    critical: {
      label: 'Critical',
      className: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
      Icon: AlertCircle,
    },
    unknown: {
      label: 'No data',
      className: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
      Icon: HelpCircle,
    },
  };
  const { label, className, Icon } = map[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]',
        className,
      )}
    >
      <Icon size={11} />
      {label}
    </span>
  );
}

function formatLastUpdated(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatAgeDays(age: number | null): string {
  if (age === null || age === undefined) return '—';
  if (age < 1) return 'today';
  if (age < 2) return '1 day ago';
  return `${Math.floor(age)} days ago`;
}

export function DataSourcesHealthPanel() {
  const { data, isLoading, error, refetch, isFetching } = useDataSourcesFreshness();

  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-[var(--text-primary)]">
            Pipeline Health
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            Per-source freshness for the Vietnam market data pipeline. Polls every
            10 min.
          </div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
          title="Refresh per-source freshness"
        >
          <RefreshCw size={11} className={cn(isFetching ? 'animate-spin' : '')} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="mt-3 text-xs text-[var(--text-muted)]">Loading freshness data…</div>
      ) : error ? (
        <div className="mt-3 rounded border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          Could not load freshness: {(error as Error).message}
        </div>
      ) : !data ? null : (
        <div className="mt-3 overflow-hidden rounded border border-[var(--border-default)]">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-[var(--bg-primary)] text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Source</th>
                <th className="px-3 py-2 text-left font-semibold">Last sync</th>
                <th className="px-3 py-2 text-left font-semibold">Age</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
                <th className="px-3 py-2 text-left font-semibold">Next sync</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)] bg-[var(--bg-primary)]/40">
              {data.sources.map((src) => (
                <tr key={src.key}>
                  <td className="px-3 py-2 align-top">
                    <div className="font-semibold text-[var(--text-primary)]">{src.label}</div>
                    <div className="mt-0.5 text-[10px] leading-4 text-[var(--text-muted)]">
                      {src.description}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top font-mono text-[var(--text-secondary)]">
                    {formatLastUpdated(src.last_updated)}
                  </td>
                  <td className="px-3 py-2 align-top text-[var(--text-secondary)]">
                    {formatAgeDays(src.age_days)}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <StatusPill status={src.status} />
                  </td>
                  <td className="px-3 py-2 align-top text-[10px] leading-4 text-[var(--text-muted)]">
                    {src.next_sync ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default DataSourcesHealthPanel;
