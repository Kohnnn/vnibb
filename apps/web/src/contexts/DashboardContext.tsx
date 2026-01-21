// Dashboard Context - Central state management for dashboards, tabs, and widgets

'use client';

import {
    createContext,
    useContext,
    useReducer,
    useCallback,
    useEffect,
    useState,
    type ReactNode,
} from 'react';
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
    generateId,
} from '@/types/dashboard';
import { DEFAULT_SYNC_GROUP_COLORS } from '@/types/dashboard';
import { useDashboardSync } from '@/lib/useDashboardSync';
import { getWidgetDefinition } from '@/data/widgetDefinitions';
import { defaultWidgetLayouts } from '@/components/widgets/WidgetRegistry';

// ============================================================================
// Storage Keys
// ============================================================================

const STORAGE_KEY = 'vnibb_dashboards';
const FOLDERS_KEY = 'vnibb_folders';
const MIGRATION_VERSION_KEY = 'vnibb_migration_version';
const CURRENT_MIGRATION_VERSION = 2; // Increment when adding new migrations

// ============================================================================
// Default Data & Templates
// ============================================================================

// Helper to generate unique widget ID
const generateWidgetId = (prefix: string): string => 
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// Template widget definitions (without tabId - will be set on creation)
type TemplateWidget = Omit<WidgetInstance, 'id' | 'tabId' | 'layout'> & {
    layout: Omit<WidgetInstance['layout'], 'i'>;
};

// Overview Tab: TickerInfo, PriceChart, KeyMetrics, Earnings
// Note: Using 24-column grid for finer layout control
const OVERVIEW_TEMPLATE: TemplateWidget[] = [
    {
        type: 'ticker_info',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 8, h: 3, minW: 6, minH: 2 }
    },
    {
        type: 'price_chart',
        syncGroupId: 1,
        config: { timeframe: '1Y', chartType: 'candle' },
        layout: { x: 8, y: 0, w: 16, h: 7, minW: 8, minH: 4 }
    },
    {
        type: 'key_metrics',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 3, w: 8, h: 6, minW: 6, minH: 4 }
    },
    {
        type: 'valuation_multiples',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 9, w: 8, h: 6, minW: 6, minH: 4 }
    },
    {
        type: 'ticker_profile',
        syncGroupId: 1,
        config: {},
        layout: { x: 8, y: 7, w: 8, h: 8, minW: 6, minH: 4 }
    },
    {
        type: 'news_feed',
        syncGroupId: 1,
        config: {},
        layout: { x: 16, y: 7, w: 8, h: 8, minW: 6, minH: 4 }
    }
];


// Financials Tab: Income, Balance, CashFlow, Ratios
const FINANCIALS_TEMPLATE: TemplateWidget[] = [
    {
        type: 'income_statement',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 12, h: 7, minW: 8, minH: 4 }
    },
    {
        type: 'balance_sheet',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 0, w: 12, h: 7, minW: 8, minH: 4 }
    },
    {
        type: 'cash_flow',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 7, w: 12, h: 7, minW: 8, minH: 4 }
    },
    {
        type: 'financial_ratios',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 7, w: 12, h: 7, minW: 8, minH: 4 }
    }
];

// Technical Analysis Tab: PriceChart (large), Volume, Technical Summary
const TECHNICAL_TEMPLATE: TemplateWidget[] = [
    {
        type: 'price_chart',
        syncGroupId: 1,
        config: { timeframe: '6M', chartType: 'candle' },
        layout: { x: 0, y: 0, w: 24, h: 8, minW: 12, minH: 4 }
    },
    {
        type: 'volume_analysis',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 8, w: 12, h: 6, minW: 6, minH: 4 }
    },
    {
        type: 'technical_summary',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 8, w: 12, h: 6, minW: 6, minH: 4 }
    }
];

