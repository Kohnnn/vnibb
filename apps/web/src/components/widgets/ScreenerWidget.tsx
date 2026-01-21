// Screener Widget - Sprint V11 Enhancement
'use client';

import { useState, useMemo, useCallback, useEffect, memo } from 'react';
import {
    Search, Filter, RefreshCw, Grid3X3, Table, LayoutGrid,
    ChevronDown, Plus, Star, BarChart3, Settings2, Bookmark,
    ArrowUpRight, ListFilter, LayoutPanelLeft, LineChart
} from 'lucide-react';
import type { ScreenerData } from '@/types/screener';
import { useScreenerData, useHistoricalPrices } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { VirtualizedTable, type VirtualizedColumn } from '@/components/ui/VirtualizedTable';
import { useColumnPresets } from '@/hooks/useColumnPresets';
import { ALL_COLUMNS, type ScreenerColumn } from '@/types/screener';
import { formatScreenerValue } from '@/utils/formatters';
import { MarketToggle, type Market } from './screener/MarketToggle';
import { cn } from '@/lib/utils';

// New Components
import { FilterBar, type ActiveFilter } from './screener/FilterBar';
import { FilterBuilderPanel, type FilterGroup } from './screener/FilterBuilderPanel';
import { ColumnCustomizer } from './screener/ColumnCustomizer';
import { SavedScreensDropdown, type SavedScreen } from './screener/SavedScreensDropdown';
import { PerformanceTable } from './screener/PerformanceTable';
import { ChartGridCard } from './screener/ChartGridCard';
import { CompanyLogo } from '@/components/ui/CompanyLogo';

interface ScreenerWidgetProps {
    id: string;
    exchange?: string;
    limit?: number;
    hideHeader?: boolean;
    onRemove?: () => void;
    onSymbolClick?: (symbol: string) => void;
}

type ViewMode = 'table' | 'chart' | 'performance';

