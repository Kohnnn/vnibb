'use client';

import { Clock, RefreshCw, Database, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatAbsoluteTimestamp, formatTime } from '@/lib/format';

const fetchingBadgeStyle = {
  backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)',
  borderColor: 'color-mix(in srgb, var(--accent-blue) 32%, transparent)',
  color: 'color-mix(in srgb, var(--accent-blue) 82%, var(--text-primary) 18%)',
} as const;

const warningBadgeStyle = {
  backgroundColor: 'color-mix(in srgb, #f59e0b 12%, transparent)',
  borderColor: 'color-mix(in srgb, #f59e0b 28%, transparent)',
  color: 'color-mix(in srgb, #b45309 72%, var(--text-primary) 28%)',
} as const;

interface WidgetMetaProps {
  updatedAt?: number | string | Date | null;
  isFetching?: boolean;
  isCached?: boolean;
  isStale?: boolean;
  sourceLabel?: string;
  note?: string;
  align?: 'left' | 'right';
  className?: string;
}

function toDate(value?: number | string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function WidgetMeta({
  updatedAt,
  isFetching = false,
  isCached = false,
  isStale = false,
  sourceLabel,
  note,
  align = 'left',
  className,
}: WidgetMetaProps) {
  const updatedDate = toDate(updatedAt);
  const updatedLabel = updatedDate ? formatAbsoluteTimestamp(updatedDate) : null;
  const exactTime = updatedDate ? formatTime(updatedDate, true) : null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]',
        align === 'right' ? 'justify-end' : 'justify-start',
        className
      )}
    >
      {updatedLabel && (
        <span className="inline-flex items-center gap-1" title={exactTime ? `Updated ${exactTime}` : undefined}>
          <Clock size={10} className="text-[var(--text-muted)]" />
          <span suppressHydrationWarning>Updated {updatedLabel}</span>
        </span>
      )}

      {isFetching && (
        <span
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
          style={fetchingBadgeStyle}
        >
          <RefreshCw size={10} className="animate-spin" />
          Refreshing
        </span>
      )}

      {(isCached || isStale) && (
        <span
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
          style={warningBadgeStyle}
        >
          <AlertTriangle size={10} />
          {isStale ? 'Stale data' : 'Cached'}
        </span>
      )}

      {note && <span className="text-[var(--text-muted)]">{note}</span>}

      {sourceLabel && (
        <span className="inline-flex items-center gap-1 text-[var(--text-muted)]">
          <Database size={10} className="opacity-70" />
          {sourceLabel}
        </span>
      )}
    </div>
  );
}

export default WidgetMeta;
