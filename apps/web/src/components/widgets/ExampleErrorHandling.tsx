/**
 * Example Widget Implementation with Complete Error Handling
 * 
 * This demonstrates best practices for error handling, loading states,
 * and empty states in widgets using the new infrastructure.
 * 
 * Use this as a reference when creating or updating widgets.
 */

'use client';

import { WidgetWrapper } from './WidgetWrapper';
import { WidgetSkeleton, TableSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { useStockQuote } from '@/lib/queries';

interface ExampleWidgetProps {
    id: string;
    symbol: string;
    tabId: string;
    dashboardId: string;
    syncGroupId?: number;
    onSymbolChange?: (symbol: string) => void;
    onRemove?: () => void;
}

/**
 * PATTERN: Complete widget with error/loading/empty/success states
 */
export function ExampleWidget({
    id,
    symbol,
    tabId,
    dashboardId,
    syncGroupId,
    onSymbolChange,
    onRemove,
}: ExampleWidgetProps) {
    // 1. Fetch data using TanStack Query hook
    const { data, isLoading, error, refetch } = useStockQuote(symbol);

    return (
        <WidgetWrapper
            id={id}
            title="Example Widget"
            symbol={symbol}
            tabId={tabId}
            dashboardId={dashboardId}
            syncGroupId={syncGroupId}
            onSymbolChange={onSymbolChange}
            onRemove={onRemove}
        >
            <div className="h-full flex flex-col">
                {/* 2. LOADING STATE - Show skeleton while fetching */}
                {isLoading && <WidgetSkeleton variant="table" lines={5} />}

                {/* 3. ERROR STATE - Show error with retry button */}
                {error && !isLoading && (
                    <WidgetError
                        error={error as Error}
                        onRetry={() => refetch()}
                        title="Failed to load quote"
                    />
                )}

                {/* 4. EMPTY STATE - Show when no data */}
                {!isLoading && !error && !data && (
                    <WidgetEmpty
                        message="No quote data available for this symbol"
                        action={{
                            label: 'Retry',
                            onClick: () => refetch(),
                        }}
                    />
                )}

                {/* 5. SUCCESS STATE - Show actual data */}
                {!isLoading && !error && data && (
                    <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-400">Price</span>
                            <span className="text-lg font-semibold text-white">
                                {data.price?.toLocaleString('vi-VN')} VND
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-400">Change</span>
                            <span
                                className={`text-sm font-medium ${(data.changePct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
                                    }`}
                            >
                                {data.changePct?.toFixed(2)}%
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-400">Volume</span>
                            <span className="text-sm text-gray-300">
                                {data.volume?.toLocaleString('vi-VN')}
                            </span>
                        </div>
                    </div>
                )}
            </div>
        </WidgetWrapper>
    );
}

/**
 * PATTERN SUMMARY:
 * 
 * 1. Import skeleton and state components from ui/
 * 2. Use TanStack Query hook: { data, isLoading, error, refetch }
 * 3. Handle 4 states in order:
 *    - isLoading → WidgetSkeleton
 *    - error → WidgetError with retry
 *    - !data → WidgetEmpty
 *    - data → Actual content
 * 4. Always provide refetch callback for retry
 * 5. Use appropriate skeleton variant (table, chart, default)
 * 
 * TanStack Query handles:
 * - Automatic retry (3 attempts with exponential backoff)
 * - Network detection
 * - Cache management
 * - Request deduplication
 * 
 * ErrorBoundary (in WidgetWrapper) handles:
 * - React component errors
 * - Rendering failures
 */
