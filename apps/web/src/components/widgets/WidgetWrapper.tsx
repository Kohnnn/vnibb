// Enhanced Widget Wrapper with OpenBB-style controls and sync integration

'use client';

import React, { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
    Download,
    FileJson,
    FileSpreadsheet,
    Image,
    Copy,
    Maximize2,
    Minimize2,
    X,
    Settings,
    Move,
    Sparkles,
    Users,
    Check,
    MoreHorizontal,
    RefreshCw
} from 'lucide-react';
import { useDashboard } from '@/contexts/DashboardContext';
import { useGlobalMarketsSymbol } from '@/contexts/GlobalMarketsSymbolContext';
import { useWidgetGroups } from '@/contexts/WidgetGroupContext';
import { WidgetGroupId } from '@/types/widget';
import type { WidgetType } from '@/types/dashboard';
import { TickerCombobox } from './TickerCombobox';
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
import { getWidgetLayoutInsight } from '@/lib/dashboardIntelligence';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { exportToCSV, exportToJSON, exportToPNG } from '@/lib/exportWidget';

interface WidgetRuntimeLayoutHint {
    compactHeight?: number;
    empty?: boolean;
}

interface WidgetRuntimePayload {
    __widgetRuntime?: {
        layoutHint?: WidgetRuntimeLayoutHint;
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
    const { state, addWidget, cloneWidget, updateWidget, updateWidgetRuntime } = useDashboard();
    const { setGlobalMarketsSymbol } = useGlobalMarketsSymbol();
    const { getColorForGroup, getSymbolForGroup, groups, setGroupSymbol } = useWidgetGroups();
    const [isMaximized, setIsMaximized] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
    const [isTickerDropdownOpen, setIsTickerDropdownOpen] = useState(false);
    const [widgetGroup, setWidgetGroup] = useState<WidgetGroupId>(initialWidgetGroup);
    const [internalData, setInternalData] = useState<any>(widgetData);
    const [isContentVisible, setIsContentVisible] = useState(false);
    const contentHostRef = useRef<HTMLDivElement | null>(null);
    const baseWidgetHeightRef = useRef<number | null>(null);
    const autoCompactHeightRef = useRef<number | null>(null);
    const lastObservedHeightRef = useRef<number | null>(null);
    const runtimeWidgetIdRef = useRef<string | null>(null);
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
        if (!currentWidget) {
            return;
        }

        if (runtimeWidgetIdRef.current !== currentWidget.id) {
            runtimeWidgetIdRef.current = currentWidget.id;
            baseWidgetHeightRef.current = currentWidget.layout.h;
            autoCompactHeightRef.current = null;
            lastObservedHeightRef.current = currentWidget.layout.h;
            return;
        }

        const currentHeight = currentWidget.layout.h;
        const lastObservedHeight = lastObservedHeightRef.current;
        const wasAutoCompactHeight = autoCompactHeightRef.current !== null && lastObservedHeight === autoCompactHeightRef.current;

        if (lastObservedHeight !== currentHeight && !wasAutoCompactHeight) {
            baseWidgetHeightRef.current = currentHeight;
        }

        lastObservedHeightRef.current = currentHeight;
    }, [currentWidget]);

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

        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry?.isIntersecting) {
                    setIsContentVisible(true);
                    observer.disconnect();
                }
            },
            { rootMargin: '280px 0px' }
        );

        const fallbackTimer = window.setTimeout(() => {
            setIsContentVisible(true);
            observer.disconnect();
        }, 6000);

        observer.observe(node);
        return () => {
            window.clearTimeout(fallbackTimer);
            observer.disconnect();
        };
    }, [isCollapsed, isContentVisible, isMaximized, shouldEagerMount]);

    useEffect(() => {
        if (!currentWidget) {
            return;
        }

        const layoutHint = (internalData as WidgetRuntimePayload | null)?.__widgetRuntime?.layoutHint;
        if (!layoutHint) {
            return;
        }

        const baseHeight = baseWidgetHeightRef.current ?? currentWidget.layout.h;
        const compactHeight = Math.max(
            layoutHint.compactHeight ?? currentWidget.layout.minH ?? 3,
            currentWidget.layout.minH ?? 2,
        );
        const currentHeight = currentWidget.layout.h;

        if (layoutHint.empty) {
            if (currentHeight <= compactHeight) {
                autoCompactHeightRef.current = compactHeight;
                return;
            }

            autoCompactHeightRef.current = compactHeight;
            lastObservedHeightRef.current = compactHeight;

            updateWidgetRuntime(dashboardId, tabId, id, {
                layout: {
                    ...currentWidget.layout,
                    h: compactHeight,
                },
            });
            return;
        }

        const wasAutoCompacted = autoCompactHeightRef.current !== null && currentHeight === autoCompactHeightRef.current;
        if (!wasAutoCompacted) {
            return;
        }

        autoCompactHeightRef.current = null;

        if (baseHeight === currentHeight) {
            return;
        }

        lastObservedHeightRef.current = baseHeight;

        updateWidgetRuntime(dashboardId, tabId, id, {
            layout: {
                ...currentWidget.layout,
                h: baseHeight,
            },
        });
    }, [currentWidget, dashboardId, id, internalData, tabId, updateWidgetRuntime]);

    // Get current group details if assigned
    const effectiveSymbol = getSymbolForGroup(widgetGroup);
    const isTradingViewLinkedWidget = Boolean(
        currentWidget &&
        isTradingViewWidget(widgetType) &&
        usesTradingViewWidgetSymbol(widgetType) &&
        currentWidget.config?.useLinkedSymbol !== false
    );
    // Priority: 
    // 1. Specific group symbol (A, B, C, D) if not global
    // 2. Legacy sync symbol (if provided via prop)
    // 3. Global group symbol
    const displaySymbol = isTradingViewWidget(widgetType)
        ? (symbol || effectiveSymbol)
        : (widgetGroup !== 'global')
            ? effectiveSymbol
            : (symbol || effectiveSymbol);
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
    const exportableInternalData = useMemo(() => {
        if (
            internalData &&
            typeof internalData === 'object' &&
            !Array.isArray(internalData) &&
            '__widgetRuntime' in (internalData as Record<string, unknown>)
        ) {
            const { __widgetRuntime, ...rest } = internalData as Record<string, unknown>;
            return Object.keys(rest).length > 0 ? rest : undefined;
        }

        return internalData;
    }, [internalData]);
    const layoutInsight = useMemo(
        () => (currentWidget ? getWidgetLayoutInsight(currentWidget) : null),
        [currentWidget]
    );

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

    const handleSyncClick = () => {
        // Legacy sync logic removed in favor of Phase 2 groups
    };


    const handleGroupChange = (newGroup: WidgetGroupId) => {
        trackWidgetAction('group_change', {
            previous_group: widgetGroup,
            next_group: newGroup,
        });
        setWidgetGroup(newGroup);
        // Persist to dashboard state
        updateWidget(dashboardId, tabId, id, { widgetGroup: newGroup });

        // If joining a new group, update local symbol if needed
        const newSymbol = getSymbolForGroup(newGroup);
        if (!newSymbol) return;

        if (isTradingViewLinkedWidget) {
            return;
        }

        if (onSymbolChange) onSymbolChange(newSymbol);
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

        switch (format) {
            case 'csv':
                if (dataToExport) {
                    const rows = Array.isArray(dataToExport) ? dataToExport : [dataToExport];
                    exportToCSV(rows, filename);
                }
                break;
            case 'json':
                if (dataToExport) {
                    exportToJSON(dataToExport, filename);
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
                    "widget-card-premium h-full flex flex-col",
                    widgetType === 'tradingview_ticker_tag' ? 'overflow-visible' : 'overflow-hidden',
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
                    showSymbolSelector={showTickerSelector}
                    onSymbolChange={() => setIsTickerDropdownOpen(true)}
                    showGroupSelector={showGroupLabels}
                    groupSelector={
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    className="flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--bg-hover)] transition-colors"
                                    style={{
                                        borderLeft: `2px solid ${getColorForGroup(widgetGroup)}`
                                    }}
                                    title={`Widget Group: ${groups[widgetGroup]?.name || 'Global'}`}
                                >
                                    <Users
                                        size={12}
                                        className={
                                            widgetGroup !== 'global'
                                                ? 'text-[var(--text-primary)]'
                                                : 'text-[var(--text-muted)]'
                                        }
                                    />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="min-w-[120px]">
                                {Object.entries(groups).map(([id, config]) => (
                                    <DropdownMenuItem
                                        key={id}
                                        onClick={() => handleGroupChange(id as WidgetGroupId)}
                                        className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)] focus:bg-[var(--bg-hover)]"
                                    >
                                        <div
                                            className="w-2 h-2 rounded-full"
                                            style={{ backgroundColor: config.color }}
                                        />
                                        <span className="flex-1">{config.name}</span>
                                        {widgetGroup === id && <Check size={12} className="text-blue-500" />}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
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
                        <div className="flex items-center gap-1">
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
                                <button className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors">
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
                <div id={id} ref={contentHostRef} className="relative flex-1 overflow-auto bg-[var(--bg-secondary)] p-2 sm:p-2.5">
                    {isCollapsed ? (
                        <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                            Collapsed
                        </div>
                    ) : !isContentVisible ? (
                        <div className="flex h-full items-center justify-center">
                            <div className="w-full max-w-sm rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]/70">
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
                <WidgetErrorBoundary
                    widgetName={title}
                    onError={(error) => logClientError(`Maximized Widget ${id} (${title}) crashed:`, error)}
                >
                    {React.isValidElement(children)
                        ? React.cloneElement(children as React.ReactElement<any>, {
                            symbol: displaySymbol,
                            widgetGroup,
                            onDataChange: setInternalData
                        })
                        : children}
                </WidgetErrorBoundary>
            </MaximizedWidgetPortal>
        </>
    );
}
