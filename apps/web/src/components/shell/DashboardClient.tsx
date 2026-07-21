// Main Dashboard Page with OpenBB-style Tabs and Dynamic Dashboard Context

'use client';

import { useState, useCallback, useMemo, useEffect, useRef, Suspense } from 'react';
import { toast } from 'sonner';
import { Sidebar, Header, TabBar, RightSidebar, MobileNav, FreshnessBanner, WhatsNewPanel } from '@/components/layout';
import { OnboardingWalkthrough } from '@/components/onboarding/OnboardingWalkthrough';
import { ResponsiveDashboardGrid, type LayoutItem } from '@/components/layout/DashboardGrid';
import { useDashboard } from '@/contexts/DashboardContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { WidgetLibrary, WidgetWrapper, widgetRegistry } from '@/components/widgets';
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
import { useUrlSync } from '@/hooks/useUrlSync';
import {
    autoFitGridItems,
    findNextAvailableLayout,
    getWidgetDefaultLayout,
    hasLayoutCoordinatesChanged
} from '@/lib/dashboardLayout';
import { LEFT_SIDEBAR_HIDE_BELOW, AI_COPILOT_OVERLAY_BELOW_WIDTH, AI_COPILOT_OVERLAY_BELOW_HEIGHT } from '@/lib/responsive';
import { useResizeNudge } from '@/hooks/useResizeNudge';
import { CURRENT_RELEASE } from '@/lib/version';
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
    dismissDashboardWalkthrough,
    dispatchOnboardingMeaningfulAction,
    markDashboardWalkthroughCompleted,
    selectOnboardingGoal,
    shouldShowDashboardWalkthrough,
    type OnboardingGoalId,
    type OnboardingMeaningfulActionId,
} from '@/lib/userPreferences';
import type { WidgetInstance, WidgetType, WidgetConfig } from '@/types/dashboard';
import { DASHBOARD_TEMPLATES, type DashboardTemplate } from '@/types/dashboard-templates';
import { AlertCircle, Grid3X3, PlusCircle, RefreshCw, Shield, X } from 'lucide-react';

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
type TemplateApplyStatus = {
    message: string;
    tone: 'success' | 'warning';
};

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
        setActiveDashboard,
        updateSyncGroupSymbol,
        deleteWidget,
        updateTabLayout,
        updateWidget,
        resetTabLayout,
        addWidget,
        setDashboardAdminUnlocked,
        migrationNotice,
        dismissMigrationNotice,
        backendSync,
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
    const [copilotStarterPrompt, setCopilotStarterPrompt] = useState<'analyze' | 'technical' | undefined>(undefined);
    const [copilotStarterPromptRequestId, setCopilotStarterPromptRequestId] = useState(0);
    const [sidebarWidth, setSidebarWidth] = useState(LEFT_SIDEBAR_DEFAULT_WIDTH);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [rightSidebarWidth, setRightSidebarWidth] = useState(RIGHT_SIDEBAR_DEFAULT_WIDTH);
    const [viewportWidth, setViewportWidth] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const [mounted, setMounted] = useState(false);
    const [isWalkthroughOpen, setIsWalkthroughOpen] = useState(false);
    const [adminLayoutKey, setAdminLayoutKey] = useState('');
    const [adminLayoutControlsVisible, setAdminLayoutControlsVisible] = useState(false);
    // Status feedback now routes through sonner toasts (see AppToaster). These
    // callbacks preserve the previous setter call-sites while removing the
    // bespoke timed banners and their render blocks.
    const setAdminLayoutStatus = useCallback((message: string | null) => {
        if (message) toast(message);
    }, []);
    const setTemplateApplyStatus = useCallback((status: TemplateApplyStatus | null) => {
        if (!status) return;
        if (status.tone === 'warning') {
            toast.warning(status.message);
        } else {
            toast.success(status.message);
        }
    }, []);
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
    const migrationNoticeClass = migrationNotice?.tone === 'warning'
        ? 'border-amber-500/25 bg-amber-500/10 text-amber-100'
        : 'border-blue-500/20 bg-blue-500/10 text-blue-100';

    const updateViewport = useCallback(() => {
        if (typeof window !== 'undefined') {
            setViewportWidth(window.innerWidth);
            setViewportHeight(window.innerHeight);
        }
    }, []);

    const effectiveLeftSidebarWidth = viewportWidth < LEFT_SIDEBAR_HIDE_BELOW
        ? 0
        : (isSidebarCollapsed ? LEFT_SIDEBAR_COLLAPSED_WIDTH : sidebarWidth);

    const overlayAICopilot = viewportWidth > 0 && (viewportWidth < AI_COPILOT_OVERLAY_BELOW_WIDTH || viewportHeight < AI_COPILOT_OVERLAY_BELOW_HEIGHT);
    const effectiveRightSidebarWidth = overlayAICopilot
        ? Math.min(rightSidebarWidth, Math.max(280, viewportWidth - 24))
        : rightSidebarWidth;

    useEffect(() => {
        setMounted(true);
        updateViewport();

        // One-shot boot log so we can ask "open devtools and tell me what
        // version you see" when users report stale-bundle issues.
        if (typeof window !== 'undefined' && !(window as { __VNIBB_BOOTED__?: boolean }).__VNIBB_BOOTED__) {
            (window as { __VNIBB_BOOTED__?: boolean }).__VNIBB_BOOTED__ = true;
            console.info(`[VNIBB ${CURRENT_RELEASE}] dashboard booted at ${new Date().toISOString()}`);
        }

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
        if (!activeDashboard || !ADMIN_MANAGED_SYSTEM_IDS.has(activeDashboard.id)) return;
        if (adminLayoutControlsVisible) return;
        if (activeDashboard.adminUnlocked !== true && !isEditing) return;
        setDashboardAdminUnlocked(activeDashboard.id, false);
        setIsEditing(false);
    }, [activeDashboard, adminLayoutControlsVisible, isEditing, setDashboardAdminUnlocked]);

    const openWalkthrough = useCallback((force = false) => {
        if (!mounted) {
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
    }, [activeDashboard?.id, activeTab?.id, mounted]);

    const skipWalkthrough = useCallback(() => {
        dismissDashboardWalkthrough();
        setIsWalkthroughOpen(false);
    }, []);

    const completeWalkthrough = useCallback((actionId: OnboardingMeaningfulActionId) => {
        markDashboardWalkthroughCompleted();
        setIsWalkthroughOpen(false);
        captureAnalyticsEvent(ANALYTICS_EVENTS.onboardingWalkthroughCompleted, {
            action_id: actionId,
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
    }, [activeDashboard, activeTab, mounted, openWalkthrough]);

    useEffect(() => {
        const handleRestartWalkthrough = () => {
            if (!mounted || !activeDashboard || !activeTab) {
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
    }, [activeDashboard, activeTab, mounted, openWalkthrough]);

    const applySelectedSymbol = useCallback((rawSymbol: string, options?: { domain?: 'vn' | 'tv' }) => {
        const normalizedSymbol = rawSymbol.trim().toUpperCase();
        if (!normalizedSymbol) return;

        // Track C: VN tickers and TradingView symbols live in two separate
        // channels. A bare VN ticker like 'MBB' must never overwrite the
        // TradingView default (e.g. 'AMEX:SPY') because the public TV embed
        // cannot resolve `HOSE:MBB` and surfaces a blocking modal.
        // Heuristic: TradingView symbols always include a colon
        // (EXCHANGE:SYMBOL); VN tickers never do.
        const inferredDomain: 'vn' | 'tv' = normalizedSymbol.includes(':') ? 'tv' : 'vn';
        const domain = options?.domain || inferredDomain;

        if (normalizedSymbol !== stockGlobalSymbol) {
            dispatchOnboardingMeaningfulAction('symbol_change');
            captureAnalyticsEvent(ANALYTICS_EVENTS.symbolChanged, {
                from_symbol: stockGlobalSymbol,
                to_symbol: normalizedSymbol,
                dashboard_id: activeDashboard?.id,
                tab_id: activeTab?.id,
                domain,
            });
        }

        if (domain === 'vn') {
            setStockGlobalSymbol(normalizedSymbol);
            setContextGlobalSymbol(normalizedSymbol);
            if (activeDashboard) {
                updateSyncGroupSymbol(activeDashboard.id, 1, normalizedSymbol);
            }
            return;
        }

        // domain === 'tv'
        setGlobalMarketsSymbol(normalizedSymbol);
        if (activeDashboard) {
            updateSyncGroupSymbol(activeDashboard.id, 1, normalizedSymbol);
        }
    }, [activeDashboard, activeTab?.id, setContextGlobalSymbol, setGlobalMarketsSymbol, setStockGlobalSymbol, stockGlobalSymbol, updateSyncGroupSymbol]);

    // URL deep-linking: ?dashboard=&tab=&symbol= for shareable/bookmarkable
    // views and browser back/forward support. Self-contained (see useUrlSync).
    const getTabIds = useCallback(
        (dashboardId: string) =>
            state.dashboards.find((d) => d.id === dashboardId)?.tabs.map((t) => t.id) ?? [],
        [state.dashboards],
    );
    const dashboardIds = useMemo(() => state.dashboards.map((d) => d.id), [state.dashboards]);
    useUrlSync({
        ready: mounted,
        activeDashboardId: activeDashboard?.id ?? null,
        activeTabId: activeTab?.id ?? null,
        symbol: stockGlobalSymbol,
        dashboardIds,
        getTabIds,
        applyDashboard: setActiveDashboard,
        applyTab: setActiveTab,
        applySymbol: (sym) => applySelectedSymbol(sym),
    });

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

        let changed = false;
        const updatedWidgets = activeTab.widgets.map(w => {
            const layoutItem = newLayout.find(l => l.i === w.id);
            if (!layoutItem) return w;

            const layoutChanged = hasLayoutCoordinatesChanged(w.layout, layoutItem);

            if (!layoutChanged) return w;

            changed = true;
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
        });

        if (!changed) return;
        updateTabLayout(activeDashboard.id, activeTab.id, updatedWidgets);
    }, [activeDashboard, activeTab, updateTabLayout]);

    const handleSymbolChange = useCallback((symbol: string) => {
        applySelectedSymbol(symbol);
    }, [applySelectedSymbol]);

    const canEditCurrentDashboard = (activeDashboard?.adminUnlocked === true) || activeDashboard?.isEditable !== false;

    // Keyboard layout editing (accessibility): when a widget is focused in edit
    // mode, arrow keys move it by one grid unit and Shift+arrow resizes it. Writes
    // flow through the same updateTabLayout path as pointer drag/resize. This is the
    // keyboard-accessible alternative to the pointer-only `.widget-drag-handle`.
    const handleWidgetLayoutKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>, widgetId: string) => {
            if (!isEditing || !canEditCurrentDashboard) return;
            if (!activeDashboard || !activeTab) return;
            const arrowKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
            if (!arrowKeys.includes(event.key)) return;
            // Don't hijack arrows while typing in an input inside the widget.
            const target = event.target as HTMLElement;
            if (target && target !== event.currentTarget && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
            if (target && target.isContentEditable) return;

            const widget = activeTab.widgets.find((w) => w.id === widgetId);
            if (!widget) return;

            event.preventDefault();
            const GRID_COLS = 24;
            const resize = event.shiftKey;
            const { x, y, w, h } = widget.layout;
            const minW = widget.layout.minW ?? 2;
            const minH = widget.layout.minH ?? 2;

            let next = { x, y, w, h };
            if (resize) {
                if (event.key === 'ArrowLeft') next = { ...next, w: Math.max(minW, w - 1) };
                if (event.key === 'ArrowRight') next = { ...next, w: Math.min(GRID_COLS - x, w + 1) };
                if (event.key === 'ArrowUp') next = { ...next, h: Math.max(minH, h - 1) };
                if (event.key === 'ArrowDown') next = { ...next, h: h + 1 };
            } else {
                if (event.key === 'ArrowLeft') next = { ...next, x: Math.max(0, x - 1) };
                if (event.key === 'ArrowRight') next = { ...next, x: Math.min(GRID_COLS - w, x + 1) };
                if (event.key === 'ArrowUp') next = { ...next, y: Math.max(0, y - 1) };
                if (event.key === 'ArrowDown') next = { ...next, y: y + 1 };
            }

            if (next.x === x && next.y === y && next.w === w && next.h === h) return;

            const updatedWidgets = activeTab.widgets.map((wgt) =>
                wgt.id === widgetId ? { ...wgt, layout: { ...wgt.layout, ...next } } : wgt
            );
            updateTabLayout(activeDashboard.id, activeTab.id, updatedWidgets);
        },
        [isEditing, canEditCurrentDashboard, activeDashboard, activeTab, updateTabLayout]
    );

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

    // One-time discoverability hint: editing is locked by default and the only
    // affordance is the header Lock/Unlock toggle, which users miss. Surface a
    // single dismissible toast the first time someone lands on an editable,
    // populated dashboard while not editing.
    // DEF-05: edit-hint toast.
    //
    // Shown exactly once per browser after a dashboard renders its first set
    // of widgets, and only when:
    //   * the dashboard is editable by the current user
    //   * the user is NOT already in edit mode
    //   * the active tab has at least one widget (no point hinting on an empty tab)
    //   * the dashboard walkthrough is not currently open
    //
    // The hint surfaces a Toast that names the header "Layout Locked" / "Layout Unlocked"
    // toggle; the exact label is rendered as "Click "Layout Locked" in the header to drag,
    // resize, and rearrange widgets." and the action button immediately enables edit mode
    // by calling handleEditToggle(). The flag persists in localStorage so the hint never
    // reappears after the first dismissal; failures to read/write localStorage are
    // deliberately swallowed so the hint may show again rather than blocking.
    useEffect(() => {
        if (!mounted || typeof window === 'undefined') return;
        if (isWalkthroughOpen || shouldShowDashboardWalkthrough()) return;
        if (!canEditCurrentDashboard || isEditing) return;
        if (!activeTab?.widgets?.length) return;

        const EDIT_HINT_KEY = 'vnibb-edit-hint-seen';
        try {
            if (localStorage.getItem(EDIT_HINT_KEY) === 'true') return;
        } catch {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            toast('Customize this dashboard', {
                description: 'Click "Layout Locked" in the header to drag, resize, and rearrange widgets.',
                duration: 8000,
                action: {
                    label: 'Edit now',
                    onClick: () => handleEditToggle(),
                },
            });
            try {
                localStorage.setItem(EDIT_HINT_KEY, 'true');
            } catch {
                // ignore persistence failure; hint simply may show again
            }
        }, 1800);

        return () => window.clearTimeout(timeoutId);
    }, [mounted, isWalkthroughOpen, canEditCurrentDashboard, isEditing, activeTab?.widgets?.length, handleEditToggle]);

    // Nudge container-measuring embeds to re-measure after dashboard/tab/widget
    // changes. Shared implementation with DashboardGrid via useResizeNudge.
    useResizeNudge([activeDashboard?.id, activeTab?.id, activeTab?.widgets, mounted], 140);

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

    const applyTemplateToDashboard = useCallback((template: DashboardTemplate, dashboardId: string, tabId: string) => {
        template.widgets.forEach(w => {
            addWidget(dashboardId, tabId, {
                type: w.type,
                tabId,
                layout: w.layout,
                config: w.config || {}
            });
        });
    }, [addWidget]);

    const handleApplyTemplate = useCallback((template: DashboardTemplate) => {
        if (template.widgets.length === 0) {
            setTemplateApplyStatus({ message: 'This template has no widgets to apply.', tone: 'warning' });
            return;
        }

        // Always create a fresh editable workspace seeded with the template
        // and switch to it. This is intentionally unconditional so templates
        // never appear stuck or "blacked out" regardless of whether the
        // currently active dashboard is locked, missing, or read-only.
        try {
            const dashboard = createDashboard({ name: `${template.name} Workspace` });
            const tab = dashboard.tabs[0];
            if (!tab) {
                setTemplateApplyStatus({ message: 'Could not create workspace for template.', tone: 'warning' });
                return;
            }
            applyTemplateToDashboard(template, dashboard.id, tab.id);
            setActiveDashboard(dashboard.id);
            setActiveTab(tab.id);
            setIsTemplateSelectorOpen(false);
            setIsAppsLibraryOpen(false);
            setTemplateApplyStatus({ message: `Created '${dashboard.name}' from ${template.name}.`, tone: 'success' });
            captureAnalyticsEvent(ANALYTICS_EVENTS.workspaceTemplateApplied, {
                source: 'template_selector_auto_workspace',
                template_id: template.id,
                template_name: template.name,
                template_category: template.category,
                dashboard_id: dashboard.id,
                tab_id: tab.id,
                widget_count: template.widgets.length,
            });
        } catch (err) {
            console.error('[handleApplyTemplate] failed', err);
            setTemplateApplyStatus({
                message: `Could not apply template: ${err instanceof Error ? err.message : 'unknown error'}`,
                tone: 'warning',
            });
        }
    }, [applyTemplateToDashboard, createDashboard, setActiveDashboard, setActiveTab]);

    const handleOnboardingGoalSelect = useCallback((goalId: OnboardingGoalId) => {
        selectOnboardingGoal(goalId);

        if (goalId === 'scan_market') {
            const template = DASHBOARD_TEMPLATES.find((item) => item.id === 'market-overview');
            if (template) {
                handleApplyTemplate(template);
            }
            dispatchOnboardingMeaningfulAction('view_open');
            return;
        }

        const dashboard = state.dashboards.find((item) => item.id === MAIN_FUNDAMENTAL_DASHBOARD_ID);
        const tabName = goalId === 'follow_ticker' ? 'Overview' : 'Financials';
        const tab = dashboard?.tabs.find((item) => item.name === tabName);
        if (dashboard && tab) {
            setActiveDashboard(dashboard.id);
            setActiveTab(tab.id);
        }
        setCopilotStarterPrompt(goalId === 'follow_ticker' ? 'technical' : 'analyze');
        setCopilotStarterPromptRequestId((current) => current + 1);
        openCopilot('onboarding');
        dispatchOnboardingMeaningfulAction('view_open');
    }, [handleApplyTemplate, openCopilot, setActiveDashboard, setActiveTab, state.dashboards]);

    const handleSeedEmptyTab = useCallback((template: DashboardTemplate) => {
        if (!activeDashboard || !activeTab) return;
        if (template.widgets.length === 0) {
            setTemplateApplyStatus({ message: 'This template has no widgets to apply.', tone: 'warning' });
            return;
        }
        if (!canEditCurrentDashboard) {
            // Empty-tab starter cards on locked dashboards now spin up a
            // fresh workspace instead of warning the user — same UX path as
            // the main template picker.
            const dashboard = createDashboard({ name: `${template.name} Workspace` });
            const tab = dashboard.tabs[0];
            applyTemplateToDashboard(template, dashboard.id, tab.id);
            setActiveDashboard(dashboard.id);
            setActiveTab(tab.id);
            setTemplateApplyStatus({ message: `Created '${dashboard.name}' from ${template.name}.`, tone: 'success' });
            captureAnalyticsEvent(ANALYTICS_EVENTS.workspaceTemplateApplied, {
                source: 'empty_tab_seed_locked_auto_workspace',
                template_id: template.id,
                template_name: template.name,
                template_category: template.category,
                dashboard_id: dashboard.id,
                tab_id: tab.id,
                widget_count: template.widgets.length,
            });
            return;
        }
        if (activeTab.widgets.length > 0) {
            setTemplateApplyStatus({ message: 'Suggested layouts can only seed an empty tab.', tone: 'warning' });
            return;
        }

        template.widgets.forEach((widget) => {
            addWidget(activeDashboard.id, activeTab.id, {
                type: widget.type,
                tabId: activeTab.id,
                layout: widget.layout,
                config: widget.config || {},
            });
        });
        setTemplateApplyStatus({ message: `Applied ${template.name} template.`, tone: 'success' });
        captureAnalyticsEvent(ANALYTICS_EVENTS.workspaceTemplateApplied, {
            source: 'empty_tab_seed',
            template_id: template.id,
            template_name: template.name,
            template_category: template.category,
            dashboard_id: activeDashboard.id,
            tab_id: activeTab.id,
            widget_count: template.widgets.length,
        });
    }, [activeDashboard, activeTab, addWidget, applyTemplateToDashboard, canEditCurrentDashboard, createDashboard, setActiveDashboard, setActiveTab]);

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
        { type: 'screener', label: 'VNIBB Screener' },
    ];

    const handleQuickAddWidget = useCallback((type: WidgetType) => {
        if (!activeDashboard || !activeTab) return;
        if (!canEditCurrentDashboard) {
            // Quick-add on a locked dashboard creates a fresh workspace
            // and adds the widget there. Mirrors the template-apply path so
            // the user is never stuck.
            const dashboard = createDashboard({ name: `${getWidgetDefinition(type)?.name ?? 'Workspace'} Workspace` });
            const tab = dashboard.tabs[0];
            const placement = findNextAvailableLayout(tab.widgets, type);
            const defaults = getWidgetDefaultLayout(type);
            addWidget(dashboard.id, tab.id, {
                type,
                tabId: tab.id,
                layout: {
                    x: placement.x,
                    y: placement.y,
                    w: defaults.w,
                    h: defaults.h,
                    minW: defaults.minW,
                    minH: defaults.minH,
                },
            });
            setActiveDashboard(dashboard.id);
            setActiveTab(tab.id);
            setTemplateApplyStatus({ message: `Created '${dashboard.name}' with ${getWidgetDefinition(type)?.name ?? type.replace(/_/g, ' ')}.`, tone: 'success' });
            return;
        }

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
        setTemplateApplyStatus({ message: `Added ${getWidgetDefinition(type)?.name ?? type.replace(/_/g, ' ')}.`, tone: 'success' });
    }, [activeDashboard, activeTab, addWidget, canEditCurrentDashboard, createDashboard, setActiveDashboard, setActiveTab]);

    const memoizedLayouts = useMemo(() => {
        if (!activeTab?.widgets) return [];

        return activeTab.widgets.map(w => ({
            ...w.layout,
            i: w.id,
            // Carry the widget type so DashboardGrid's responsive derivation can
            // resolve each widget's size contract (min/preferred W/H, orientation).
            type: w.type,
            minW: w.layout.minW ?? 4,
            minH: w.layout.minH ?? 3,
        }));
    }, [activeTab?.widgets]);

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

    if (!mounted) {
        return (
            <div aria-busy="true" aria-label="Loading dashboard" className="flex h-screen items-center justify-center bg-[var(--bg-primary)] text-sm text-[var(--text-muted)]">
                Loading dashboard...
            </div>
        );
    }

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

                <FreshnessBanner />

                {backendSync.loadPaused && (
                    <div
                        role="status"
                        className="mx-3 mt-2 rounded-md border border-blue-500/20 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-100"
                    >
                        Cross-device sync is one-way while you have custom workspaces: changes here are
                        saved to the cloud, but this device won&apos;t auto-pull layouts from other devices.
                    </div>
                )}

                <TabBar symbol={stockGlobalSymbol} />

                <WhatsNewPanel />

                {migrationNotice ? (
                    <div
                        role={migrationNotice.tone === 'warning' ? 'alert' : 'status'}
                        className={`mx-2 mt-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs shadow-sm sm:mx-3 lg:mx-4 ${migrationNoticeClass}`}
                    >
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                            <div className="font-black uppercase tracking-[0.14em]">
                                {migrationNotice.message}
                            </div>
                            <div className="mt-1 leading-5 opacity-85">
                                {migrationNotice.detail}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={dismissMigrationNotice}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-current/20 text-current/80 hover:bg-white/10 hover:text-current"
                            aria-label="Dismiss dashboard storage notice"
                            title="Dismiss"
                        >
                            <X size={14} />
                        </button>
                    </div>
                ) : null}

                <div className="relative flex-1 min-h-0 overflow-hidden bg-[var(--bg-primary)] p-2 sm:p-3 lg:p-4">
                    {showAdminSystemLayoutControls && activeDashboard ? (
                        <div className="pointer-events-none absolute right-4 top-4 z-20">
                            <div className="pointer-events-auto flex min-w-[260px] max-w-[min(520px,calc(100vw-2rem))] flex-col gap-2 rounded-2xl border border-amber-500/20 bg-[color-mix(in_srgb,var(--bg-secondary)_86%,#f59e0b_14%)] px-3 py-2.5 shadow-[0_12px_32px_rgba(2,6,23,0.25)] backdrop-blur-sm">
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
                                <div className="mb-2 flex flex-col gap-2 rounded-2xl border border-amber-500/20 bg-[color-mix(in_srgb,var(--bg-secondary)_88%,#f59e0b_12%)] px-3 py-2.5 shadow-[0_12px_32px_rgba(2,6,23,0.18)]">
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
                                <div className="mb-2 flex flex-col gap-2 rounded-2xl border border-blue-500/20 bg-[var(--bg-secondary)] px-3 py-2.5 shadow-[0_12px_32px_rgba(2,6,23,0.12)]">
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
                                >
                                    {activeTab.widgets.map((widget) => {
                                        const widgetType = widget.type;
                                        const registryEntry = widgetRegistry.get(widgetType);
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

                                        const LazyWidgetComponent = registryEntry?.component;

                                        return (
                                            <div
                                                key={widget.id}
                                                className="h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] rounded"
                                                data-widget-focus="true"
                                                data-widget-id={widget.id}
                                                data-widget-type={widgetType}
                                                data-widget-symbol={widgetSymbol}
                                                tabIndex={0}
                                                role={isEditing && canEditCurrentDashboard ? 'application' : undefined}
                                                aria-label={isEditing && canEditCurrentDashboard
                                                    ? `${widgetTitle} — arrow keys move, Shift+arrow resizes`
                                                    : undefined}
                                                onKeyDown={(event) => handleWidgetLayoutKeyDown(event, widget.id)}
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
                                                    {LazyWidgetComponent ? (
                                                        <Suspense fallback={<div className="p-4 text-[var(--text-muted)]">Loading widget...</div>}>
                                                            <LazyWidgetComponent
                                                                id={widget.id}
                                                                symbol={widgetSymbol}
                                                                config={widget.config}
                                                                initialSymbols={Array.isArray(widget.config?.initialSymbols) ? widget.config.initialSymbols as string[] : undefined}
                                                            />
                                                        </Suspense>
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
                                        starterPrompt={copilotStarterPrompt}
                                        starterPromptRequestId={copilotStarterPromptRequestId}
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
                                starterPrompt={copilotStarterPrompt}
                                starterPromptRequestId={copilotStarterPromptRequestId}
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
                onSelectTemplate={handleApplyTemplate}
            />

            <TemplateSelector
                open={isTemplateSelectorOpen}
                onClose={() => setIsTemplateSelectorOpen(false)}
                onSelectTemplate={handleApplyTemplate}
                currentDashboard={activeDashboard ?? null}
                currentSymbol={stockGlobalSymbol}
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
                onSkip={skipWalkthrough}
                onGoalSelect={handleOnboardingGoalSelect}
                onMeaningfulAction={completeWalkthrough}
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
