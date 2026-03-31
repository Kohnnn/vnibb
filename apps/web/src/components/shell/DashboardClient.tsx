// Main Dashboard Page with OpenBB-style Tabs and Dynamic Dashboard Context

'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Sidebar, Header, TabBar, RightSidebar, MobileNav } from '@/components/layout';
import { ResponsiveDashboardGrid, type LayoutItem } from '@/components/layout/DashboardGrid';
import { useDashboard } from '@/contexts/DashboardContext';
import { useTheme } from '@/contexts/ThemeContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import {
    TickerInfoWidget,
    PriceChartWidget,
    KeyMetricsWidget,
    ScreenerWidget,
    TickerProfileWidget,
    ShareStatisticsWidget,
    EarningsHistoryWidget,
    DividendPaymentWidget,
    CompanyFilingsWidget,
    StockSplitsWidget,
    MarketOverviewWidget,
    WidgetLibrary,
    WidgetWrapper,
    widgetRegistry
} from '@/components/widgets';
import {
    TIMEFRAME_OPTIONS,
    CHART_TYPE_OPTIONS,
    PERIOD_OPTIONS,
    DATA_SOURCE_OPTIONS,
    INDICATOR_OPTIONS,
    type WidgetParameter,
    type ParameterOption
} from '@/components/widgets/WidgetParameterDropdown';
import { type WidgetMultiSelectParam } from '@/components/widgets/WidgetWrapper';
import { WidgetSettingsModal, AppsLibrary, PromptsLibrary, TemplateSelector } from '@/components/modals';
import { AICopilot } from '@/components/ui/AICopilot';
import { useWidgetGroups } from '@/contexts/WidgetGroupContext';
import { useSymbolLink } from '@/contexts/SymbolLinkContext';
import { useUnit } from '@/contexts/UnitContext';
import { autoFitGridItems, findNextAvailableLayout, getWidgetDefaultLayout } from '@/lib/dashboardLayout';
import { getWidgetDefinition } from '@/data/widgetDefinitions';
import type { WidgetInstance, WidgetType, WidgetConfig } from '@/types/dashboard';
import { DASHBOARD_TEMPLATES, type DashboardTemplate } from '@/types/dashboard-templates';
import { Grid3X3, PlusCircle, RefreshCw } from 'lucide-react';

export default function DashboardPage() {
    return (
        <ProtectedRoute>
            <DashboardContent />
        </ProtectedRoute>
    );
}

const RIGHT_SIDEBAR_WIDTH = 350;

