// Screener Widget - backend-wired screening workspace
'use client';

import { useState, useMemo, useCallback, useEffect, memo, useRef } from 'react';
import { Search, Table, LayoutGrid, ListFilter, LineChart, Bell, BellRing, Plus } from 'lucide-react';

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
import type { Dashboard } from '@/types/dashboard';
import { ALL_COLUMNS } from '@/types/screener';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
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
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '@/lib/pollingPolicy';
import { logClientError } from '@/lib/clientLogger';
import { recordAlertActivity } from '@/lib/alertActivity';
import { parseWatchlistSymbols } from './WatchlistWidget';
import { findNextAvailableLayout, getWidgetDefaultLayout } from '@/lib/dashboardLayout';
import { normalizeTickerSymbol } from '@/lib/defaultTicker';
import { canEditDashboard } from '@/contexts/DashboardContext/helpers';


interface ScreenerWidgetProps {
    id: string;
    exchange?: string;
    limit?: number;
    hideHeader?: boolean;
    onRemove?: () => void;
    onSymbolClick?: (symbol: string) => void;
    widgetGroup?: WidgetGroupId;
    config?: Record<string, unknown>;
    onDataChange?: (data: WidgetDataPayload) => void;
}

type ViewMode = 'table' | 'chart' | 'performance';

interface SerializedFilterGroup {
    logic: 'AND' | 'OR';
    conditions: Array<FilterCondition | SerializedFilterGroup>;
}

interface WatchlistTarget {
    dashboardId: string;
    tabId: string;
    widgetId: string;
    label: string;
    config: Record<string, unknown>;
}

