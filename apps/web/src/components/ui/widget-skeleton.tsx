'use client';

/**
 * Skeleton loading components for widgets
 * Provides consistent loading states across the dashboard
 */

interface WidgetSkeletonProps {
    lines?: number;
    variant?: 'default' | 'table' | 'chart';
}

/**
 * Default skeleton loader for widgets
 * Shows animated placeholder bars
 */
export function WidgetSkeleton({ lines = 3, variant = 'default' }: WidgetSkeletonProps) {
    if (variant === 'table') {
        return <TableSkeleton rows={lines} />;
    }

    if (variant === 'chart') {
        return <ChartSkeleton />;
    }

    return (
        <div className="animate-pulse space-y-3 p-4">
            {Array.from({ length: lines }).map((_, i) => (
                <div key={i} className="space-y-2">
                    <div
                        className="h-3 rounded bg-[var(--bg-tertiary)]"
                        style={{ width: `${Math.random() * 30 + 60}%` }}
                    />
                    <div
                        className="h-2 rounded bg-[var(--bg-secondary)]"
                        style={{ width: `${Math.random() * 20 + 40}%` }}
                    />
                </div>
            ))}
        </div>
    );
}

/**
 * Table-specific skeleton loader
 */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
    return (
        <div
            className="animate-pulse p-4 space-y-2"
            role="status"
            aria-label="Loading data..."
        >
            {/* Table Header */}
            <div className="flex gap-2 border-b border-[var(--border-subtle)] pb-2">
                <div className="h-3 w-1/4 rounded bg-[var(--bg-tertiary)]" />
                <div className="h-3 w-1/4 rounded bg-[var(--bg-tertiary)]" />
                <div className="h-3 w-1/4 rounded bg-[var(--bg-tertiary)]" />
                <div className="h-3 w-1/4 rounded bg-[var(--bg-tertiary)]" />
            </div>
            {/* Table Rows */}
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex gap-2 py-2">
                    <div className="h-2.5 w-1/4 rounded bg-[var(--bg-secondary)]" />
                    <div className="h-2.5 w-1/4 rounded bg-[var(--bg-secondary)]" />
                    <div className="h-2.5 w-1/4 rounded bg-[var(--bg-secondary)]" />
                    <div className="h-2.5 w-1/4 rounded bg-[var(--bg-secondary)]" />
                </div>
            ))}
        </div>
    );
}

/**
 * Chart-specific skeleton loader
 */
export function ChartSkeleton() {
    return (
        <div className="animate-pulse p-4 h-full flex flex-col">
            {/* Y-axis labels */}
            <div className="flex-1 flex items-end gap-1">
                {Array.from({ length: 12 }).map((_, i) => (
                    <div
                        key={i}
                        className="w-full rounded-t bg-[var(--bg-tertiary)]"
                        style={{ height: `${Math.random() * 60 + 20}%` }}
                    />
                ))}
            </div>
            {/* X-axis */}
            <div className="flex gap-4 mt-3">
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-2 w-12 rounded bg-[var(--bg-secondary)]" />
                ))}
            </div>
        </div>
    );
}

/**
 * Compact skeleton for small widgets or cards
 */
export function CompactSkeleton() {
    return (
        <div className="animate-pulse p-3 space-y-2">
            <div className="h-2.5 w-3/4 rounded bg-[var(--bg-tertiary)]" />
            <div className="h-2 w-1/2 rounded bg-[var(--bg-secondary)]" />
        </div>
    );
}
