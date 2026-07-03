// Dashboard UI state management hook
// Consolidates all DashboardClient.tsx state into a reducer-based hook

'use client';

import { useReducer, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

// ============ Layout Constants ============

export const LEFT_SIDEBAR_DEFAULT_WIDTH = 248;
export const LEFT_SIDEBAR_COLLAPSED_WIDTH = 56;
export const LEFT_SIDEBAR_MIN_WIDTH = 180;
export const LEFT_SIDEBAR_MAX_WIDTH = 320;
export const RIGHT_SIDEBAR_DEFAULT_WIDTH = 360;
export const RIGHT_SIDEBAR_MIN_WIDTH = 300;
export const RIGHT_SIDEBAR_MAX_WIDTH = 480;
export const LEFT_SIDEBAR_STORAGE_KEY = 'vnibb-left-sidebar-width';
export const RIGHT_SIDEBAR_STORAGE_KEY = 'vnibb-right-sidebar-width';

// ============ State Types ============

export interface WidgetSettingsState {
    widgetId: string;
    tabId: string;
}

export interface TemplateApplyStatus {
    message: string;
    tone: 'success' | 'warning';
}

export type DraggingPane = 'left' | 'right' | null;

export interface DashboardUIState {
    // Edit mode
    isEditing: boolean;
    // Sidebar
    sidebarWidth: number;
    isSidebarCollapsed: boolean;
    rightSidebarWidth: number;
    // Modals
    isWidgetLibraryOpen: boolean;
    isAppsLibraryOpen: boolean;
    isTemplateSelectorOpen: boolean;
    // AI Copilot
    showAICopilot: boolean;
    copilotWidgetContext: string | undefined;
    copilotWidgetData: Record<string, unknown> | undefined;
    copilotPromptLibraryRequestId: number;
    // Widget settings
    widgetSettingsState: WidgetSettingsState | null;
    // Onboarding
    isWalkthroughOpen: boolean;
    // Admin layout
    adminLayoutKey: string;
    adminLayoutControlsVisible: boolean;
    isPublishingSystemLayout: boolean;
    // Dragging
    draggingPane: DraggingPane;
    // Status callbacks
    adminLayoutStatus: string | null;
    templateApplyStatus: TemplateApplyStatus | null;
    // Viewport
    viewportWidth: number;
    viewportHeight: number;
    mounted: boolean;
}

// ============ Actions ============

type DashboardUIAction =
    | { type: 'SET_EDITING'; payload: boolean }
    | { type: 'SET_SIDEBAR_WIDTH'; payload: number }
    | { type: 'SET_SIDEBAR_COLLAPSED'; payload: boolean }
    | { type: 'SET_RIGHT_SIDEBAR_WIDTH'; payload: number }
    | { type: 'SET_WIDGET_LIBRARY_OPEN'; payload: boolean }
    | { type: 'SET_APPS_LIBRARY_OPEN'; payload: boolean }
    | { type: 'SET_TEMPLATE_SELECTOR_OPEN'; payload: boolean }
    | { type: 'SET_SHOW_AI_COPILOT'; payload: boolean }
    | { type: 'SET_COPILOT_CONTEXT'; payload: { context?: string; data?: Record<string, unknown> } }
    | { type: 'INCREMENT_COPILOT_PROMPT_LIBRARY_REQUEST_ID' }
    | { type: 'SET_WIDGET_SETTINGS_STATE'; payload: WidgetSettingsState | null }
    | { type: 'SET_WALKTHROUGH_OPEN'; payload: boolean }
    | { type: 'SET_ADMIN_LAYOUT_KEY'; payload: string }
    | { type: 'SET_ADMIN_LAYOUT_CONTROLS_VISIBLE'; payload: boolean }
    | { type: 'SET_PUBLISHING_SYSTEM_LAYOUT'; payload: boolean }
    | { type: 'SET_DRAGGING_PANE'; payload: DraggingPane }
    | { type: 'SET_ADMIN_LAYOUT_STATUS'; payload: string | null }
    | { type: 'SET_TEMPLATE_APPLY_STATUS'; payload: TemplateApplyStatus | null }
    | { type: 'SET_VIEWPORT'; payload: { width: number; height: number } }
    | { type: 'SET_MOUNTED'; payload: boolean }
    | { type: 'CLOSE_ALL_MODALS' }
    | { type: 'RESET' };

// ============ Initial State ============

const initialState: DashboardUIState = {
    isEditing: false,
    sidebarWidth: LEFT_SIDEBAR_DEFAULT_WIDTH,
    isSidebarCollapsed: false,
    rightSidebarWidth: RIGHT_SIDEBAR_DEFAULT_WIDTH,
    isWidgetLibraryOpen: false,
    isAppsLibraryOpen: false,
    isTemplateSelectorOpen: false,
    showAICopilot: false,
    copilotWidgetContext: undefined,
    copilotWidgetData: undefined,
    copilotPromptLibraryRequestId: 0,
    widgetSettingsState: null,
    isWalkthroughOpen: false,
    adminLayoutKey: '',
    adminLayoutControlsVisible: false,
    isPublishingSystemLayout: false,
    draggingPane: null,
    adminLayoutStatus: null,
    templateApplyStatus: null,
    viewportWidth: 0,
    viewportHeight: 0,
    mounted: false,
};

// ============ Reducer ============

function dashboardUIReducer(state: DashboardUIState, action: DashboardUIAction): DashboardUIState {
    switch (action.type) {
        case 'SET_EDITING':
            return { ...state, isEditing: action.payload };
        case 'SET_SIDEBAR_WIDTH':
            return { ...state, sidebarWidth: action.payload };
        case 'SET_SIDEBAR_COLLAPSED':
            return { ...state, isSidebarCollapsed: action.payload };
        case 'SET_RIGHT_SIDEBAR_WIDTH':
            return { ...state, rightSidebarWidth: action.payload };
        case 'SET_WIDGET_LIBRARY_OPEN':
            return { ...state, isWidgetLibraryOpen: action.payload };
        case 'SET_APPS_LIBRARY_OPEN':
            return { ...state, isAppsLibraryOpen: action.payload };
        case 'SET_TEMPLATE_SELECTOR_OPEN':
            return { ...state, isTemplateSelectorOpen: action.payload };
        case 'SET_SHOW_AI_COPILOT':
            return { ...state, showAICopilot: action.payload };
        case 'SET_COPILOT_CONTEXT':
            return {
                ...state,
                copilotWidgetContext: action.payload.context,
                copilotWidgetData: action.payload.data,
            };
        case 'INCREMENT_COPILOT_PROMPT_LIBRARY_REQUEST_ID':
            return { ...state, copilotPromptLibraryRequestId: state.copilotPromptLibraryRequestId + 1 };
        case 'SET_WIDGET_SETTINGS_STATE':
            return { ...state, widgetSettingsState: action.payload };
        case 'SET_WALKTHROUGH_OPEN':
            return { ...state, isWalkthroughOpen: action.payload };
        case 'SET_ADMIN_LAYOUT_KEY':
            return { ...state, adminLayoutKey: action.payload };
        case 'SET_ADMIN_LAYOUT_CONTROLS_VISIBLE':
            return { ...state, adminLayoutControlsVisible: action.payload };
        case 'SET_PUBLISHING_SYSTEM_LAYOUT':
            return { ...state, isPublishingSystemLayout: action.payload };
        case 'SET_DRAGGING_PANE':
            return { ...state, draggingPane: action.payload };
        case 'SET_ADMIN_LAYOUT_STATUS':
            return { ...state, adminLayoutStatus: action.payload };
        case 'SET_TEMPLATE_APPLY_STATUS':
            return { ...state, templateApplyStatus: action.payload };
        case 'SET_VIEWPORT':
            return { ...state, viewportWidth: action.payload.width, viewportHeight: action.payload.height };
        case 'SET_MOUNTED':
            return { ...state, mounted: action.payload };
        case 'CLOSE_ALL_MODALS':
            return {
                ...state,
                isWidgetLibraryOpen: false,
                isAppsLibraryOpen: false,
                isTemplateSelectorOpen: false,
                widgetSettingsState: null,
                showAICopilot: false,
            };
        case 'RESET':
            return initialState;
        default:
            return state;
    }
}

// ============ Hook ============

export interface UseDashboardUIOptions {
    onAdminLayoutStatusChange?: (message: string | null) => void;
    onTemplateApplyStatusChange?: (status: TemplateApplyStatus | null) => void;
}

export function useDashboardUI(options: UseDashboardUIOptions = {}) {
    const [state, dispatch] = useReducer(dashboardUIReducer, initialState);
    const dragStateRef = useRef<{ pane: DraggingPane; startX: number; startWidth: number }>({
        pane: null,
        startX: 0,
        startWidth: 0,
    });

    // Sidebar actions
    const setSidebarWidth = useCallback((width: number) => {
        const clamped = Math.max(LEFT_SIDEBAR_MIN_WIDTH, Math.min(LEFT_SIDEBAR_MAX_WIDTH, width));
        dispatch({ type: 'SET_SIDEBAR_WIDTH', payload: clamped });
    }, []);

    const setIsSidebarCollapsed = useCallback((collapsed: boolean) => {
        dispatch({ type: 'SET_SIDEBAR_COLLAPSED', payload: collapsed });
    }, []);

    const setRightSidebarWidth = useCallback((width: number) => {
        const clamped = Math.max(RIGHT_SIDEBAR_MIN_WIDTH, Math.min(RIGHT_SIDEBAR_MAX_WIDTH, width));
        dispatch({ type: 'SET_RIGHT_SIDEBAR_WIDTH', payload: clamped });
    }, []);

    // Modal actions
    const openWidgetLibrary = useCallback(() => {
        dispatch({ type: 'SET_WIDGET_LIBRARY_OPEN', payload: true });
    }, []);

    const closeWidgetLibrary = useCallback(() => {
        dispatch({ type: 'SET_WIDGET_LIBRARY_OPEN', payload: false });
    }, []);

    const openAppsLibrary = useCallback(() => {
        dispatch({ type: 'SET_APPS_LIBRARY_OPEN', payload: true });
    }, []);

    const closeAppsLibrary = useCallback(() => {
        dispatch({ type: 'SET_APPS_LIBRARY_OPEN', payload: false });
    }, []);

    const openTemplateSelector = useCallback(() => {
        dispatch({ type: 'SET_TEMPLATE_SELECTOR_OPEN', payload: true });
    }, []);

    const closeTemplateSelector = useCallback(() => {
        dispatch({ type: 'SET_TEMPLATE_SELECTOR_OPEN', payload: false });
    }, []);

    // AI Copilot actions
    const setShowAICopilot = useCallback((show: boolean) => {
        dispatch({ type: 'SET_SHOW_AI_COPILOT', payload: show });
    }, []);

    const openCopilot = useCallback((
        contextName?: string,
        contextData?: Record<string, unknown>,
    ) => {
        dispatch({ type: 'SET_COPILOT_CONTEXT', payload: { context: contextName, data: contextData } });
        dispatch({ type: 'SET_SHOW_AI_COPILOT', payload: true });
    }, []);

    const incrementCopilotPromptLibraryRequestId = useCallback(() => {
        dispatch({ type: 'INCREMENT_COPILOT_PROMPT_LIBRARY_REQUEST_ID' });
    }, []);

    // Widget settings actions
    const openWidgetSettings = useCallback((widgetId: string, tabId: string) => {
        dispatch({ type: 'SET_WIDGET_SETTINGS_STATE', payload: { widgetId, tabId } });
    }, []);

    const closeWidgetSettings = useCallback(() => {
        dispatch({ type: 'SET_WIDGET_SETTINGS_STATE', payload: null });
    }, []);

    // Edit mode actions
    const setIsEditing = useCallback((editing: boolean) => {
        dispatch({ type: 'SET_EDITING', payload: editing });
    }, []);

    // Walkthrough actions
    const setIsWalkthroughOpen = useCallback((open: boolean) => {
        dispatch({ type: 'SET_WALKTHROUGH_OPEN', payload: open });
    }, []);

    // Admin layout actions
    const setAdminLayoutKey = useCallback((key: string) => {
        dispatch({ type: 'SET_ADMIN_LAYOUT_KEY', payload: key });
    }, []);

    const setAdminLayoutControlsVisible = useCallback((visible: boolean) => {
        dispatch({ type: 'SET_ADMIN_LAYOUT_CONTROLS_VISIBLE', payload: visible });
    }, []);

    const setIsPublishingSystemLayout = useCallback((publishing: boolean) => {
        dispatch({ type: 'SET_PUBLISHING_SYSTEM_LAYOUT', payload: publishing });
    }, []);

    const setAdminLayoutStatus = useCallback((message: string | null) => {
        if (message && options.onAdminLayoutStatusChange) {
            options.onAdminLayoutStatusChange(message);
        } else {
            dispatch({ type: 'SET_ADMIN_LAYOUT_STATUS', payload: message });
        }
    }, [options.onAdminLayoutStatusChange]);

    const setTemplateApplyStatus = useCallback((status: TemplateApplyStatus | null) => {
        if (options.onTemplateApplyStatusChange) {
            options.onTemplateApplyStatusChange(status);
        } else {
            dispatch({ type: 'SET_TEMPLATE_APPLY_STATUS', payload: status });
        }
    }, [options.onTemplateApplyStatusChange]);

    // Drag pane actions
    const setDraggingPane = useCallback((pane: DraggingPane) => {
        dispatch({ type: 'SET_DRAGGING_PANE', payload: pane });
    }, []);

    // Close all modals
    const closeAllModals = useCallback(() => {
        dispatch({ type: 'CLOSE_ALL_MODALS' });
    }, []);

    // Begin pane resize
    const beginPaneResize = useCallback((pane: 'left' | 'right', clientX: number) => {
        dragStateRef.current = {
            pane,
            startX: clientX,
            startWidth: pane === 'left' ? state.sidebarWidth : state.rightSidebarWidth,
        };
        dispatch({ type: 'SET_DRAGGING_PANE', payload: pane });
    }, [state.sidebarWidth, state.rightSidebarWidth]);

    // Handle pointer move for resizing
    useEffect(() => {
        if (!state.draggingPane) return;

        const handlePointerMove = (event: PointerEvent) => {
            const { pane, startWidth, startX } = dragStateRef.current;
            if (!pane) return;

            if (pane === 'left') {
                const nextWidth = startWidth + (event.clientX - startX);
                const clamped = Math.max(LEFT_SIDEBAR_MIN_WIDTH, Math.min(LEFT_SIDEBAR_MAX_WIDTH, nextWidth));
                dispatch({ type: 'SET_SIDEBAR_WIDTH', payload: clamped });
                return;
            }

            const nextWidth = startWidth - (event.clientX - startX);
            const clamped = Math.max(RIGHT_SIDEBAR_MIN_WIDTH, Math.min(RIGHT_SIDEBAR_MAX_WIDTH, nextWidth));
            dispatch({ type: 'SET_RIGHT_SIDEBAR_WIDTH', payload: clamped });
        };

        const handlePointerUp = () => {
            dragStateRef.current = { pane: null, startX: 0, startWidth: 0 };
            dispatch({ type: 'SET_DRAGGING_PANE', payload: null });
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
    }, [state.draggingPane]);

    // Update viewport
    const updateViewport = useCallback(() => {
        if (typeof window !== 'undefined') {
            dispatch({ type: 'SET_VIEWPORT', payload: { width: window.innerWidth, height: window.innerHeight } });
        }
    }, []);

    // Mount and viewport effects
    useEffect(() => {
        dispatch({ type: 'SET_MOUNTED', payload: true });
        updateViewport();

        // Load saved sidebar widths
        if (typeof window !== 'undefined') {
            const storedLeftWidth = Number(window.localStorage.getItem(LEFT_SIDEBAR_STORAGE_KEY));
            const storedRightWidth = Number(window.localStorage.getItem(RIGHT_SIDEBAR_STORAGE_KEY));
            if (Number.isFinite(storedLeftWidth) && storedLeftWidth >= LEFT_SIDEBAR_MIN_WIDTH && storedLeftWidth <= LEFT_SIDEBAR_MAX_WIDTH) {
                dispatch({ type: 'SET_SIDEBAR_WIDTH', payload: storedLeftWidth });
            }
            if (Number.isFinite(storedRightWidth) && storedRightWidth >= RIGHT_SIDEBAR_MIN_WIDTH && storedRightWidth <= RIGHT_SIDEBAR_MAX_WIDTH) {
                dispatch({ type: 'SET_RIGHT_SIDEBAR_WIDTH', payload: storedRightWidth });
            }
        }

        window.addEventListener('resize', updateViewport);
        return () => window.removeEventListener('resize', updateViewport);
    }, [updateViewport]);

    // Persist sidebar widths
    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(LEFT_SIDEBAR_STORAGE_KEY, String(state.sidebarWidth));
    }, [state.sidebarWidth]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(RIGHT_SIDEBAR_STORAGE_KEY, String(state.rightSidebarWidth));
    }, [state.rightSidebarWidth]);

    return {
        // State
        ...state,
        // Computed values
        effectiveLeftSidebarWidth: state.viewportWidth < 1024 ? 0 : (state.isSidebarCollapsed ? LEFT_SIDEBAR_COLLAPSED_WIDTH : state.sidebarWidth),
        // Sidebar actions
        setSidebarWidth,
        setIsSidebarCollapsed,
        setRightSidebarWidth,
        // Modal actions
        openWidgetLibrary,
        closeWidgetLibrary,
        openAppsLibrary,
        closeAppsLibrary,
        openTemplateSelector,
        closeTemplateSelector,
        closeAllModals,
        // AI Copilot actions
        setShowAICopilot,
        openCopilot,
        incrementCopilotPromptLibraryRequestId,
        // Widget settings actions
        openWidgetSettings,
        closeWidgetSettings,
        // Edit mode actions
        setIsEditing,
        // Walkthrough actions
        setIsWalkthroughOpen,
        // Admin layout actions
        setAdminLayoutKey,
        setAdminLayoutControlsVisible,
        setIsPublishingSystemLayout,
        setAdminLayoutStatus,
        setTemplateApplyStatus,
        // Drag actions
        beginPaneResize,
        setDraggingPane,
    };
}

export type DashboardUIStateReturn = ReturnType<typeof useDashboardUI>;