// Ownership Tab: Major Shareholders, Officers, Foreign Trading, Insider Deals
const OWNERSHIP_TEMPLATE: TemplateWidget[] = [
    {
        type: 'major_shareholders',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 12, h: 7, minW: 6, minH: 4 }
    },
    {
        type: 'officers_management',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 0, w: 12, h: 7, minW: 6, minH: 4 }
    },
    {
        type: 'foreign_trading',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 7, w: 12, h: 7, minW: 6, minH: 4 }
    },
    {
        type: 'insider_trading',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 7, w: 12, h: 6, minW: 8, minH: 4 }
    }
];

// Calendar Tab: Events, Dividends, Economic Calendar
const CALENDAR_TEMPLATE: TemplateWidget[] = [
    {
        type: 'events_calendar',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 12, h: 7, minW: 6, minH: 4 }
    },
    {
        type: 'dividend_payment',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 0, w: 12, h: 5, minW: 8, minH: 3 }
    },
    {
        type: 'economic_calendar',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 5, w: 12, h: 7, minW: 6, minH: 4 }
    }
];

// Map template name to widgets
const DASHBOARD_TEMPLATES: Record<string, TemplateWidget[]> = {
    overview: OVERVIEW_TEMPLATE,
    financials: FINANCIALS_TEMPLATE,
    technical: TECHNICAL_TEMPLATE,
    ownership: OWNERSHIP_TEMPLATE,
    calendar: CALENDAR_TEMPLATE,
};

// Map tab names to template names for migration
const TAB_NAME_TO_TEMPLATE: Record<string, string> = {
    'overview': 'overview',
    'financials': 'financials',
    'technical analysis': 'technical',
    'technical': 'technical',
    'ownership': 'ownership',
    'calendar': 'calendar',
};

// Migration: Apply templates to empty tabs that should have widgets
const migrateEmptyTabs = (dashboards: Dashboard[]): Dashboard[] => {
    return dashboards.map(dashboard => ({
        ...dashboard,
        tabs: dashboard.tabs.map(tab => {
            // Skip tabs that already have widgets
            if (tab.widgets.length > 0) return tab;
            
            // Find matching template by tab name (case-insensitive)
            const templateName = TAB_NAME_TO_TEMPLATE[tab.name.toLowerCase()];
            if (!templateName) return tab;
            
            const template = DASHBOARD_TEMPLATES[templateName];
            if (!template) return tab;
            
            // Apply template to empty tab
            const widgets = createWidgetsFromTemplate(template, tab.id);
            return { ...tab, widgets };
        }),
    }));
};

// Convert template widgets to actual widget instances
const createWidgetsFromTemplate = (template: TemplateWidget[], tabId: string): WidgetInstance[] => {
    return template.map((tw) => {
        const widgetId = generateWidgetId(tw.type);
        return {
            id: widgetId,
            type: tw.type,
            tabId,
            syncGroupId: tw.syncGroupId,
            config: tw.config,
            layout: {
                i: widgetId,
                ...tw.layout,
            },
        };
    });
};

// Create a tab with pre-populated widgets from template
const createTabWithTemplate = (
    name: string, 
    order: number, 
    templateName: string
): DashboardTab => {
    const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const template = DASHBOARD_TEMPLATES[templateName] || [];
    const widgets = createWidgetsFromTemplate(template, tabId);
    
    return {
        id: tabId,
        name,
        order,
        widgets,
    };
};

const createDefaultTab = (name: string, order: number): DashboardTab => ({
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name,
    order,
    widgets: [],
});

