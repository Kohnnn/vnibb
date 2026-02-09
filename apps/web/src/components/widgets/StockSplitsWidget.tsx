// Stock Splits Widget - Company Calendar tab

'use client';

import { SplitSquareVertical } from 'lucide-react';
import { useCompanyEvents } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

interface StockSplitsWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function parseSplitRatio(value?: string): { from: string; to: string } {
    if (!value) return { from: '-', to: '-' };
    const normalized = value.replace(/\s+/g, '').replace('-', ':').replace('/', ':');
    const parts = normalized.split(':');
    if (parts.length === 2) return { from: parts[0] || '-', to: parts[1] || '-' };
    return { from: value, to: '-' };
}

function formatDate(value?: string): string {
    if (!value) return '-';
    return value;
}

export function StockSplitsWidget({ symbol }: StockSplitsWidgetProps) {
    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useCompanyEvents(symbol, { limit: 50, enabled: !!symbol });

    const splitRows =
        data?.data?.filter((event) => {
            const eventType = (event.event_type || '').toUpperCase();
            const eventName = (event.event_name || '').toUpperCase();
            const description = (event.description || '').toUpperCase();
            return (
                eventType.includes('SPLIT') ||
                eventName.includes('SPLIT') ||
                description.includes('SPLIT') ||
                eventType.includes('CHIA') ||
                eventName.includes('CHIA')
            );
        }) || [];

    const hasData = splitRows.length > 0;

    if (!symbol) {
        return <WidgetEmpty message="Select a symbol to view splits" icon={<SplitSquareVertical size={18} />} />;
    }

    return (
        <div className="h-full flex flex-col">
            <div className="pb-2 border-b border-gray-800/50">
                <WidgetMeta
                    updatedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    note="Company events"
                    align="right"
                />
            </div>
            <div className="flex-1 overflow-x-auto pt-3">
                {isLoading && !hasData ? (
                    <WidgetSkeleton lines={5} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty message="No stock splits recorded" icon={<SplitSquareVertical size={18} />} />
                ) : (
                    <table className="data-table w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-gray-500 uppercase">
                                <th className="pb-2 pr-4">Execution Date</th>
                                <th className="pb-2 pr-4 text-center">Split From</th>
                                <th className="pb-2 text-center">Split To</th>
                            </tr>
                        </thead>
                        <tbody>
                            {splitRows.map((row, idx) => {
                                const ratio = parseSplitRatio(row.value || row.description || row.event_name);
                                const executionDate = row.event_date || row.record_date || row.ex_date;
                                return (
                                    <tr key={`${executionDate || 'split'}-${idx}`} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                                        <td className="py-2 pr-4 text-gray-300">{formatDate(executionDate || undefined)}</td>
                                        <td className="py-2 pr-4 text-center text-blue-400 font-medium">{ratio.from}</td>
                                        <td className="py-2 text-center text-green-400 font-medium">{ratio.to}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
