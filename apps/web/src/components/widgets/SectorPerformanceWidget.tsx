'use client';

import { useState, useMemo } from 'react';
import { LayoutGrid } from 'lucide-react';
import { useSectorPerformance } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import type { WidgetGroupId } from '@/types/widget';

interface SectorPerformanceWidgetProps {
    isEditing?: boolean;
    onRemove?: () => void;
    widgetGroup?: WidgetGroupId;
}

function getHeatmapColor(changePct: number): string {
    if (changePct >= 2) return 'bg-green-600';
    if (changePct >= 1) return 'bg-green-500/70';
    if (changePct >= 0.5) return 'bg-green-400/50';
    if (changePct >= 0) return 'bg-green-300/30';
    if (changePct >= -0.5) return 'bg-red-300/30';
    if (changePct >= -1) return 'bg-red-400/50';
    if (changePct >= -2) return 'bg-red-500/70';
    return 'bg-red-600';
}

export function SectorPerformanceWidget({ onRemove, widgetGroup }: SectorPerformanceWidgetProps) {
    const [view, setView] = useState<'grid' | 'list'>('grid');
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useSectorPerformance();
    const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup);

    const sectors = data?.data || [];
    const hasData = sectors.length > 0;
    const isFallback = Boolean(error && hasData);

    const sortedSectors = useMemo(() => {
        return [...sectors].sort((a, b) => Math.abs((b.changePct ?? 0) - (a.changePct ?? 0)));
    }, [sectors]);

    const headerActions = (
        <div className="flex bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded text-[10px] mr-2">
            <button
                onClick={() => setView('grid')}
                className={`px-3 py-1 rounded transition-colors ${view === 'grid' ? 'bg-blue-600 text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
                Grid
            </button>
            <button
                onClick={() => setView('list')}
                className={`px-3 py-1 rounded transition-colors ${view === 'list' ? 'bg-blue-600 text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
                List
            </button>
        </div>
    );

    return (
        <WidgetContainer
            title="Sector Performance"
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading && !hasData}
            headerActions={headerActions}
            noPadding
        >
            <div className="h-full flex flex-col p-2">
                <WidgetMeta
                    updatedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    isCached={isFallback}
                    note="Sector snapshot"
                    align="right"
                    className="mb-2"
                />

                <div className="flex-1 overflow-auto text-left">
                    {isLoading && !hasData ? (
                        <WidgetSkeleton lines={6} />
                    ) : error && !hasData ? (
                        <WidgetError error={error as Error} onRetry={() => refetch()} />
                    ) : !hasData ? (
                        <WidgetEmpty message="Sector data will appear when available." icon={<LayoutGrid size={18} />} />
                    ) : view === 'grid' ? (
                        <div className="grid grid-cols-2 gap-1.5">
                            {sortedSectors.map((sector) => {
                                const change = sector.changePct ?? 0;
                                const name = sector.sectorName || sector.sectorNameEn || sector.sectorId;
                                return (
                                    <div
                                        key={sector.sectorId}
                                        className={`p-3 rounded-lg border border-[var(--border-default)] ${getHeatmapColor(change)} cursor-pointer hover:opacity-90 transition-opacity flex flex-col justify-between min-h-[60px]`}
                                    >
                                        <div className="text-[10px] font-bold text-[var(--text-secondary)] uppercase truncate">
                                            {name}
                                        </div>
                                        <div className={`text-base font-black ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                                        </div>
                                        <div className="text-[9px] text-[var(--text-muted)]">{sector.totalStocks} stocks</div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            {sortedSectors.map((sector) => {
                                const change = sector.changePct ?? 0;
                                const isUp = change >= 0;
                                const name = sector.sectorName || sector.sectorNameEn || sector.sectorId;
                                const topGainer = sector.topGainer?.symbol;
                                const topLoser = sector.topLoser?.symbol;

                                return (
                                    <div
                                        key={sector.sectorId}
                                        className="flex items-center justify-between py-2 px-3 hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-2 h-2 rounded-full ${isUp ? 'bg-green-400' : 'bg-red-400'}`} />
                                            <div>
                                                <div className="text-sm font-medium text-[var(--text-primary)]">{name}</div>
                                                <div className="text-[10px] text-[var(--text-muted)] flex items-center gap-2">
                                                    {topGainer && (
                                                        <button
                                                            onClick={() => setLinkedSymbol(topGainer)}
                                                            className="text-green-400 hover:text-green-300 font-bold"
                                                        >
                                                            {topGainer}
                                                        </button>
                                                    )}
                                                    {topLoser && (
                                                        <button
                                                            onClick={() => setLinkedSymbol(topLoser)}
                                                            className="text-red-400 hover:text-red-300 font-bold"
                                                        >
                                                            {topLoser}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <span className={`text-sm font-bold font-mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                                            {isUp ? '+' : ''}{change.toFixed(2)}%
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}