const createDefaultDashboard = (): Dashboard => {
    // Stagger tab creation to ensure unique timestamps
    const tabs: DashboardTab[] = [];
    
    // Create tabs with templates - small delay between each to ensure unique IDs
    tabs.push(createTabWithTemplate('Overview', 0, 'overview'));
    tabs.push(createTabWithTemplate('Financials', 1, 'financials'));
    tabs.push(createTabWithTemplate('Technical Analysis', 2, 'technical'));
    tabs.push(createTabWithTemplate('Ownership', 3, 'ownership'));
    tabs.push(createTabWithTemplate('Calendar', 4, 'calendar'));
    
    return {
        id: `dash-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: 'Stock Research',
        description: 'Default research dashboard with pre-configured widgets',
        order: 0,
        isDefault: true,
        showGroupLabels: true,
        tabs,
        syncGroups: [
            { id: 1, name: 'Group 1', color: DEFAULT_SYNC_GROUP_COLORS[0], currentSymbol: 'VNM' },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
};

// ============================================================================
// Actions
// ============================================================================

type DashboardAction =
    | { type: 'SET_STATE'; payload: DashboardState }
    | { type: 'SET_ACTIVE_DASHBOARD'; payload: string }
    | { type: 'SET_ACTIVE_TAB'; payload: string }
    | { type: 'ADD_DASHBOARD'; payload: Dashboard }
    | { type: 'UPDATE_DASHBOARD'; payload: { id: string; updates: Partial<Dashboard> } }
    | { type: 'DELETE_DASHBOARD'; payload: string }
    | { type: 'ADD_FOLDER'; payload: DashboardFolder }
    | { type: 'UPDATE_FOLDER'; payload: { id: string; updates: Partial<DashboardFolder> } }
    | { type: 'DELETE_FOLDER'; payload: string }
    | { type: 'ADD_TAB'; payload: { dashboardId: string; tab: DashboardTab } }
    | { type: 'UPDATE_TAB'; payload: { dashboardId: string; tabId: string; updates: Partial<DashboardTab> } }
    | { type: 'DELETE_TAB'; payload: { dashboardId: string; tabId: string } }
    | { type: 'REORDER_TABS'; payload: { dashboardId: string; tabs: DashboardTab[] } }
    | { type: 'ADD_WIDGET'; payload: { dashboardId: string; tabId: string; widget: WidgetInstance } }
    | { type: 'UPDATE_WIDGET'; payload: { dashboardId: string; tabId: string; widgetId: string; updates: Partial<WidgetInstance> } }
    | { type: 'DELETE_WIDGET'; payload: { dashboardId: string; tabId: string; widgetId: string } }
    | { type: 'UPDATE_TAB_LAYOUT'; payload: { dashboardId: string; tabId: string; widgets: WidgetInstance[] } }
    | { type: 'RESET_TAB_LAYOUT'; payload: { dashboardId: string; tabId: string } }
    | { type: 'UPDATE_SYNC_GROUP'; payload: { dashboardId: string; groupId: number; symbol: string } }
    | { type: 'ADD_SYNC_GROUP'; payload: { dashboardId: string; group: WidgetSyncGroup } }
    | { type: 'MOVE_DASHBOARD'; payload: { dashboardId: string; targetFolderId: string | undefined } }
    | { type: 'REORDER_DASHBOARDS'; payload: { dashboardIds: string[]; folderId: string | undefined } };

// ============================================================================
// Reducer
// ============================================================================

function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
    switch (action.type) {
        case 'SET_STATE':
            return action.payload;

        case 'SET_ACTIVE_DASHBOARD':
            return { ...state, activeDashboardId: action.payload };

        case 'SET_ACTIVE_TAB':
            return { ...state, activeTabId: action.payload };

        case 'ADD_DASHBOARD':
            return {
                ...state,
                dashboards: [...state.dashboards, action.payload],
            };

        case 'UPDATE_DASHBOARD':
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.id
                        ? { ...d, ...action.payload.updates, updatedAt: new Date().toISOString() }
                        : d
                ),
            };

        case 'DELETE_DASHBOARD':
            return {
                ...state,
                dashboards: state.dashboards.filter((d) => d.id !== action.payload),
                activeDashboardId:
                    state.activeDashboardId === action.payload
                        ? state.dashboards[0]?.id || null
                        : state.activeDashboardId,
            };

        case 'ADD_FOLDER':
            return {
                ...state,
                folders: [...state.folders, action.payload],
            };

        case 'UPDATE_FOLDER':
            return {
                ...state,
                folders: state.folders.map((f) =>
                    f.id === action.payload.id ? { ...f, ...action.payload.updates } : f
                ),
            };

        case 'DELETE_FOLDER':
            return {
                ...state,
                folders: state.folders.filter((f) => f.id !== action.payload),
                // Move dashboards out of deleted folder
                dashboards: state.dashboards.map((d) =>
                    d.folderId === action.payload ? { ...d, folderId: undefined } : d
                ),
            };

        case 'ADD_TAB': {
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? { ...d, tabs: [...d.tabs, action.payload.tab], updatedAt: new Date().toISOString() }
                        : d
                ),
            };
        }

        case 'UPDATE_TAB': {
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? {
                            ...d,
                            tabs: d.tabs.map((t) =>
                                t.id === action.payload.tabId ? { ...t, ...action.payload.updates } : t
                            ),
                            updatedAt: new Date().toISOString(),
                        }
                        : d
                ),
            };
        }

        case 'DELETE_TAB': {
            const targetDashboard = state.dashboards.find((d) => d.id === action.payload.dashboardId);
            const remainingTabs = targetDashboard?.tabs.filter((t) => t.id !== action.payload.tabId) || [];
            // Sort by order to get the first tab correctly
            const sortedRemainingTabs = [...remainingTabs].sort((a, b) => a.order - b.order);
            const newActiveTabId = state.activeTabId === action.payload.tabId
                ? sortedRemainingTabs[0]?.id || null
                : state.activeTabId;

            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? {
                            ...d,
                            tabs: remainingTabs,
                            updatedAt: new Date().toISOString(),
                        }
                        : d
                ),
                activeTabId: newActiveTabId,
            };
        }

        case 'REORDER_TABS': {
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? { ...d, tabs: action.payload.tabs, updatedAt: new Date().toISOString() }
                        : d
                ),
            };
        }

        case 'ADD_WIDGET': {
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? {
                            ...d,
                            tabs: d.tabs.map((t) =>
                                t.id === action.payload.tabId
                                    ? { ...t, widgets: [...t.widgets, action.payload.widget] }
                                    : t
                            ),
                            updatedAt: new Date().toISOString(),
                        }
                        : d
                ),
            };
        }

        case 'UPDATE_WIDGET': {
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? {
                            ...d,
                            tabs: d.tabs.map((t) =>
                                t.id === action.payload.tabId
                                    ? {
                                        ...t,
                                        widgets: t.widgets.map((w) =>
                                            w.id === action.payload.widgetId
                                                ? { ...w, ...action.payload.updates }
                                                : w
                                        ),
                                    }
                                    : t
                            ),
                            updatedAt: new Date().toISOString(),
                        }
                        : d
                ),
            };
        }

        case 'DELETE_WIDGET': {
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? {
                            ...d,
                            tabs: d.tabs.map((t) =>
                                t.id === action.payload.tabId
                                    ? { ...t, widgets: t.widgets.filter((w) => w.id !== action.payload.widgetId) }
                                    : t
                            ),
                            updatedAt: new Date().toISOString(),
                        }
                        : d
                ),
            };
        }

        case 'UPDATE_TAB_LAYOUT': {
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? {
                            ...d,
                            tabs: d.tabs.map((t) =>
                                t.id === action.payload.tabId
                                    ? { ...t, widgets: action.payload.widgets }
                                    : t
                            ),
                            updatedAt: new Date().toISOString(),
                        }
                        : d
                ),
            };
        }

        case 'RESET_TAB_LAYOUT': {
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? {
                            ...d,
                            tabs: d.tabs.map((t) => {
                                if (t.id !== action.payload.tabId) return t;
                                // Reset each widget to its default layout from widgetDefinitions
                                let currentX = 0;
                                let currentY = 0;
                                const cols = 24;  // Updated to match new 24-column grid
                                const resetWidgets = t.widgets.map((w) => {
                                    const definition = getWidgetDefinition(w.type);
                                    // Scale default widths for 24-column grid (multiply by 2)
                                    const defaultW = (definition?.defaultLayout.w ?? 6) * 2;
                                    const defaultH = definition?.defaultLayout.h ?? 4;
                                    const minW = (definition?.defaultLayout.minW ?? 2) * 2;
                                    const minH = definition?.defaultLayout.minH ?? 2;

                                    // Auto-flow: if widget doesn't fit on current row, move to next
                                    if (currentX + defaultW > cols) {
                                        currentX = 0;
                                        currentY += defaultH;
                                    }

                                    const newLayout = {
                                        ...w.layout,
                                        x: currentX,
                                        y: currentY,
                                        w: defaultW,
                                        h: defaultH,
                                        minW,
                                        minH,
                                    };

                                    currentX += defaultW;

                                    return { ...w, layout: newLayout };
                                });
                                return { ...t, widgets: resetWidgets };
                            }),
                            updatedAt: new Date().toISOString(),
                        }
                        : d
                ),
            };
        }

        case 'UPDATE_SYNC_GROUP': {
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? {
                            ...d,
                            syncGroups: d.syncGroups.map((g) =>
                                g.id === action.payload.groupId
                                    ? { ...g, currentSymbol: action.payload.symbol }
                                    : g
                            ),
                            updatedAt: new Date().toISOString(),
                        }
                        : d
                ),
            };
        }

        case 'ADD_SYNC_GROUP': {
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? {
                            ...d,
                            syncGroups: [...d.syncGroups, action.payload.group],
                            updatedAt: new Date().toISOString(),
                        }
                        : d
                ),
            };
        }

        case 'MOVE_DASHBOARD': {
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? { ...d, folderId: action.payload.targetFolderId, updatedAt: new Date().toISOString() }
                        : d
                ),
            };
        }

        case 'REORDER_DASHBOARDS': {
            const { dashboardIds, folderId } = action.payload;
            return {
                ...state,
                dashboards: state.dashboards.map((d) => {
                    const newIndex = dashboardIds.indexOf(d.id);
                    if (newIndex !== -1) {
                        return { ...d, order: newIndex, folderId, updatedAt: new Date().toISOString() };
                    }
                    return d;
                }),
            };
        }

        default:
            return state;
    }
}

// ============================================================================
// Context
// ============================================================================

interface DashboardContextValue {
    state: DashboardState;
    // Dashboard actions
    setActiveDashboard: (id: string) => void;
    createDashboard: (data: DashboardCreate) => Dashboard;
    updateDashboard: (id: string, updates: Partial<Dashboard>) => void;
    deleteDashboard: (id: string) => void;
    // Folder actions
    createFolder: (name: string) => DashboardFolder;
    updateFolder: (id: string, updates: Partial<DashboardFolder>) => void;
    deleteFolder: (id: string) => void;
    toggleFolder: (id: string) => void;
    // Tab actions
    setActiveTab: (id: string) => void;
    createTab: (dashboardId: string, name: string) => DashboardTab;
    updateTab: (dashboardId: string, tabId: string, updates: Partial<DashboardTab>) => void;
    deleteTab: (dashboardId: string, tabId: string) => void;
    reorderTabs: (dashboardId: string, tabs: DashboardTab[]) => void;
    applyTemplate: (dashboardId: string, tabId: string, templateName: string) => void;
    // Widget actions
    addWidget: (dashboardId: string, tabId: string, widget: WidgetCreate) => WidgetInstance;
    updateWidget: (dashboardId: string, tabId: string, widgetId: string, updates: Partial<WidgetInstance>) => void;
    deleteWidget: (dashboardId: string, tabId: string, widgetId: string) => void;
    updateTabLayout: (dashboardId: string, tabId: string, widgets: WidgetInstance[]) => void;
    resetTabLayout: (dashboardId: string, tabId: string) => void;
    // Sync group actions
    updateSyncGroupSymbol: (dashboardId: string, groupId: number, symbol: string) => void;
    createSyncGroup: (dashboardId: string, symbol: string) => WidgetSyncGroup;
    // Move & Reorder actions
    moveDashboard: (dashboardId: string, targetFolderId: string | undefined) => void;
    reorderDashboards: (dashboardIds: string[], folderId: string | undefined) => void;
    // Computed values
    activeDashboard: Dashboard | null;
    activeTab: DashboardTab | null;
    // Template helpers
    availableTemplates: string[];
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface DashboardProviderProps {
    children: ReactNode;
}

export function DashboardProvider({ children }: DashboardProviderProps) {
    const [state, dispatch] = useReducer(dashboardReducer, {
        dashboards: [],
        folders: [],
        activeDashboardId: null,
        activeTabId: null,
    });

    // Load from localStorage on mount
    useEffect(() => {
        if (typeof window === 'undefined') return;

        try {
            const storedDashboards = localStorage.getItem(STORAGE_KEY);
            const storedFolders = localStorage.getItem(FOLDERS_KEY);
            const storedMigrationVersion = localStorage.getItem(MIGRATION_VERSION_KEY);
            const migrationVersion = storedMigrationVersion ? parseInt(storedMigrationVersion, 10) : 0;

            let dashboards: Dashboard[] = [];
            let folders: DashboardFolder[] = [];

            if (storedDashboards) {
                dashboards = JSON.parse(storedDashboards);
            }
            if (storedFolders) {
                folders = JSON.parse(storedFolders);
            }

            // Create default dashboard if none exist
            if (dashboards.length === 0) {
                dashboards = [createDefaultDashboard()];
            } else if (migrationVersion < CURRENT_MIGRATION_VERSION) {
                // Apply migrations for existing dashboards
                // Migration v2: Apply templates to empty tabs
                dashboards = migrateEmptyTabs(dashboards);
                
                // Final safety validation for all widgets
                dashboards = dashboards.map(d => ({
                    ...d,
                    tabs: d.tabs.map(t => ({
                        ...t,
                        widgets: t.widgets.filter(w => {
                            if (!w.type || typeof w.type !== 'string') {
                                console.warn('Removing invalid widget (missing type):', w);
                                return false;
                            }
                            return true;
                        })
                    }))
                }));

                // Save migration version
                localStorage.setItem(MIGRATION_VERSION_KEY, String(CURRENT_MIGRATION_VERSION));
            }

            const activeDashboardId = dashboards[0]?.id || null;
            const activeTabId = dashboards[0]?.tabs[0]?.id || null;

            dispatch({
                type: 'SET_STATE',
                payload: { dashboards, folders, activeDashboardId, activeTabId },
            });
        } catch (error) {
            console.error('Failed to load dashboards from storage:', error);
            const defaultDashboard = createDefaultDashboard();
            dispatch({
                type: 'SET_STATE',
                payload: {
                    dashboards: [defaultDashboard],
                    folders: [],
                    activeDashboardId: defaultDashboard.id,
                    activeTabId: defaultDashboard.tabs[0]?.id || null,
                },
            });
        }
    }, []);

    // Save to localStorage on state change
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (state.dashboards.length === 0) return;

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.dashboards));
            localStorage.setItem(FOLDERS_KEY, JSON.stringify(state.folders));
        } catch (error) {
            console.error('Failed to save dashboards to storage:', error);
        }
    }, [state.dashboards, state.folders]);

    // Sync to backend (debounced)
    const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');

    useDashboardSync(state, {
        enabled: true,
        onSyncSuccess: () => setSyncStatus('synced'),
        onSyncError: () => setSyncStatus('error'),
    });

    // ========================================================================
    // Dashboard Actions
    // ========================================================================

    const setActiveDashboard = useCallback((id: string) => {
        dispatch({ type: 'SET_ACTIVE_DASHBOARD', payload: id });
        // Also set first tab as active
        const dashboard = state.dashboards.find((d) => d.id === id);
        if (dashboard?.tabs[0]) {
            dispatch({ type: 'SET_ACTIVE_TAB', payload: dashboard.tabs[0].id });
        }
    }, [state.dashboards]);

    const createDashboard = useCallback((data: DashboardCreate): Dashboard => {
        const now = new Date().toISOString();
        const dashboard: Dashboard = {
            id: `dash-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name: data.name,
            description: data.description,
            folderId: data.folderId,
            order: state.dashboards.length,
            isDefault: data.isDefault || false,
            showGroupLabels: true,
            tabs: [createDefaultTab('Overview', 0)],
            syncGroups: [
                { id: 1, name: 'Group 1', color: DEFAULT_SYNC_GROUP_COLORS[0], currentSymbol: 'VNM' },
            ],
            createdAt: now,
            updatedAt: now,
        };
        dispatch({ type: 'ADD_DASHBOARD', payload: dashboard });
        return dashboard;
    }, [state.dashboards.length]);

    const updateDashboard = useCallback((id: string, updates: Partial<Dashboard>) => {
        dispatch({ type: 'UPDATE_DASHBOARD', payload: { id, updates } });
    }, []);

    const deleteDashboard = useCallback((id: string) => {
        dispatch({ type: 'DELETE_DASHBOARD', payload: id });
    }, []);

    // ========================================================================
    // Folder Actions
    // ========================================================================

    const createFolder = useCallback((name: string): DashboardFolder => {
        const folder: DashboardFolder = {
            id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name,
            order: state.folders.length,
            isExpanded: true,
        };
        dispatch({ type: 'ADD_FOLDER', payload: folder });
        return folder;
    }, [state.folders.length]);

    const updateFolder = useCallback((id: string, updates: Partial<DashboardFolder>) => {
        dispatch({ type: 'UPDATE_FOLDER', payload: { id, updates } });
    }, []);

    const deleteFolder = useCallback((id: string) => {
        dispatch({ type: 'DELETE_FOLDER', payload: id });
    }, []);

    const toggleFolder = useCallback((id: string) => {
        const folder = state.folders.find((f) => f.id === id);
        if (folder) {
            dispatch({ type: 'UPDATE_FOLDER', payload: { id, updates: { isExpanded: !folder.isExpanded } } });
        }
    }, [state.folders]);

    // ========================================================================
    // Tab Actions
    // ========================================================================

    const setActiveTab = useCallback((id: string) => {
        dispatch({ type: 'SET_ACTIVE_TAB', payload: id });
    }, []);

    const createTab = useCallback((dashboardId: string, name: string): DashboardTab => {
        const dashboard = state.dashboards.find((d) => d.id === dashboardId);
        const tab = createDefaultTab(name, dashboard?.tabs.length || 0);
        dispatch({ type: 'ADD_TAB', payload: { dashboardId, tab } });
        return tab;
    }, [state.dashboards]);

    const updateTab = useCallback((dashboardId: string, tabId: string, updates: Partial<DashboardTab>) => {
        dispatch({ type: 'UPDATE_TAB', payload: { dashboardId, tabId, updates } });
    }, []);

    const deleteTab = useCallback((dashboardId: string, tabId: string) => {
        dispatch({ type: 'DELETE_TAB', payload: { dashboardId, tabId } });
    }, []);

    const reorderTabs = useCallback((dashboardId: string, tabs: DashboardTab[]) => {
        dispatch({ type: 'REORDER_TABS', payload: { dashboardId, tabs } });
    }, []);

    const applyTemplate = useCallback((dashboardId: string, tabId: string, templateName: string) => {
        const template = DASHBOARD_TEMPLATES[templateName];
        if (!template) {
            console.warn(`Template "${templateName}" not found. Available: ${Object.keys(DASHBOARD_TEMPLATES).join(', ')}`);
            return;
        }
        
        const widgets = createWidgetsFromTemplate(template, tabId);
        dispatch({ type: 'UPDATE_TAB_LAYOUT', payload: { dashboardId, tabId, widgets } });
    }, []);

    // ========================================================================
    // Widget Actions
    // ========================================================================

    const addWidget = useCallback((dashboardId: string, tabId: string, data: WidgetCreate): WidgetInstance => {
        // Get default layout constraints from WidgetRegistry
        const defaults = defaultWidgetLayouts[data.type as keyof typeof defaultWidgetLayouts];
        const widgetId = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        
        const widget: WidgetInstance = {
            id: widgetId,
            type: data.type,
            tabId,
            syncGroupId: data.syncGroupId,
            config: data.config || {},
            layout: {
                i: widgetId,
                x: data.layout?.x ?? 0,
                y: data.layout?.y ?? Infinity, // Place at bottom if not specified
                w: data.layout?.w ?? (defaults?.w ?? 6),
                h: data.layout?.h ?? (defaults?.h ?? 4),
                // Always apply minW/minH from registry for proper resize constraints
                minW: data.layout?.minW ?? defaults?.minW ?? 3,
                minH: data.layout?.minH ?? defaults?.minH ?? 2,
            },
        };
        dispatch({ type: 'ADD_WIDGET', payload: { dashboardId, tabId, widget } });
        return widget;
    }, []);

    const updateWidget = useCallback((
        dashboardId: string,
        tabId: string,
        widgetId: string,
        updates: Partial<WidgetInstance>
    ) => {
        dispatch({ type: 'UPDATE_WIDGET', payload: { dashboardId, tabId, widgetId, updates } });
    }, []);

    const deleteWidget = useCallback((dashboardId: string, tabId: string, widgetId: string) => {
        dispatch({ type: 'DELETE_WIDGET', payload: { dashboardId, tabId, widgetId } });
    }, []);

    const updateTabLayout = useCallback((dashboardId: string, tabId: string, widgets: WidgetInstance[]) => {
        dispatch({ type: 'UPDATE_TAB_LAYOUT', payload: { dashboardId, tabId, widgets } });
    }, []);

    const resetTabLayout = useCallback((dashboardId: string, tabId: string) => {
        dispatch({ type: 'RESET_TAB_LAYOUT', payload: { dashboardId, tabId } });
    }, []);

    // ========================================================================
    // Sync Group Actions
    // ========================================================================

    const updateSyncGroupSymbol = useCallback((dashboardId: string, groupId: number, symbol: string) => {
        dispatch({ type: 'UPDATE_SYNC_GROUP', payload: { dashboardId, groupId, symbol } });
    }, []);

    const createSyncGroup = useCallback((dashboardId: string, symbol: string): WidgetSyncGroup => {
        const dashboard = state.dashboards.find((d) => d.id === dashboardId);
        const nextId = (dashboard?.syncGroups.length || 0) + 1;
        const colorIndex = (nextId - 1) % DEFAULT_SYNC_GROUP_COLORS.length;
        const group: WidgetSyncGroup = {
            id: nextId,
            name: `Group ${nextId}`,
            color: DEFAULT_SYNC_GROUP_COLORS[colorIndex],
            currentSymbol: symbol,
        };
        dispatch({ type: 'ADD_SYNC_GROUP', payload: { dashboardId, group } });
        return group;
    }, [state.dashboards]);

    // ========================================================================
    // Move & Reorder Actions
    // ========================================================================

    const moveDashboard = useCallback((dashboardId: string, targetFolderId: string | undefined) => {
        dispatch({ type: 'MOVE_DASHBOARD', payload: { dashboardId, targetFolderId } });
    }, []);

    const reorderDashboards = useCallback((dashboardIds: string[], folderId: string | undefined) => {
        dispatch({ type: 'REORDER_DASHBOARDS', payload: { dashboardIds, folderId } });
    }, []);

    // ========================================================================
    // Computed Values
    // ========================================================================

    const activeDashboard = state.dashboards.find((d) => d.id === state.activeDashboardId) || null;
    const activeTab = activeDashboard?.tabs.find((t) => t.id === state.activeTabId) || null;

    // ========================================================================
    // Context Value
    // ========================================================================

    const value: DashboardContextValue = {
        state,
        setActiveDashboard,
        createDashboard,
        updateDashboard,
        deleteDashboard,
        createFolder,
        updateFolder,
        deleteFolder,
        toggleFolder,
        setActiveTab,
        createTab,
        updateTab,
        deleteTab,
        reorderTabs,
        applyTemplate,
        addWidget,
        updateWidget,
        deleteWidget,
        updateTabLayout,
        resetTabLayout,
        updateSyncGroupSymbol,
        createSyncGroup,
        moveDashboard,
        reorderDashboards,
        activeDashboard,
        activeTab,
        availableTemplates: Object.keys(DASHBOARD_TEMPLATES),
    };

    return (
        <DashboardContext.Provider value={value}>
            {children}
        </DashboardContext.Provider>
    );
}

// ============================================================================
// Hook
// ============================================================================

export function useDashboard() {
    const context = useContext(DashboardContext);
    if (!context) {
        throw new Error('useDashboard must be used within a DashboardProvider');
    }
    return context;
}
