// Market Heatmap Widget - Treemap visualization of market sectors with D3
'use client';

import { useState, useMemo, useRef, useEffect, memo } from 'react';
import { ChevronLeft, Download, LayoutGrid } from 'lucide-react';
import { hierarchy, treemap } from 'd3-hierarchy';
import { exportToPNG, type ExportProvenance } from '@/lib/exportWidget';
import { logClientError } from '@/lib/clientLogger';
import { useUnit } from '@/contexts/UnitContext';
import { useMarketHeatmap } from '@/lib/queries';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { marketCapExplanation, resolveMarketCap } from '@/lib/marketCap';
import type { SectorGroup } from '@/lib/api';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { ChartSizeBox } from '@/components/ui/ChartSizeBox';
import { EMPTY_VALUE, formatCompactValueForUnit, formatPercent } from '@/lib/units';
import { formatShortDate } from '@/lib/formatDate';
import { cn } from '@/lib/utils';

interface MarketHeatmapWidgetProps {
    id: string;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: WidgetDataPayload) => void;
}

type HeatmapGroupBy = 'sector' | 'industry' | 'vn30' | 'hnx30';
type HeatmapExchange = 'HOSE' | 'HNX' | 'UPCOM' | 'ALL';

const EXCHANGES = ['HOSE', 'HNX', 'UPCOM', 'ALL'] as const;
const INDEX_PRESETS = [
    { label: 'VN30', groupBy: 'vn30' },
    { label: 'HNX30', groupBy: 'hnx30' },
] as const;
const HEATMAP_GROUP_LABELS: Record<HeatmapGroupBy, string> = {
    sector: 'Sector',
    industry: 'Industry',
    vn30: 'VN30',
    hnx30: 'HNX30',
};

const SIZE_LABELS: Record<string, string> = {
    market_cap: 'Market cap',
    volume: 'Volume',
    value_traded: 'Traded value',
};