const DEFAULT_SORT_FIELD = 'market_cap';
const DEFAULT_SORT_ORDER: 'asc' | 'desc' = 'desc';
const DEFAULT_VIEW_MODE: ViewMode = 'table';
const PASS_REASON_PRESET_IDS = new Set([
    'cheap_profitable',
    'dividend_quality',
    'growth_reasonable_price',
    'low_debt_compounder',
    'fcf_margin_expansion',
]);

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
    return value === 'HOSE' || value === 'HNX' || value === 'UPCOM' || value === 'ALL' || value === 'VN30' || value === 'VN100' || value === 'HNX30'
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
            if (typeof value === 'number' || typeof value === 'boolean') {
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

function formatReasonMetric(row: Record<string, unknown>, field: string, label: string, suffix = ''): string | null {
    const value = row[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return `${label} ${value.toFixed(field.includes('growth') || field.includes('margin') || field === 'roe' || field === 'dividend_yield' ? 1 : 2)}${suffix}`;
    }
    if (typeof value === 'boolean') {
        return value ? `${label} yes` : `${label} no`;
    }
    if (typeof value === 'string' && value.trim()) {
        return `${label} ${value}`;
    }
    return null;
}

export function buildSavedScreenAlertId(screenId: string, symbols: string[], triggerTime: string): string {
    return `saved-screen:${screenId}:${symbols.join(',')}:${triggerTime}`;
}

export function getScreenerMatchSymbols(rows: Array<Record<string, unknown>>): string[] {
    return Array.from(new Set(rows
        .map((row) => String(row.ticker ?? row.symbol ?? '').trim().toUpperCase())
        .filter(Boolean)))
        .sort();
}

export function resolveScreenerWatchlistAction(targetCount: number): 'create' | 'direct' | 'choose' {
    if (targetCount <= 0) return 'create';
    if (targetCount === 1) return 'direct';
    return 'choose';
}

export function getScreenerWatchlistTargets(dashboards: Dashboard[]): WatchlistTarget[] {
    return dashboards.flatMap((dashboard) => {
        if (!canEditDashboard(dashboard)) return [];
        return dashboard.tabs.flatMap((tab) => tab.widgets
            .filter((widget) => widget.type === 'watchlist')
            .map((widget, index) => ({
                dashboardId: dashboard.id,
                tabId: tab.id,
                widgetId: widget.id,
                label: `${dashboard.name} / ${tab.name} / ${typeof widget.config.title === 'string' && widget.config.title.trim() ? widget.config.title.trim() : `Watchlist ${index + 1}`}`,
                config: widget.config,
            })));
    });
}

export function getNewScreenerMatchSymbols(previousSymbols: string[], rows: Array<Record<string, unknown>>): string[] {
    const previous = new Set(previousSymbols.map((symbol) => symbol.toUpperCase()));
    return getScreenerMatchSymbols(rows).filter((symbol) => !previous.has(symbol));
}

export function canProcessScreenerAlert(isHidden: boolean, isOnline: boolean): boolean {
    return !isHidden && isOnline;
}

export function shouldRescheduleScreenerAlertPoll(cancelled: boolean, isHidden: boolean, isOnline: boolean): boolean {
    return !cancelled && canProcessScreenerAlert(isHidden, isOnline);
}

export function shouldResumeScreenerAlertPoll(
    cancelled: boolean,
    isHidden: boolean,
    isOnline: boolean,
    alertEnabled: boolean,
    savedScanIsCurrent: boolean,
    hasTimer = false,
    isInFlight = false,
): boolean {
    return !hasTimer && !isInFlight && alertEnabled && savedScanIsCurrent && shouldRescheduleScreenerAlertPoll(cancelled, isHidden, isOnline);
}

export function isSavedScreenScanCurrent(
    screen: SavedScreen,
    quickFilters: ActiveFilter[],
    advancedFilters: FilterGroup,
    sortField: string,
    sortOrder: 'asc' | 'desc',
    market: Market,
): boolean {
    return JSON.stringify(screen.quickFilters || []) === JSON.stringify(quickFilters)
        && JSON.stringify(screen.advancedFilters || createEmptyFilterGroup()) === JSON.stringify(advancedFilters)
        && (screen.sortField || DEFAULT_SORT_FIELD) === sortField
        && (screen.sortOrder || DEFAULT_SORT_ORDER) === sortOrder
        && parseMarket(screen.market, 'ALL') === market;
}

function buildPassReason(screenId: string, row: Record<string, unknown>): string | undefined {

    if (!PASS_REASON_PRESET_IDS.has(screenId)) return undefined;

    const fieldsByPreset: Record<string, Array<[string, string, string?]>> = {
        cheap_profitable: [['pe', 'P/E'], ['pb', 'P/B'], ['roe', 'ROE', '%']],
        dividend_quality: [['dividend_yield', 'Yield', '%'], ['roe', 'ROE', '%'], ['debt_to_equity', 'Debt/Eq']],
        growth_reasonable_price: [['revenue_growth', 'Rev growth', '%'], ['earnings_growth', 'Earn growth', '%'], ['pe', 'P/E']],
        low_debt_compounder: [['roe', 'ROE', '%'], ['debt_to_equity', 'Debt/Eq'], ['revenue_growth', 'Rev growth', '%']],
        fcf_margin_expansion: [['fcf_positive', 'FCF+'], ['net_margin', 'Net margin', '%'], ['revenue_growth', 'Rev growth', '%']],
    };

    const reasons = (fieldsByPreset[screenId] || [])
        .map(([field, label, suffix]) => formatReasonMetric(row, field, label, suffix))
        .filter((reason): reason is string => Boolean(reason));

    return reasons.length ? reasons.join(' | ') : undefined;
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
    onDataChange,
}: ScreenerWidgetProps) {
    const { state, activeDashboard, activeTab, addWidget, createDashboard, createTab, updateWidget } = useDashboard();
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
    const [pendingWatchlistSymbol, setPendingWatchlistSymbol] = useState<string | null>(null);
    const [watchlistStatus, setWatchlistStatus] = useState('');
    const alertPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const alertPollInFlightRef = useRef(false);

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
    const watchlistTargets = useMemo(
        () => getScreenerWatchlistTargets(state.dashboards),
        [state.dashboards],
    );

    const source = useVnstockSource();
    const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup, { widgetId: id, widgetType: 'screener' });
    const analyticsContext = useMemo(() => ({
        widgetId: id,
    }), [id]);

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
        universe: market === 'VN30' || market === 'VN100' || market === 'HNX30' ? market : undefined,
        exchange: market === 'HOSE' || market === 'HNX' || market === 'UPCOM' ? market : undefined,
        filters: serializedFilters,
        sort,
    });

    const dataWithPassReasons = useMemo(() => {
        if (!screenerData?.data) return [];
        return screenerData.data.map((stock) => ({
            ...stock,
            pass_reason: buildPassReason(activeScreenId, stock as Record<string, unknown>) ?? stock.pass_reason,
        }));
    }, [activeScreenId, screenerData?.data]);

    const filteredData = useMemo(() => {
        if (!dataWithPassReasons.length) return [];

        if (!search.trim()) return dataWithPassReasons;

        const normalizedQuery = search.trim().toLowerCase();
        return dataWithPassReasons.filter((stock: Record<string, unknown>) => {
            const symbolValue = String(stock.ticker ?? stock.symbol ?? '').toLowerCase();
            const nameValue = String(stock.organ_name ?? stock.company_name ?? '').toLowerCase();
            const industryValue = String(stock.industry_name ?? stock.industry ?? '').toLowerCase();
            return symbolValue.includes(normalizedQuery)
                || nameValue.includes(normalizedQuery)
                || industryValue.includes(normalizedQuery);
        });
    }, [dataWithPassReasons, search]);

    const activeSavedScreen = customScreens.find((screen) => screen.id === activeScreenId) || null;
    const activeSavedScreenIsCurrent = Boolean(activeSavedScreen && isSavedScreenScanCurrent(
        activeSavedScreen,
        activeFilters,
        advancedFilterGroup,
        sortField,
        sortOrder,
        market,
    ));
    const activeScreenAlertEnabled = Boolean(activeSavedScreen?.alertEnabled);
    const hasData = filteredData.length > 0;

    const isFallback = Boolean(error && hasData);
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData);
    const sourceUpdatedAt =
        getLatestTimestampValue([
            screenerData?.meta?.last_data_date,
            ...(screenerData?.data ?? []).map((row) => row.updated_at),
        ]) ?? dataUpdatedAt;

    useEffect(() => {
        const clearAlertPoll = () => {
            if (!alertPollRef.current) return;
            clearTimeout(alertPollRef.current);
            alertPollRef.current = null;
        };

        if (!activeScreenAlertEnabled || !activeSavedScreenIsCurrent) {
            clearAlertPoll();
            return;
        }

        let cancelled = false;
        const scheduleNextPoll = () => {
            const isHidden = typeof document !== 'undefined' && document.hidden;
            const isOnline = typeof navigator === 'undefined' || navigator.onLine;
            if (!shouldResumeScreenerAlertPoll(cancelled, isHidden, isOnline, activeScreenAlertEnabled, activeSavedScreenIsCurrent) || alertPollRef.current || alertPollInFlightRef.current) return;
            const interval = getAdaptiveRefetchInterval(POLLING_PRESETS.alerts);
            if (interval === false) return;
            alertPollRef.current = setTimeout(async () => {
                alertPollRef.current = null;
                const hiddenAtStart = typeof document !== 'undefined' && document.hidden;
                const onlineAtStart = typeof navigator === 'undefined' || navigator.onLine;
                if (canProcessScreenerAlert(hiddenAtStart, onlineAtStart)) {
                    alertPollInFlightRef.current = true;
                    try {
                        await refetch();
                    } finally {
                        alertPollInFlightRef.current = false;
                    }
                }
                scheduleNextPoll();
            }, interval);
        };
        const handleVisibilityChange = () => {
            if (document.hidden) {
                clearAlertPoll();
                return;
            }
            scheduleNextPoll();
        };
        const handleOffline = clearAlertPoll;

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('online', scheduleNextPoll);
        window.addEventListener('offline', handleOffline);
        scheduleNextPoll();
        return () => {
            cancelled = true;
            clearAlertPoll();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('online', scheduleNextPoll);
            window.removeEventListener('offline', handleOffline);
        };
    }, [activeSavedScreen?.id, activeSavedScreenIsCurrent, activeScreenAlertEnabled, refetch]);

    useEffect(() => {
        if (!activeSavedScreen || !activeScreenAlertEnabled || !activeSavedScreenIsCurrent || !screenerData?.data) return;
        const isHidden = typeof document !== 'undefined' && document.hidden;
        const isOnline = typeof navigator === 'undefined' || navigator.onLine;
        if (!canProcessScreenerAlert(isHidden, isOnline)) return;

        const currentSymbols = getScreenerMatchSymbols(dataWithPassReasons);
        const previousSymbols = activeSavedScreen.alertMatchSymbols;
        if (previousSymbols) {
            const newMatches = getNewScreenerMatchSymbols(previousSymbols, dataWithPassReasons);
            if (newMatches.length > 0) {
                const triggerTime = new Date().toISOString();
                recordAlertActivity({
                    id: buildSavedScreenAlertId(activeSavedScreen.id, newMatches, triggerTime),
                    source: 'saved_screen',
                    triggerTime,
                    deliveryClass: 'polled',
                    serverBacked: false,
                    title: `${activeSavedScreen.name}: ${newMatches.length} new match${newMatches.length === 1 ? '' : 'es'}`,
                    detail: newMatches.slice(0, 8).join(', '),
                });
            }
            if (newMatches.length > 0 && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                try {
                    const notification = new Notification(`${activeSavedScreen.name}: ${newMatches.length} new match${newMatches.length === 1 ? '' : 'es'}`, {
                        body: newMatches.slice(0, 8).join(', '),
                        icon: '/favicon.ico',
                        badge: '/favicon.ico',
                        tag: `screener-${id}-${activeSavedScreen.id}`,
                    });
                    setTimeout(() => notification.close(), 10_000);
                } catch (notificationError) {
                    logClientError('Failed to show screener alert notification:', notificationError);
                }
            }
        }

        if (JSON.stringify(previousSymbols ?? []) === JSON.stringify(currentSymbols)) return;
        setCustomScreens((screens) => screens.map((screen) => screen.id === activeSavedScreen.id
            ? { ...screen, alertMatchSymbols: currentSymbols }
            : screen));
    }, [activeSavedScreen, activeSavedScreenIsCurrent, activeScreenAlertEnabled, dataWithPassReasons, id, screenerData?.data]);

    useEffect(() => {

        onDataChange?.(buildWidgetRuntime({
            empty: !hasData,
            apiGroup: '/screener',
            endpoint: '/api/v1/screener',
            sourceLabel: screenerData?.meta?.source ?? 'live',
            lastDataDate: typeof sourceUpdatedAt === 'string' ? sourceUpdatedAt : undefined,
            stale: Boolean(screenerData?.meta?.stale),
            derived: Boolean(search.trim() || serializedFilters),
            extra: {
                count: filteredData.length,
                market,
                sort,
                cached: Boolean(screenerData?.meta?.cached),
                fallback: Boolean(screenerData?.meta?.fallback),
                coreFieldCoverage: screenerData?.meta?.visible_field_coverage ?? {},
                coreFieldValues: screenerData?.meta?.visible_field_values ?? 0,
                coreFieldPossibleValues: screenerData?.meta?.visible_field_possible_values ?? 0,
            },
        }))
    }, [filteredData.length, hasData, market, onDataChange, screenerData?.meta, search, serializedFilters, sort, sourceUpdatedAt]);

    const handleSort = useCallback((field: string) => {
        captureAnalyticsEvent(ANALYTICS_EVENTS.widgetControlChanged, {
            control_type: 'screener_sort',
            previous_value: sortField === field ? sortOrder : `${sortField}:${sortOrder}`,
            value: sortField === field ? `${field}:${sortOrder === 'asc' ? 'desc' : 'asc'}` : `${field}:desc`,
            widget_id: id,
            widget_type: 'screener',
        });
        if (sortField === field) {
            setSortOrder((previous) => (previous === 'asc' ? 'desc' : 'asc'));
            return;
        }
        setSortField(field);
        setSortOrder('desc');
    }, [id, sortField, sortOrder]);

    const addSymbolToTarget = useCallback((symbol: string, target: WatchlistTarget) => {
        const normalized = normalizeTickerSymbol(symbol);
        if (!normalized) return;
        const symbols = parseWatchlistSymbols(target.config);
        if (symbols.includes(normalized)) {
            setWatchlistStatus(`${normalized} is already in ${target.label}.`);
            setPendingWatchlistSymbol(null);
            return;
        }
        updateWidget(target.dashboardId, target.tabId, target.widgetId, {
            config: { ...target.config, watchlistSymbols: [...symbols, normalized] },
        });
        setWatchlistStatus(`Added ${normalized} to ${target.label}.`);
        setPendingWatchlistSymbol(null);
    }, [updateWidget]);

    const createWatchlistWithSymbol = useCallback((symbol: string) => {
        const normalized = normalizeTickerSymbol(symbol);
        if (!normalized) return;
        let dashboard = activeDashboard && canEditDashboard(activeDashboard) ? activeDashboard : state.dashboards.find(canEditDashboard) ?? null;
        if (!dashboard) dashboard = createDashboard({ name: 'Investor Workflow' });
        let tab = dashboard.id === activeDashboard?.id && activeTab ? activeTab : dashboard.tabs[0] ?? null;
        if (!tab) tab = createTab(dashboard.id, 'Watchlist');
        const defaults = getWidgetDefaultLayout('watchlist');
        const placement = findNextAvailableLayout(tab.widgets, 'watchlist');
        addWidget(dashboard.id, tab.id, {
            type: 'watchlist',
            tabId: tab.id,
            config: { watchlistSymbols: [normalized] },
            layout: { x: placement.x, y: placement.y, w: defaults.w, h: defaults.h, minW: defaults.minW, minH: defaults.minH },
        });
        setWatchlistStatus(`Created a watchlist with ${normalized}.`);
        setPendingWatchlistSymbol(null);
    }, [activeDashboard, activeTab, addWidget, createDashboard, createTab, state.dashboards]);

    const handleAddToWatchlist = useCallback((symbol: string) => {
        const normalized = normalizeTickerSymbol(symbol);
        if (!normalized) return;
        const action = resolveScreenerWatchlistAction(watchlistTargets.length);
        if (action === 'create') {
            createWatchlistWithSymbol(normalized);
            return;
        }
        if (action === 'direct') {
            addSymbolToTarget(normalized, watchlistTargets[0]);
            return;
        }
        setPendingWatchlistSymbol(normalized);
        setWatchlistStatus('');
    }, [addSymbolToTarget, createWatchlistWithSymbol, watchlistTargets]);

    const handleSymbolSelect = useCallback((symbol: string) => {
        if (!symbol) return;
        captureAnalyticsEvent(ANALYTICS_EVENTS.widgetAction, {
            action: 'select_symbol',
            widget_id: id,
            widget_type: 'screener',
            symbol,
            view_mode: viewMode,
        });
        onSymbolClick?.(symbol);
        setLinkedSymbol(symbol);
    }, [id, onSymbolClick, setLinkedSymbol, viewMode]);

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

    const handleToggleScreenAlert = useCallback(async () => {
        if (!activeSavedScreen || !activeSavedScreenIsCurrent) return;
        const nextEnabled = !activeSavedScreen.alertEnabled;
        if (nextEnabled && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
            await Notification.requestPermission();
        }
        const currentSymbols = getScreenerMatchSymbols(dataWithPassReasons);
        setCustomScreens((screens) => screens.map((screen) => screen.id === activeSavedScreen.id
            ? {
                ...screen,
                alertEnabled: nextEnabled,
                alertMatchSymbols: nextEnabled ? currentSymbols : screen.alertMatchSymbols,
            }
            : screen));
    }, [activeSavedScreen, activeSavedScreenIsCurrent, dataWithPassReasons]);

    const handleResetFilters = useCallback(() => {
        captureAnalyticsEvent(ANALYTICS_EVENTS.widgetAction, {
            action: 'reset_filters',
            widget_id: id,
            widget_type: 'screener',
            filter_count: activeFilters.length,
        });
        setActiveFilters([]);
        setAdvancedFilterGroup(createEmptyFilterGroup());
        setSearch('');
        setActiveScreenId('all');
        setSortField(DEFAULT_SORT_FIELD);
        setSortOrder(DEFAULT_SORT_ORDER);
    }, [activeFilters.length, id]);

    const tableColumns = useMemo(() => [
        ...visibleColumns.map((column) => ({
            id: column.id,
            header: column.label,
            width: column.width || 100,
            accessor: (row: Record<string, unknown>) => formatScreenerValue(row[column.id], column.format),
            sortable: true,
        })),
        {
            id: 'row_actions',
            header: 'Actions',
            width: 88,
            sortable: false,
            accessor: (row: Record<string, unknown>) => {
                const symbol = String(row.ticker ?? row.symbol ?? '');
                return <div className="flex items-center gap-1"><button type="button" onClick={(event) => { event.stopPropagation(); handleSymbolSelect(symbol); }} aria-label={`View ${symbol}`} className="min-h-9 min-w-9 rounded p-2 text-[var(--text-muted)] hover:bg-blue-500/10 hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"><Search size={13} /></button><button type="button" onClick={(event) => { event.stopPropagation(); handleAddToWatchlist(symbol); }} aria-label={`Add ${symbol} to Watchlist`} className="min-h-9 min-w-9 rounded p-2 text-blue-300 hover:bg-blue-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"><Plus size={13} /></button></div>;
            },
        },
    ], [handleAddToWatchlist, handleSymbolSelect, visibleColumns]);

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
                        analyticsContext={analyticsContext}
                    />

                    {activeSavedScreen && (
                        <button
                            type="button"
                            onClick={handleToggleScreenAlert}
                            disabled={!activeSavedScreenIsCurrent}
                            aria-label={activeScreenAlertEnabled ? `Disable alerts for ${activeSavedScreen.name}` : `Enable alerts for ${activeSavedScreen.name}`}
                            title={activeSavedScreenIsCurrent ? 'Notify when new stocks enter this saved screen' : 'Re-select the saved screen before enabling alerts'}
                            className={cn(
                                'flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[10px] font-bold uppercase transition-all',
                                activeScreenAlertEnabled
                                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                                    : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                                !activeSavedScreenIsCurrent && 'cursor-not-allowed opacity-40',
                            )}
                        >
                            {activeScreenAlertEnabled ? <BellRing size={12} /> : <Bell size={12} />}
                            Alert
                        </button>
                    )}

                    <div className="mx-1 h-4 w-[1px] bg-[var(--border-color)]" />

                    <div className="relative flex-1 max-w-[220px]">
                        <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-muted)]" />
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Quick search..."
                            aria-label="Filter screener results"
                            className="h-8 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] pl-8 pr-3 text-[11px] text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:border-blue-500/50"
                        />
                    </div>

                    <MarketToggle value={market} onChange={setMarket} />

                    <div className="flex rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5">
                        <button
                            onClick={() => {
                                captureAnalyticsEvent(ANALYTICS_EVENTS.widgetControlChanged, {
                                    control_type: 'screener_view_mode',
                                    previous_value: viewMode,
                                    value: 'table',
                                    widget_id: id,
                                    widget_type: 'screener',
                                });
                                setViewMode('table')
                            }}
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
                            onClick={() => {
                                captureAnalyticsEvent(ANALYTICS_EVENTS.widgetControlChanged, {
                                    control_type: 'screener_view_mode',
                                    previous_value: viewMode,
                                    value: 'performance',
                                    widget_id: id,
                                    widget_type: 'screener',
                                });
                                setViewMode('performance')
                            }}
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
                            onClick={() => {
                                captureAnalyticsEvent(ANALYTICS_EVENTS.widgetControlChanged, {
                                    control_type: 'screener_view_mode',
                                    previous_value: viewMode,
                                    value: 'chart',
                                    widget_id: id,
                                    widget_type: 'screener',
                                });
                                setViewMode('chart')
                            }}
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
                            onClick={() => {
                                const nextOpen = !showAdvancedFilters
                                captureAnalyticsEvent(ANALYTICS_EVENTS.widgetAction, {
                                    action: nextOpen ? 'open_advanced_filters' : 'close_advanced_filters',
                                    widget_id: id,
                                    widget_type: 'screener',
                                });
                                setShowAdvancedFilters(nextOpen)
                            }}
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
                            analyticsContext={analyticsContext}
                        />
                    </div>
                </div>

                {pendingWatchlistSymbol && (
                    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] bg-blue-500/5 px-3 py-2 text-xs" role="group" aria-label={`Choose watchlist for ${pendingWatchlistSymbol}`}>
                        <span className="font-semibold text-[var(--text-primary)]">Add {pendingWatchlistSymbol} to:</span>
                        {watchlistTargets.map((target) => <button key={`${target.dashboardId}:${target.tabId}:${target.widgetId}`} type="button" onClick={() => addSymbolToTarget(pendingWatchlistSymbol, target)} className="min-h-9 rounded border border-[var(--border-color)] px-3 py-1 text-[var(--text-secondary)] hover:border-blue-500/40 hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">{target.label}</button>)}
                        <button type="button" onClick={() => setPendingWatchlistSymbol(null)} className="min-h-9 rounded px-3 py-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">Cancel</button>
                    </div>
                )}
                {watchlistStatus && <div className="border-b border-[var(--border-color)] px-3 py-1 text-[10px] text-emerald-300" role="status">{watchlistStatus}</div>}

                <FilterBar filters={activeFilters} onChange={setActiveFilters} analyticsContext={analyticsContext} />

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
                            interactiveCells
                            sortField={sortField}
                            sortOrder={sortOrder}
                            onSort={handleSort}
                        />
                    ) : viewMode === 'performance' ? (
                        <PerformanceTable data={filteredData.map((stock) => ({ ...stock, symbol: String(stock.ticker ?? stock.symbol ?? '') })) as never[]} onSymbolClick={handleSymbolSelect} onAddToWatchlist={handleAddToWatchlist} />
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
                                        onAddToWatchlist={() => handleAddToWatchlist(String(stock.ticker ?? stock.symbol ?? ''))}
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
                        {screenerData?.meta?.membership_current && (
                            <div className="hidden items-center gap-2 sm:flex" title="Current constituent membership only; not historical point-in-time membership.">
                                <span className={cn('h-1 w-1 rounded-full', screenerData.meta.membership_available ? 'bg-emerald-400' : 'bg-amber-400')} />
                                <span>{screenerData.meta.membership_available ? `Current ${screenerData.meta.membership_source ?? 'provider'} members` : 'Current membership unavailable'}</span>
                            </div>
                        )}
                        {screenerData?.meta?.discovery_coverage?.target_price ? (
                            <span className="hidden sm:inline" title={screenerData.meta.target_reference_note}>Provider references, not advice</span>
                        ) : null}
                    </div>
                    <WidgetMeta
                        updatedAt={sourceUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={Boolean(screenerData?.meta?.cached) || isFallback}
                        isStale={Boolean(screenerData?.meta?.stale)}
                        sourceLabel={screenerData?.meta?.source ?? source}
                        note={`${screenerData?.meta?.visible_field_values ?? 0}/${screenerData?.meta?.visible_field_possible_values ?? 0} core fields · ${screenerData?.meta?.discovery_coverage?.target_price ?? 0} provider targets${screenerData?.meta?.fallback ? ' · fallback' : ''}`}
                        align="right"
                        className="text-[9px]"
                    />
                </div>
            </div>
        </WidgetContainer>
    );
}

export default memo(ScreenerWidget);
