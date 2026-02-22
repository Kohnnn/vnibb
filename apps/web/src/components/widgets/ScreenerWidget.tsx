// Screener Widget - Sprint V11 Enhancement
'use client';

import { useState, useMemo, useCallback, useEffect, memo } from 'react';
import { Search, Table, LayoutGrid, ListFilter, LineChart } from 'lucide-react';
import type { ScreenerData } from '@/types/screener';
import { useScreenerData, useVnstockSource } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { VirtualizedTable, type VirtualizedColumn } from '@/components/ui/VirtualizedTable';
import { useColumnPresets } from '@/hooks/useColumnPresets';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import type { WidgetGroupId } from '@/types/widget';
import { ALL_COLUMNS, type ScreenerColumn } from '@/types/screener';
import { formatScreenerValue } from '@/utils/formatters';
import { MarketToggle, type Market } from './screener/MarketToggle';
import { cn } from '@/lib/utils';

import { FilterBar, type ActiveFilter } from './screener/FilterBar';
import { FilterBuilderPanel, type FilterGroup } from './screener/FilterBuilderPanel';
import { ColumnCustomizer } from './screener/ColumnCustomizer';
import { SavedScreensDropdown, type SavedScreen } from './screener/SavedScreensDropdown';
import { PerformanceTable } from './screener/PerformanceTable';
import { ChartGridCard } from './screener/ChartGridCard';

interface ScreenerWidgetProps {
    id: string;
    exchange?: string;
    limit?: number;
    hideHeader?: boolean;
    onRemove?: () => void;
    onSymbolClick?: (symbol: string) => void;
    widgetGroup?: WidgetGroupId;
}

type ViewMode = 'table' | 'chart' | 'performance';

