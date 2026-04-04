// Screener Widget - backend-wired screening workspace
'use client';

import { useState, useMemo, useCallback, useEffect, memo } from 'react';
import { Search, Table, LayoutGrid, ListFilter, LineChart } from 'lucide-react';

import { useScreenerData, useVnstockSource } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { VirtualizedTable } from '@/components/ui/VirtualizedTable';
import { useColumnPresets } from '@/hooks/useColumnPresets';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import { useDashboard } from '@/contexts/DashboardContext';
import { useDashboardWidget } from '@/hooks/useDashboardWidget';
import type { WidgetGroupId } from '@/types/widget';
import { ALL_COLUMNS } from '@/types/screener';
import { formatScreenerValue } from '@/utils/formatters';
import { MarketToggle, type Market } from './screener/MarketToggle';
import { cn } from '@/lib/utils';
import { FilterBar, type ActiveFilter } from './screener/FilterBar';
import { FilterBuilderPanel, type FilterCondition, type FilterGroup } from './screener/FilterBuilderPanel';
import { ColumnCustomizer } from './screener/ColumnCustomizer';
import { SavedScreensDropdown, type SavedScreen } from './screener/SavedScreensDropdown';
import { PerformanceTable } from './screener/PerformanceTable';
import { ChartGridCard } from './screener/ChartGridCard';
import { getLatestTimestampValue } from '@/lib/dataFreshness';

interface ScreenerWidgetProps {
    id: string;
    exchange?: string;
    limit?: number;
    hideHeader?: boolean;
    onRemove?: () => void;
    onSymbolClick?: (symbol: string) => void;
    widgetGroup?: WidgetGroupId;
    config?: Record<string, unknown>;
}

type ViewMode = 'table' | 'chart' | 'performance';

interface SerializedFilterGroup {
    logic: 'AND' | 'OR';
    conditions: Array<FilterCondition | SerializedFilterGroup>;
}

const DEFAULT_SORT_FIELD = 'market_cap';
const DEFAULT_SORT_ORDER: 'asc' | 'desc' = 'desc';
const DEFAULT_VIEW_MODE: ViewMode = 'table';

function createEmptyFilterGroup(): FilterGroup {
    return { logic: 'AND', conditions: [] };
}

function hasOwnConfigKey(config: Record<string, unknown> | undefined, key: string): boolean {
    return Boolean(config) && Object.prototype.hasOwnProperty.call(config, key);
}

function parseActiveFilters(value: unknown): ActiveFilter[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ActiveFilter => {
        return Boolean(item)
            && typeof item === 'object'
            && typeof (item as ActiveFilter).id === 'string';
    });
}

function parseFilterGroup(value: unknown): FilterGroup {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return createEmptyFilterGroup();
    }
    const candidate = value as Partial<FilterGroup>;
    return {
        logic: candidate.logic === 'OR' ? 'OR' : 'AND',
        conditions: Array.isArray(candidate.conditions)
            ? candidate.conditions.filter((item): item is FilterCondition => Boolean(item) && typeof item === 'object' && 'field' in item)
            : [],
    };
}

function parseSavedScreens(value: unknown): SavedScreen[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SavedScreen => Boolean(item) && typeof item === 'object' && typeof (item as SavedScreen).id === 'string' && typeof (item as SavedScreen).name === 'string');
}

function parseColumnIds(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null;
    const ids = value.filter((item): item is string => typeof item === 'string');
    return ids.length > 0 ? ids : null;
}

function parseMarket(value: unknown, fallback: Market): Market {
    return value === 'HOSE' || value === 'HNX' || value === 'UPCOM' || value === 'ALL'
        ? value
        : fallback;
}

function parseViewMode(value: unknown): ViewMode {
    return value === 'chart' || value === 'performance' ? value : 'table';
}

