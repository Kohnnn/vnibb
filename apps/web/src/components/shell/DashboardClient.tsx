// Main Dashboard Page with OpenBB-style Tabs and Dynamic Dashboard Context

'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Sidebar, Header, TabBar, RightSidebar, MobileNav } from '@/components/layout';
import { OnboardingWalkthrough } from '@/components/onboarding/OnboardingWalkthrough';
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
import { WidgetSettingsModal, AppsLibrary, TemplateSelector } from '@/components/modals';
import { AICopilot } from '@/components/ui/AICopilot';
import { useGlobalMarketsSymbol } from '@/contexts/GlobalMarketsSymbolContext';
import { isTradingViewWidget, usesTradingViewWidgetSymbol } from '@/lib/tradingViewWidgets';
import { useWidgetGroups } from '@/contexts/WidgetGroupContext';
import { useSymbolLink } from '@/contexts/SymbolLinkContext';
import { useUnit } from '@/contexts/UnitContext';
import { autoFitGridItems, findNextAvailableLayout, getWidgetDefaultLayout } from '@/lib/dashboardLayout';
import { analyzeDashboardTab } from '@/lib/dashboardIntelligence';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import {
    readAdminLayoutControlsVisible,
    readAdminLayoutKey,
    subscribeAdminLayoutKey,
} from '@/lib/adminLayoutAccess';
import { saveAdminSystemDashboardTemplate } from '@/lib/api';
import { getWidgetDefinition } from '@/data/widgetDefinitions';
import {
    DASHBOARD_WALKTHROUGH_RESTART_EVENT,
    markDashboardWalkthroughCompleted,
    shouldShowDashboardWalkthrough,
} from '@/lib/userPreferences';
import type { WidgetInstance, WidgetType, WidgetConfig } from '@/types/dashboard';
import { DASHBOARD_TEMPLATES, type DashboardTemplate } from '@/types/dashboard-templates';
import { AlertCircle, Grid3X3, PlusCircle, RefreshCw, Shield } from 'lucide-react';

export default function DashboardPage() {
    return (
        <ProtectedRoute>
            <DashboardContent />
        </ProtectedRoute>
    );
}