export function ScreenerWidget({
    id,
    exchange: initialExchange = 'ALL',
    limit = 1000,
    hideHeader,
    onRemove,
    onSymbolClick,
}: ScreenerWidgetProps) {
    // UI State
    const [viewMode, setViewMode] = useState<ViewMode>('table');
    const [search, setSearch] = useState('');
    const [market, setMarket] = useState<Market>('ALL');
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

    // Data fetching
    const { data: screenerData, isLoading, isRefetching, refetch } = useScreenerData({
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
                s.ticker?.toLowerCase().includes(searchLower) ||
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

    // Handlers
    const handleSort = useCallback((field: string) => {
        if (sortField === field) {
            setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('desc');
        }
    }, [sortField]);

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
            isLoading={isLoading || isRefetching}
            noPadding
            widgetId={id}
            exportData={filteredData}
        >
            <div className="flex flex-col h-full overflow-hidden bg-black font-sans">
                {/* Primary Toolbar */}
                <div className="flex flex-wrap items-center gap-2 p-2 border-b border-gray-800 bg-[#0a0a0a]">
                    <SavedScreensDropdown
                        activeScreenId={activeScreenId}
                        customScreens={customScreens}
                        onSelect={handleSelectScreen}
                        onSave={handleSaveScreen}
                        onDelete={handleDeleteScreen}
                    />

                    <div className="h-4 w-[1px] bg-gray-800 mx-1" />

                    <div className="relative flex-1 max-w-[200px]">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-600" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Quick search..."
                            className="w-full pl-8 pr-3 h-8 bg-gray-900/50 border border-gray-800 rounded-lg text-[11px] text-white focus:border-blue-500/50 focus:bg-gray-900 outline-none transition-all placeholder:text-gray-700"
                        />
                    </div>

                    <MarketToggle value={market} onChange={setMarket} />

                    <div className="flex bg-gray-900/50 rounded-lg p-0.5 border border-gray-800">
                        <button
                            onClick={() => setViewMode('table')}
                            className={cn(
                                "p-1.5 rounded-md transition-all",
                                viewMode === 'table' ? "bg-gray-800 text-blue-400 shadow-inner" : "text-gray-600 hover:text-gray-400"
                            )}
                            title="Table View"
                        >
                            <Table size={14} />
                        </button>
                        <button
                            onClick={() => setViewMode('performance')}
                            className={cn(
                                "p-1.5 rounded-md transition-all",
                                viewMode === 'performance' ? "bg-gray-800 text-blue-400 shadow-inner" : "text-gray-600 hover:text-gray-400"
                            )}
                            title="Performance View"
                        >
                            <LineChart size={14} />
                        </button>
                        <button
                            onClick={() => setViewMode('chart')}
                            className={cn(
                                "p-1.5 rounded-md transition-all",
                                viewMode === 'chart' ? "bg-gray-800 text-blue-400 shadow-inner" : "text-gray-600 hover:text-gray-400"
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
                                    : "bg-gray-900/50 border-gray-800 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
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
                    <div className="px-3 py-2 bg-secondary/30 border-b border-gray-800">
                        <FilterBuilderPanel
                            filterGroup={advancedFilterGroup}
                            onFilterChange={setAdvancedFilterGroup}
                            onClose={() => setShowAdvancedFilters(false)}
                        />
                    </div>
                )}

                {/* Main Content Area */}
                <div className="flex-1 overflow-hidden relative">
                    {isLoading ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 z-50">
                            <RefreshCw size={32} className="animate-spin text-blue-500 mb-4" />
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 animate-pulse">Scanning Vietnam Markets</span>
                        </div>
                    ) : filteredData.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-700 gap-4">
                            <div className="p-4 bg-gray-900/50 rounded-full border border-gray-800">
                                <Search size={40} strokeWidth={1} />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-bold text-gray-400">No stocks found</p>
                                <p className="text-xs text-gray-600 mt-1 uppercase tracking-tighter">Try adjusting your filters or search terms</p>
                            </div>
                            <button
                                onClick={() => { setActiveFilters([]); setSearch(''); }}
                                className="mt-2 text-[10px] font-black text-blue-500 hover:text-blue-400 uppercase tracking-widest px-4 py-2 border border-blue-500/20 rounded-lg hover:bg-blue-500/5"
                            >
                                Reset All Filters
                            </button>
                        </div>
                    ) : viewMode === 'table' ? (
                        <VirtualizedTable
                            data={filteredData}
                            columns={tableColumns}
                            rowHeight={38}
                            onRowClick={(row) => onSymbolClick?.(row.ticker)}
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
                                        key={stock.ticker}
                                        symbol={stock.ticker}
                                        name={stock.organ_name}
                                        price={stock.price}
                                        change={stock.change_1d}
                                        changePercent={stock.change_1d}
                                        priceHistory={stock.priceHistory}
                                        onClick={() => onSymbolClick?.(stock.ticker)}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Status Bar Footer */}
                <div className="px-4 py-2 border-t border-gray-800 bg-[#0a0a0a] flex items-center justify-between text-[10px] font-bold text-gray-600 uppercase tracking-widest">
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <span className="text-blue-500 font-black">{filteredData.length.toLocaleString()}</span>
                            <span className="opacity-50">Matches Found</span>
                        </div>
                        {market !== 'ALL' && (
                            <div className="hidden sm:flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-gray-700" />
                                <span className="text-gray-500">{market} Exchange</span>
                            </div>
                        )}
                        <div className="hidden md:flex items-center gap-2">
                            <span className="w-1 h-1 rounded-full bg-gray-700" />
                            <span className="text-gray-500">Source: TCBS/VCI</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)] animate-pulse" />
                            <span className="text-gray-400">Live</span>
                        </div>
                    </div>
                </div>
            </div>
        </WidgetContainer>
    );
}

export default ScreenerWidget;
