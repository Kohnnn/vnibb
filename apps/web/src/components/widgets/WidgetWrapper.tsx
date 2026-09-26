// Enhanced Widget Wrapper with OpenBB-style controls and sync integration

'use client';

import React, { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
    Download,
    FileJson,
    FileSpreadsheet,
    Image,
    Copy,
    Minimize2,
    Settings,
    Move,
    MoreHorizontal,
} from 'lucide-react';
import { useDashboard } from '@/contexts/DashboardContext';
import { useGlobalMarketsSymbol } from '@/contexts/GlobalMarketsSymbolContext';
import { useWidgetGroups } from '@/contexts/WidgetGroupContext';
import { WidgetGroupId } from '@/types/widget';
import type { WidgetType } from '@/types/dashboard';
import { TickerCombobox } from './TickerCombobox';
import { WidgetGroupSelector } from './WidgetGroupSelector';
import {
    WidgetParameterDropdown,
    WidgetMultiSelectDropdown,
    type WidgetParameter,
    type ParameterOption
} from './WidgetParameterDropdown';
import { WidgetHeaderVisibilityProvider } from '@/components/ui/WidgetContainer';
import { WidgetToolbar } from '@/components/ui/WidgetToolbar';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetErrorBoundary } from './ErrorBoundary';
import { MaximizedWidgetPortal } from './MaximizedWidgetPortal';
import { useProfile } from '@/lib/queries';
import { logClientError } from '@/lib/clientLogger';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent
} from '@/components/ui/dropdown-menu';
import { isTradingViewWidget, usesTradingViewWidgetSymbol } from '@/lib/tradingViewWidgets';
import {
    GROUP_TICKER_SCOPE,
    readTickerScope,
    resolveWidgetSymbol,
    shouldAdoptOnGroupChange,
    type TickerScope,
    type TickerScopeMode,
} from '@/lib/widgetScope';
import { getWidgetLayoutInsight } from '@/lib/dashboardIntelligence';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { exportToCSV, exportToJSON, exportToPNG, type ExportProvenance } from '@/lib/exportWidget';
import { WidgetHealthChip } from '@/components/ui/WidgetHealthChip';
import { deriveWidgetHealth } from '@/lib/widgetHealth';
import { getWidgetExportData } from '@/lib/widgetRuntime';

interface WidgetRuntimePayload {
    __widgetRuntime?: {
        provenance?: Partial<ExportProvenance>;
        exportData?: unknown;
    };
}


// Multi-select parameter interface
export interface WidgetMultiSelectParam {
    id: string;
    label: string;
    currentValues: string[];
    options: ParameterOption[];
    onChange: (values: string[]) => void;
}

export interface WidgetWrapperProps {
    id: string; // Widget Instance ID
    title: string;
    widgetType: WidgetType;
    children: ReactNode;
    symbol?: string; // Current symbol passed to child
    tabId: string;
    dashboardId: string;
    syncGroupId?: number;
    widgetGroup?: WidgetGroupId;
    isEditing?: boolean;
    isCollapsed?: boolean;

    showTickerSelector?: boolean;
    showGroupLabels?: boolean; // Controls visibility of sync badge
    parameters?: WidgetParameter[]; // Inline parameter controls (OpenBB-style)
    multiSelectParams?: WidgetMultiSelectParam[]; // Multi-select params (for indicators)
    data?: any; // Data for export (CSV/JSON)
    onRemove?: () => void;

    onMaximize?: () => void;
    onRefresh?: () => void;
    onSymbolChange?: (symbol: string) => void;

    onSettingsClick?: () => void;
    onCopilotClick?: (context?: Record<string, unknown>) => void;
}