const LEFT_SIDEBAR_DEFAULT_WIDTH = 248;
const LEFT_SIDEBAR_COLLAPSED_WIDTH = 56;
const LEFT_SIDEBAR_MIN_WIDTH = 180;
const LEFT_SIDEBAR_MAX_WIDTH = 320;
const RIGHT_SIDEBAR_DEFAULT_WIDTH = 360;
const RIGHT_SIDEBAR_MIN_WIDTH = 300;
const RIGHT_SIDEBAR_MAX_WIDTH = 480;
const LEFT_SIDEBAR_STORAGE_KEY = 'vnibb-left-sidebar-width';
const RIGHT_SIDEBAR_STORAGE_KEY = 'vnibb-right-sidebar-width';
const MAIN_FUNDAMENTAL_DASHBOARD_ID = 'default-fundamental';
const TECHNICAL_DASHBOARD_ID = 'default-technical';
const QUANT_DASHBOARD_ID = 'default-quant';
const GLOBAL_MARKETS_DASHBOARD_ID = 'default-global-markets';
const FUNDAMENTALS_TAB_NAME = 'Fundamentals';
const FUNDAMENTALS_PERIOD_SYNC_GROUP = 'fundamental-core';
const ADMIN_MANAGED_SYSTEM_IDS = new Set([
    MAIN_FUNDAMENTAL_DASHBOARD_ID,
    TECHNICAL_DASHBOARD_ID,
    QUANT_DASHBOARD_ID,
    GLOBAL_MARKETS_DASHBOARD_ID,
]);

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
        addWidget,
        setDashboardAdminUnlocked,
    } = useDashboard();

    const { setGlobalSymbol: setContextGlobalSymbol } = useWidgetGroups();
    const { globalSymbol: stockGlobalSymbol, setGlobalSymbol: setStockGlobalSymbol } = useSymbolLink();
    const { globalMarketsSymbol, setGlobalMarketsSymbol } = useGlobalMarketsSymbol();
    const { config: unitConfig, setUnit } = useUnit();

    const [isEditing, setIsEditing] = useState(false);
    const [isWidgetLibraryOpen, setIsWidgetLibraryOpen] = useState(false);
    const [isAppsLibraryOpen, setIsAppsLibraryOpen] = useState(false);
    const [isTemplateSelectorOpen, setIsTemplateSelectorOpen] = useState(false);
    const [showAICopilot, setShowAICopilot] = useState(false);
    const [copilotWidgetContext, setCopilotWidgetContext] = useState<string | undefined>(undefined);
    const [copilotWidgetData, setCopilotWidgetData] = useState<Record<string, unknown> | undefined>(undefined);
    const [copilotPromptLibraryRequestId, setCopilotPromptLibraryRequestId] = useState(0);
    const [sidebarWidth, setSidebarWidth] = useState(LEFT_SIDEBAR_DEFAULT_WIDTH);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [rightSidebarWidth, setRightSidebarWidth] = useState(RIGHT_SIDEBAR_DEFAULT_WIDTH);
    const [viewportWidth, setViewportWidth] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const [mounted, setMounted] = useState(false);
    const [isWalkthroughOpen, setIsWalkthroughOpen] = useState(false);
    const [adminLayoutKey, setAdminLayoutKey] = useState('');
    const [adminLayoutControlsVisible, setAdminLayoutControlsVisible] = useState(false);
    const [adminLayoutStatus, setAdminLayoutStatus] = useState<string | null>(null);
    const [isPublishingSystemLayout, setIsPublishingSystemLayout] = useState(false);
    const [draggingPane, setDraggingPane] = useState<'left' | 'right' | null>(null);
    const [widgetSettingsState, setWidgetSettingsState] = useState<{
        widgetId: string;
        tabId: string;
    } | null>(null);
    const autoWalkthroughQueuedRef = useRef(false);
    const dragStateRef = useRef<{ pane: 'left' | 'right' | null; startX: number; startWidth: number }>({
        pane: null,
        startX: 0,
        startWidth: 0,
    });

    const starterTemplates = useMemo(() => {
        const preferredIds = ['getting-started', 'fundamental-analyst', 'global-markets', 'earnings-season'];
        return preferredIds
            .map((id) => DASHBOARD_TEMPLATES.find((template) => template.id === id))
            .filter((template): template is DashboardTemplate => Boolean(template));
    }, []);

    const updateViewport = useCallback(() => {
        if (typeof window !== 'undefined') {
            setViewportWidth(window.innerWidth);
            setViewportHeight(window.innerHeight);
        }
    }, []);

    const effectiveLeftSidebarWidth = viewportWidth < 1024
        ? 0
        : (isSidebarCollapsed ? LEFT_SIDEBAR_COLLAPSED_WIDTH : sidebarWidth);

    const overlayAICopilot = viewportWidth > 0 && (viewportWidth < 1480 || viewportHeight < 840);
    const effectiveRightSidebarWidth = overlayAICopilot
        ? Math.min(rightSidebarWidth, Math.max(280, viewportWidth - 24))
        : rightSidebarWidth;

    useEffect(() => {
        setMounted(true);
        updateViewport();

        if (typeof window !== 'undefined') {
            const storedLeftWidth = Number(window.localStorage.getItem(LEFT_SIDEBAR_STORAGE_KEY));
            const storedRightWidth = Number(window.localStorage.getItem(RIGHT_SIDEBAR_STORAGE_KEY));
            if (Number.isFinite(storedLeftWidth) && storedLeftWidth >= LEFT_SIDEBAR_MIN_WIDTH && storedLeftWidth <= LEFT_SIDEBAR_MAX_WIDTH) {
                setSidebarWidth(storedLeftWidth);
            }
            if (Number.isFinite(storedRightWidth) && storedRightWidth >= RIGHT_SIDEBAR_MIN_WIDTH && storedRightWidth <= RIGHT_SIDEBAR_MAX_WIDTH) {
                setRightSidebarWidth(storedRightWidth);
            }
        }

        window.addEventListener('resize', updateViewport);
        return () => window.removeEventListener('resize', updateViewport);
    }, [updateViewport]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(LEFT_SIDEBAR_STORAGE_KEY, String(sidebarWidth));
    }, [sidebarWidth]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(RIGHT_SIDEBAR_STORAGE_KEY, String(rightSidebarWidth));
    }, [rightSidebarWidth]);

    const beginPaneResize = useCallback((pane: 'left' | 'right', clientX: number) => {
        dragStateRef.current = {
            pane,
            startX: clientX,
            startWidth: pane === 'left' ? sidebarWidth : rightSidebarWidth,
        };
        setDraggingPane(pane);
    }, [rightSidebarWidth, sidebarWidth]);

    useEffect(() => {
        if (!draggingPane) return;

        const handlePointerMove = (event: PointerEvent) => {
            const { pane, startWidth, startX } = dragStateRef.current;
            if (!pane) return;

            if (pane === 'left') {
                const nextWidth = startWidth + (event.clientX - startX);
                const clamped = Math.max(LEFT_SIDEBAR_MIN_WIDTH, Math.min(LEFT_SIDEBAR_MAX_WIDTH, nextWidth));
                setSidebarWidth(clamped);
                return;
            }

            const nextWidth = startWidth - (event.clientX - startX);
            const clamped = Math.max(RIGHT_SIDEBAR_MIN_WIDTH, Math.min(RIGHT_SIDEBAR_MAX_WIDTH, nextWidth));
            setRightSidebarWidth(clamped);
        };

        const handlePointerUp = () => {
            dragStateRef.current = { pane: null, startX: 0, startWidth: 0 };
            setDraggingPane(null);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);

        return () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [draggingPane]);

    useEffect(() => {
        if (!mounted) return;
        const syncAdminKey = () => {
            setAdminLayoutKey(readAdminLayoutKey());
            setAdminLayoutControlsVisible(readAdminLayoutControlsVisible());
        };
        syncAdminKey();
        return subscribeAdminLayoutKey(syncAdminKey);
    }, [mounted]);

    useEffect(() => {
        if (!adminLayoutStatus) return;
        const timeoutId = window.setTimeout(() => setAdminLayoutStatus(null), 2600);
        return () => window.clearTimeout(timeoutId);
    }, [adminLayoutStatus]);

    useEffect(() => {
        if (!activeDashboard || !ADMIN_MANAGED_SYSTEM_IDS.has(activeDashboard.id)) return;
        if (adminLayoutControlsVisible) return;
        if (activeDashboard.adminUnlocked !== true && !isEditing) return;
        setDashboardAdminUnlocked(activeDashboard.id, false);
        setIsEditing(false);
    }, [activeDashboard, adminLayoutControlsVisible, isEditing, setDashboardAdminUnlocked]);

    const openWalkthrough = useCallback((force = false) => {
        if (!mounted || effectiveLeftSidebarWidth === 0) {
            return;
        }

        if (!force && !shouldShowDashboardWalkthrough()) {
            return;
        }

        setIsWidgetLibraryOpen(false);
        setIsAppsLibraryOpen(false);
        setIsTemplateSelectorOpen(false);
        setWidgetSettingsState(null);
        setShowAICopilot(false);
        setIsWalkthroughOpen(true);
        captureAnalyticsEvent(ANALYTICS_EVENTS.onboardingWalkthroughStarted, {
            source: force ? 'manual_restart' : 'auto',
            dashboard_id: activeDashboard?.id,
            tab_id: activeTab?.id,
        });
    }, [activeDashboard?.id, activeTab?.id, effectiveLeftSidebarWidth, mounted]);

    const closeWalkthrough = useCallback(() => {
        markDashboardWalkthroughCompleted();
        setIsWalkthroughOpen(false);
        captureAnalyticsEvent(ANALYTICS_EVENTS.onboardingWalkthroughCompleted, {
            dashboard_id: activeDashboard?.id,
            tab_id: activeTab?.id,
        });
    }, [activeDashboard?.id, activeTab?.id]);

    const openCopilot = useCallback((
        source: string,
        contextName?: string,
        contextData?: Record<string, unknown>,
    ) => {
        setCopilotWidgetContext(contextName);
        setCopilotWidgetData(contextData);
        setShowAICopilot(true);
        captureAnalyticsEvent(ANALYTICS_EVENTS.copilotOpened, {
            source,
            symbol: stockGlobalSymbol,
            dashboard_id: activeDashboard?.id,
            tab_id: activeTab?.id,
            tab_name: activeTab?.name,
            widget_context: contextName,
            widget_type_key: typeof contextData?.widgetTypeKey === 'string' ? contextData.widgetTypeKey : undefined,
        });
    }, [activeDashboard?.id, activeTab?.id, activeTab?.name, stockGlobalSymbol]);

    const handleOpenGlobalPrompts = useCallback(() => {
        openCopilot('global_prompts');
        setCopilotPromptLibraryRequestId((current) => current + 1);
    }, [openCopilot]);

    useEffect(() => {
        if (
            !mounted ||
            effectiveLeftSidebarWidth === 0 ||
            !activeDashboard ||
            !activeTab ||
            autoWalkthroughQueuedRef.current ||
            !shouldShowDashboardWalkthrough()
        ) {
            return;
        }

        autoWalkthroughQueuedRef.current = true;

        const timeoutId = window.setTimeout(() => {
            window.requestAnimationFrame(() => {
                openWalkthrough();
            });
        }, 240);

        return () => window.clearTimeout(timeoutId);
    }, [activeDashboard, activeTab, effectiveLeftSidebarWidth, mounted, openWalkthrough]);

    useEffect(() => {
        const handleRestartWalkthrough = () => {
            if (!mounted || effectiveLeftSidebarWidth === 0 || !activeDashboard || !activeTab) {
                return;
            }

            window.requestAnimationFrame(() => {
                openWalkthrough(true);
            });
        };

        window.addEventListener(DASHBOARD_WALKTHROUGH_RESTART_EVENT, handleRestartWalkthrough);
        return () => {
            window.removeEventListener(DASHBOARD_WALKTHROUGH_RESTART_EVENT, handleRestartWalkthrough);
        };
    }, [activeDashboard, activeTab, effectiveLeftSidebarWidth, mounted, openWalkthrough]);

    const applySelectedSymbol = useCallback((rawSymbol: string) => {
        const normalizedSymbol = rawSymbol.trim().toUpperCase();
        if (!normalizedSymbol) return;

        if (normalizedSymbol !== stockGlobalSymbol) {
            captureAnalyticsEvent(ANALYTICS_EVENTS.symbolChanged, {
                from_symbol: stockGlobalSymbol,
                to_symbol: normalizedSymbol,
                dashboard_id: activeDashboard?.id,
                tab_id: activeTab?.id,
            });
        }

        setStockGlobalSymbol(normalizedSymbol);
        setContextGlobalSymbol(normalizedSymbol);
        setGlobalMarketsSymbol(normalizedSymbol);
        if (activeDashboard) {
            updateSyncGroupSymbol(activeDashboard.id, 1, normalizedSymbol);
        }
    }, [activeDashboard, activeTab?.id, setContextGlobalSymbol, setGlobalMarketsSymbol, setStockGlobalSymbol, stockGlobalSymbol, updateSyncGroupSymbol]);

    const isSystemFundamentalsTab =
        activeDashboard?.id === MAIN_FUNDAMENTAL_DASHBOARD_ID &&
        activeTab?.name === FUNDAMENTALS_TAB_NAME;
    const sharedFundamentalPeriodKey = isSystemFundamentalsTab
        ? `${FUNDAMENTALS_PERIOD_SYNC_GROUP}:${stockGlobalSymbol.toUpperCase()}`
        : undefined;
    const { period: sharedFundamentalPeriod, setPeriod: setSharedFundamentalPeriod } = usePeriodState({
        widgetId: `dashboard-period-${activeDashboard?.id ?? 'none'}-${activeTab?.id ?? 'none'}`,
        defaultPeriod: 'FY',
        validPeriods: ['FY', 'Q', 'TTM'],
        sharedKey: sharedFundamentalPeriodKey,
    });
    const isAdminManagedSystemDashboard = Boolean(
        activeDashboard && ADMIN_MANAGED_SYSTEM_IDS.has(activeDashboard.id),
    );
    const showAdminSystemLayoutControls =
        isAdminManagedSystemDashboard &&
        adminLayoutControlsVisible &&
        adminLayoutKey.trim().length > 0;

    const serializeSystemDashboardForPublish = useCallback((dashboard: typeof activeDashboard) => {
        if (!dashboard) return null;
        return {
            id: dashboard.id,
            name: dashboard.name,
            description: dashboard.description,
            globalMarketsSymbol: dashboard.globalMarketsSymbol,
            folderId: dashboard.folderId,
            order: dashboard.order,
            isDefault: dashboard.isDefault,
            isEditable: false,
            isDeletable: false,
            showGroupLabels: dashboard.showGroupLabels,
            tabs: dashboard.tabs.map((tab) => ({
                id: tab.id,
                name: tab.name,
                order: tab.order,
                widgets: tab.widgets.map((widget) => {
                    const defaults = getWidgetDefaultLayout(widget.type);
                    const cleanConfig = Object.fromEntries(
                        Object.entries(widget.config || {}).filter(([, value]) => value !== undefined)
                    );
                    return {
                        id: widget.id,
                        type: widget.type,
                        tabId: widget.tabId,
                        syncGroupId: widget.syncGroupId,
                        widgetGroup: widget.widgetGroup,
                        config: cleanConfig,
                        layout: {
                            i: widget.id,
                            x: Number.isFinite(widget.layout.x) ? widget.layout.x : 0,
                            y: Number.isFinite(widget.layout.y) ? widget.layout.y : 0,
                            w: Number.isFinite(widget.layout.w) ? widget.layout.w : defaults.w,
                            h: Number.isFinite(widget.layout.h) ? widget.layout.h : defaults.h,
                            minW: Number.isFinite(widget.layout.minW) ? widget.layout.minW : defaults.minW,
                            minH: Number.isFinite(widget.layout.minH) ? widget.layout.minH : defaults.minH,
                            maxW: Number.isFinite(widget.layout.maxW) ? widget.layout.maxW : undefined,
                            maxH: Number.isFinite(widget.layout.maxH) ? widget.layout.maxH : undefined,
                            static: widget.layout.static === true ? true : undefined,
                        },
                    };
                }),
            })),
            syncGroups: dashboard.syncGroups.map((group) => ({
                id: group.id,
                name: group.name,
                color: group.color,
                currentSymbol: group.currentSymbol,
            })),
            createdAt: dashboard.createdAt,
            updatedAt: new Date().toISOString(),
        };
    }, []);

    const handleToggleAdminLayoutMode = useCallback(() => {
        if (!activeDashboard || !isAdminManagedSystemDashboard) return;
        const nextUnlocked = activeDashboard.adminUnlocked !== true;
        setDashboardAdminUnlocked(activeDashboard.id, nextUnlocked);
        setIsEditing(nextUnlocked);
        setAdminLayoutStatus(nextUnlocked ? 'Admin layout mode enabled.' : 'Admin layout mode disabled.');
    }, [activeDashboard, isAdminManagedSystemDashboard, setDashboardAdminUnlocked]);

    const handlePersistSystemLayout = useCallback(async (publish: boolean) => {
        if (!activeDashboard || !isAdminManagedSystemDashboard || !adminLayoutKey) {
            setAdminLayoutStatus('Save an admin layout key in Settings before publishing global layouts.');
            return;
        }
        const payloadDashboard = serializeSystemDashboardForPublish(activeDashboard);
        if (!payloadDashboard) return;

        try {
            setIsPublishingSystemLayout(true);
            await saveAdminSystemDashboardTemplate(
                activeDashboard.id,
                {
                    dashboard: payloadDashboard,
                    publish,
                },
                adminLayoutKey,
            );
            setDashboardAdminUnlocked(activeDashboard.id, false);
            setIsEditing(false);
            setAdminLayoutStatus(publish ? 'Published globally.' : 'Draft saved.');
        } catch (error) {
            console.error('Failed to persist system layout template:', error);
            setAdminLayoutStatus(
                error instanceof Error ? error.message : 'Failed to persist system layout.',
            );
        } finally {
            setIsPublishingSystemLayout(false);
        }
    }, [activeDashboard, adminLayoutKey, isAdminManagedSystemDashboard, serializeSystemDashboardForPublish, setDashboardAdminUnlocked]);

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
        applySelectedSymbol(symbol);
    }, [applySelectedSymbol]);

    const canEditCurrentDashboard = (activeDashboard?.adminUnlocked === true) || activeDashboard?.isEditable !== false;

    const handleEditToggle = useCallback(() => {
        if (!canEditCurrentDashboard) {
            return;
        }
        const nextEditing = !isEditing;
        setIsEditing(nextEditing);
        captureAnalyticsEvent(ANALYTICS_EVENTS.layoutAction, {
            action: 'toggle_edit',
            enabled: nextEditing,
            dashboard_id: activeDashboard?.id,
            tab_id: activeTab?.id,
        });
    }, [activeDashboard?.id, activeTab?.id, canEditCurrentDashboard, isEditing]);

    useEffect(() => {
        if (!canEditCurrentDashboard && isEditing) {
            setIsEditing(false);
        }
    }, [activeDashboard?.id, canEditCurrentDashboard, isEditing]);

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
            captureAnalyticsEvent(ANALYTICS_EVENTS.layoutAction, {
                action: 'reset',
                dashboard_id: activeDashboard.id,
                tab_id: activeTab.id,
                widget_count: activeTab.widgets.length,
            });
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
        captureAnalyticsEvent(ANALYTICS_EVENTS.layoutAction, {
            action: 'autofit',
            dashboard_id: activeDashboard.id,
            tab_count: activeDashboard.tabs.length,
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
        captureAnalyticsEvent(ANALYTICS_EVENTS.layoutAction, {
            action: 'collapse_all',
            dashboard_id: activeDashboard.id,
            tab_id: activeTab.id,
            widget_count: activeTab.widgets.length,
        });
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
        captureAnalyticsEvent(ANALYTICS_EVENTS.layoutAction, {
            action: 'expand_all',
            dashboard_id: activeDashboard.id,
            tab_id: activeTab.id,
            widget_count: activeTab.widgets.length,
        });
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
        const widget = activeTab.widgets.find((item) => item.id === widgetId);
        captureAnalyticsEvent(ANALYTICS_EVENTS.widgetSettingsOpened, {
            dashboard_id: activeDashboard?.id,
            tab_id: activeTab.id,
            widget_id: widgetId,
            widget_type: widget?.type,
        });
    }, [activeDashboard?.id, activeTab]);

    const handleApplyTemplate = useCallback((template: DashboardTemplate) => {
        if (!activeDashboard || !activeTab || !canEditCurrentDashboard) return;

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
        captureAnalyticsEvent(ANALYTICS_EVENTS.workspaceTemplateApplied, {
            source: 'template_selector',
            template_id: template.id,
            template_name: template.name,
            template_category: template.category,
            dashboard_id: activeDashboard.id,
            tab_id: tab.id,
            widget_count: template.widgets.length,
        });
    }, [activeDashboard, activeTab, addWidget, canEditCurrentDashboard, createTab, setActiveTab]);

    const handleSeedEmptyTab = useCallback((template: DashboardTemplate) => {
        if (!activeDashboard || !activeTab || !canEditCurrentDashboard || activeTab.widgets.length > 0) return;

        template.widgets.forEach((widget) => {
            addWidget(activeDashboard.id, activeTab.id, {
                type: widget.type,
                tabId: activeTab.id,
                layout: widget.layout,
                config: widget.config || {},
            });
        });
        captureAnalyticsEvent(ANALYTICS_EVENTS.workspaceTemplateApplied, {
            source: 'empty_tab_seed',
            template_id: template.id,
            template_name: template.name,
            template_category: template.category,
            dashboard_id: activeDashboard.id,
            tab_id: activeTab.id,
            widget_count: template.widgets.length,
        });
    }, [activeDashboard, activeTab, addWidget, canEditCurrentDashboard]);

    const handleCreateWorkspace = useCallback(() => {
        const dashboard = createDashboard({ name: 'Workspace 1' });
        setActiveDashboard(dashboard.id);
    }, [createDashboard, setActiveDashboard]);

    const quickAddOptions: Array<{ type: WidgetType; label: string }> = [
        { type: 'price_chart', label: 'Price Chart' },
        { type: 'tradingview_chart', label: 'TradingView Chart' },
        { type: 'tradingview_ticker_tape', label: 'Ticker Tape' },
        { type: 'tradingview_technical_analysis', label: 'TV Technicals' },
        { type: 'key_metrics', label: 'Key Metrics' },
        { type: 'screener', label: 'Screener' },
    ];

    const handleQuickAddWidget = useCallback((type: WidgetType) => {
        if (!activeDashboard || !activeTab || !canEditCurrentDashboard) return;

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
    }, [activeDashboard, activeTab, addWidget, canEditCurrentDashboard]);

    const memoizedLayouts = useMemo(() => {
        if (!activeTab?.widgets) return [];

        return activeTab.widgets.map(w => ({
            ...w.layout,
            i: w.id,
            minW: w.layout.minW ?? 4,
            minH: w.layout.minH ?? 3,
        }));
    }, [activeTab?.widgets, isEditing]);

    const activeTabIntelligence = useMemo(
        () => analyzeDashboardTab(activeTab?.widgets || []),
        [activeTab?.widgets]
    );

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
        <div aria-label="Dashboard workspace" className="flex h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
            <div
                className={`hidden lg:flex h-screen shrink-0 ${draggingPane === 'left' ? 'transition-none' : 'transition-[width] duration-150 ease-out'}`}
                style={{ width: effectiveLeftSidebarWidth }}
            >
                <Sidebar
                    onOpenWidgetLibrary={() => setIsWidgetLibraryOpen(true)}
                    onOpenAppsLibrary={() => setIsAppsLibraryOpen(true)}
                    onOpenPromptsLibrary={handleOpenGlobalPrompts}
                    onOpenTemplateSelector={() => setIsTemplateSelectorOpen(true)}
                    collapsed={isSidebarCollapsed}
                    onCollapsedChange={setIsSidebarCollapsed}
                />
            </div>

            {!isSidebarCollapsed && effectiveLeftSidebarWidth > 0 ? (
                <div
                    className="hidden lg:block h-screen w-[4px] shrink-0 cursor-col-resize bg-[var(--bg-secondary)] hover:bg-blue-500/30"
                    onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        beginPaneResize('left', event.clientX);
                    }}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize workspace sidebar"
                />
            ) : null}

            <MobileNav
                onOpenWidgetLibrary={() => setIsWidgetLibraryOpen(true)}
                onOpenAppsLibrary={() => setIsAppsLibraryOpen(true)}
                onOpenPromptsLibrary={handleOpenGlobalPrompts}
                onOpenTemplateSelector={() => setIsTemplateSelectorOpen(true)}
            />

            <main className="flex-1 min-w-0 flex flex-col relative overflow-hidden">
                <Header
                    currentSymbol={stockGlobalSymbol}
                    isEditing={isEditing}
                    onEditToggle={canEditCurrentDashboard ? handleEditToggle : undefined}
                    isAIOpen={showAICopilot}
                    onAIClick={() => {
                        if (showAICopilot) {
                            setShowAICopilot(false);
                            return;
                        }

                        openCopilot('header');
                    }}
                    onResetLayout={canEditCurrentDashboard ? handleResetLayout : undefined}
                    onAutoFitLayout={canEditCurrentDashboard ? handleAutoFitLayout : undefined}
                    onCollapseAll={canEditCurrentDashboard ? handleCollapseAll : undefined}
                    onExpandAll={canEditCurrentDashboard ? handleExpandAll : undefined}
                    unitDisplay={unitConfig.display}
                    onUnitDisplayChange={setUnit}
                />

                <TabBar symbol={stockGlobalSymbol} />

                <div className="relative flex-1 min-h-0 overflow-hidden bg-[var(--bg-primary)] p-2 sm:p-3 lg:p-4">
                    {showAdminSystemLayoutControls && activeDashboard ? (
                        <div className="pointer-events-none absolute right-4 top-4 z-20">
                            <div className="pointer-events-auto flex min-w-[260px] max-w-[min(520px,calc(100vw-2rem))] flex-col gap-2 rounded-2xl border border-amber-500/20 bg-[linear-gradient(135deg,rgba(120,53,15,0.18),rgba(30,41,59,0.96))] px-3 py-2.5 shadow-[0_12px_32px_rgba(2,6,23,0.25)] backdrop-blur-sm">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex min-w-0 items-start gap-2">
                                        <Shield className="mt-0.5 h-4 w-4 text-amber-300" />
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200/90">
                                                System Dashboard Controls
                                            </div>
                                            <div className="mt-1 text-xs text-[var(--text-secondary)]">
                                                Admin-only draft and publish controls for the current system dashboard.
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleToggleAdminLayoutMode}
                                        disabled={!adminLayoutKey || isPublishingSystemLayout}
                                        className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {activeDashboard.adminUnlocked ? 'Disable Admin Mode' : 'Enable Admin Mode'}
                                    </button>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => void handlePersistSystemLayout(false)}
                                        disabled={!adminLayoutKey || !activeDashboard.adminUnlocked || isPublishingSystemLayout}
                                        className="rounded-lg border border-[var(--border-default)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Save Draft
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void handlePersistSystemLayout(true)}
                                        disabled={!adminLayoutKey || !activeDashboard.adminUnlocked || isPublishingSystemLayout}
                                        className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isPublishingSystemLayout ? 'Publishing...' : 'Publish Global'}
                                    </button>
                                    {adminLayoutStatus ? (
                                        <div className="inline-flex items-center gap-1 text-[11px] text-amber-200/85">
                                            <AlertCircle className="h-3.5 w-3.5" />
                                            <span>{adminLayoutStatus}</span>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <div className="flex h-full min-h-0 w-full overflow-hidden">
                        <div className="min-w-0 flex-1 overflow-hidden">
                            {activeDashboard && activeTab ? (
                                <>
                            <div className="h-full w-full overflow-y-auto scrollbar-hide">
                            {activeTabIntelligence.recommendations.length > 0 && (isEditing || activeTabIntelligence.isDeadTab) ? (
                                <div className="mb-2 flex flex-col gap-2 rounded-2xl border border-amber-500/20 bg-[linear-gradient(135deg,rgba(120,53,15,0.14),rgba(15,23,42,0.94))] px-3 py-2.5 shadow-[0_12px_32px_rgba(2,6,23,0.18)]">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200/90">
                                                Dashboard Recommendations
                                            </div>
                                            <div className="mt-1 text-xs text-[var(--text-secondary)]">
                                                Live hints from widget size contracts and sparse-state compaction.
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {canEditCurrentDashboard ? (
                                                <button
                                                    type="button"
                                                    onClick={handleAutoFitLayout}
                                                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/15"
                                                >
                                                    Auto-fit Dashboard
                                                </button>
                                            ) : null}
                                            <button
                                                type="button"
                                                onClick={() => setIsWidgetLibraryOpen(true)}
                                                className="rounded-lg border border-[var(--border-default)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
                                            >
                                                Open Widget Library
                                            </button>
                                        </div>
                                    </div>
                                    <div className="space-y-1 text-[11px] text-amber-100/85">
                                        {activeTabIntelligence.recommendations.map((recommendation) => (
                                            <div key={recommendation}>- {recommendation}</div>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                            {isSystemFundamentalsTab ? (
                                <div className="mb-2 flex flex-col gap-2 rounded-2xl border border-blue-500/20 bg-[linear-gradient(135deg,rgba(30,41,59,0.92),rgba(15,23,42,0.92))] px-3 py-2.5 shadow-[0_12px_32px_rgba(2,6,23,0.22)]">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-300/80">
                                                Financial Period View
                                            </div>
                                            <div className="mt-1 text-xs text-[var(--text-secondary)]">
                                                Syncs Financial Ratios, Income Statement, Balance Sheet, and Cash Flow for {stockGlobalSymbol}.
                                            </div>
                                        </div>
                                        <PeriodToggle
                                            value={sharedFundamentalPeriod}
                                            onChange={setSharedFundamentalPeriod}
                                            options={['FY', 'Q', 'TTM']}
                                        />
                                    </div>
                                </div>
                            ) : null}
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
                                        const widgetSymbol = isTradingViewWidget(widgetType)
                                            ? usesTradingViewWidgetSymbol(widgetType)
                                                ? (widget.config?.useLinkedSymbol !== false
                                                    ? globalMarketsSymbol
                                                    : (typeof widget.config?.symbol === 'string' && widget.config.symbol
                                                        ? widget.config.symbol
                                                        : globalMarketsSymbol))
                                                : undefined
                                            : stockGlobalSymbol;
                                        const parameters = getWidgetParameters(widget, (key, value) =>
                                            handleWidgetConfigChange(widget.id, key, value)
                                        );
                                        
                                        return (
                                            <div
                                                key={widget.id}
                                                className="h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] rounded"
                                                data-widget-focus="true"
                                                data-widget-id={widget.id}
                                                data-widget-type={widgetType}
                                                data-widget-symbol={widgetSymbol}
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
                                                    onRemove={!canEditCurrentDashboard || !isEditing
                                                        ? undefined
                                                        : () => deleteWidget(activeDashboard.id, activeTab.id, widget.id)}
                                                    onSymbolChange={handleSymbolChange}
                                                    onCopilotClick={(context) => {
                                                        const contextName = typeof context?.widgetType === 'string'
                                                            ? context.widgetType
                                                            : widgetType.replace(/_/g, ' ');
                                                        openCopilot('widget', contextName, context || undefined);
                                                    }}
                                                    onSettingsClick={() => handleOpenWidgetSettings(widget.id)}
                                                    parameters={parameters}
                                                >
                                                    {WidgetComponent ? (
                                                        <WidgetComponent 
                                                            id={widget.id}
                                                            symbol={widgetSymbol}
                                                            config={widget.config}
                                                            initialSymbols={Array.isArray(widget.config?.initialSymbols) ? widget.config.initialSymbols as string[] : undefined}
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
                                </>
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

                        {!overlayAICopilot && showAICopilot ? (
                            <>
                            <div
                                className="hidden lg:block h-full w-[4px] shrink-0 cursor-col-resize bg-[var(--bg-secondary)] hover:bg-blue-500/30"
                                onPointerDown={(event) => {
                                    if (event.button !== 0) return;
                                    event.preventDefault();
                                    beginPaneResize('right', event.clientX);
                                }}
                                role="separator"
                                aria-orientation="vertical"
                                aria-label="Resize VniAgent sidebar"
                            />
                            <div
                                className={`hidden lg:block h-full shrink-0 ${draggingPane === 'right' ? 'transition-none' : 'transition-[width] duration-150 ease-out'}`}
                                style={{ width: effectiveRightSidebarWidth }}
                            >
                                <RightSidebar 
                                    isOpen={showAICopilot} 
                                    onToggle={() => setShowAICopilot(false)}
                                    width={effectiveRightSidebarWidth}
                                    overlay={false}
                                >
                                    <AICopilot 
                                        isOpen={showAICopilot} 
                                        onClose={() => setShowAICopilot(false)} 
                                        currentSymbol={stockGlobalSymbol}
                                        widgetContext={copilotWidgetContext}
                                        widgetContextData={copilotWidgetData}
                                        activeTabName={activeTab?.name}
                                        promptLibraryRequestId={copilotPromptLibraryRequestId}
                                    />
                                </RightSidebar>
                            </div>
                            </>
                        ) : null}
                    </div>

                    {overlayAICopilot && showAICopilot ? (
                        <RightSidebar 
                            isOpen={showAICopilot} 
                            onToggle={() => setShowAICopilot(false)}
                            width={effectiveRightSidebarWidth}
                            overlay={true}
                        >
                            <AICopilot 
                                isOpen={showAICopilot} 
                                onClose={() => setShowAICopilot(false)} 
                                currentSymbol={stockGlobalSymbol}
                                widgetContext={copilotWidgetContext}
                                widgetContextData={copilotWidgetData}
                                activeTabName={activeTab?.name}
                                promptLibraryRequestId={copilotPromptLibraryRequestId}
                            />
                        </RightSidebar>
                    ) : null}
                </div>
            </main>

            <WidgetLibrary
                isOpen={isWidgetLibraryOpen}
                onClose={() => setIsWidgetLibraryOpen(false)}
            />
            
            <AppsLibrary
                isOpen={isAppsLibraryOpen}
                onClose={() => setIsAppsLibraryOpen(false)}
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

            <OnboardingWalkthrough
                open={isWalkthroughOpen}
                onComplete={closeWalkthrough}
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
