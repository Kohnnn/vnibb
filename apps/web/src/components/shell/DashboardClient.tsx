// Main Dashboard Page with OpenBB-style Tabs and Dynamic Dashboard Context

'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Sidebar, Header, TabBar, RightSidebar, MobileNav } from '@/components/layout';
import { ResponsiveDashboardGrid, type LayoutItem } from '@/components/layout/DashboardGrid';
import { useDashboard } from '@/contexts/DashboardContext';
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
import { defaultWidgetLayouts } from '@/components/widgets/WidgetRegistry';
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
import { CommandPalette, useCommandPalette } from '@/components/ui/CommandPalette';
import { AICopilot } from '@/components/ui/AICopilot';
import { MarketRibbon } from '@/components/ui/MarketRibbon';
import { useWidgetGroups } from '@/contexts/WidgetGroupContext';
import { useSymbolLink } from '@/contexts/SymbolLinkContext';
import { useUnit } from '@/contexts/UnitContext';
import type { WidgetInstance, WidgetType, WidgetConfig } from '@/types/dashboard';
import type { DashboardTemplate } from '@/types/dashboard-templates';

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
        activeDashboard,
        activeTab,
        setActiveTab,
        updateSyncGroupSymbol,
        deleteWidget,
        updateTabLayout,
        updateWidget,
        resetTabLayout,
        addWidget
    } = useDashboard();

    const { setGlobalSymbol: setContextGlobalSymbol } = useWidgetGroups();
    const { globalSymbol, setGlobalSymbol } = useSymbolLink();
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
            if (isEditableTarget(event.target)) return;

            if (event.key === 'Escape') {
                setIsWidgetLibraryOpen(false);
                setIsAppsLibraryOpen(false);
                setIsPromptsLibraryOpen(false);
                setIsTemplateSelectorOpen(false);
                setWidgetSettingsState(null);
                setShowAICopilot(false);
                return;
            }

            if (!event.metaKey && !event.ctrlKey && !event.altKey) {
                const numeric = Number(event.key);
                if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 9 && activeDashboard?.tabs?.length) {
                    const orderedTabs = [...activeDashboard.tabs].sort((a, b) => a.order - b.order);
                    const nextTab = orderedTabs[numeric - 1];
                    if (nextTab) {
                        event.preventDefault();
                        setActiveTab(nextTab.id);
                    }
                    return;
                }

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
    }, [activeDashboard?.tabs, activeTab?.widgets, mounted, setActiveTab]);

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
    }, [activeDashboard, updateSyncGroupSymbol, setGlobalSymbol, setContextGlobalSymbol]);

    const handleEditToggle = useCallback(() => {
        setIsEditing((prev) => !prev);
    }, []);

    const handleResetLayout = useCallback(() => {
        if (activeDashboard && activeTab) {
            resetTabLayout(activeDashboard.id, activeTab.id);
        }
    }, [activeDashboard, activeTab, resetTabLayout]);

    const handleAutoFitLayout = useCallback(() => {
        if (!activeDashboard || !activeTab) return;

        const cols = 24;
        const columnHeights = new Array(cols).fill(0);

        const findBestPosition = (width: number) => {
            let bestX = 0;
            let bestY = Number.MAX_SAFE_INTEGER;

            for (let x = 0; x <= cols - width; x += 1) {
                const candidateY = Math.max(...columnHeights.slice(x, x + width));
                if (candidateY < bestY) {
                    bestY = candidateY;
                    bestX = x;
                }
            }

            return { x: bestX, y: bestY };
        };

        const updatedWidgets = activeTab.widgets.map((widget) => {
            const defaults = defaultWidgetLayouts[widget.type as WidgetType] || { w: 6, h: 4, minW: 3, minH: 2 };
            const minW = defaults.minW ?? widget.layout.minW ?? 3;
            const minH = defaults.minH ?? widget.layout.minH ?? 2;
            const width = Math.min(Math.max(widget.layout.w || defaults.w || 6, minW), cols);
            const height = Math.max(widget.layout.h || defaults.h || 4, minH);
            const { x, y } = findBestPosition(width);

            for (let col = x; col < x + width; col += 1) {
                columnHeights[col] = y + height;
            }

            const nextLayout = {
                ...widget.layout,
                x,
                y,
                w: width,
                h: height,
                minW,
                minH,
            };

            return { ...widget, layout: nextLayout };
        });

        updateTabLayout(activeDashboard.id, activeTab.id, updatedWidgets);
    }, [activeDashboard, activeTab, updateTabLayout]);

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
        if (!activeDashboard || !activeTab) return;
        
        // Clear existing widgets and add template ones
        // In a real app we might want to ask confirmation
        template.widgets.forEach(w => {
            addWidget(activeDashboard.id, activeTab.id, {
                type: w.type,
                tabId: activeTab.id,
                layout: w.layout,
                config: w.config || {}
            });
        });
    }, [activeDashboard, activeTab, addWidget]);

    const quickAddOptions: Array<{ type: WidgetType; label: string }> = [
        { type: 'price_chart', label: 'Price Chart' },
        { type: 'key_metrics', label: 'Key Metrics' },
        { type: 'screener', label: 'Screener' },
    ];

    const handleQuickAddWidget = useCallback((type: WidgetType) => {
        if (!activeDashboard || !activeTab) return;

        const defaults = defaultWidgetLayouts[type] || { w: 6, h: 4 };
        const nextY = activeTab.widgets.reduce(
            (maxY, widget) => Math.max(maxY, widget.layout.y + widget.layout.h),
            0,
        );

        addWidget(activeDashboard.id, activeTab.id, {
            type,
            tabId: activeTab.id,
            layout: {
                x: 0,
                y: nextY,
                w: defaults.w,
                h: defaults.h,
                minW: defaults.minW,
                minH: defaults.minH,
            },
        });
    }, [activeDashboard, activeTab, addWidget]);

    const memoizedLayouts = useMemo(() => {
        if (!activeTab?.widgets) return [];

        const compactHeights: Partial<Record<WidgetType, number>> = {
            income_statement: 5,
            balance_sheet: 5,
            cash_flow: 5,
            financial_ratios: 5,
            comparison_analysis: 8,
        };

        return activeTab.widgets.map(w => ({
            ...w.layout,
            i: w.id,
            h: !isEditing && compactHeights[w.type]
                ? Math.min(w.layout.h, compactHeights[w.type] as number)
                : w.layout.h,
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
                <MarketRibbon />

                <Header
                    currentSymbol={globalSymbol}
                    onSymbolChange={handleSymbolChange}
                    isEditing={isEditing}
                    onEditToggle={handleEditToggle}
                    onAIClick={() => {
                        setCopilotWidgetContext(undefined);
                        setCopilotWidgetData(undefined);
                        setShowAICopilot(!showAICopilot);
                    }}
                    onResetLayout={handleResetLayout}
                    onAutoFitLayout={handleAutoFitLayout}
                    onCollapseAll={handleCollapseAll}
                    onExpandAll={handleExpandAll}
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
                                    rowHeight={60}
                                    cols={24}
                                >
                                    {activeTab.widgets.map((widget) => {
                                        const widgetType = widget.type;
                                        const WidgetComponent = widgetRegistry[widgetType];
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
                                                    title={widgetType.replace(/_/g, ' ')}
                                                    symbol={globalSymbol}
                                                    tabId={activeTab.id}
                                                    dashboardId={activeDashboard.id}
                                                    widgetGroup={widget.widgetGroup}
                                                    isEditing={isEditing}
                                                    isCollapsed={Boolean(widget.config?.collapsed)}
                                                    onRemove={() => deleteWidget(activeDashboard.id, activeTab.id, widget.id)}
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
                                                            symbol={globalSymbol}
                                                        />
                                                    ) : (
                                                        <div className="p-4 text-gray-500">Widget not found: {widgetType}</div>
                                                    )}
                                                </WidgetWrapper>
                                            </div>
                                        );
                                    })}
                                </ResponsiveDashboardGrid>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-[var(--text-secondary)] space-y-4 px-4 text-center">
                                    <Grid3X3 size={48} className="opacity-30" />
                                    <div className="space-y-1">
                                        <p className="font-medium text-[var(--text-primary)]">This tab is empty</p>
                                        <p className="text-sm text-[var(--text-muted)]">Add your first widget or open the full library.</p>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-center gap-2">
                                        {quickAddOptions.map((option) => (
                                            <button
                                                key={option.type}
                                                onClick={() => handleQuickAddWidget(option.type)}
                                                className="px-3 py-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => setIsWidgetLibraryOpen(true)}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
                                    >
                                        Open Widget Library
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full">
                            <RefreshCw className="animate-spin text-blue-500" />
                        </div>
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

import { Grid3X3, RefreshCw } from 'lucide-react';
