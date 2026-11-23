'use client';

import type { ReactNode } from 'react';
import { formatSourceObservation } from '@/lib/formatDate';
import type { WidgetHealthState } from '@/lib/widgetHealth';
import type { IntradayAvailability } from '@/hooks/useIntradayAvailability';
import { WidgetMeta } from './WidgetMeta';
import { WidgetEmpty, WidgetError } from './widget-states';

export function IntradayStatus({ availability, hasData, isFetching, label, health }: {
  availability: IntradayAvailability;
  hasData: boolean;
  isFetching: boolean;
  label?: string;
  health?: WidgetHealthState;
}) {
  const { runtime, retained, sessionLabel, source, window } = availability;
  const snapshot = formatSourceObservation(runtime.intraday?.snapshotAt);
  const note = [
    label, hasData && retained && 'Retained observations', hasData && window && `Covered session: ${window.session_date}`,
  ].filter(Boolean).join(' · ');
  return (
    <div className="min-w-0">
      <p className="text-right text-[10px] text-[var(--text-secondary)]">{sessionLabel}</p>
      <WidgetMeta
        updatedAt={runtime.lastDataDate}
        fetchedAt={runtime.fetchedAt}
        isFetching={isFetching}
        isCached={runtime.cached && !retained}
        health={health}
        sourceLabel={source}
        note={note}
        align="right"
      />
      {snapshot && !runtime.lastDataDate && (
        <p className="text-right text-[10px] text-[var(--text-muted)]">Snapshot stored: {snapshot}</p>
      )}
      {hasData && runtime.warnings?.map((warning) => (
        <p key={warning} role="status" className="my-1 text-[11px] text-[var(--color-warning)]">{warning}</p>
      ))}
    </div>
  );
}

export function IntradayEmpty({ availability, unavailable, empty, detail, icon, onRetry, allowZero = true }: {
  availability: IntradayAvailability;
  unavailable: string;
  empty: string;
  detail: string;
  icon?: ReactNode;
  onRetry: () => void;
  allowZero?: boolean;
}) {
  if (availability.failure) {
    return <WidgetError title={unavailable} error={new Error(availability.failure.message)} onRetry={onRetry} />;
  }
  const zero = allowZero && availability.window?.trade_count === 0;
  return (
    <WidgetEmpty
      message={zero ? `No trades in the covered ${availability.window?.session_date} session` : empty}
      detail={zero ? 'A dated session record confirms zero trades for this symbol.' : detail}
      icon={icon}
      action={{ label: 'Refresh', onClick: onRetry }}
    />
  );
}