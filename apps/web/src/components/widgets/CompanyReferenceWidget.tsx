'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { APIError } from '@/lib/api';
import { CompanyReferenceEnvelopeError } from '@/lib/queries/equity';
import { buildCompanyReferenceRuntime, type CompanyReferenceWidgetType } from '@/lib/companyReferenceRuntime';
import { formatAbsoluteTimestamp } from '@/lib/formatDate';
import { deriveWidgetHealth } from '@/lib/widgetHealth';
import type { CompanyReferenceResponse } from '@/types/equity';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetEmpty } from '@/components/ui/widget-states';

function describeFailure(error: Error | null) {
  if (!error) return null;
  if (error instanceof CompanyReferenceEnvelopeError) return { kind: 'envelope', reason: error.message } as const;
  if (error instanceof APIError) {
    if (error.status === 408 || error.status === 504) return { kind: 'request', reason: 'Request timed out' } as const;
    if (error.status === 0) return { kind: 'request', reason: 'Could not reach the server' } as const;
    if (error.status) return { kind: 'request', reason: `Request failed (HTTP ${error.status})` } as const;
  }
  return { kind: 'request', reason: 'Request failed' } as const;
}

function readSourceAsOf(value?: string | null) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const day = value.slice(0, 10);
  if (new Date(day).toJSON()?.slice(0, 10) !== day) return null;
  return value === day ? day : new Date(value).toJSON();
}

interface CompanyReferenceWidgetProps<Row> {
  type: CompanyReferenceWidgetType;
  symbol: string;
  label: string;
  icon: ReactNode;
  query: UseQueryResult<CompanyReferenceResponse<Row>>;
  onDataChange?: (data: WidgetDataPayload) => void;
  exportRow: (row: Row) => object;
  renderRow: (row: Row, index: number) => ReactNode;
}

export function CompanyReferenceWidget<Row>({
  type, symbol, label, icon, query, onDataChange, exportRow, renderRow,
}: CompanyReferenceWidgetProps<Row>) {
  const { data, error, isFetching, dataUpdatedAt, errorUpdatedAt, refetch } = query;
  const rows = data?.data;
  const hasRows = Boolean(rows?.length);
  const failure = describeFailure(error);
  const reason = failure?.reason;
  const failureKind = failure?.kind;
  const observationStatus = !symbol ? undefined : hasRows ? 'available' : failure ? 'unavailable' : data ? 'empty' : 'loading';
  const refreshStatus = !symbol ? undefined : isFetching ? 'refreshing' : failure ? 'failed' : data ? 'succeeded' : undefined;
  const hasObservation = observationStatus === 'available' || observationStatus === 'empty';
  const runtime = useMemo(() => buildCompanyReferenceRuntime(type, symbol, {
    observationStatus,
    refreshStatus,
    lastDataDate: hasObservation ? readSourceAsOf(data?.meta?.last_data_date) : null,
    fetchedAt: hasObservation && dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : null,
    failedAt: reason && errorUpdatedAt ? new Date(errorUpdatedAt).toISOString() : undefined,
    failureKind,
    warnings: reason ? [reason] : undefined,
    cached: hasRows && Boolean(reason),
    exportData: hasObservation ? rows?.map(exportRow) : null,
  }), [type, symbol, observationStatus, refreshStatus, hasObservation, hasRows, data?.meta?.last_data_date,
    dataUpdatedAt, reason, failureKind, errorUpdatedAt, rows, exportRow]);
  const provenance = runtime.__widgetRuntime?.provenance;

  useEffect(() => { onDataChange?.(runtime); }, [onDataChange, runtime]);

  if (!symbol) return <WidgetEmpty message={`Select a symbol to view ${label.toLowerCase()}`} icon={icon} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-[var(--border-subtle)] pb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          {icon}
          <span>{hasRows ? `${label} returned: ${rows?.length}` : label}</span>
        </div>
        <WidgetMeta
          updatedAt={provenance?.updatedAt}
          fetchedAt={provenance?.fetchedAt}
          isFetching={isFetching && observationStatus !== 'loading'}
          health={provenance && deriveWidgetHealth(provenance)}
          align="right"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pt-2">
        {reason && (
          <div className="rounded border border-[var(--color-state-border)] bg-[var(--color-state-bg)] p-2 text-xs">
            <div role="status" className="space-y-1 text-[var(--text-secondary)]">
              <p className="font-medium">{hasRows ? 'Refresh failed. Showing previous records.' : `Data unavailable for ${symbol}`}</p>
              <p>{reason}</p>
              {provenance?.failedAt && (
                <p>Failed at <time dateTime={String(provenance.failedAt)}>{formatAbsoluteTimestamp(provenance.failedAt)}</time></p>
              )}
            </div>
            <button
              type="button"
              onClick={() => { void refetch(); }}
              disabled={isFetching}
              className="mt-2 min-h-6 rounded-md border border-[var(--color-state-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-info)] hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] disabled:opacity-60"
            >
              Retry
            </button>
          </div>
        )}
        {observationStatus === 'loading' && (
          <div role="status" aria-label="Loading records"><WidgetSkeleton lines={4} /></div>
        )}
        {observationStatus === 'empty' && (
          <WidgetEmpty
            message={`No records returned for ${symbol}`}
            detail="The source did not confirm full coverage."
            icon={icon}
          />
        )}
        {rows?.map(renderRow)}
      </div>
    </div>
  );
}
