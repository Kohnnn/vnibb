// Market Heatmap Widget - Treemap visualization of market sectors with D3
'use client';

import { useState, useMemo, useRef, memo } from 'react';
import { ChevronLeft, Download, LayoutGrid } from 'lucide-react';
import { hierarchy, treemap } from 'd3-hierarchy';
import html2canvas from 'html2canvas';
import { useMarketHeatmap } from '@/lib/queries';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import type { SectorGroup } from '@/lib/api';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { cn } from '@/lib/utils';

interface MarketHeatmapWidgetProps {
    id: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function clampLabelSize(width: number, height: number): number {
    return Math.max(10, Math.min(18, Math.min(width / 7.5, height / 2.4)));
}

// Color scale based on Phase 20 MD
function getHeatmapColor(change: number): string {
    if (change >= 6.9) return 'rgb(6, 182, 212)'; // cyan-500 (Ceiling)
    if (change >= 4) return 'rgb(34, 197, 94)';   // green-500
    if (change >= 2) return 'rgb(22, 163, 74)';   // green-600
    if (change >= 0.5) return 'rgb(21, 128, 61)'; // green-700
    if (change >= -0.5) return 'rgb(202, 138, 4)'; // yellow-600 (Neutral)
    if (change >= -2) return 'rgb(185, 28, 28)';   // red-700
    if (change >= -4) return 'rgb(220, 38, 38)';   // red-600
    if (change <= -6.9) return 'rgb(59, 130, 246)'; // blue-500 (Floor)
    return 'rgb(239, 68, 68)'; // red-500
}

function MarketHeatmapWidgetComponent({ id, isEditing, onRemove }: MarketHeatmapWidgetProps) {
    const [groupBy, setGroupBy] = useState<'sector' | 'industry'>('sector');
    const [exchange, setExchange] = useState<'HOSE' | 'HNX' | 'UPCOM' | 'ALL'>('HOSE');
    const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
    const heatmapRef = useRef<HTMLDivElement>(null);
    const { setLinkedSymbol } = useWidgetSymbolLink();

    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useMarketHeatmap({
        group_by: groupBy,
        exchange,
        limit: 500,
        use_cache: true,
    });

    const treemapData = useMemo(() => {
        if (!data?.sectors) return null;

        if (selectedGroup) {
            const group = data.sectors.find((sector: SectorGroup) => sector.sector === selectedGroup);
            if (!group) return null;

            return {
                name: group.sector,
                children: group.stocks.map((stock) => ({
                    name: stock.symbol,
                    symbol: stock.symbol,
                    sector: group.sector,
                    value: stock.market_cap || 0,
                    changePct: stock.change_pct,
                    price: stock.price,
                    volume: stock.volume,
                })),
            };
        }

        return {
            name: 'Market',
            children: data.sectors.map((sector: SectorGroup) => ({
                name: sector.sector,
                sector: sector.sector,
                changePct: sector.avg_change_pct,
                stockCount: sector.stock_count,
                value: sector.total_market_cap,
                avgMarketCap: sector.total_market_cap,
            })),
        };
    }, [data, selectedGroup]);

    const treemapLayout = useMemo(() => {
        if (!treemapData) return null;

        const root = hierarchy(treemapData)
            .sum((d: any) => d.value || 0)
            .sort((a, b) => (b.value || 0) - (a.value || 0));

        // Use standard dimensions, SVG will scale
        const layout = treemap<any>()
            .size([900, 560])
            .paddingOuter(6)
            .paddingTop(28)
            .paddingInner(3)
            .round(true);

        return layout(root);
    }, [treemapData]);

    const handleExport = async () => {
        if (!heatmapRef.current) return;
        try {
            const canvas = await html2canvas(heatmapRef.current, { background: '#000' } as any);
            const link = document.createElement('a');
            link.download = `market-heatmap-${exchange}-${Date.now()}.png`;
            link.href = canvas.toDataURL();
            link.click();
        } catch (error) {
            console.error('Heatmap export failed:', error);
        }
    };

    const headerActions = (
        <div className="flex items-center gap-2 mr-2">
            <select
                value={groupBy}
                onChange={(e) => {
                    setGroupBy(e.target.value as any)
                    setSelectedGroup(null)
                }}
                aria-label="Heatmap grouping"
                className="bg-[var(--bg-secondary)] text-[9px] font-black uppercase text-[var(--text-secondary)] border border-[var(--border-default)] rounded px-1.5 py-0.5 outline-none hover:text-[var(--text-primary)] transition-colors"
            >
                <option value="sector">By Sector</option>
                <option value="industry">By Industry</option>
            </select>

            <div className="flex bg-[var(--bg-secondary)] rounded p-0.5 border border-[var(--border-default)]">
                {['HOSE', 'HNX', 'UPCOM', 'ALL'].map(m => (
                    <button
                        key={m}
                        onClick={() => {
                            setExchange(m as any)
                            setSelectedGroup(null)
                        }}
                        className={cn(
                            "px-2 py-0.5 text-[9px] font-bold rounded transition-all",
                            exchange === m ? "bg-blue-600 text-white shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        )}
                    >
                        {m}
                    </button>
                ))}
            </div>

            <button
                onClick={handleExport}
                className="p-1 text-[var(--text-muted)] hover:text-blue-400 transition-colors"
                title="Export Image"
            >
                <Download size={14} />
            </button>
        </div>
    );

    const hasData = Boolean(treemapLayout && data?.sectors?.length);
    const isFallback = Boolean(error && hasData);

    return (
        <WidgetContainer
            title="Market Heatmap"
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading && !hasData}
            headerActions={headerActions}
            noPadding
            widgetId={id}
        >
            <div className="h-full flex flex-col bg-[var(--bg-primary)]">
                <div className="flex-1 overflow-hidden relative">
                {isLoading && !hasData ? (
                        <div className="mx-auto mt-6 max-h-[200px] max-w-[560px] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/70">
                            <WidgetSkeleton variant="chart" />
                        </div>
                    ) : error && !hasData ? (
                        <WidgetError error={error as Error} onRetry={() => refetch()} />
                    ) : !treemapLayout ? (
                        <div className="mx-auto mt-8 max-w-md">
                            <WidgetEmpty message="Market data unavailable" icon={<LayoutGrid size={18} />} size="compact" />
                        </div>
                    ) : (
                        <div ref={heatmapRef} className="flex h-full w-full flex-col p-2">
                            <div className="mb-2 flex items-center justify-between gap-2 px-1">
                                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                                    {selectedGroup ? (
                                        <button
                                            type="button"
                                            onClick={() => setSelectedGroup(null)}
                                            className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                        >
                                            <ChevronLeft size={12} />
                                            Back
                                        </button>
                                    ) : null}
                                    <span>{selectedGroup ? `${selectedGroup} Constituents` : `${groupBy === 'sector' ? 'Sector' : 'Industry'} Heatmap`}</span>
                                </div>
                                <span className="text-[10px] text-[var(--text-muted)]">
                                    {selectedGroup ? 'Click a stock to sync the dashboard symbol' : 'Click a block to drill down'}
                                </span>
                            </div>
                            <div className="min-h-0 flex-1">
                            <svg width="100%" height="100%" viewBox="0 0 900 560" preserveAspectRatio="xMidYMid meet">
                                {treemapLayout.leaves().map((node: any, i: number) => {
                                    const width = node.x1 - node.x0;
                                    const height = node.y1 - node.y0;
                                    const changePct = node.data.changePct || 0;
                                    const color = getHeatmapColor(changePct);
                                    const labelSize = clampLabelSize(width, height);
                                    const detailSize = Math.max(9, Math.min(12, labelSize - 2));
                                    const canShowTitle = width > 70 && height > 34;
                                    const canShowDetail = width > 120 && height > 56;

                                    return (
                                        <g key={i} className="group transition-opacity hover:opacity-100">
                                            <rect
                                                x={node.x0}
                                                y={node.y0}
                                                width={width}
                                                height={height}
                                                fill={color}
                                                className="cursor-pointer transition-all hover:brightness-110"
                                                stroke="rgba(255,255,255,0.18)"
                                                strokeWidth={1}
                                                rx={8}
                                                ry={8}
                                                onClick={() => {
                                                    if (selectedGroup && node.data.symbol) {
                                                        setLinkedSymbol(node.data.symbol)
                                                        return
                                                    }
                                                    setSelectedGroup(node.data.sector || node.data.name)
                                                }}
                                            >
                                                <title>
                                                    {node.data.symbol || node.data.name}
                                                    {node.data.sector ? `\nSector: ${node.data.sector}` : ''}
                                                    {'\n'}Change: {changePct.toFixed(2)}%
                                                    {'\n'}Value: {((node.data.value || 0) / 1e9).toFixed(1)}B
                                                    {!selectedGroup && node.data.stockCount ? `\nStocks: ${node.data.stockCount}` : ''}
                                                </title>
                                            </rect>
                                            {canShowTitle && (
                                                <>
                                                    <text
                                                        x={node.x0 + 10}
                                                        y={node.y0 + 18}
                                                        textAnchor="start"
                                                        className="pointer-events-none select-none font-black"
                                                        fill="rgba(255,255,255,0.96)"
                                                        style={{ fontSize: labelSize }}
                                                    >
                                                        {node.data.symbol || node.data.name}
                                                    </text>
                                                    <text
                                                        x={node.x0 + 10}
                                                        y={node.y0 + 18 + labelSize + 6}
                                                        textAnchor="start"
                                                        className="pointer-events-none select-none font-semibold"
                                                        fill="rgba(255,255,255,0.86)"
                                                        style={{ fontSize: detailSize }}
                                                    >
                                                        {`${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`}
                                                    </text>
                                                </>
                                            )}
                                            {canShowDetail && (
                                                <text
                                                    x={node.x0 + 10}
                                                    y={node.y1 - 12}
                                                    textAnchor="start"
                                                    className="pointer-events-none select-none font-medium"
                                                    fill="rgba(255,255,255,0.78)"
                                                    style={{ fontSize: 10 }}
                                                >
                                                    {selectedGroup
                                                        ? `${node.data.sector || selectedGroup} • ${((node.data.value || 0) / 1e9).toFixed(1)}B`
                                                        : `${node.data.stockCount || 0} stocks • ${((node.data.value || 0) / 1e9).toFixed(1)}B`}
                                                </text>
                                            )}
                                        </g>
                                    );
                                })}
                            </svg>
                            </div>
                        </div>
                    )}
                </div>

                {/* Legend bar */}
                <div className="px-3 py-2 border-t border-[var(--border-default)] bg-[var(--bg-secondary)] flex items-center justify-between shadow-[0_-5px_15px_rgba(0,0,0,0.2)] z-10">
                    <div className="flex items-center gap-3">
                        <div className="flex h-1.5 w-32 rounded-full overflow-hidden border border-[var(--border-subtle)] shadow-inner">
                            <div className="flex-1 bg-blue-500" title="Floor" />
                            <div className="flex-1 bg-red-600" />
                            <div className="flex-1 bg-yellow-600" />
                            <div className="flex-1 bg-green-700" />
                            <div className="flex-1 bg-green-500" />
                            <div className="flex-1 bg-cyan-500" title="Ceiling" />
                        </div>
                        <span className="text-[8px] font-black text-[var(--text-muted)] uppercase tracking-tighter">-7% to +7%</span>
                    </div>
                    <div className="flex items-center gap-3">
                        {data && (
                            <div className="flex items-center gap-2 text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">
                                <span className="text-[var(--text-secondary)]">{data.count}</span> Stocks
                                <span className="text-[var(--text-muted)]">•</span>
                                <span className="text-[var(--text-secondary)]">{selectedGroup ? 1 : data.sectors.length}</span> Groups
                            </div>
                        )}
                        <WidgetMeta
                            updatedAt={data?.updated_at || dataUpdatedAt}
                            isFetching={isFetching && hasData}
                            isCached={isFallback}
                            align="right"
                        />
                    </div>
                </div>
            </div>
        </WidgetContainer>
    );
}

export const MarketHeatmapWidget = memo(MarketHeatmapWidgetComponent);
export default MarketHeatmapWidget;