function DashboardContent() {
    const {
        state,
        activeDashboard,
        activeTab,
        setActiveTab,
        createDashboard,
        createTab,
        setActiveDashboard,
        updateSyncGroupSymbol,
        deleteWidget,
        updateTabLayout,
        updateWidget,
        resetTabLayout,
        addWidget
    } = useDashboard();

    const { setGlobalSymbol: setContextGlobalSymbol } = useWidgetGroups();
    const { globalSymbol, setGlobalSymbol } = useSymbolLink();
    const { resolvedTheme, setTheme } = useTheme();
    const { config: unitConfig, setUnit } = useUnit();

    const [isEditing, setIsEditing] = useState(false);
    const [isWidgetLibraryOpen, setIsWidgetLibraryOpen] = useState(false);
    const [isAppsLibraryOpen, setIsAppsLibraryOpen] = useState(false);
    const [isPromptsLibraryOpen, setIsPromptsLibraryOpen] = useState(false);
    const [isTemplateSelectorOpen, setIsTemplateSelectorOpen] = useState(false);
    const [showAICopilot, setShowAICopilot] = useState(false);
    const [copilotWidgetContext, setCopilotWidgetContext] = useState<string | undefined>(undefined);
    const [copilotWidgetData, setCopilotWidgetData] = useState<Record<string, unknown> | undefined>(undefined);
    const [sidebarWidth, setSidebarWidth] = useState(208);
    const [mounted, setMounted] = useState(false);
    const [widgetSettingsState, setWidgetSettingsState] = useState<{
        widgetId: string;
        tabId: string;
    } | null>(null);

    const starterTemplates = useMemo(() => {
        const preferredIds = ['getting-started', 'fundamental-analyst', 'global-markets', 'earnings-season'];
        return preferredIds
            .map((id) => DASHBOARD_TEMPLATES.find((template) => template.id === id))
            .filter((template): template is DashboardTemplate => Boolean(template));
    }, []);

    const updateSidebarWidth = useCallback(() => {
        if (typeof window !== 'undefined') {
            if (window.innerWidth < 1024) {
                setSidebarWidth(0);
                return;
            }

            const sidebar = document.querySelector('aside[data-mobile-sidebar="false"]');
            const sidebarW = sidebar?.clientWidth || 208;
            setSidebarWidth(sidebarW);
        }
    }, []);

    useEffect(() => {
        setMounted(true);
        updateSidebarWidth();
        window.addEventListener('resize', updateSidebarWidth);
        return () => window.removeEventListener('resize', updateSidebarWidth);
    }, [updateSidebarWidth]);

    useEffect(() => {
        if (!mounted) return;

        const isEditableTarget = (target: EventTarget | null) => {
            if (!(target instanceof HTMLElement)) return false;
            const tag = target.tagName;
            if (target.isContentEditable) return true;
            return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
        };

        const handleKeyboardNavigation = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsWidgetLibraryOpen(false);
                setIsAppsLibraryOpen(false);
                setIsPromptsLibraryOpen(false);
                setIsTemplateSelectorOpen(false);
                setWidgetSettingsState(null);
                setShowAICopilot(false);
                return;
            }

            if (isEditableTarget(event.target)) return;

            const numeric = Number(event.key);
            if (
                Number.isInteger(numeric) &&
                numeric >= 1 &&
                numeric <= 9 &&
                activeDashboard?.tabs?.length &&
                (event.metaKey || event.ctrlKey) &&
                !event.altKey &&
                !event.shiftKey
            ) {
                const orderedTabs = [...activeDashboard.tabs].sort((a, b) => a.order - b.order);
                const nextTab = orderedTabs[numeric - 1];
                if (nextTab) {
                    event.preventDefault();
                    setActiveTab(nextTab.id);
                    return;
                }
            }

            if (
                (event.metaKey || event.ctrlKey) &&
                !event.altKey &&
                !event.shiftKey &&
                event.key.toLowerCase() === 'l'
            ) {
                event.preventDefault();
                setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
                return;
            }

            if (!event.metaKey && !event.ctrlKey && !event.altKey) {
                if (event.key === 'Tab' && activeTab?.widgets?.length) {
                    const focusableWidgets = Array.from(
                        document.querySelectorAll<HTMLElement>('[data-widget-focus="true"]')
                    );
                    if (!focusableWidgets.length) return;

                    event.preventDefault();
                    const currentIndex = focusableWidgets.findIndex((node) => node === document.activeElement);
                    const direction = event.shiftKey ? -1 : 1;
                    const fallbackIndex = event.shiftKey ? focusableWidgets.length - 1 : 0;
                    const nextIndex = currentIndex === -1
                        ? fallbackIndex
                        : (currentIndex + direction + focusableWidgets.length) % focusableWidgets.length;
                    focusableWidgets[nextIndex]?.focus();
                }
            }
        };

        window.addEventListener('keydown', handleKeyboardNavigation);
        return () => window.removeEventListener('keydown', handleKeyboardNavigation);
    }, [activeDashboard?.tabs, activeTab?.widgets, mounted, resolvedTheme, setActiveTab, setTheme]);

    const handleLayoutChange = useCallback((newLayout: LayoutItem[]) => {
        if (!activeDashboard || !activeTab) return;

        const updatedWidgets = activeTab.widgets.map(w => {
            const layoutItem = newLayout.find(l => l.i === w.id);
            if (layoutItem) {
                return {
                    ...w,
                    layout: {
                        ...w.layout,
                        x: layoutItem.x,
                        y: layoutItem.y,
                        w: layoutItem.w,
                        h: layoutItem.h
                    }
                };
            }
            return w;
        });

        updateTabLayout(activeDashboard.id, activeTab.id, updatedWidgets);
    }, [activeDashboard, activeTab, updateTabLayout]);

    const handleSymbolChange = useCallback((symbol: string) => {
        if (activeDashboard) {
            setGlobalSymbol(symbol);
            setContextGlobalSymbol(symbol);
            updateSyncGroupSymbol(activeDashboard.id, 1, symbol);
        }
    }, [
        activeDashboard,
        updateSyncGroupSymbol,
        setGlobalSymbol,
        setContextGlobalSymbol,
    ]);

    const handleEditToggle = useCallback(() => {
        if (activeDashboard?.isEditable === false) {
            return;
        }
        setIsEditing((prev) => !prev);
    }, [activeDashboard?.isEditable]);

    useEffect(() => {
        if (activeDashboard?.isEditable === false && isEditing) {
            setIsEditing(false);
        }
    }, [activeDashboard?.id, activeDashboard?.isEditable, isEditing]);

    useEffect(() => {
        if (!mounted || typeof window === 'undefined') return;

        let timeoutId: number | undefined;
        let frameA: number | undefined;
        let frameB: number | undefined;

        timeoutId = window.setTimeout(() => {
            frameA = window.requestAnimationFrame(() => {
                frameB = window.requestAnimationFrame(() => {
                    window.dispatchEvent(new Event('resize'));
                });
            });
        }, 140);

        return () => {
            if (timeoutId !== undefined) window.clearTimeout(timeoutId);
            if (frameA !== undefined) window.cancelAnimationFrame(frameA);
            if (frameB !== undefined) window.cancelAnimationFrame(frameB);
        };
    }, [activeDashboard?.id, activeTab?.id, activeTab?.widgets, mounted]);

    const handleResetLayout = useCallback(() => {
        if (activeDashboard && activeTab) {
            resetTabLayout(activeDashboard.id, activeTab.id);
        }
    }, [activeDashboard, activeTab, resetTabLayout]);

    const handleAutoFitLayout = useCallback(() => {
        if (!activeDashboard) return;

        activeDashboard.tabs.forEach((tab) => {
            const normalizedWidgets = tab.widgets.map((widget) => {
                const defaults = getWidgetDefaultLayout(widget.type);
                return {
                    ...widget,
                    layout: {
                        ...widget.layout,
                        w: widget.layout.w || defaults.w,
                        h: widget.layout.h || defaults.h,
                        minW: defaults.minW ?? widget.layout.minW ?? 3,
                        minH: defaults.minH ?? widget.layout.minH ?? 2,
                    },
                };
            });

            updateTabLayout(activeDashboard.id, tab.id, autoFitGridItems(normalizedWidgets));
        });
    }, [activeDashboard, updateTabLayout]);

    const handleCollapseAll = useCallback(() => {
        if (!activeDashboard || !activeTab) return;
        const updatedWidgets = activeTab.widgets.map((widget) => ({
            ...widget,
            config: {
                ...widget.config,
                collapsed: true,
            },
        }));
        updateTabLayout(activeDashboard.id, activeTab.id, updatedWidgets);
    }, [activeDashboard, activeTab, updateTabLayout]);

    const handleExpandAll = useCallback(() => {
        if (!activeDashboard || !activeTab) return;
        const updatedWidgets = activeTab.widgets.map((widget) => ({
            ...widget,
            config: {
                ...widget.config,
                collapsed: false,
            },
        }));
        updateTabLayout(activeDashboard.id, activeTab.id, updatedWidgets);
    }, [activeDashboard, activeTab, updateTabLayout]);

    const handleWidgetConfigChange = useCallback((
        widgetId: string,
        key: string,
        value: string
    ) => {
        if (!activeDashboard || !activeTab) return;
        const widget = activeTab.widgets.find((current) => current.id === widgetId);
        if (!widget) return;

        updateWidget(activeDashboard.id, activeTab.id, widgetId, {
            config: {
                ...widget.config,
                [key]: value
            }
        });
    }, [activeDashboard, activeTab, updateWidget]);

    const handleOpenWidgetSettings = useCallback((widgetId: string) => {
        if (!activeTab) return;
        setWidgetSettingsState({ widgetId, tabId: activeTab.id });
    }, [activeTab]);

    const handleApplyTemplate = useCallback((template: DashboardTemplate) => {
        if (!activeDashboard || !activeTab || activeDashboard.isEditable === false) return;

        const tab = createTab(activeDashboard.id, template.name);
        template.widgets.forEach(w => {
            addWidget(activeDashboard.id, tab.id, {
                type: w.type,
                tabId: tab.id,
                layout: w.layout,
                config: w.config || {}
            });
        });
        setActiveTab(tab.id);
    }, [activeDashboard, activeTab, addWidget, createTab, setActiveTab]);

    const handleSeedEmptyTab = useCallback((template: DashboardTemplate) => {
        if (!activeDashboard || !activeTab || activeDashboard.isEditable === false || activeTab.widgets.length > 0) return;

        template.widgets.forEach((widget) => {
            addWidget(activeDashboard.id, activeTab.id, {
                type: widget.type,
                tabId: activeTab.id,
                layout: widget.layout,
                config: widget.config || {},
            });
        });
    }, [activeDashboard, activeTab, addWidget]);

    const handleCreateWorkspace = useCallback(() => {
        const dashboard = createDashboard({ name: 'Workspace 1' });
        setActiveDashboard(dashboard.id);
    }, [createDashboard, setActiveDashboard]);

    const quickAddOptions: Array<{ type: WidgetType; label: string }> = [
        { type: 'price_chart', label: 'Price Chart' },
        { type: 'tradingview_chart', label: 'TradingView Chart' },
        { type: 'tradingview_ticker_tape', label: 'Ticker Tape' },
        { type: 'key_metrics', label: 'Key Metrics' },
        { type: 'screener', label: 'Screener' },
    ];

    const handleQuickAddWidget = useCallback((type: WidgetType) => {
        if (!activeDashboard || !activeTab) return;

        const placement = findNextAvailableLayout(activeTab.widgets, type);
        const defaults = getWidgetDefaultLayout(type);

        addWidget(activeDashboard.id, activeTab.id, {
            type,
            tabId: activeTab.id,
            layout: {
                x: placement.x,
                y: placement.y,
                w: defaults.w,
                h: defaults.h,
                minW: defaults.minW,
                minH: defaults.minH,
            },
        });
    }, [activeDashboard, activeTab, addWidget]);

    const memoizedLayouts = useMemo(() => {
        if (!activeTab?.widgets) return [];

        return activeTab.widgets.map(w => ({
            ...w.layout,
            i: w.id,
            minW: w.layout.minW ?? 4,
            minH: w.layout.minH ?? 3,
        }));
    }, [activeTab?.widgets, isEditing]);

    const getWidgetParameters = useCallback((
        widget: WidgetInstance,
        onConfigChange: (key: string, value: string) => void
    ): WidgetParameter[] => {
        const config = widget.config || {};
        switch (widget.type) {
            case 'price_chart':
                return [
                    {
                        id: 'timeframe',
                        label: 'Period',
                        currentValue: (config.timeframe as string) || '1Y',
                        options: TIMEFRAME_OPTIONS,
                        onChange: (v) => onConfigChange('timeframe', v)
                    },
                    {
                        id: 'chartType',
                        label: 'Type',
                        currentValue: (config.chartType as string) || 'candle',
                        options: CHART_TYPE_OPTIONS,
                        onChange: (v) => onConfigChange('chartType', v)
                    }
                ];
            default:
                return [];
        }
    }, []);

    if (!mounted) return null;

    return (
        <div aria-label="Dashboard workspace" className="flex min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
            <Sidebar
                onOpenWidgetLibrary={() => setIsWidgetLibraryOpen(true)}
                onOpenAppsLibrary={() => setIsAppsLibraryOpen(true)}
                onOpenPromptsLibrary={() => setIsPromptsLibraryOpen(true)}
                onOpenTemplateSelector={() => setIsTemplateSelectorOpen(true)}
            />

            <MobileNav
                onOpenWidgetLibrary={() => setIsWidgetLibraryOpen(true)}
                onOpenAppsLibrary={() => setIsAppsLibraryOpen(true)}
                onOpenPromptsLibrary={() => setIsPromptsLibraryOpen(true)}
                onOpenTemplateSelector={() => setIsTemplateSelectorOpen(true)}
            />

            <main
                className="flex-1 flex flex-col relative transition-all duration-300"
                style={{
                    marginLeft: sidebarWidth,
                    marginRight: showAICopilot ? RIGHT_SIDEBAR_WIDTH : 0
                }}
            >
                <Header
                    currentSymbol={globalSymbol}
                    onSymbolChange={handleSymbolChange}
                    isEditing={isEditing}
                    onEditToggle={activeDashboard?.isEditable === false ? undefined : handleEditToggle}
                    onAIClick={() => {
                        setCopilotWidgetContext(undefined);
                        setCopilotWidgetData(undefined);
                        setShowAICopilot(!showAICopilot);
                    }}
                    onResetLayout={activeDashboard?.isEditable === false ? undefined : handleResetLayout}
                    onAutoFitLayout={activeDashboard?.isEditable === false ? undefined : handleAutoFitLayout}
                    onCollapseAll={activeDashboard?.isEditable === false ? undefined : handleCollapseAll}
                    onExpandAll={activeDashboard?.isEditable === false ? undefined : handleExpandAll}
                    unitDisplay={unitConfig.display}
                    onUnitDisplayChange={setUnit}
                />

                <TabBar symbol={globalSymbol} />

                <div className="flex-1 p-3 sm:p-4 overflow-hidden bg-[var(--bg-primary)]">
                    {activeDashboard && activeTab ? (
                        <div className="h-full w-full overflow-y-auto scrollbar-hide">
                            {activeTab.widgets.length > 0 ? (
                                <ResponsiveDashboardGrid
                                    layouts={memoizedLayouts}
                                    onLayoutChange={handleLayoutChange}
                                    isEditing={isEditing}
                                    rowHeight={40}
                                    cols={24}
                                >
                                    {activeTab.widgets.map((widget) => {
                                        const widgetType = widget.type;
                                        const WidgetComponent = widgetRegistry[widgetType];
                                        const widgetTitle = getWidgetDefinition(widgetType)?.name ?? widgetType.replace(/_/g, ' ');
                                        const widgetSymbol =
                                            widgetType === 'tradingview_chart' && typeof widget.config?.symbol === 'string'
                                                ? widget.config.symbol
                                                : globalSymbol;
                                        const parameters = getWidgetParameters(widget, (key, value) =>
                                            handleWidgetConfigChange(widget.id, key, value)
                                        );
                                        
                                        return (
                                            <div
                                                key={widget.id}
                                                className="h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] rounded"
                                                data-widget-focus="true"
                                                tabIndex={0}
                                            >
                                                <WidgetWrapper
                                                    id={widget.id}
                                                    title={widgetTitle}
                                                    widgetType={widgetType}
                                                    symbol={widgetSymbol}
                                                    tabId={activeTab.id}
                                                    dashboardId={activeDashboard.id}
                                                    widgetGroup={widget.widgetGroup}
                                                    isEditing={isEditing}
                                                    isCollapsed={Boolean(widget.config?.collapsed)}
                                                    onRemove={activeDashboard.isEditable === false
                                                        ? undefined
                                                        : () => deleteWidget(activeDashboard.id, activeTab.id, widget.id)}
                                                    onSymbolChange={handleSymbolChange}
                                                    onCopilotClick={(context) => {
                                                        const contextName = typeof context?.widgetType === 'string'
                                                            ? context.widgetType
                                                            : widgetType.replace(/_/g, ' ');
                                                        setCopilotWidgetContext(contextName);
                                                        setCopilotWidgetData(context || undefined);
                                                        setShowAICopilot(true);
                                                    }}
                                                    onSettingsClick={() => handleOpenWidgetSettings(widget.id)}
                                                    parameters={parameters}
                                                >
                                                    {WidgetComponent ? (
                                                        <WidgetComponent 
                                                            id={widget.id}
                                                            symbol={widgetSymbol}
                                                            config={widget.config}
                                                        />
                                                    ) : (
                                                        <div className="p-4 text-[var(--text-muted)]">Widget not found: {widgetType}</div>
                                                    )}
                                                </WidgetWrapper>
                                            </div>
                                        );
                                    })}
                                </ResponsiveDashboardGrid>
                            ) : (
                                <div className="mx-auto flex h-full w-full max-w-4xl flex-col items-center justify-center gap-5 px-4 text-center text-[var(--text-secondary)]">
                                    <Grid3X3 size={42} className="opacity-35" />
                                    <div className="space-y-1.5">
                                        <p className="text-lg font-semibold text-[var(--text-primary)]">Start with a suggested layout</p>
                                        <p className="text-sm text-[var(--text-muted)]">Seed this empty tab with a balanced starter, then refine it widget by widget.</p>
                                    </div>

                                    <div className="grid w-full gap-3 md:grid-cols-3">
                                        {starterTemplates.map((template) => (
                                            <button
                                                key={template.id}
                                                onClick={() => handleSeedEmptyTab(template)}
                                                className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]/70 p-4 text-left transition-colors hover:border-blue-500/30 hover:bg-[var(--bg-hover)]"
                                            >
                                                <div className="text-sm font-semibold text-[var(--text-primary)]">{template.name}</div>
                                                <div className="mt-1 text-xs text-[var(--text-muted)]">{template.description}</div>
                                                <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-300/80">
                                                    {template.widgets.slice(0, 3).map((widget) => widget.type.replace(/_/g, ' ')).join(' • ')}
                                                </div>
                                            </button>
                                        ))}
                                    </div>

                                    <div className="flex flex-wrap items-center justify-center gap-2">
                                        {quickAddOptions.map((option) => (
                                            <button
                                                key={option.type}
                                                onClick={() => handleQuickAddWidget(option.type)}
                                                className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>

                                    <button
                                        onClick={() => setIsWidgetLibraryOpen(true)}
                                        className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-500"
                                    >
                                        Open Widget Library
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        state.dashboards.length === 0 ? (
                            <EmptyDashboardState onCreateWorkspace={handleCreateWorkspace} />
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <RefreshCw className="animate-spin text-blue-500" />
                            </div>
                        )
                    )}
                </div>

                <RightSidebar 
                    isOpen={showAICopilot} 
                    onToggle={() => setShowAICopilot(false)}
                    width={RIGHT_SIDEBAR_WIDTH}
                >
                    <AICopilot 
                        isOpen={showAICopilot} 
                        onClose={() => setShowAICopilot(false)} 
                        currentSymbol={globalSymbol}
                        widgetContext={copilotWidgetContext}
                        widgetContextData={copilotWidgetData}
                        activeTabName={activeTab?.name}
                    />
                </RightSidebar>
            </main>

            <WidgetLibrary
                isOpen={isWidgetLibraryOpen}
                onClose={() => setIsWidgetLibraryOpen(false)}
            />
            
            <AppsLibrary
                isOpen={isAppsLibraryOpen}
                onClose={() => setIsAppsLibraryOpen(false)}
            />

            <PromptsLibrary
                isOpen={isPromptsLibraryOpen}
                onClose={() => setIsPromptsLibraryOpen(false)}
            />

            <TemplateSelector
                open={isTemplateSelectorOpen}
                onClose={() => setIsTemplateSelectorOpen(false)}
                onSelectTemplate={handleApplyTemplate}
            />

            <WidgetSettingsModal
                isOpen={Boolean(widgetSettingsState)}
                onClose={() => setWidgetSettingsState(null)}
                widgetId={widgetSettingsState?.widgetId ?? null}
                dashboardId={activeDashboard?.id ?? null}
                tabId={widgetSettingsState?.tabId ?? null}
            />
        </div>
    );
}

function EmptyDashboardState({ onCreateWorkspace }: { onCreateWorkspace: () => void }) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)]/50 px-6 text-center">
            <div className="space-y-2">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">No Dashboard Workspace</h2>
                <p className="text-sm text-[var(--text-muted)]">
                    Create a workspace to start adding widgets and building your layout.
                </p>
            </div>
            <button
                onClick={onCreateWorkspace}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
            >
                <PlusCircle size={16} />
                Create Workspace
            </button>
        </div>
    );
}