export function WidgetWrapper({
    id,
    title,
    widgetType,
    children,
    symbol,
    tabId,
    dashboardId,
    syncGroupId,
    widgetGroup: initialWidgetGroup = 'global',
    isEditing = false,
    showTickerSelector = false,
    showGroupLabels = true,
    parameters = [],
    multiSelectParams = [],
    data: widgetData,
    onRemove,
    onMaximize,
    onRefresh,
    onSymbolChange,
    onSettingsClick,
    onCopilotClick,
    isCollapsed: initialCollapsed = false,
}: WidgetWrapperProps) {
    const { state, addWidget, cloneWidget, updateWidget } = useDashboard();
    const { setGlobalMarketsSymbol } = useGlobalMarketsSymbol();
    const {
        getColorForGroup,
        getSymbolForGroup,
        groups,
        setGroupSymbol,
        tickerOverrideFor,
        setWidgetTickerOverride,
        clearWidgetTickerOverride,
    } = useWidgetGroups();
    const [isMaximized, setIsMaximized] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
    const [isTickerDropdownOpen, setIsTickerDropdownOpen] = useState(false);
    const [widgetGroup, setWidgetGroup] = useState<WidgetGroupId>(initialWidgetGroup);
    const [internalData, setInternalData] = useState<any>(widgetData);
    const [isContentVisible, setIsContentVisible] = useState(false);
    const contentHostRef = useRef<HTMLDivElement | null>(null);
    const currentDashboard = state.dashboards.find((dashboard) => dashboard.id === dashboardId) || null;
    const currentTab = currentDashboard?.tabs.find((tab) => tab.id === tabId) || null;
    const currentWidget = currentTab?.widgets.find((widget) => widget.id === id) || null;
    const shouldEagerMount = currentDashboard?.isEditable === false || (currentWidget?.layout.y ?? Number.POSITIVE_INFINITY) <= 18;
    const copyTargets = state.dashboards.filter(
        (dashboard) =>
            dashboard.id !== dashboardId &&
            dashboard.isEditable !== false &&
            dashboard.tabs.length > 0
    );

    // Sync widgetGroup state when prop changes
    useEffect(() => {
        setWidgetGroup(initialWidgetGroup);
    }, [initialWidgetGroup]);

    // Sync internal data with prop if provided
    useEffect(() => {
        if (widgetData) setInternalData(widgetData);
    }, [widgetData]);


    useEffect(() => {
        setIsCollapsed(initialCollapsed);
    }, [initialCollapsed]);

    useEffect(() => {
        if (shouldEagerMount) {
            setIsContentVisible(true);
            return;
        }

        if (isContentVisible || isCollapsed || isMaximized) {
            if (isMaximized && !isContentVisible) {
                setIsContentVisible(true);
            }
            return;
        }

        if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
            setIsContentVisible(true);
            return;
        }

        const node = contentHostRef.current;
        if (!node) {
            setIsContentVisible(true);
            return;
        }

        // Lazy-mount via IntersectionObserver. The earlier 6 second fallback
        // was too long: many widgets sit inside transform-clipped grid cells
        // where IntersectionObserver never resolves at all (zero-size during
        // breakpoint transitions, sub-pixel rounding inside react-grid-
        // layout). Result was a "blank widget" that silently waited 6
        // seconds before showing anything. We now:
        //
        //   1. Force-mount immediately if the cell is already on-screen via
        //      a synchronous getBoundingClientRect() check.
        //   2. Drop the IO fallback to 1.5s so worst-case the user sees the
        //      skeleton briefly rather than a blank cell.
        //   3. Also drop the IntersectionObserver entirely once the host has
        //      a measured width >= 32 px (the chart-mount-guard threshold)
        //      because such a cell is "ready" even if the observer hasn't
        //      fired yet.
        try {
            const rect = node.getBoundingClientRect();
            const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
            const inViewport = rect.bottom > -300 && rect.top < viewportH + 300;
            const hasSize = rect.width >= 32 && rect.height >= 16;
            if (inViewport && hasSize) {
                setIsContentVisible(true);
                return;
            }
        } catch {
            // ignore; fall through to observer.
        }

        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry?.isIntersecting) {
                    setIsContentVisible(true);
                    observer.disconnect();
                }
            },
            { rootMargin: '320px 0px' }
        );

        const fallbackTimer = window.setTimeout(() => {
            setIsContentVisible(true);
            observer.disconnect();
        }, 1500);

        observer.observe(node);
        return () => {
            window.clearTimeout(fallbackTimer);
            observer.disconnect();
        };
    }, [isCollapsed, isContentVisible, isMaximized, shouldEagerMount]);


    // Get current group details if assigned
    const configuredScope = readTickerScope(currentWidget?.config);
    const [tickerScope, setTickerScope] = useState<TickerScope>(configuredScope);
    const isTradingViewLinkedWidget = Boolean(
        currentWidget &&
        isTradingViewWidget(widgetType) &&
        usesTradingViewWidgetSymbol(widgetType) &&
        currentWidget.config?.useLinkedSymbol !== false
    );
    const groupSymbol = getSymbolForGroup(widgetGroup);
    const tickerOverride = tickerOverrideFor(id);
    // A persisted override is authoritative over the in-memory scope: it means
    // the user detached this widget, so it keeps its own ticker until reset.
    const scopeMode: TickerScopeMode = tickerOverride ? 'override' : tickerScope.mode;
    const effectiveScope: TickerScope = tickerOverride
        ? { mode: 'override', symbol: tickerOverride }
        : tickerScope;
    // The widget shows its own ticker when detached, otherwise its group's.
    // TradingView charts keep showing the symbol the workspace seeded them with.
    const scopedSymbol = resolveWidgetSymbol(effectiveScope, groupSymbol);
    const displaySymbol = isTradingViewWidget(widgetType)
        ? (symbol || scopedSymbol)
        : scopedSymbol;
    const usesExternalTradingViewSymbol =
        isTradingViewWidget(widgetType) &&
        usesTradingViewWidgetSymbol(widgetType) &&
        displaySymbol.includes(':');

    const { data: profileData } = useProfile(displaySymbol || '', Boolean(displaySymbol) && !usesExternalTradingViewSymbol);
    const rawExchangeBadge = usesExternalTradingViewSymbol
        ? displaySymbol.split(':')[0]?.trim().toUpperCase()
        : profileData?.data?.exchange?.toString().trim().toUpperCase();
    const exchangeBadge =
        rawExchangeBadge && rawExchangeBadge !== 'VN' && rawExchangeBadge !== 'UNKNOWN'
            ? rawExchangeBadge
            : null;
    const exportableInternalData = useMemo(
        () => getWidgetExportData(internalData),
        [internalData],
    );
    const layoutInsight = useMemo(
        () => (currentWidget ? getWidgetLayoutInsight(currentWidget) : null),
        [currentWidget]
    );

    // Dashboard-wide source-health chip. Widgets opt in by publishing a
    // `provenance` object through their runtime payload (onDataChange). When a
    // widget does not publish provenance, no chip is shown, so this stays a
    // progressive enhancement rather than a forced UI change.
    const publishedProvenance = useMemo<Partial<ExportProvenance> | undefined>(() => {
        if (
            internalData &&
            typeof internalData === 'object' &&
            !Array.isArray(internalData)
        ) {
            return (internalData as WidgetRuntimePayload).__widgetRuntime?.provenance;
        }
        return undefined;
    }, [internalData]);

    const widgetHealth = useMemo(() => {
        if (!publishedProvenance) return null;
        return deriveWidgetHealth({
            cached: publishedProvenance.cached,
            stale: publishedProvenance.stale,
            localOnly: publishedProvenance.localOnly,
            updatedAt: publishedProvenance.updatedAt,
            sourceLabel: publishedProvenance.sourceLabel,
        });
    }, [publishedProvenance]);

    const healthChip = widgetHealth ? (
        <WidgetHealthChip
            health={widgetHealth}
            details={{
                sourceLabel: publishedProvenance?.sourceLabel,
                apiGroup: publishedProvenance?.apiGroup,
                endpoint: publishedProvenance?.endpoint,
                updatedAt: publishedProvenance?.updatedAt,
                adjustmentMode: publishedProvenance?.adjustmentMode,
            }}
        />
    ) : null;

    const trackWidgetAction = (action: string, properties?: Record<string, string | number | boolean | string[] | null | undefined>) => {
        captureAnalyticsEvent(ANALYTICS_EVENTS.widgetAction, {
            action,
            widget_id: id,
            widget_type: widgetType,
            widget_title: title,
            symbol: displaySymbol,
            dashboard_id: dashboardId,
            tab_id: tabId,
            widget_group: widgetGroup,
            ...properties,
        });
    };

    const trackedParameters = useMemo(() => parameters.map((parameter) => ({
        ...parameter,
        onChange: (value: string) => {
            captureAnalyticsEvent(ANALYTICS_EVENTS.widgetControlChanged, {
                control_type: 'parameter',
                parameter_id: parameter.id,
                parameter_label: parameter.label,
                previous_value: parameter.currentValue,
                value,
                widget_id: id,
                widget_type: widgetType,
                widget_title: title,
                symbol: displaySymbol,
                dashboard_id: dashboardId,
                tab_id: tabId,
            });
            parameter.onChange(value);
        },
    })), [dashboardId, displaySymbol, id, parameters, tabId, title, widgetType]);

    const trackedMultiSelectParams = useMemo(() => multiSelectParams.map((parameter) => ({
        ...parameter,
        onChange: (values: string[]) => {
            captureAnalyticsEvent(ANALYTICS_EVENTS.widgetControlChanged, {
                control_type: 'multi_select_parameter',
                parameter_id: parameter.id,
                parameter_label: parameter.label,
                previous_values: parameter.currentValues,
                values,
                widget_id: id,
                widget_type: widgetType,
                widget_title: title,
                symbol: displaySymbol,
                dashboard_id: dashboardId,
                tab_id: tabId,
            });
            parameter.onChange(values);
        },
    })), [dashboardId, displaySymbol, id, multiSelectParams, tabId, title, widgetType]);




    const handleMaximize = () => {
        const nextMaximized = !isMaximized;
        setIsMaximized(nextMaximized);
        trackWidgetAction(nextMaximized ? 'maximize' : 'restore');
        onMaximize?.();
    };

    const handleCollapseToggle = () => {
        const nextCollapsed = !isCollapsed;
        setIsCollapsed(nextCollapsed);
        trackWidgetAction(nextCollapsed ? 'collapse' : 'expand');

        if (!currentWidget) return;
        updateWidget(dashboardId, tabId, id, {
            config: {
                ...currentWidget.config,
                collapsed: nextCollapsed,
            },
        });
    };

    const handleDuplicate = () => {
        trackWidgetAction('duplicate');
        cloneWidget(dashboardId, tabId, id);
    };

    const handleCopyToDashboard = (targetDashboardId: string) => {
        const targetDashboard = state.dashboards.find((dashboard) => dashboard.id === targetDashboardId);
        const targetTab = targetDashboard?.tabs[0];

        if (!currentWidget || !targetTab || !targetDashboard) {
            return;
        }

        addWidget(targetDashboard.id, targetTab.id, {
            type: currentWidget.type,
            tabId: targetTab.id,
            syncGroupId: currentWidget.syncGroupId,
            config: currentWidget.config,
            layout: {
                x: currentWidget.layout.x,
                y: Infinity,
                w: currentWidget.layout.w,
                h: currentWidget.layout.h,
                minW: currentWidget.layout.minW,
                minH: currentWidget.layout.minH,
            },
        });
        trackWidgetAction('copy_to_dashboard', {
            target_dashboard_id: targetDashboard.id,
            target_dashboard_name: targetDashboard.name,
            target_tab_id: targetTab.id,
        });
    };



    const handleGroupChange = (newGroup: WidgetGroupId) => {
        trackWidgetAction('group_change', {
            previous_group: widgetGroup,
            next_group: newGroup,
        });
        setWidgetGroup(newGroup);
        // Persist to dashboard state
        updateWidget(dashboardId, tabId, id, { widgetGroup: newGroup });

        // A detached widget keeps its own ticker when it changes group; a
        // following widget adopts the new group's ticker. TradingView linked
        // charts are a separate rule: switching group never rewrites them.
        if (isTradingViewLinkedWidget) return;

        const newSymbol = getSymbolForGroup(newGroup);
        if (!newSymbol) return;
        if (!shouldAdoptOnGroupChange(effectiveScope, newSymbol, displaySymbol)) return;

        onSymbolChange?.(newSymbol);
    };


    /** Persist a widget's ticker scope into its config. */
    const persistTickerScope = (nextScope: TickerScope) => {
        setTickerScope(nextScope);
        updateWidget(dashboardId, tabId, id, {
            config: {
                ...currentWidget?.config,
                tickerScope: nextScope.mode,
                symbol: resolveWidgetSymbol(nextScope, groupSymbol),
            },
        });
    };

    /** Detach: the widget keeps the ticker it shows right now as its own. */
    const handleDetachTicker = () => {
        if (scopeMode === 'override' || !displaySymbol) return;
        trackWidgetAction('ticker_scope_change', {
            previous_scope: scopeMode,
            next_scope: 'override',
            scope_group: widgetGroup,
        });
        setWidgetTickerOverride(id, displaySymbol);
        persistTickerScope({ mode: 'override', symbol: displaySymbol });
    };

    /** Reset: drop the widget's own ticker and follow the group again. */
    const handleFollowGroupTicker = () => {
        if (scopeMode !== 'override') return;
        trackWidgetAction('ticker_scope_change', {
            previous_scope: scopeMode,
            next_scope: 'group',
            scope_group: widgetGroup,
        });
        clearWidgetTickerOverride(id);
        persistTickerScope(GROUP_TICKER_SCOPE);
        if (!groupSymbol) return;
        if (isTradingViewLinkedWidget) return;
        if (!shouldAdoptOnGroupChange(GROUP_TICKER_SCOPE, groupSymbol, displaySymbol)) return;
        onSymbolChange?.(groupSymbol);
    };

    const handleTickerSelect = (newSymbol: string) => {
        if (newSymbol && newSymbol !== displaySymbol) {
            trackWidgetAction('symbol_change', {
                previous_symbol: displaySymbol,
                next_symbol: newSymbol,
            });
            if (isTradingViewLinkedWidget && currentWidget) {
                updateWidget(dashboardId, tabId, id, {
                    config: {
                        ...currentWidget.config,
                        symbol: newSymbol,
                    },
                });

                // QA-v4 GM-2: When the user changes the symbol on a
                // TradingView chart, propagate the new symbol to every
                // other TV widget in the same syncGroup on the same tab
                // (e.g. Technical Analysis). This keeps the TA panel
                // aligned with the chart even when both are seeded with
                // useLinkedSymbol:false (which prevents the global
                // VN-ticker channel from clobbering the TV symbol).
                if (currentTab && currentWidget.syncGroupId !== undefined) {
                    for (const peer of currentTab.widgets) {
                        if (peer.id === id) continue;
                        if (peer.syncGroupId !== currentWidget.syncGroupId) continue;
                        if (typeof peer.type !== 'string' || !peer.type.startsWith('tradingview_')) continue;
                        const peerHasOwnSymbol =
                            peer.config && typeof (peer.config as { symbol?: unknown }).symbol === 'string';
                        if (!peerHasOwnSymbol) continue;
                        updateWidget(dashboardId, tabId, peer.id, {
                            config: {
                                ...peer.config,
                                symbol: newSymbol,
                            },
                        });
                    }
                }

                setGlobalMarketsSymbol(newSymbol);
                return;
            }

            onSymbolChange?.(newSymbol);
            // Update the group symbol so other widgets in same group sync
            setGroupSymbol(widgetGroup, newSymbol);
        }
    };

    const handleExport = async (format: 'csv' | 'json' | 'png') => {
        const filename = `${title.replace(/\s+/g, '_')}_${displaySymbol}_${new Date().toISOString().split('T')[0]}`;
        const dataToExport = exportableInternalData || widgetData;

        trackWidgetAction('export', {
            export_format: format,
        });

        // Source-aware provenance: combine what the wrapper knows (widget type,
        // title, symbol) with any provenance the child widget published through
        // its runtime payload, so every export remains self-describing.
        const runtimeProvenance =
            internalData &&
            typeof internalData === 'object' &&
            !Array.isArray(internalData)
                ? (internalData as WidgetRuntimePayload).__widgetRuntime?.provenance
                : undefined;
        const provenance: ExportProvenance = {
            widgetType,
            widgetTitle: title,
            symbol: displaySymbol || undefined,
            ...runtimeProvenance,
        };

        switch (format) {
            case 'csv':
                if (dataToExport) {
                    const rows = Array.isArray(dataToExport) ? dataToExport : [dataToExport];
                    exportToCSV(rows, filename, provenance);
                }
                break;
            case 'json':
                if (dataToExport) {
                    exportToJSON(dataToExport, filename, provenance);
                }
                break;
            case 'png':
                await exportToPNG(id, filename);
                break;
        }
    };

    const buildCopilotContext = (): Record<string, unknown> => {
        const sourceData = exportableInternalData ?? widgetData;
        let dataSample: unknown = null;

        if (Array.isArray(sourceData)) {
            dataSample = sourceData.slice(0, 5);
        } else if (sourceData && typeof sourceData === 'object') {
            dataSample = Object.fromEntries(Object.entries(sourceData).slice(0, 20));
        } else if (sourceData !== undefined) {
            dataSample = sourceData;
        }

        return {
            widgetId: id,
            widgetType: title,
            widgetTypeKey: widgetType,
            symbol: displaySymbol,
            widgetGroup,
            tabId,
            dashboardId,
            widgetConfig: currentWidget?.config || null,
            dataSample,
        };
    };


    return (
        <>
            {/* Normal widget - dim when maximized */}
            <div
                className={cn(
                    "widget-card-premium h-full min-h-0 flex flex-col overflow-visible",
                    isEditing ? 'ring-2 ring-blue-500/40' : '',
                    isMaximized ? 'opacity-0 pointer-events-none' : ''
                )}
                style={{
                    borderColor: widgetGroup !== 'global'
                        ? getColorForGroup(widgetGroup)
                        : undefined
                }}
            >
                <WidgetToolbar
                    title={title}
                    widgetType={widgetType}
                    symbol={displaySymbol}
                    isEditing={isEditing}
                    healthChip={healthChip}
                    showSymbolSelector={showTickerSelector}
                    onSymbolChange={() => setIsTickerDropdownOpen(true)}
                    showGroupSelector={showGroupLabels}
                    groupSelector={
                        <WidgetGroupSelector
                            widgetGroup={widgetGroup}
                            groups={groups}
                            getColorForGroup={getColorForGroup}
                            getSymbolForGroup={getSymbolForGroup}
                            currentSymbol={displaySymbol}
                            onGroupChange={handleGroupChange}
                            scopeMode={scopeMode}
                            onDetachTicker={handleDetachTicker}
                            onFollowGroupTicker={handleFollowGroupTicker}
                        />
                    }
                    tickerSelector={
                        <div className="relative flex items-center min-w-[68px]">
                            <button
                                type="button"
                                onClick={() => setIsTickerDropdownOpen(true)}
                                className="inline-flex items-center gap-1 rounded border border-blue-500/25 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-blue-300 transition-colors hover:bg-blue-500/20 hover:text-blue-200"
                                title="Select widget ticker"
                            >
                                <span>{displaySymbol}</span>
                                {exchangeBadge && (
                                    <span className="rounded bg-blue-900/30 px-1 text-[9px] text-blue-200/80">
                                        {exchangeBadge}
                                    </span>
                                )}
                            </button>
                            <TickerCombobox
                                isOpen={isTickerDropdownOpen}
                                onClose={() => setIsTickerDropdownOpen(false)}
                                currentSymbol={displaySymbol}
                                onSelect={handleTickerSelect}
                            />
                        </div>
                    }
                    parameters={
                        <div className="flex flex-wrap items-center gap-1">
                            {trackedParameters.map((param) => (
                                <WidgetParameterDropdown key={param.id} parameter={param} />
                            ))}
                            {trackedMultiSelectParams.map((param) => (
                                <WidgetMultiSelectDropdown
                                    key={param.id}
                                    id={param.id}
                                    label={param.label}
                                    currentValues={param.currentValues}
                                    options={param.options}
                                    onChange={param.onChange}
                                />
                            ))}
                        </div>
                    }
                    compactParameters={trackedParameters.length > 0 || trackedMultiSelectParams.length > 0 ? (
                        <>
                            {trackedParameters.map(parameter => (
                                <label key={parameter.id} className="flex min-w-0 flex-col gap-1 text-xs text-[var(--text-secondary)]">
                                    {parameter.label}
                                    <select value={parameter.currentValue} onChange={event => parameter.onChange(event.target.value)} className="max-w-full rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] p-1 text-[var(--text-primary)]">
                                        {parameter.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </label>
                            ))}
                            {trackedMultiSelectParams.map(parameter => (
                                <fieldset key={parameter.id} className="w-full text-xs text-[var(--text-secondary)]">
                                    <legend className="mb-1">{parameter.label}</legend>
                                    <div className="flex flex-wrap gap-2">
                                        {parameter.options.map(option => (
                                            <label key={option.value} className="flex items-center gap-1">
                                                <input type="checkbox" checked={parameter.currentValues.includes(option.value)} onChange={event => parameter.onChange(event.target.checked ? [...parameter.currentValues, option.value] : parameter.currentValues.filter(value => value !== option.value))} />
                                                {option.label}
                                            </label>
                                        ))}
                                    </div>
                                </fieldset>
                            ))}
                        </>
                    ) : undefined}
                    isMaximized={isMaximized}
                    onMaximize={handleMaximize}
                    onRefresh={onRefresh ? () => {
                        trackWidgetAction('refresh');
                        onRefresh();
                    } : undefined}
                    onSettings={onSettingsClick ? () => {
                        trackWidgetAction('open_settings');
                        onSettingsClick();
                    } : undefined}
                    highlightSettings={isTradingViewWidget(widgetType)}
                    onCopilot={onCopilotClick ? () => {
                        trackWidgetAction('open_copilot');
                        onCopilotClick(buildCopilotContext());
                    } : undefined}
                    onClose={onRemove ? () => {
                        trackWidgetAction('close');
                        onRemove();
                    } : undefined}
                    actions={
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button type="button" aria-label={`Widget actions for ${title}`} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors">
                                    <MoreHorizontal size={11} />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="min-w-[150px]">
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger className="cursor-pointer text-xs text-[var(--text-primary)] focus:bg-[var(--bg-hover)]">
                                        <Download size={14} className="mr-2" />
                                        <span>Export</span>
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent>
                                        <DropdownMenuItem onClick={() => handleExport('csv')} className="cursor-pointer text-xs text-[var(--text-primary)] focus:bg-[var(--bg-hover)]">
                                            <FileSpreadsheet size={14} className="mr-2" />
                                            <span>Export as CSV</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleExport('json')} className="cursor-pointer text-xs text-[var(--text-primary)] focus:bg-[var(--bg-hover)]">
                                            <FileJson size={14} className="mr-2" />
                                            <span>Export as JSON</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleExport('png')} className="cursor-pointer text-xs text-[var(--text-primary)] focus:bg-[var(--bg-hover)]">
                                            <Image size={14} className="mr-2" />
                                            <span>Export as PNG</span>
                                        </DropdownMenuItem>
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                                {onSettingsClick && (
                                    <DropdownMenuItem onClick={onSettingsClick} className="cursor-pointer text-xs text-[var(--text-primary)] focus:bg-[var(--bg-hover)]">
                                        <Settings size={14} className="mr-2" />
                                        <span>Widget Settings</span>
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={handleDuplicate} className="cursor-pointer text-xs text-[var(--text-primary)] focus:bg-[var(--bg-hover)]">
                                    <Copy size={14} className="mr-2" />
                                    <span>Duplicate</span>
                                </DropdownMenuItem>
                                {copyTargets.length > 0 && (
                                    <DropdownMenuSub>
                                        <DropdownMenuSubTrigger className="cursor-pointer text-xs text-[var(--text-primary)] focus:bg-[var(--bg-hover)]">
                                            <Move size={14} className="mr-2" />
                                            <span>Copy to Dashboard</span>
                                        </DropdownMenuSubTrigger>
                                        <DropdownMenuSubContent>
                                            {copyTargets.map((dashboard) => (
                                                <DropdownMenuItem
                                                    key={dashboard.id}
                                                    onClick={() => handleCopyToDashboard(dashboard.id)}
                                                    className="cursor-pointer text-xs text-[var(--text-primary)] focus:bg-[var(--bg-hover)]"
                                                >
                                                    <span>{dashboard.name}</span>
                                                </DropdownMenuItem>
                                            ))}
                                        </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                )}
                                <DropdownMenuItem onClick={handleCollapseToggle} className="cursor-pointer text-xs text-[var(--text-primary)] focus:bg-[var(--bg-hover)]">
                                    <Minimize2 size={14} className="mr-2" />
                                    <span>{isCollapsed ? 'Expand Widget' : 'Minimize'}</span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    }
                />

                {isEditing && layoutInsight ? (
                    <div className={cn(
                        'border-b px-3 py-2 text-[10px] leading-4',
                        layoutInsight.severity === 'warning'
                            ? 'border-amber-500/20 bg-amber-500/8 text-amber-100/90'
                            : 'border-blue-500/20 bg-blue-500/8 text-blue-100/85'
                    )}>
                        <span className="font-semibold uppercase tracking-[0.16em]">
                            {layoutInsight.kind === 'compacted_sparse' ? 'Sparse State' : 'Layout Fit'}
                        </span>
                        <span className="ml-2">{layoutInsight.detail}</span>
                    </div>
                ) : null}


                {/* Content */}
                <div id={id} ref={contentHostRef} className="relative min-h-0 flex-1 overflow-auto rounded-b-lg bg-[var(--bg-secondary)] p-2 sm:p-2.5">
                    {isMaximized ? null : isCollapsed ? (
                        <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                            Collapsed
                        </div>
                    ) : !isContentVisible ? (
                        <div className="flex h-full items-center justify-center p-3">
                            <div className="w-full max-w-sm rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]/80 p-3 shadow-sm">
                                <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                                    Preparing widget
                                </div>
                                <WidgetSkeleton lines={4} />
                            </div>
                        </div>
                    ) : (
                        <WidgetHeaderVisibilityProvider hideHeader>
                            <WidgetErrorBoundary
                                widgetName={title}
                                onError={(error) => logClientError(`Widget ${id} (${title}) crashed:`, error)}
                            >
                                {React.isValidElement(children)
                                    ? React.cloneElement(children as React.ReactElement<any>, {
                                        id: id,
                                        symbol: displaySymbol,
                                        widgetGroup,
                                        onDataChange: setInternalData,
                                    })
                                    : children}
                            </WidgetErrorBoundary>
                        </WidgetHeaderVisibilityProvider>
                    )}
                </div>

            </div>

            {/* Maximized Portal - renders outside grid DOM */}
            <MaximizedWidgetPortal
                isOpen={isMaximized}
                onClose={() => setIsMaximized(false)}
                title={`${displaySymbol ? `${displaySymbol} - ` : ''}${title}`}
            >
                <WidgetHeaderVisibilityProvider hideHeader>
                <WidgetErrorBoundary
                    widgetName={title}
                    onError={(error) => logClientError(`Maximized Widget ${id} (${title}) crashed:`, error)}
                >
                    {React.isValidElement(children)
                        ? React.cloneElement(children as React.ReactElement<any>, {
                            id,
                            symbol: displaySymbol,
                            widgetGroup,
                            onDataChange: setInternalData
                        })
                        : children}
                </WidgetErrorBoundary>
                </WidgetHeaderVisibilityProvider>
            </MaximizedWidgetPortal>
        </>
    );
}