function validSize(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function clampLabelSize(width: number, height: number): number {
    return Math.max(10, Math.min(18, Math.min(width / 7.5, height / 2.4)));
}

// A group whose change is unknown is not a flat 0% group: coercing a missing
// change to 0 painted the neutral band and printed "+0.00%", a fabricated
// neutral market read (issue #107). Unknown keeps its own darker neutral fill
// and a "—" label.
const UNKNOWN_CHANGE_COLOR = 'color-mix(in srgb, var(--text-muted, #929aa8) 42%, black)';

// Treemap tiles carry white labels, so each band must be dark enough for white
// text (>=4.5:1). Mixing the semantic direction token with black keeps gain/loss
// meaning and follows the colour-vision swap, which a fixed rgb() ramp did not:
// the old scale darkened toward cyan/blue, so the biggest gain and the biggest
// loss read as a third category, and the neutral band was yellow.
function band(token: string, strength: number): string {
    return `color-mix(in srgb, var(${token}) ${strength}%, black)`;
}

const HEAT_GAIN = [band('--color-positive', 55), band('--color-positive', 46), band('--color-positive', 38), band('--color-positive', 30)];
const HEAT_LOSS = [band('--color-negative', 55), band('--color-negative', 46), band('--color-negative', 38), band('--color-negative', 30)];
const HEAT_NEUTRAL = band('--text-muted', 62);

function getHeatmapColor(change: number | null | undefined): string {
    if (change === null || change === undefined || !Number.isFinite(change)) return UNKNOWN_CHANGE_COLOR;
    if (change >= 6.9) return HEAT_GAIN[3];
    if (change >= 4) return HEAT_GAIN[2];
    if (change >= 2) return HEAT_GAIN[1];
    if (change >= 0.5) return HEAT_GAIN[0];
    if (change >= -0.5) return HEAT_NEUTRAL;
    if (change >= -2) return HEAT_LOSS[0];
    if (change >= -4) return HEAT_LOSS[1];
    if (change >= -6.9) return HEAT_LOSS[2];
    return HEAT_LOSS[3];
}

function buildTreemapLayout(data: unknown, width: number, height: number) {
    if (!data || width <= 0 || height <= 0) return null;

    const root = hierarchy(data as any)
        .sum((d: any) => d.value || 0)
        .sort((a, b) => (b.value || 0) - (a.value || 0));

    const layout = treemap<any>()
        .size([Math.max(320, Math.floor(width)), Math.max(240, Math.floor(height))])
        .paddingOuter(6)
        .paddingTop(28)
        .paddingInner(3)
        .round(true);

    return layout(root);
}

function MarketHeatmapWidgetComponent({ id, isEditing, onRemove, onDataChange }: MarketHeatmapWidgetProps) {
    const [groupBy, setGroupBy] = useState<HeatmapGroupBy>('sector');
    const [exchange, setExchange] = useState<HeatmapExchange>('HOSE');
    const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
    // Roving tabindex: the treemap is one tab stop, arrows move within it.
    const [tileIndex, setTileIndex] = useState(0);
    const tileRefs = useRef<Array<SVGRectElement | null>>([]);
    const heatmapRef = useRef<HTMLDivElement>(null);
    const { setLinkedSymbol } = useWidgetSymbolLink(undefined, { widgetType: 'market_heatmap' });
    const { config: unitConfig } = useUnit();

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
        // An empty sector list means the endpoint had no coverage, not a flat market:
        // rendering it produced a treemap with "0 stocks / 0 groups" and a
        // fabricated neutral read (issue #107). Unavailable stays unavailable.
        if (!data?.sectors?.length) return null;

        if (selectedGroup) {
            const group = data.sectors.find((sector: SectorGroup) => sector.sector === selectedGroup);
            if (!group) return null;

            const children = group.stocks.flatMap((stock) => {
                const marketCap = resolveMarketCap({ label: stock.symbol, value: stock.market_cap, provenance: stock.market_cap_provenance });
                if (!validSize(stock.size_value) || (data.size_metric === 'market_cap' && marketCap.value !== stock.size_value)) return [];
                return [{ name: stock.symbol, symbol: stock.symbol, sector: group.sector, value: stock.size_value,
                    changePct: stock.change_pct, price: stock.price, volume: stock.volume, marketCap }];
            });
            return children.length ? { name: group.sector, children } : null;
        }

        const children = data.sectors.filter((sector: SectorGroup) => validSize(sector.total_size_value) && (data.size_metric !== 'market_cap' || (Number.isInteger(sector.cap_count) && sector.cap_count > 0 && sector.cap_count <= sector.stock_count && sector.total_market_cap === sector.total_size_value))).map((sector: SectorGroup) => ({
            name: sector.sector,
            sector: sector.sector,
            changePct: sector.avg_change_pct,
            stockCount: sector.stock_count,
            value: sector.total_size_value,
            totalMarketCap: Number.isInteger(sector.cap_count) && sector.cap_count > 0 && sector.cap_count <= sector.stock_count && validSize(sector.total_market_cap) ? sector.total_market_cap : null,
            capCount: sector.cap_count,
        }));
        return children.length ? { name: 'Market', children } : null;
    }, [data, selectedGroup]);

    const handleExport = async () => {
        if (!heatmapRef.current) return;
        // A bitmap cannot carry a sidecar, so the source and both timestamps are
        // painted on. Brand v1.1 review found the export faked dark always.
        const provenance: ExportProvenance = {
            widgetType: 'market_heatmap',
            widgetTitle: 'Market Heatmap',
            sourceLabel: 'Market heatmap',
            apiGroup: '/market',
            endpoint: heatmapEndpoint,
            updatedAt: data?.price_updated_at ?? null,
            fetchedAt: dataUpdatedAt || null,
            coverage: data?.partial ? 'partial' : undefined,
            stale: isFallback || Boolean(data?.constituents_stale),
            cached: Boolean(data?.cached) || isFallback,
        };
        try {
            await exportToPNG(heatmapRef.current, `market-heatmap-${exchange}-${Date.now()}`, provenance);
        } catch (error) {
            logClientError('Heatmap export failed:', error);
        }
    };

    const headerActions = (
        <div className="flex items-center gap-2 mr-2">
            <select
                value={groupBy === 'sector' || groupBy === 'industry' ? groupBy : 'sector'}
                onChange={(e) => {
                    setGroupBy(e.target.value === 'industry' ? 'industry' : 'sector')
                    setSelectedGroup(null)
                }}
                aria-label="Heatmap grouping"
                className="bg-[var(--bg-secondary)] text-[9px] font-black uppercase text-[var(--text-secondary)] border border-[var(--border-default)] rounded px-1.5 py-0.5 outline-none hover:text-[var(--text-primary)] transition-colors"
            >
                <option value="sector">By Sector</option>
                <option value="industry">By Industry</option>
            </select>

            <div className="flex bg-[var(--bg-secondary)] rounded p-0.5 border border-[var(--border-default)]">
                {INDEX_PRESETS.map(({ label, groupBy: presetGroupBy }) => (
                    <button
                        key={presetGroupBy}
                        type="button"
                        onClick={() => {
                            setGroupBy(presetGroupBy)
                            setExchange('ALL')
                            setSelectedGroup(null)
                        }}
                        className={cn(
                            "px-2 py-0.5 text-[9px] font-bold rounded transition-all",
                            groupBy === presetGroupBy ? "bg-[var(--color-accent-fill)] text-[var(--color-on-accent)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="flex bg-[var(--bg-secondary)] rounded p-0.5 border border-[var(--border-default)]">
                {EXCHANGES.map(m => (
                    <button
                        key={m}
                        type="button"
                        onClick={() => {
                            setExchange(m)
                            setSelectedGroup(null)
                        }}
                        className={cn(
                            "px-2 py-0.5 text-[9px] font-bold rounded transition-all",
                            exchange === m ? "bg-[var(--color-accent-fill)] text-[var(--color-on-accent)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        )}
                    >
                        {m}
                    </button>
                ))}
            </div>

            <button
                onClick={handleExport}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--color-accent-primary)] transition-colors"
                title="Export Image"
            >
                <Download size={14} />
            </button>
        </div>
    );

    const hasData = Boolean(treemapData && data?.sectors?.length);
    const isFallback = Boolean(error && hasData);
    const heatmapEndpoint = `/market/heatmap?group_by=${groupBy}&exchange=${exchange}&limit=500`;
    const constituentDate = data?.constituents_as_of;
    const constituentNote = constituentDate
        ? `Constituents ${formatShortDate(constituentDate)}${data?.constituents_stale ? ' (stale)' : ''}`
        : 'Constituents date unknown';
    const freshnessNote = `${data?.partial ? 'Partial universe · ' : ''}Price ${data?.price_updated_at ? formatShortDate(data.price_updated_at) : 'date unknown'} · ${constituentNote}`;
    const sizeLabel = SIZE_LABELS[data?.size_metric ?? ''] ?? 'Unknown metric';
    const formatSize = (value: number) => data?.size_metric === 'volume'
        ? value.toLocaleString()
        : formatCompactValueForUnit(value, unitConfig, { decimals: 1 });

    useEffect(() => {
        onDataChange?.(
            buildWidgetRuntime({
                empty: !hasData,
                apiGroup: '/market',
                endpoint: heatmapEndpoint,
                sourceLabel: 'Market heatmap',
                lastDataDate: constituentDate ?? null,
                fetchedAt: dataUpdatedAt,
                cached: Boolean(data?.cached) || isFallback,
                // Incomplete universe coverage is a coverage fact, not source age:
                // report it as `partial` so the health chip says "Partial coverage"
                // instead of claiming the stored observation is stale (issue #107).
                coverage: data?.partial ? 'partial' : undefined,
                stale: isFallback || Boolean(data?.constituents_stale),
                warnings: error ? [error.message] : undefined,
                extra: hasData ? { groupBy, exchange, groupCount: data?.sectors?.length ?? 0, endpoint: heatmapEndpoint, sizeMetric: data?.size_metric, sectors: data?.sectors } : undefined,
            }),
        );
    }, [hasData, constituentDate, dataUpdatedAt, data?.cached, data?.constituents_stale, data?.partial, isFallback, error, groupBy, exchange, data?.sectors, data?.size_metric, onDataChange, heatmapEndpoint]);

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
                {error && hasData && (
                    <div role="alert" className="border-b border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                        {error.message}
                    </div>
                )}
                <div className="flex-1 overflow-hidden relative">
                {isLoading && !hasData ? (
                        <div className="mx-auto mt-6 max-h-[200px] max-w-[560px] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/70">
                            <WidgetSkeleton variant="chart" />
                        </div>
                    ) : error && !hasData ? (
                        <WidgetError error={error as Error} onRetry={() => refetch()} />
                    ) : !treemapData ? (
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
                                    <span>{selectedGroup ? `${selectedGroup} Constituents` : `${HEATMAP_GROUP_LABELS[groupBy]} Heatmap`}</span>
                                    <span>Size: {sizeLabel}</span>
                                </div>
                                {/* Tiles are now real buttons, so the hint must not
                                    promise only a pointer interaction. */}
                                <span className="text-[10px] text-[var(--text-muted)]">
                                    {selectedGroup ? 'Select a stock to sync the dashboard symbol' : 'Select a block to drill down'}
                                </span>
                            </div>
                            <div className="min-h-0 flex-1">
                                <ChartSizeBox className="h-full min-h-[280px]" minHeight={280}>
                                    {({ width: containerWidth, height: containerHeight }) => {
                                        const treemapLayout = buildTreemapLayout(treemapData, containerWidth, containerHeight);
                                        if (!treemapLayout) {
                                            return <div className="h-full w-full" />;
                                        }
                                        // A drilldown can shrink the tile list; keep the
                                        // roving stop inside the rendered range.
                                        const tileCount = treemapLayout.leaves().length;
                                        const activeTile = tileCount > 0 ? Math.min(tileIndex, tileCount - 1) : 0;

                                        return (
                                             <svg
                                                 width="100%"
                                                 height="100%"
                                                 viewBox={`0 0 ${Math.max(320, Math.floor(containerWidth))} ${Math.max(240, Math.floor(containerHeight))}`}
                                                 preserveAspectRatio="none"
                                                // A named <svg> implies role="img", which makes every
                                                // descendant presentational — the sector/symbol controls
                                                // would disappear from the accessibility tree.
                                                role="group"
                                                aria-label={`Market heatmap grouped by ${groupBy}`}
                                             >
                                                {treemapLayout.leaves().map((node: any, index: number) => {
                                                    const width = node.x1 - node.x0;
                                                    const height = node.y1 - node.y0;
                                                    const rawChange = node.data.changePct;
                                                    const changePct =
                                                        typeof rawChange === 'number' && Number.isFinite(rawChange)
                                                            ? rawChange
                                                            : null;
                                                    const color = getHeatmapColor(changePct);
                                                    const labelSize = clampLabelSize(width, height);
                                                    const detailSize = Math.max(9, Math.min(12, labelSize - 2));
                                                    const canShowTitle = width > 70 && height > 34;
                                                    const canShowDetail = width > 120 && height > 56;
                                                    const nodeKey = node.data.symbol || node.data.sector || node.data.name;
                                                    const activatesSymbol = Boolean(selectedGroup && node.data.symbol);
                                                    const activate = () => {
                                                        if (activatesSymbol) {
                                                            setLinkedSymbol(node.data.symbol)
                                                            return
                                                        }
                                                        setSelectedGroup(node.data.sector || node.data.name)
                                                    }
                                                    return (
                                                        <g key={nodeKey} className="group transition-opacity hover:opacity-100">
                                                            <rect
                                                                x={node.x0}
                                                                y={node.y0}
                                                                width={width}
                                                                height={height}
                                                                fill={color}
                                                                className="cursor-pointer transition-all hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent-primary)]"
                                                                stroke="rgba(255,255,255,0.18)"
                                                                strokeWidth={1}
                                                                rx={8}
                                                                ry={8}
                                                                role="button"
                                                                // One tab stop for the whole treemap: `limit: 500`
                                                                // would otherwise put 500 stops before the next widget.
                                                                // Arrow keys move the roving stop between tiles.
                                                                tabIndex={index === activeTile ? 0 : -1}
                                                                aria-label={
                                                                    activatesSymbol
                                                                        ? `Select ${node.data.symbol}`
                                                                        : `Open ${node.data.sector || node.data.name} constituents`
                                                                }
                                                                onClick={activate}
                                                                onKeyDown={(event) => {
                                                                    if (event.key === 'ArrowRight' || event.key === 'ArrowDown'
                                                                        || event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                                                                        event.preventDefault()
                                                                        const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
                                                                        const next = (index + delta + tileCount) % tileCount
                                                                        setTileIndex(next)
                                                                        tileRefs.current[next]?.focus()
                                                                        return
                                                                    }
                                                                    if (event.key !== 'Enter' && event.key !== ' ') return
                                                                    event.preventDefault()
                                                                    activate()
                                                                }}
                                                                ref={(element) => { tileRefs.current[index] = element }}
                                                            >
                                                                <title>
                                                                    {node.data.symbol || node.data.name}
                                                                    {node.data.sector ? `\nSector: ${node.data.sector}` : ''}
                                                                    {'\n'}Change: {changePct === null ? EMPTY_VALUE : `${changePct.toFixed(2)}%`}
                                                                    {'\n'}Size ({sizeLabel}): {formatSize(node.data.value)}
                                                                    {selectedGroup && node.data.marketCap ? `\nMarket cap: ${node.data.marketCap.value === null ? 'Unavailable' : formatCompactValueForUnit(node.data.marketCap.value, unitConfig, { decimals: 1 })}\n${marketCapExplanation(node.data.marketCap)}` : ''}
                                                                    {!selectedGroup ? `\nAdmitted market cap: ${node.data.totalMarketCap === null ? 'Unavailable' : formatCompactValueForUnit(node.data.totalMarketCap, unitConfig, { decimals: 1 })}\nCap coverage: ${node.data.capCount ?? 'unknown'} of ${node.data.stockCount} returned stocks${node.data.capCount < node.data.stockCount || data?.partial ? ' (partial coverage)' : ''}` : ''}
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
                                                                        fill="rgba(255,255,255,0.94)"
                                                                        style={{ fontSize: detailSize }}
                                                                    >
                                                                        {changePct === null ? EMPTY_VALUE : formatPercent(changePct, { input: 'percent', decimals: 2, signed: true })}
                                                                    </text>
                                                                </>
                                                            )}
                                                            {canShowDetail && (
                                                                <text
                                                                    x={node.x0 + 10}
                                                                    y={node.y1 - 12}
                                                                    textAnchor="start"
                                                                    className="pointer-events-none select-none font-medium"
                                                                    fill="rgba(255,255,255,0.90)"
                                                                    style={{ fontSize: 10 }}
                                                                >
                                                                    {selectedGroup
                                                                        ? `${node.data.sector || selectedGroup} • ${sizeLabel}: ${formatSize(node.data.value)}`
                                                                        : `${node.data.stockCount || 0} stocks • ${sizeLabel}: ${formatSize(node.data.value)}`}
                                                                </text>
                                                            )}
                                                        </g>
                                                    );
                                                })}
                                            </svg>
                                        );
                                    }}
                                </ChartSizeBox>
                            </div>
                        </div>
                    )}
                </div>

                {/* Legend bar */}
                <div className="px-3 py-2 border-t border-[var(--border-default)] bg-[var(--bg-secondary)] flex items-center justify-between shadow-[0_-5px_15px_rgba(0,0,0,0.2)] z-10">
                    <div className="flex items-center gap-3">
                        <div className="flex h-1.5 w-32 rounded-full overflow-hidden border border-[var(--border-subtle)] shadow-inner">
                            {[HEAT_LOSS[3], HEAT_LOSS[1], HEAT_NEUTRAL, HEAT_GAIN[1], HEAT_GAIN[3]].map((fill, index) => (
                                <div key={`legend-${index}`} className="flex-1" style={{ backgroundColor: fill }} />
                            ))}
                        </div>
                        <span className="text-[8px] font-black text-[var(--text-muted)] uppercase tracking-tighter">-7% to +7%</span>
                    </div>
                    <div className="flex items-center gap-3">
                        {/* An empty universe already says "Market data unavailable";
                            printing 0 Stocks • 0 Groups beside it reads as a flat market. */}
                        {hasData && data && (
                            <div className="flex items-center gap-2 text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">
                                <span className="text-[var(--text-secondary)]">{data.count}</span> Stocks
                                <span className="text-[var(--text-muted)]">•</span>
                                <span className="text-[var(--text-secondary)]">{selectedGroup ? 1 : data.sectors.length}</span> Groups
                            </div>
                        )}
                        <WidgetMeta
                            updatedAt={data?.price_updated_at ?? null}
                            fetchedAt={dataUpdatedAt}
                            isFetching={isFetching && hasData}
                            isCached={Boolean(data?.cached) || isFallback}
                            isStale={isFallback && !data?.cached}
                            note={hasData ? freshnessNote : undefined}
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