function quickFilterConditions(filters: ActiveFilter[]): FilterCondition[] {
    return filters.flatMap((filter) => {
        if (filter.value === null || filter.value === undefined || filter.value === '') {
            return [];
        }

        const normalizeConditionValue = (value: unknown): FilterCondition['value'] => {
            if (Array.isArray(value)) {
                return value.filter((item): item is number | string => typeof item === 'number' || typeof item === 'string') as number[] | string[];
            }
            if (typeof value === 'number') {
                return value;
            }
            if (typeof value === 'string') {
                return [value];
            }
            return 0;
        };

        if (typeof filter.value === 'object' && filter.value !== null && !Array.isArray(filter.value)) {
            return Object.entries(filter.value as Record<string, unknown>)
                .filter((entry): entry is [FilterCondition['operator'], unknown] => entry[1] !== undefined)
                .map(([operator, value]) => ({
                    field: filter.id,
                    operator,
                    value: normalizeConditionValue(value),
                    enabled: true,
                    id: `${filter.id}:${operator}`,
                }));
        }

        return [{
            id: `${filter.id}:eq`,
            field: filter.id,
            operator: Array.isArray(filter.value) ? 'in' : 'eq',
            value: normalizeConditionValue(filter.value),
            enabled: true,
        }];
    });
}

function buildSerializedFilters(quickFilters: ActiveFilter[], advancedGroup: FilterGroup): string | undefined {
    const quickConditions = quickFilterConditions(quickFilters);
    const hasAdvancedConditions = advancedGroup.conditions.length > 0;

    if (!quickConditions.length && !hasAdvancedConditions) {
        return undefined;
    }

    const merged: SerializedFilterGroup = {
        logic: 'AND',
        conditions: [],
    };

    if (quickConditions.length) {
        merged.conditions.push(...quickConditions);
    }

    if (hasAdvancedConditions) {
        merged.conditions.push({
            logic: advancedGroup.logic,
            conditions: advancedGroup.conditions.map((condition) => ({ ...condition })),
        });
    }

    return JSON.stringify(merged);
}