export function ScreenerWidget({
    id,
    exchange: initialExchange = 'ALL',
    limit = 1000,
    hideHeader,
    onRemove,
    onSymbolClick,
    widgetGroup,
}: ScreenerWidgetProps) {
    // UI State
    const [viewMode, setViewMode] = useState<ViewMode>('table');
    const [search, setSearch] = useState('');
    const [market, setMarket] = useState<Market>(initialExchange as Market);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
    const [advancedFilterGroup, setAdvancedFilterGroup] = useState<FilterGroup | null>(null);
    const [activeScreenId, setActiveScreenId] = useState('all');
    const [customScreens, setCustomScreens] = useState<SavedScreen[]>([]);
    const [sortField, setSortField] = useState<string>('market_cap');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    // Column state
    const { getActiveColumns, setColumns } = useColumnPresets();
    const activeColumnIds = getActiveColumns();
    const visibleColumns = useMemo(() =>
        ALL_COLUMNS.filter(c => activeColumnIds.includes(c.id)),
        [activeColumnIds]
    );

    const source = useVnstockSource();
    const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup);

    // Data fetching
    const {
        data: screenerData,
        isLoading,
        isFetching,
        error,
        dataUpdatedAt,
        refetch,
    } = useScreenerData({
        limit,
        exchange: market === 'ALL' ? undefined : market
    });

    const filteredData = useMemo(() => {
        if (!screenerData?.data) return [];
        let result = [...screenerData.data];

        // Apply search filter
        if (search) {
            const searchLower = search.toLowerCase();
            result = result.filter((s: any) =>
                (s.ticker ?? s.symbol)?.toLowerCase().includes(searchLower) ||
                s.organ_name?.toLowerCase().includes(searchLower)
            );
        }

        // Apply active filters
        activeFilters.forEach(filter => {
            if (filter.value) {
                result = result.filter((s: any) => {
                    const val = s[filter.id];
                    if (filter.value.gte !== undefined && val < filter.value.gte) return false;
                    if (filter.value.lt !== undefined && val >= filter.value.lt) return false;
                    if (filter.value.gt !== undefined && val <= filter.value.gt) return false;
                    if (filter.value.eq !== undefined && val !== filter.value.eq) return false;
                    return true;
                });
            }
        });

        // Apply sorting
        result.sort((a: any, b: any) => {
            const aVal = a[sortField] ?? 0;
            const bVal = b[sortField] ?? 0;
            return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
        });

        return result;
    }, [screenerData, search, activeFilters, sortField, sortOrder]);

    const hasData = filteredData.length > 0;
    const isFallback = Boolean(error && hasData);

    // Handlers
    const handleSort = useCallback((field: string) => {
        if (sortField === field) {
            setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('desc');
        }
    }, [sortField]);

    const handleSymbolSelect = useCallback((symbol: string) => {
        if (!symbol) return;
        onSymbolClick?.(symbol);
        setLinkedSymbol(symbol);
    }, [onSymbolClick, setLinkedSymbol]);

    const handleSelectScreen = useCallback((screen: SavedScreen) => {
        setActiveScreenId(screen.id);
        if (screen.filters) {
            setActiveFilters(screen.filters);
        }
    }, []);

    const handleSaveScreen = useCallback((name: string) => {
        const newScreen: SavedScreen = {
            id: crypto.randomUUID(),
            name,
            filters: activeFilters,
            columns: activeColumnIds,
        };
        setCustomScreens(prev => [...prev, newScreen]);
    }, [activeFilters, activeColumnIds]);

    const handleDeleteScreen = useCallback((id: string) => {
        setCustomScreens(prev => prev.filter(s => s.id !== id));
    }, []);

    const handleResetFilters = useCallback(() => {
        setActiveFilters([]);
        setSearch('');
    }, []);

    // Table columns configuration
    const tableColumns = useMemo(() => {
        return visibleColumns.map(col => ({
            id: col.id,
            header: col.label,
            width: col.width || 100,
            accessor: (row: any) => formatScreenerValue(row[col.id], col.format),
            sortable: true,
        }));
    }, [visibleColumns]);

    return (
        <WidgetContainer
            title="Screener Pro"
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading && !hasData}
            noPadding
            widgetId={id}
            exportData={filteredData}
            hideHeader={hideHeader}
        >
            <div className="flex flex-col h-full overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans">
                {/* Primary Toolbar */}
                <div className="flex flex-wrap items-center gap-2 p-2 border-b border-[var(--border-color)] bg-[var(--bg-primary)]">
                    <SavedScreensDropdown
                        activeScreenId={activeScreenId}
                        customScreens={customScreens}
                        onSelect={handleSelectScreen}
                        onSave={handleSaveScreen}
                        onDelete={handleDeleteScreen}
                    />

                    <div className="h-4 w-[1px] bg-[var(--border-color)] mx-1" />

                    <div className="relative flex-1 max-w-[200px]">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-muted)]" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Quick search..."
                            className="w-full pl-8 pr-3 h-8 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg text-[11px] text-[var(--text-primary)] focus:border-blue-500/50 focus:bg-[var(--bg-secondary)] outline-none transition-all placeholder:text-[var(--text-muted)]"
                        />
                    </div>

                    <MarketToggle value={market} onChange={setMarket} />

                    <div className="flex bg-[var(--bg-secondary)] rounded-lg p-0.5 border border-[var(--border-color)]">
                        <button
                            onClick={() => setViewMode('table')}
                            className={cn(
                                "p-1.5 rounded-md transition-all",
                                viewMode === 'table'
                                    ? "bg-[var(--bg-tertiary)] text-blue-400 shadow-inner"
                                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                            )}
                            title="Table View"
                        >
                            <Table size={14} />
                        </button>
                        <button
                            onClick={() => setViewMode('performance')}
                            className={cn(
                                "p-1.5 rounded-md transition-all",
                                viewMode === 'performance'
                                    ? "bg-[var(--bg-tertiary)] text-blue-400 shadow-inner"
                                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                            )}
                            title="Performance View"
                        >
                            <LineChart size={14} />
                        </button>
                        <button
                            onClick={() => setViewMode('chart')}
                            className={cn(
                                "p-1.5 rounded-md transition-all",
                                viewMode === 'chart'
                                    ? "bg-[var(--bg-tertiary)] text-blue-400 shadow-inner"
                                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                            )}
                            title="Chart Grid"
                        >
                            <LayoutGrid size={14} />
                        </button>
                    </div>

                    <div className="ml-auto flex items-center gap-1">
                        <button
                            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                            className={cn(
                                "flex items-center gap-1.5 h-8 px-3 rounded-lg text-[10px] font-bold uppercase transition-all border",
                                showAdvancedFilters
                                    ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20"
                                    : "bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]"
                            )}
                        >
                            <ListFilter size={12} />
                            <span>Filters</span>
                        </button>

                        <ColumnCustomizer
                            columns={ALL_COLUMNS.map(c => ({ id: c.id, label: c.label, visible: activeColumnIds.includes(c.id) }))}
                            onChange={(cols) => setColumns(cols.filter(c => c.visible).map(c => c.id))}
                        />
                    </div>
                </div>

                {/* Filter Pills Bar */}
                <FilterBar filters={activeFilters} onChange={setActiveFilters} />

                {/* Advanced Filter Builder (Overlay/Panel) */}
                {showAdvancedFilters && advancedFilterGroup && (
                    <div className="px-3 py-2 bg-[var(--bg-secondary)]/30 border-b border-[var(--border-color)]">
                        <FilterBuilderPanel
                            filterGroup={advancedFilterGroup}
                            onFilterChange={setAdvancedFilterGroup}
                            onClose={() => setShowAdvancedFilters(false)}
                        />
                    </div>
                )}

                {/* Main Content Area */}
                <div className="flex-1 overflow-hidden relative">
                    {isLoading && !hasData ? (
                        <WidgetSkeleton variant="table" lines={8} />
                    ) : error && !hasData ? (
                        <WidgetError error={error as Error} onRetry={() => refetch()} />
                    ) : filteredData.length === 0 ? (
                        <WidgetEmpty
                            message="No stocks match your filters."
                            action={{ label: 'Reset filters', onClick: handleResetFilters }}
                        />
                    ) : viewMode === 'table' ? (
                        <VirtualizedTable
                            data={filteredData}
                            columns={tableColumns}
                            rowHeight={38}
                            onRowClick={(row) => handleSymbolSelect(row.ticker ?? row.symbol)}
                            sortField={sortField}
                            sortOrder={sortOrder}
                            onSort={handleSort}
                        />
                    ) : viewMode === 'performance' ? (
                        <PerformanceTable data={filteredData as any} />
                    ) : (
                        <div className="h-full overflow-y-auto p-4 scrollbar-hide">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                                {filteredData.map((stock: any) => (
                                    <ChartGridCard
                                        key={stock.ticker ?? stock.symbol}
                                        symbol={stock.ticker ?? stock.symbol}
                                        exchange={stock.exchange}
                                        name={stock.organ_name}
                                        price={stock.price}
                                        change={stock.change_1d}
                                        changePercent={stock.change_1d}
                                        onClick={() => handleSymbolSelect(stock.ticker ?? stock.symbol)}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Status Bar Footer */}
                <div className="px-3 py-2 border-t border-[var(--border-color)] bg-[var(--bg-primary)] flex items-center justify-between text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest shadow-[0_-5px_15px_rgba(0,0,0,0.2)] z-20">
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <span className="text-blue-400 font-black text-xs drop-shadow-md">{filteredData.length.toLocaleString()}</span>
                            <span className="opacity-40 font-semibold tracking-tight">Matches</span>
                        </div>
                        {market !== 'ALL' && (
                            <div className="hidden sm:flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-[var(--text-muted)]" />
                                <span className="text-[var(--text-muted)]">{market}</span>
                            </div>
                        )}
                    </div>
                    <WidgetMeta
                        updatedAt={dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={isFallback}
                        sourceLabel={source}
                        note="Snapshot"
                        align="right"
                        className="text-[9px]"
                    />
                </div>
            </div>
        </WidgetContainer>
    );
}

export default ScreenerWidget;
