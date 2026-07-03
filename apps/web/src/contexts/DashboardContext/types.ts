// Types for Dashboard Context - extracted from DashboardContext.tsx

import type {
    Dashboard,
    DashboardFolder,
    DashboardTab,
    WidgetInstance,
    WidgetSyncGroup,
    DashboardState,
    DashboardCreate,
    TabCreate,
    WidgetCreate,
    WidgetType,
    WidgetConfig,
    WidgetLayout,
} from '@/types/dashboard';

// Re-export from dashboard types
export {
    type Dashboard,
    type DashboardFolder,
    type DashboardTab,
    type WidgetInstance,
    type WidgetSyncGroup,
    type DashboardState,
    type DashboardCreate,
    type TabCreate,
    type WidgetCreate,
    type WidgetType,
    type WidgetConfig,
    type WidgetLayout,
} from '@/types/dashboard';

// Generate unique IDs
export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============================================================================
// Dashboard State & Actions
// ============================================================================

export type DashboardAction =
    | { type: 'LOAD_STATE'; payload: { dashboards: Dashboard[]; folders: DashboardFolder[]; activeDashboardId: string | null; activeTabId: string | null } }
    | { type: 'SET_ACTIVE_DASHBOARD'; payload: { dashboardId: string } }
    | { type: 'ADD_DASHBOARD'; payload: { dashboard: Dashboard } }
    | { type: 'UPDATE_DASHBOARD'; payload: { dashboardId: string; updates: Partial<Dashboard> } }
    | { type: 'UPDATE_DASHBOARD_RUNTIME'; payload: { dashboardId: string; updates: Partial<Dashboard> } }
    | { type: 'DELETE_DASHBOARD'; payload: { dashboardId: string } }
    | { type: 'ADD_FOLDER'; payload: { folder: DashboardFolder } }
    | { type: 'UPDATE_FOLDER'; payload: { folderId: string; updates: Partial<DashboardFolder> } }
    | { type: 'DELETE_FOLDER'; payload: { folderId: string } }
    | { type: 'TOGGLE_FOLDER'; payload: { folderId: string } }
    | { type: 'SET_ACTIVE_TAB'; payload: { tabId: string } }
    | { type: 'ADD_TAB'; payload: { dashboardId: string; tab: DashboardTab } }
    | { type: 'UPDATE_TAB'; payload: { dashboardId: string; tabId: string; updates: Partial<DashboardTab> } }
    | { type: 'DELETE_TAB'; payload: { dashboardId: string; tabId: string } }
    | { type: 'REORDER_TABS'; payload: { dashboardId: string; tabs: DashboardTab[] } }
    | { type: 'ADD_WIDGET'; payload: { dashboardId: string; tabId: string; widget: WidgetInstance } }
    | { type: 'UPDATE_WIDGET'; payload: { dashboardId: string; tabId: string; widgetId: string; updates: Partial<WidgetInstance> } }
    | { type: 'UPDATE_WIDGET_RUNTIME'; payload: { dashboardId: string; tabId: string; widgetId: string; updates: Partial<WidgetInstance> } }
    | { type: 'DELETE_WIDGET'; payload: { dashboardId: string; tabId: string; widgetId: string } }
    | { type: 'UPDATE_TAB_LAYOUT'; payload: { dashboardId: string; tabId: string; widgets: WidgetInstance[] } }
    | { type: 'RESET_TAB_LAYOUT'; payload: { dashboardId: string; tabId: string } }
    | { type: 'UPDATE_SYNC_GROUP'; payload: { dashboardId: string; groupId: number; symbol: string } }
    | { type: 'ADD_SYNC_GROUP'; payload: { dashboardId: string; group: WidgetSyncGroup } }
    | { type: 'MOVE_DASHBOARD'; payload: { dashboardId: string; targetFolderId: string | undefined } }
    | { type: 'REORDER_DASHBOARDS'; payload: { dashboardIds: string[]; folderId: string | undefined } }
    | { type: 'APPLY_SYSTEM_TEMPLATES'; payload: Dashboard[] };

// ============================================================================
// Template Types
// ============================================================================

export interface TabTemplate {
    name: string;
    widgets: TemplateWidget[];
}

export type TemplateWidget = Omit<WidgetInstance, 'id' | 'tabId' | 'layout'> & {
    layout: Omit<WidgetInstance['layout'], 'i'>;
};

// ============================================================================
// Storage Types
// ============================================================================

export interface StoredDashboardViewState {
    activeDashboardId: string | null;
    lastActiveTabIdByDashboard: Record<string, string>;
}

export interface DashboardMigrationNotice {
    tone: 'info' | 'warning';
    message: string;
    detail: string;
}

// ============================================================================
// Context Value Type
// ============================================================================

export interface DashboardContextValue {
    state: DashboardState;
    setActiveDashboard: (id: string) => void;
    createDashboard: (data: DashboardCreate) => Dashboard;
    updateDashboard: (id: string, updates: Partial<Dashboard>) => void;
    updateDashboardRuntime: (id: string, updates: Partial<Dashboard>) => void;
    deleteDashboard: (id: string) => void;
    createFolder: (name: string) => DashboardFolder;
    updateFolder: (id: string, updates: Partial<DashboardFolder>) => void;
    deleteFolder: (id: string) => void;
    toggleFolder: (id: string) => void;
    setActiveTab: (id: string) => void;
    createTab: (dashboardId: string, name: string) => DashboardTab;
    updateTab: (dashboardId: string, tabId: string, updates: Partial<DashboardTab>) => void;
    deleteTab: (dashboardId: string, tabId: string) => void;
    reorderTabs: (dashboardId: string, tabs: DashboardTab[]) => void;
    restoreLastClosedTab: () => string | null;
    recentlyClosedTabs: ReadonlyArray<{
        dashboardId: string;
        tab: DashboardTab;
        closedAt: number;
    }>;
    applyTemplate: (dashboardId: string, tabId: string, templateName: string) => void;
    addWidget: (dashboardId: string, tabId: string, widget: WidgetCreate) => WidgetInstance;
    updateWidget: (dashboardId: string, tabId: string, widgetId: string, updates: Partial<WidgetInstance>) => void;
    updateWidgetRuntime: (dashboardId: string, tabId: string, widgetId: string, updates: Partial<WidgetInstance>) => void;
    deleteWidget: (dashboardId: string, tabId: string, widgetId: string) => void;
    cloneWidget: (dashboardId: string, tabId: string, widgetId: string) => WidgetInstance | null;
    updateTabLayout: (dashboardId: string, tabId: string, widgets: WidgetInstance[]) => void;
    resetTabLayout: (dashboardId: string, tabId: string) => void;
    updateSyncGroupSymbol: (dashboardId: string, groupId: number, symbol: string) => void;
    createSyncGroup: (dashboardId: string, symbol: string) => WidgetSyncGroup;
    setDashboardAdminUnlocked: (dashboardId: string, unlocked: boolean) => void;
    moveDashboard: (dashboardId: string, targetFolderId: string | undefined) => void;
    reorderDashboards: (dashboardIds: string[], folderId: string | undefined) => void;
    activeDashboard: Dashboard | null;
    activeTab: DashboardTab | null;
    migrationNotice: DashboardMigrationNotice | null;
    dismissMigrationNotice: () => void;
    backendSync: {
        enabled: boolean;
        status: 'idle' | 'syncing' | 'synced' | 'error';
        loadPaused: boolean;
    };
    availableTemplates: string[];
}