function safeRandomId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ScreenerWidget({
    id,
    exchange: initialExchange = 'ALL',
    limit = 1000,
    hideHeader,
    onRemove,
    onSymbolClick,
    widgetGroup,
    config,
}: ScreenerWidgetProps) {
    const { updateWidget } = useDashboard();
    const widgetLocation = useDashboardWidget(id);

    const persistedQuickFilters = useMemo(() => parseActiveFilters(config?.quickFilters), [config]);
    const persistedAdvancedFilters = useMemo(() => parseFilterGroup(config?.advancedFilters), [config]);
    const persistedCustomScreens = useMemo(() => parseSavedScreens(config?.savedScreens), [config]);
    const persistedColumns = useMemo(() => parseColumnIds(config?.activeColumns), [config]);
    const persistedSortField = typeof config?.sortField === 'string' ? config.sortField : DEFAULT_SORT_FIELD;
    const persistedSortOrder = config?.sortOrder === 'asc' ? 'asc' : DEFAULT_SORT_ORDER;
    const persistedActiveScreenId = typeof config?.activeScreenId === 'string' ? config.activeScreenId : 'all';
    const persistedSearch = typeof config?.search === 'string' ? config.search : '';
    const persistedMarket = parseMarket(config?.market, initialExchange as Market);
    const persistedViewMode = parseViewMode(config?.viewMode);

    const [viewMode, setViewMode] = useState<ViewMode>(persistedViewMode);
    const [search, setSearch] = useState(persistedSearch);
    const [market, setMarket] = useState<Market>(persistedMarket);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>(persistedQuickFilters);
    const [advancedFilterGroup, setAdvancedFilterGroup] = useState<FilterGroup>(persistedAdvancedFilters);
    const [activeScreenId, setActiveScreenId] = useState(persistedActiveScreenId);
    const [customScreens, setCustomScreens] = useState<SavedScreen[]>(persistedCustomScreens);
    const [sortField, setSortField] = useState<string>(persistedSortField);
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(persistedSortOrder);

    const { getActiveColumns, setColumns } = useColumnPresets();

    useEffect(() => {
        setActiveFilters((current) => JSON.stringify(current) === JSON.stringify(persistedQuickFilters) ? current : persistedQuickFilters);
    }, [persistedQuickFilters]);

    useEffect(() => {
        setAdvancedFilterGroup((current) => JSON.stringify(current) === JSON.stringify(persistedAdvancedFilters) ? current : persistedAdvancedFilters);
    }, [persistedAdvancedFilters]);

    useEffect(() => {
        setCustomScreens((current) => JSON.stringify(current) === JSON.stringify(persistedCustomScreens) ? current : persistedCustomScreens);
    }, [persistedCustomScreens]);

    useEffect(() => {
        setActiveScreenId((current) => current === persistedActiveScreenId ? current : persistedActiveScreenId);
    }, [persistedActiveScreenId]);

    useEffect(() => {
        setSearch((current) => current === persistedSearch ? current : persistedSearch);
    }, [persistedSearch]);

    useEffect(() => {
        setMarket((current) => current === persistedMarket ? current : persistedMarket);
    }, [persistedMarket]);

    useEffect(() => {
        setViewMode((current) => current === persistedViewMode ? current : persistedViewMode);
    }, [persistedViewMode]);

    useEffect(() => {
        setSortField((current) => current === persistedSortField ? current : persistedSortField);
    }, [persistedSortField]);

    useEffect(() => {
        setSortOrder((current) => current === persistedSortOrder ? current : persistedSortOrder);
    }, [persistedSortOrder]);

    useEffect(() => {
        if (!persistedColumns) return;
        if (JSON.stringify(getActiveColumns()) === JSON.stringify(persistedColumns)) return;
        setColumns(persistedColumns);
    }, [getActiveColumns, persistedColumns, setColumns]);

    const activeColumnIds = getActiveColumns();
    const visibleColumns = useMemo(() => ALL_COLUMNS.filter((column) => activeColumnIds.includes(column.id)), [activeColumnIds]);

    const source = useVnstockSource();
    const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup);

    const serializedFilters = useMemo(
        () => buildSerializedFilters(activeFilters, advancedFilterGroup),
        [activeFilters, advancedFilterGroup]
    );
    const sort = useMemo(() => `${sortField}:${sortOrder}`, [sortField, sortOrder]);

    useEffect(() => {
        if (!widgetLocation) return;

        const currentConfig = widgetLocation.widget.config || {};
        const nextConfig = {
            ...currentConfig,
            quickFilters: activeFilters,
            advancedFilters: advancedFilterGroup,
            savedScreens: customScreens,
            activeScreenId,
            activeColumns: activeColumnIds,
            sortField,
            sortOrder,
            search,
            market,
            viewMode,
        };

        if (
            JSON.stringify(currentConfig.quickFilters ?? []) === JSON.stringify(activeFilters)
            && JSON.stringify(currentConfig.advancedFilters ?? createEmptyFilterGroup()) === JSON.stringify(advancedFilterGroup)
            && JSON.stringify(currentConfig.savedScreens ?? []) === JSON.stringify(customScreens)
            && JSON.stringify(currentConfig.activeColumns ?? []) === JSON.stringify(activeColumnIds)
            && currentConfig.activeScreenId === activeScreenId
            && currentConfig.sortField === sortField
            && currentConfig.sortOrder === sortOrder
            && currentConfig.search === search
            && currentConfig.market === market
            && currentConfig.viewMode === viewMode
        ) {
            return;
        }

        updateWidget(widgetLocation.dashboardId, widgetLocation.tabId, id, { config: nextConfig });
    }, [activeColumnIds, activeFilters, activeScreenId, advancedFilterGroup, customScreens, id, market, search, sortField, sortOrder, updateWidget, viewMode, widgetLocation]);

    const {
        data: screenerData,
        isLoading,
        isFetching,
        error,
        dataUpdatedAt,
        refetch,
    } = useScreenerData({
        limit,
        exchange: market === 'ALL' ? undefined : market,
        filters: serializedFilters,
        sort,
    });

    const filteredData = useMemo(() => {
        if (!screenerData?.data) return [];

        if (!search.trim()) return screenerData.data;

        const normalizedQuery = search.trim().toLowerCase();
        return screenerData.data.filter((stock: Record<string, unknown>) => {
            const symbolValue = String(stock.ticker ?? stock.symbol ?? '').toLowerCase();
            const nameValue = String(stock.organ_name ?? stock.company_name ?? '').toLowerCase();
            const industryValue = String(stock.industry_name ?? stock.industry ?? '').toLowerCase();
            return symbolValue.includes(normalizedQuery)
                || nameValue.includes(normalizedQuery)
                || industryValue.includes(normalizedQuery);
        });
    }, [screenerData?.data, search]);

    const hasData = filteredData.length > 0;
    const isFallback = Boolean(error && hasData);
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData);
    const sourceUpdatedAt =
        getLatestTimestampValue([
            screenerData?.meta?.last_data_date,
            ...(screenerData?.data ?? []).map((row) => row.updated_at),
        ]) ?? dataUpdatedAt;

    const handleSort = useCallback((field: string) => {
        if (sortField === field) {
            setSortOrder((previous) => (previous === 'asc' ? 'desc' : 'asc'));
            return;
        }
        setSortField(field);
        setSortOrder('desc');
    }, [sortField]);

    const handleSymbolSelect = useCallback((symbol: string) => {
        if (!symbol) return;
        onSymbolClick?.(symbol);
        setLinkedSymbol(symbol);
    }, [onSymbolClick, setLinkedSymbol]);

    const handleSelectScreen = useCallback((screen: SavedScreen) => {
        setActiveScreenId(screen.id);
        setActiveFilters(screen.quickFilters || []);
        setAdvancedFilterGroup(screen.advancedFilters || createEmptyFilterGroup());
        setSortField(screen.sortField || DEFAULT_SORT_FIELD);
        setSortOrder(screen.sortOrder || DEFAULT_SORT_ORDER);
        setMarket(parseMarket(screen.market, 'ALL'));
        setViewMode(screen.viewMode || DEFAULT_VIEW_MODE);
        if (screen.columns.length > 0) {
            setColumns(screen.columns);
        }
    }, [setColumns]);

    const handleSaveScreen = useCallback((name: string) => {
        const newScreen: SavedScreen = {
            id: safeRandomId(),
            name,
            quickFilters: activeFilters,
            advancedFilters: advancedFilterGroup.conditions.length > 0 ? advancedFilterGroup : null,
            columns: activeColumnIds,
            sortField,
            sortOrder,
            market,
            viewMode,
        };
        setCustomScreens((previous) => [...previous, newScreen]);
        setActiveScreenId(newScreen.id);
    }, [activeColumnIds, activeFilters, advancedFilterGroup, market, sortField, sortOrder, viewMode]);

    const handleDeleteScreen = useCallback((screenId: string) => {
        setCustomScreens((previous) => previous.filter((screen) => screen.id !== screenId));
        if (activeScreenId === screenId) {
            setActiveScreenId('all');
        }
    }, [activeScreenId]);

    const handleResetFilters = useCallback(() => {
        setActiveFilters([]);
        setAdvancedFilterGroup(createEmptyFilterGroup());
        setSearch('');
        setActiveScreenId('all');
        setSortField(DEFAULT_SORT_FIELD);
        setSortOrder(DEFAULT_SORT_ORDER);
    }, []);

    const tableColumns = useMemo(() => {
        return visibleColumns.map((column) => ({
            id: column.id,
            header: column.label,
            width: column.width || 100,
            accessor: (row: Record<string, unknown>) => formatScreenerValue(row[column.id], column.format),
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
            <div className="flex h-full flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans">
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                    <SavedScreensDropdown
                        activeScreenId={activeScreenId}
                        customScreens={customScreens}
                        onSelect={handleSelectScreen}
                        onSave={handleSaveScreen}
                        onDelete={handleDeleteScreen}
                    />

                    <div className="mx-1 h-4 w-[1px] bg-[var(--border-color)]" />

                    <div className="relative flex-1 max-w-[220px]">
                        <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-muted)]" />
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Quick search..."
                            className="h-8 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] pl-8 pr-3 text-[11px] text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:border-blue-500/50"
                        />
                    </div>

                    <MarketToggle value={market} onChange={setMarket} />

                    <div className="flex rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5">
                        <button
                            onClick={() => setViewMode('table')}
                            className={cn(
                                'rounded-md p-1.5 transition-all',
                                viewMode === 'table'
                                    ? 'bg-[var(--bg-tertiary)] text-blue-400 shadow-inner'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                            )}
                            title="Table View"
                        >
                            <Table size={14} />
                        </button>
                        <button
                            onClick={() => setViewMode('performance')}
                            className={cn(
                                'rounded-md p-1.5 transition-all',
                                viewMode === 'performance'
                                    ? 'bg-[var(--bg-tertiary)] text-blue-400 shadow-inner'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                            )}
                            title="Performance View"
                        >
                            <LineChart size={14} />
                        </button>
                        <button
                            onClick={() => setViewMode('chart')}
                            className={cn(
                                'rounded-md p-1.5 transition-all',
                                viewMode === 'chart'
                                    ? 'bg-[var(--bg-tertiary)] text-blue-400 shadow-inner'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                            )}
                            title="Chart Grid"
                        >
                            <LayoutGrid size={14} />
                        </button>
                    </div>

                    <div className="ml-auto flex items-center gap-1">
                        <button
                            onClick={() => setShowAdvancedFilters((current) => !current)}
                            className={cn(
                                'flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[10px] font-bold uppercase transition-all',
                                showAdvancedFilters
                                    ? 'border-blue-500 bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                                    : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]'
                            )}
                        >
                            <ListFilter size={12} />
                            <span>Filters</span>
                        </button>

                        <ColumnCustomizer
                            columns={ALL_COLUMNS.map((column) => ({ id: column.id, label: column.label, visible: activeColumnIds.includes(column.id) }))}
                            onChange={(columns) => setColumns(columns.filter((column) => column.visible).map((column) => column.id))}
                        />
                    </div>
                </div>

                <FilterBar filters={activeFilters} onChange={setActiveFilters} />

                {showAdvancedFilters && (
                    <div className="border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/30 px-3 py-2">
                        <FilterBuilderPanel
                            filterGroup={advancedFilterGroup}
                            onFilterChange={setAdvancedFilterGroup}
                            onClose={() => setShowAdvancedFilters(false)}
                        />
                    </div>
                )}

                <div className="relative flex-1 overflow-hidden">
                    {timedOut && isLoading && !hasData ? (
                        <WidgetError
                            title="Loading timed out"
                            error={new Error('Request timed out after 15 seconds.')}
                            onRetry={() => {
                                resetTimeout();
                                refetch();
                            }}
                        />
                    ) : isLoading && !hasData ? (
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
                            onRowClick={(row) => handleSymbolSelect((row.ticker ?? row.symbol) as string)}
                            sortField={sortField}
                            sortOrder={sortOrder}
                            onSort={handleSort}
                        />
                    ) : viewMode === 'performance' ? (
                        <PerformanceTable data={filteredData as never[]} />
                    ) : (
                        <div className="h-full overflow-y-auto p-4 scrollbar-hide">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                                {filteredData.map((stock: Record<string, unknown>) => (
                                    <ChartGridCard
                                        key={String(stock.ticker ?? stock.symbol)}
                                        symbol={String(stock.ticker ?? stock.symbol ?? '')}
                                        exchange={typeof stock.exchange === 'string' ? stock.exchange : undefined}
                                        name={typeof stock.organ_name === 'string' ? stock.organ_name : String(stock.company_name ?? stock.ticker ?? stock.symbol ?? 'Unknown')}
                                        price={typeof stock.price === 'number' ? stock.price : 0}
                                        change={typeof stock.change_1d === 'number' ? stock.change_1d : 0}
                                        changePercent={typeof stock.change_1d === 'number' ? stock.change_1d : 0}
                                        onClick={() => handleSymbolSelect(String(stock.ticker ?? stock.symbol ?? ''))}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="z-20 flex items-center justify-between border-t border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] shadow-[0_-5px_15px_rgba(0,0,0,0.2)]">
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-blue-400 drop-shadow-md">{filteredData.length.toLocaleString()}</span>
                            <span className="font-semibold tracking-tight opacity-40">Matches</span>
                        </div>
                        {market !== 'ALL' && (
                            <div className="hidden items-center gap-2 sm:flex">
                                <span className="h-1 w-1 rounded-full bg-[var(--text-muted)]" />
                                <span className="text-[var(--text-muted)]">{market}</span>
                            </div>
                        )}
                    </div>
                    <WidgetMeta
                        updatedAt={sourceUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={isFallback}
                        sourceLabel={source}
                        note="Backend screening"
                        align="right"
                        className="text-[9px]"
                    />
                </div>
            </div>
        </WidgetContainer>
    );
}

export default memo(ScreenerWidget);
