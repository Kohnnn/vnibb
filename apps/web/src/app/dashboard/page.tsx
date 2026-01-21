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
        updateSyncGroupSymbol,
        deleteWidget,
        updateTabLayout,
        updateWidget,
        resetTabLayout,
        addWidget
    } = useDashboard();

    const { setGlobalSymbol: setContextGlobalSymbol } = useWidgetGroups();
    const { globalSymbol, setGlobalSymbol } = useSymbolLink();

    const [isEditing, setIsEditing] = useState(false);
    const [isWidgetLibraryOpen, setIsWidgetLibraryOpen] = useState(false);
    const [isAppsLibraryOpen, setIsAppsLibraryOpen] = useState(false);
    const [isPromptsLibraryOpen, setIsPromptsLibraryOpen] = useState(false);
    const [isTemplateSelectorOpen, setIsTemplateSelectorOpen] = useState(false);
    const [showAICopilot, setShowAICopilot] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(208);
    const [mounted, setMounted] = useState(false);

    const updateSidebarWidth = useCallback(() => {
        if (typeof window !== 'undefined') {
            const sidebar = document.querySelector('aside');
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

    const memoizedLayouts = useMemo(() => {
        if (!activeTab?.widgets) return [];
        return activeTab.widgets.map(w => ({
            ...w.layout,
            i: w.id,
            minW: w.layout.minW ?? 4,
            minH: w.layout.minH ?? 3,
        }));
    }, [activeTab?.widgets]);

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
        <div className="flex min-h-screen bg-black text-white overflow-hidden">
            <Sidebar
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
                    onAIClick={() => setShowAICopilot(!showAICopilot)}
                    onResetLayout={handleResetLayout}
                />

                <TabBar symbol={globalSymbol} />

                <div className="flex-1 p-4 overflow-hidden bg-[#0a0a0a]">
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
                                        
                                        return (
                                            <div key={widget.id} className="h-full">
                                                <WidgetWrapper
                                                    id={widget.id}
                                                    title={widgetType.replace(/_/g, ' ')}
                                                    symbol={globalSymbol}
                                                    tabId={activeTab.id}
                                                    dashboardId={activeDashboard.id}
                                                    isEditing={isEditing}
                                                    onRemove={() => deleteWidget(activeDashboard.id, activeTab.id, widget.id)}
                                                    onSymbolChange={handleSymbolChange}
                                                    onCopilotClick={() => setShowAICopilot(true)}
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
                                <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4">
                                    <Grid3X3 size={48} className="opacity-20" />
                                    <p>Dashboard is empty. Add widgets from the sidebar.</p>
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
        </div>
    );
}

import { Grid3X3, RefreshCw } from 'lucide-react';
