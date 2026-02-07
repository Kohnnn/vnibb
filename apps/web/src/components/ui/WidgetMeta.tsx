'use client';

import { Clock, RefreshCw, Database, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime, formatTime } from '@/lib/format';

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
  const updatedLabel = updatedDate ? formatRelativeTime(updatedDate) : null;
  const exactTime = updatedDate ? formatTime(updatedDate, true) : null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 text-[10px] text-gray-500',
        align === 'right' ? 'justify-end' : 'justify-start',
        className
      )}
    >
      {updatedLabel && (
        <span className="inline-flex items-center gap-1" title={exactTime ? `Updated ${exactTime}` : undefined}>
          <Clock size={10} className="text-gray-500" />
          <span suppressHydrationWarning>Updated {updatedLabel}</span>
        </span>
      )}

      {isFetching && (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 text-blue-300 px-2 py-0.5">
          <RefreshCw size={10} className="animate-spin" />
          Refreshing
        </span>
      )}

      {(isCached || isStale) && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-300 px-2 py-0.5">
          <AlertTriangle size={10} />
          {isStale ? 'Stale data' : 'Cached'}
        </span>
      )}

      {note && <span className="text-gray-500">{note}</span>}

      {sourceLabel && (
        <span className="inline-flex items-center gap-1 text-gray-500">
          <Database size={10} className="opacity-70" />
          {sourceLabel}
        </span>
      )}
    </div>
  );
}

export default WidgetMeta;
