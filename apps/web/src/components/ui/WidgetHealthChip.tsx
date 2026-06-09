'use client';

import { Clock, Database, AlertTriangle, ShieldAlert, Activity } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatAbsoluteTimestamp, formatTime } from '@/lib/format';
import type { WidgetHealthState } from '@/lib/widgetHealth';

const warningBadgeStyle = {
  backgroundColor: 'color-mix(in srgb, #f59e0b 12%, transparent)',
  borderColor: 'color-mix(in srgb, #f59e0b 28%, transparent)',
  color: 'color-mix(in srgb, #b45309 72%, var(--text-primary) 28%)',
} as const;

const infoBadgeStyle = {
  backgroundColor: 'color-mix(in srgb, #38bdf8 12%, transparent)',
  borderColor: 'color-mix(in srgb, #38bdf8 28%, transparent)',
  color: 'color-mix(in srgb, #0ea5e9 72%, var(--text-primary) 28%)',
} as const;

const liveBadgeStyle = {
  backgroundColor: 'color-mix(in srgb, #10b981 12%, transparent)',
  borderColor: 'color-mix(in srgb, #10b981 32%, transparent)',
  color: 'color-mix(in srgb, #059669 72%, var(--text-primary) 28%)',
} as const;

function getPresentation(status: WidgetHealthState['status']) {
  switch (status) {
    case 'awaiting_update':
      return { icon: Clock, style: infoBadgeStyle };
    case 'cached':
      return { icon: Database, style: warningBadgeStyle };
    case 'stale':
      return { icon: AlertTriangle, style: warningBadgeStyle };
    case 'limited':
      return { icon: ShieldAlert, style: warningBadgeStyle };
    case 'live':
      return { icon: Activity, style: liveBadgeStyle };
    case 'coverage_gap':
    default:
      return { icon: AlertTriangle, style: warningBadgeStyle };
  }
}

export interface WidgetHealthChipDetails {
  sourceLabel?: string;
  apiGroup?: string;
  endpoint?: string;
  updatedAt?: number | string | Date | null;
  adjustmentMode?: string;
}

interface WidgetHealthChipProps {
  health: WidgetHealthState;
  details?: WidgetHealthChipDetails;
}

function toDate(value?: number | string | Date | null): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Compact, dashboard-wide source-health chip rendered in the widget toolbar.
 * Shows live/cached/stale/limited at a glance; the popover reveals data lineage
 * (source label, API group, endpoint, last update, adjustment mode) so users can
 * tell whether a widget is showing live, cached, stale, or local-only data.
 */
export function WidgetHealthChip({ health, details }: WidgetHealthChipProps) {
  const presentation = getPresentation(health.status);
  const Icon = presentation.icon;
  const updatedDate = toDate(details?.updatedAt);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium transition-opacity hover:opacity-80"
          style={presentation.style}
          title={health.detail}
          aria-label={`Data status: ${health.label}`}
        >
          <Icon size={9} />
          <span className="hidden sm:inline">{health.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="z-[120] mt-2 w-64 rounded-xl border border-[var(--border-default)] bg-[rgba(10,15,26,0.98)] p-3 text-left shadow-2xl"
      >
        <div className="mb-2 flex items-center gap-1.5 border-b border-[var(--border-subtle)] pb-2">
          <Icon size={12} />
          <span className="text-[11px] font-semibold text-slate-100">{health.label}</span>
        </div>
        {health.detail && (
          <p className="mb-2 text-[11px] leading-4 text-slate-300/85">{health.detail}</p>
        )}
        <div className="space-y-1 text-[10px] text-slate-300/80">
          {details?.sourceLabel && (
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Source</span>
              <span className="text-right text-slate-100/90">{details.sourceLabel}</span>
            </div>
          )}
          {details?.apiGroup && (
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">API group</span>
              <span className="text-right text-slate-100/90">{details.apiGroup}</span>
            </div>
          )}
          {details?.endpoint && (
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Endpoint</span>
              <span className="text-right font-mono text-[9px] text-slate-100/90">{details.endpoint}</span>
            </div>
          )}
          {updatedDate && (
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Updated</span>
              <span className="text-right text-slate-100/90" suppressHydrationWarning title={formatTime(updatedDate, true)}>
                {formatAbsoluteTimestamp(updatedDate)}
              </span>
            </div>
          )}
          {details?.adjustmentMode && (
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Adjustment</span>
              <span className="text-right text-slate-100/90">{details.adjustmentMode}</span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default WidgetHealthChip;
