// Market Heatmap Widget - Treemap visualization of market sectors with D3
'use client';

import { useState, useMemo, useRef, memo } from 'react';
import { LayoutGrid, RefreshCw, Download, Maximize2 } from 'lucide-react';
import { hierarchy, treemap } from 'd3-hierarchy';
import html2canvas from 'html2canvas';
import { useMarketHeatmap } from '@/lib/queries';
import type { HeatmapStock, SectorGroup } from '@/lib/api';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { cn } from '@/lib/utils';

interface MarketHeatmapWidgetProps {
    id: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

// Color scale based on Phase 20 MD
function getHeatmapColor(change: number): string {
    if (change >= 6.9) return 'rgb(168, 85, 247)'; // purple-500 (Ceiling)
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
    const heatmapRef = useRef<HTMLDivElement>(null);

    const { data, isLoading, refetch, isRefetching } = useMarketHeatmap({
        group_by: groupBy,
        exchange,
        limit: 500,
        use_cache: true,
    });

    const treemapData = useMemo(() => {
        if (!data?.sectors) return null;

        return {
            name: 'Market',
            children: data.sectors.map((sector: SectorGroup) => ({
                name: sector.sector,
                value: sector.total_market_cap,
                changePct: sector.avg_change_pct,
                stockCount: sector.stock_count,
                stocks: sector.stocks,
            })),
        };
    }, [data]);

    const treemapLayout = useMemo(() => {
        if (!treemapData) return null;

        const root = hierarchy(treemapData)
            .sum((d: any) => d.value || 0)
            .sort((a, b) => (b.value || 0) - (a.value || 0));

        // Use standard dimensions, SVG will scale
        const layout = treemap<any>()
            .size([800, 500])
            .paddingOuter(4)
            .paddingTop(20)
            .paddingInner(2)
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
                onChange={(e) => setGroupBy(e.target.value as any)}
                className="bg-gray-900 text-[9px] font-black uppercase text-gray-400 border border-gray-800 rounded px-1.5 py-0.5 outline-none hover:text-white transition-colors"
            >
                <option value="sector">By Sector</option>
                <option value="industry">By Industry</option>
            </select>

            <div className="flex bg-gray-900 rounded p-0.5 border border-gray-800">
                {['HOSE', 'HNX', 'ALL'].map(m => (
                    <button
                        key={m}
                        onClick={() => setExchange(m as any)}
                        className={cn(
                            "px-2 py-0.5 text-[9px] font-bold rounded transition-all",
                            exchange === m ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-300"
                        )}
                    >
                        {m}
                    </button>
                ))}
            </div>

            <button
                onClick={handleExport}
                className="p-1 text-gray-500 hover:text-blue-400 transition-colors"
                title="Export Image"
            >
                <Download size={14} />
            </button>
        </div>
    );

    return (
        <WidgetContainer
            title="Market Heatmap"
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading || isRefetching}
            headerActions={headerActions}
            noPadding
            widgetId={id}
        >
            <div className="h-full flex flex-col bg-black">
                <div className="flex-1 overflow-hidden relative">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
                            <RefreshCw className="animate-spin" size={24} />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Rendering Treemap...</span>
                        </div>
                    ) : !treemapLayout ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-600 opacity-50 uppercase font-black text-[10px] tracking-widest">
                            <LayoutGrid size={32} strokeWidth={1} />
                            No Map Data
                        </div>
                    ) : (
                        <div ref={heatmapRef} className="w-full h-full p-2">
                            <svg width="100%" height="100%" viewBox="0 0 800 500" preserveAspectRatio="xMidYMid meet">
                                {treemapLayout.leaves().map((node: any, i: number) => {
                                    const width = node.x1 - node.x0;
                                    const height = node.y1 - node.y0;
                                    const changePct = node.data.changePct || 0;
                                    const color = getHeatmapColor(changePct);

                                    return (
                                        <g key={i}>
                                            <rect
                                                x={node.x0}
                                                y={node.y0}
                                                width={width}
                                                height={height}
                                                fill={color}
                                                className="hover:brightness-125 transition-all cursor-pointer"
                                                stroke="#000"
                                                strokeWidth={0.5}
                                            >
                                                <title>
                                                    {node.data.name}
                                                    {'\n'}Change: {changePct.toFixed(2)}%
                                                    {'\n'}Value: {(node.data.value / 1e9).toFixed(1)}B
                                                </title>
                                            </rect>
                                            {width > 40 && height > 20 && (
                                                <text
                                                    x={node.x0 + width / 2}
                                                    y={node.y0 + height / 2 + 4}
                                                    textAnchor="middle"
                                                    className="fill-white font-black pointer-events-none select-none"
                                                    style={{ fontSize: Math.min(width / 6, height / 2, 10) }}
                                                >
                                                    {node.data.name.split('-')[0].substring(0, 8)}
                                                </text>
                                            )}
                                        </g>
                                    );
                                })}
                            </svg>
                        </div>
                    )}
                </div>

                {/* Legend bar */}
                <div className="px-3 py-1.5 border-t border-gray-800 bg-gray-900/20 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="flex h-1.5 w-24 rounded-full overflow-hidden border border-gray-800">
                            <div className="flex-1 bg-blue-500" />
                            <div className="flex-1 bg-red-600" />
                            <div className="flex-1 bg-yellow-600" />
                            <div className="flex-1 bg-green-700" />
                            <div className="flex-1 bg-green-500" />
                            <div className="flex-1 bg-purple-500" />
                        </div>
                        <span className="text-[8px] font-black text-gray-600 uppercase tracking-tighter">-7% to +7%</span>
                    </div>
                    {data && (
                        <div className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">
                            {data.count} Stocks • {data.sectors.length} Groups
                        </div>
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

export const MarketHeatmapWidget = memo(MarketHeatmapWidgetComponent);
export default MarketHeatmapWidget;
