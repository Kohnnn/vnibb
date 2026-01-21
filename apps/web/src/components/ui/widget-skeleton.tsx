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
                        className="h-3 bg-gray-800/60 rounded"
                        style={{ width: `${Math.random() * 30 + 60}%` }}
                    />
                    <div
                        className="h-2 bg-gray-800/40 rounded"
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
            <div className="flex gap-2 pb-2 border-b border-gray-800">
                <div className="h-3 bg-gray-700/60 rounded w-1/4" />
                <div className="h-3 bg-gray-700/60 rounded w-1/4" />
                <div className="h-3 bg-gray-700/60 rounded w-1/4" />
                <div className="h-3 bg-gray-700/60 rounded w-1/4" />
            </div>
            {/* Table Rows */}
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex gap-2 py-2">
                    <div className="h-2.5 bg-gray-800/50 rounded w-1/4" />
                    <div className="h-2.5 bg-gray-800/50 rounded w-1/4" />
                    <div className="h-2.5 bg-gray-800/50 rounded w-1/4" />
                    <div className="h-2.5 bg-gray-800/50 rounded w-1/4" />
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
                        className="bg-gray-800/50 rounded-t w-full"
                        style={{ height: `${Math.random() * 60 + 20}%` }}
                    />
                ))}
            </div>
            {/* X-axis */}
            <div className="flex gap-4 mt-3">
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-2 bg-gray-700/40 rounded w-12" />
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
            <div className="h-2.5 bg-gray-800/60 rounded w-3/4" />
            <div className="h-2 bg-gray-800/40 rounded w-1/2" />
        </div>
    );
}
