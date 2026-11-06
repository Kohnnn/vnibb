'use client';

import { useState, useMemo, useEffect } from 'react';
import { LayoutGrid } from 'lucide-react';
import { useSectorPerformance } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import type { WidgetGroupId } from '@/types/widget';
import { toNumber } from './utils';
import { EMPTY_VALUE } from '@/lib/units';
import { signedToneClass, priceDirection } from '@/lib/priceColor';

interface SectorPerformanceWidgetProps {
    isEditing?: boolean;
    onRemove?: () => void;
    widgetGroup?: WidgetGroupId;
    onDataChange?: (data: WidgetDataPayload) => void;
}

// A sector with no usable change rows is not a flat 0% sector: it gets the
// neutral slate tile and an "n/a" label instead of a fabricated "+0.00%" read
// (issue #107). A genuine 0 keeps the same neutral family at a fainter strength
// (brand §13: zero is ink, not a gain) and still prints `0.00%`.
//
// Bands are tint strengths of the semantic direction tokens rather than a raw
// palette ramp: intensity rises monotonically with magnitude, and color-vision
// mode reaches the tiles through --color-positive/negative instead of needing a
// global class remap (which flattened one band and inverted the scale).
export function getHeatmapStyle(changePct: number | null): { background: string } {
    const tint = (token: string, pct: number) =>
        `color-mix(in srgb, var(${token}) ${pct}%, transparent)`;
    if (changePct === null) return { background: tint('--color-neutral', 40) };
    // Brand §13 `financialSemantics`: a measured zero is ink, so it takes the
    // neutral family rather than the gain tint.
    if (changePct === 0) return { background: tint('--color-neutral', 10) };
    // Symmetric: +2 and -2 must land on the same strength, because the label
    // contrast flip keys off |change| >= 2 and only reads correctly on a solid fill.
    const magnitude = Math.abs(changePct);
    const direction = changePct > 0 ? '--color-positive' : '--color-negative';
    if (magnitude >= 2) return { background: tint(direction, 100) };
    // Non-solid bands cap at 30% so primary ink stays >= 9:1 on the fill in both
    // themes. Above ~30% a same-hue label falls under 4.5:1 and secondary body
    // text under 3:1 (light +70% measured 2.0:1), so the tint must stay pale.
    if (magnitude >= 1) return { background: tint(direction, 30) };
    if (magnitude >= 0.5) return { background: tint(direction, 20) };
    return { background: tint(direction, 10) };
}

export function SectorPerformanceWidget({ onRemove, widgetGroup, onDataChange }: SectorPerformanceWidgetProps) {
    const [view, setView] = useState<'grid' | 'list'>('grid');
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useSectorPerformance();
    const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup, { widgetType: 'sector_performance' });

    const sectors = data?.data || [];
    const hasData = sectors.length > 0;
    const isFallback = Boolean(error && hasData);

    const sortedSectors = useMemo(() => {
        return [...sectors].sort((a, b) => Math.abs(toNumber(b.changePct) ?? 0) - Math.abs(toNumber(a.changePct) ?? 0));
    }, [sectors]);

    useEffect(() => {
        onDataChange?.(
            buildWidgetRuntime({
                empty: !hasData,
                apiGroup: '/market',
                endpoint: '/market/sector-performance',
                sourceLabel: 'Sector snapshot',
                lastDataDate: null,
                fetchedAt: dataUpdatedAt,
                stale: isFallback,
                extra: hasData ? { sectorCount: sectors.length } : undefined,
            }),
        );
    }, [hasData, dataUpdatedAt, isFallback, sectors.length, onDataChange]);

    const headerActions = (
        <div className="flex bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded text-[10px] mr-2">
            <button
                onClick={() => setView('grid')}
                className={`px-3 py-1 rounded transition-colors ${view === 'grid' ? 'bg-[var(--color-accent-fill)] text-[var(--color-on-accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
                Grid
            </button>
            <button
                onClick={() => setView('list')}
                className={`px-3 py-1 rounded transition-colors ${view === 'list' ? 'bg-[var(--color-accent-fill)] text-[var(--color-on-accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
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
                    updatedAt={null}
                    fetchedAt={dataUpdatedAt}
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
                                const change = toNumber(sector.changePct);
                                // The >=2% bands are solid fills: labels must flip to the
                                // page surface colour or they disappear into the tile.
                                const solid = change !== null && Math.abs(change) >= 2;
                                const name = sector.sectorName || sector.sectorNameEn || sector.sectorId;
                                return (
                                    <div
                                        key={sector.sectorId}
                                        className="p-3 rounded-lg border border-[var(--border-default)] flex flex-col justify-between min-h-[60px]"
                                        style={getHeatmapStyle(change)}
                                    >
                                        <div className={`break-words whitespace-normal text-[10px] font-bold uppercase ${solid ? 'text-[var(--color-bg-primary)]' : 'text-[var(--text-primary)]'}`}>
                                            {name}
                                        </div>
                                        {/* The >=2% bands paint a solid direction fill, so a
                                            same-token label would be 1:1 contrast. Paler bands
                                            carry direction in the fill, not the ink. */}
                                        <div className={`text-base font-black ${change === null ? 'text-[var(--text-muted)]' : solid ? 'text-[var(--color-bg-primary)]' : 'text-[var(--text-primary)]'}`}>
                                            {change === null ? EMPTY_VALUE : `${Number(change.toFixed(2)) > 0 ? '+' : ''}${change.toFixed(2)}%`}
                                        </div>
                                        <div className={`text-[9px] ${solid ? 'text-[var(--color-bg-primary)]' : 'text-[var(--text-primary)]'}`}>{sector.totalStocks} stocks</div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            {sortedSectors.map((sector) => {
                                const change = toNumber(sector.changePct);
                                const direction = priceDirection(change);
                                const name = sector.sectorName || sector.sectorNameEn || sector.sectorId;
                                const topGainer = sector.topGainer?.symbol;
                                const topLoser = sector.topLoser?.symbol;

                                return (
                                    <div
                                        key={sector.sectorId}
                                        className="flex items-center justify-between py-2 px-3 hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-2 h-2 rounded-full ${direction === 'none' ? 'bg-[var(--color-neutral)]' : direction === 'flat' ? 'bg-[var(--color-neutral)]' : direction === 'up' ? 'bg-[var(--color-positive)]' : 'bg-[var(--color-negative)]'}`} />
                                            <div>
                                                <div className="text-sm font-medium text-[var(--text-primary)]">{name}</div>
                                                <div className="text-[10px] text-[var(--text-muted)] flex items-center gap-2">
                                                    {topGainer && (
                                                        <button
                                                            onClick={() => setLinkedSymbol(topGainer)}
                                                            className="text-[var(--color-positive)] hover:text-[var(--color-positive)] font-bold"
                                                        >
                                                            {topGainer}
                                                        </button>
                                                    )}
                                                    {topLoser && (
                                                        <button
                                                            onClick={() => setLinkedSymbol(topLoser)}
                                                            className="text-[var(--color-negative)] hover:text-[var(--color-negative)] font-bold"
                                                        >
                                                            {topLoser}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <span className={`text-sm font-bold font-mono ${signedToneClass(change)}`}>
                                            {change === null ? EMPTY_VALUE : `${Number(change.toFixed(2)) > 0 ? '+' : ''}${change.toFixed(2)}%`}
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
