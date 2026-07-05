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
import { flushSync } from 'react-dom';
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
} from '@/types/dashboard';

// Re-export everything from submodules for backward compatibility
export * from './types';
export * from './constants';
export * from './templates';
export * from './migrations';
export * from './actions';
export * from './reducer';
export * from './hooks';

// ============================================================================
// Storage Keys (local to this file for now - will be moved to constants)
// ============================================================================

const STORAGE_KEY = 'vnibb_dashboards';
const FOLDERS_KEY = 'vnibb_folders';
const STORAGE_VERSION_KEY = 'vnibb-dashboard-version';
const CURRENT_STORAGE_VERSION = 'v73';
const MIGRATION_VERSION_KEY = 'vnibb_migration_version';
const CURRENT_MIGRATION_VERSION = 22;
const LAST_VIEW_STATE_KEY = 'vnibb-dashboard-last-view';
const DASHBOARD_RECOVERY_BACKUP_KEY = 'vnibb_dashboards_recovery_backup_v1';

interface StoredDashboardViewState {
    activeDashboardId: string | null;
    lastActiveTabIdByDashboard: Record<string, string>;
}

function backupUnreadableDashboardStorage(rawDashboards: string | null, rawFolders: string | null): boolean {
    if (typeof window === 'undefined') return false;

    try {
        window.localStorage.setItem(
            DASHBOARD_RECOVERY_BACKUP_KEY,
            JSON.stringify({
                createdAt: new Date().toISOString(),
                dashboards: rawDashboards,
                folders: rawFolders,
            })
        );
        return true;
    } catch (error) {
        console.warn('Failed to back up unreadable dashboard storage:', error);
        return false;
    }
}

function readStoredDashboardViewState(): StoredDashboardViewState {
    if (typeof window === 'undefined') {
        return { activeDashboardId: null, lastActiveTabIdByDashboard: {} };
    }

    try {
        const raw = window.localStorage.getItem(LAST_VIEW_STATE_KEY);
        if (!raw) {
            return { activeDashboardId: null, lastActiveTabIdByDashboard: {} };
        }

        const parsed = JSON.parse(raw) as Partial<StoredDashboardViewState>;
        return {
            activeDashboardId: typeof parsed.activeDashboardId === 'string' ? parsed.activeDashboardId : null,
            lastActiveTabIdByDashboard:
                parsed.lastActiveTabIdByDashboard && typeof parsed.lastActiveTabIdByDashboard === 'object'
                    ? Object.fromEntries(
                        Object.entries(parsed.lastActiveTabIdByDashboard).filter(
                            (entry): entry is [string, string] => typeof entry[1] === 'string'
                        )
                    )
                    : {},
        };
    } catch {
        return { activeDashboardId: null, lastActiveTabIdByDashboard: {} };
    }
}

function writeStoredDashboardViewState(next: StoredDashboardViewState): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LAST_VIEW_STATE_KEY, JSON.stringify(next));
}

// ============================================================================
// Import from submodules
// ============================================================================

// These come from ./templates (moved from DashboardContext.tsx)
export {
    MAIN_TAB_TEMPLATES,
    TAB_WIDGET_TEMPLATES,
    TAB_NAME_TO_TEMPLATE_KEY,
    countDashboardWidgets,
    generateWidgetId,
    createWidgetsFromTemplate,
} from './templates';

// Import names locally for use in this file
import {
    MAIN_TAB_TEMPLATES,
    TAB_WIDGET_TEMPLATES,
    createWidgetsFromTemplate,
} from './templates';

import {
    LEGACY_DASHBOARD_NAME_RE,
    LEGACY_SIDEBAR_DASHBOARD_RE,
    LEGACY_MANAGE_TAB_NAME_RE,
    LEGACY_STALE_TAB_RE,
    LEGACY_MAIN_DASHBOARD_ID,
    INITIAL_FOLDER_ID,
    MAIN_DASHBOARD_ID,
    MAIN_DASHBOARD_NAME,
    TECHNICAL_DASHBOARD_ID,
    QUANT_DASHBOARD_ID,
    GLOBAL_MARKETS_DASHBOARD_ID,
    GLOBAL_MARKETS_DASHBOARD_NAME,
    SYSTEM_DASHBOARD_IDS,
    GLOBAL_SYSTEM_TEMPLATE_IDS,
    INITIAL_FOLDER_NAME,
} from './constants';

// Migration functions come from ./migrations (moved from DashboardContext.tsx)
export {
    migrateEmptyTabs,
    migrateLegacyWidgetTypes,
    migrateLegacyWidgetLayoutBounds,
    migrateLegacyDashboardNames,
    migrateLegacyChartWidgets,
    migrateLegacySidebarDashboards,
    migrateManageTabs,
    migrateStaleTabs,
} from './migrations';

// System dashboard factories for tests and generators
export {
    createMainSystemDashboard,
    createTechnicalSystemDashboard,
    createQuantSystemDashboard,
    createGlobalMarketsDashboard,
    shouldRefreshGlobalMarketsLayout,
} from './systemDashboards';

// Import migration functions locally for use in this file
import {
    migrateEmptyTabs,
    migrateLegacyWidgetTypes,
    migrateLegacyWidgetLayoutBounds,
    migrateLegacyDashboardNames,
    migrateLegacyChartWidgets,
    migrateLegacySidebarDashboards,
    migrateManageTabs,
    migrateStaleTabs,
} from './migrations';

import { dashboardReducer } from './reducer';
import type { DashboardAction } from './types';
import { generateId } from './types';
import { DEFAULT_SYNC_GROUP_COLORS } from '@/types/dashboard';
import { DEFAULT_TICKER, readStoredTicker } from '@/lib/defaultTicker';
import { DEFAULT_GLOBAL_MARKETS_SYMBOL, isLegacyGlobalMarketsSymbol } from '@/lib/globalMarketsSymbol';
import { findPreferredDashboardId, findPreferredTabId, readStoredUserPreferences } from '@/lib/userPreferences';
import { useDashboardSync, useLoadFromBackend } from '@/lib/useDashboardSync';
import { config } from '@/lib/config';
import { normalizeWidgetType } from '@/data/widgetDefinitions';
import { autoFitGridItems, compactGridItems, findNextAvailableLayout, getWidgetDefaultLayout, layoutsOverlap, preserveTemplateGridItems } from '@/lib/dashboardLayout';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
import { getPublishedSystemDashboardTemplates } from '@/lib/api';

interface DashboardMigrationNotice {
    tone: 'info' | 'warning';
    message: string;
    detail: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

const canEditDashboard = (dashboard: Dashboard): boolean => {
    if (dashboard.isEditable === false) return false;
    if (SYSTEM_DASHBOARD_IDS.has(dashboard.id)) return false;
    return true;
};

const isEditableDashboardId = (dashboardId: string): boolean => {
    if (dashboardId === MAIN_DASHBOARD_ID) return false;
    if (dashboardId === TECHNICAL_DASHBOARD_ID) return false;
    if (dashboardId === QUANT_DASHBOARD_ID) return false;
    return true;
};

// ============================================================================
// Action Creators (inline for now - extracted to actions.ts)
// ============================================================================

type DashboardActionType = DashboardAction['type'];

const createInitialState = (): DashboardState => ({
    dashboards: [],
    folders: [],
    activeDashboardId: null,
    activeTabId: null,
});

function createSystemDashboards(): Dashboard[] {
    const now = new Date().toISOString();
    const defaultSyncGroups: WidgetSyncGroup[] = [
        { id: 1, name: 'Group 1', color: DEFAULT_SYNC_GROUP_COLORS[0], currentSymbol: DEFAULT_TICKER },
        { id: 2, name: 'Group 2', color: DEFAULT_SYNC_GROUP_COLORS[1], currentSymbol: DEFAULT_TICKER },
    ];

    return [
        {
            id: MAIN_DASHBOARD_ID,
            name: MAIN_DASHBOARD_NAME,
            description: 'Comprehensive fundamental analysis workspace',
            folderId: INITIAL_FOLDER_ID,
            order: 0,
            isDefault: true,
            isEditable: true,
            adminUnlocked: false,
            showGroupLabels: false,
            tabs: MAIN_TAB_TEMPLATES.map((tabTemplate, index) => ({
                id: `${MAIN_DASHBOARD_ID}-tab-${index}`,
                name: tabTemplate.name,
                order: index,
                widgets: createWidgetsFromTemplate(tabTemplate.widgets, `${MAIN_DASHBOARD_ID}-tab-${index}`),
            })),
            syncGroups: defaultSyncGroups,
            createdAt: now,
            updatedAt: now,
        },
        {
            id: TECHNICAL_DASHBOARD_ID,
            name: 'Technical',
            description: 'Technical analysis and charting workspace',
            folderId: INITIAL_FOLDER_ID,
            order: 1,
            isDefault: true,
            isEditable: true,
            adminUnlocked: false,
            showGroupLabels: false,
            tabs: [],
            syncGroups: [...defaultSyncGroups],
            createdAt: now,
            updatedAt: now,
        },
        {
            id: QUANT_DASHBOARD_ID,
            name: 'Quant',
            description: 'Quantitative analysis and backtesting workspace',
            folderId: INITIAL_FOLDER_ID,
            order: 2,
            isDefault: true,
            isEditable: true,
            adminUnlocked: false,
            showGroupLabels: false,
            tabs: [],
            syncGroups: [...defaultSyncGroups],
            createdAt: now,
            updatedAt: now,
        },
    ];
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
    updateDashboardRuntime: (id: string, updates: Partial<Dashboard>) => void;
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
    restoreLastClosedTab: () => string | null;
    recentlyClosedTabs: ReadonlyArray<{
        dashboardId: string;
        tab: DashboardTab;
        closedAt: number;
    }>;
    applyTemplate: (dashboardId: string, tabId: string, templateName: string) => void;
    // Widget actions
    addWidget: (dashboardId: string, tabId: string, widget: WidgetCreate) => WidgetInstance;
    updateWidget: (dashboardId: string, tabId: string, widgetId: string, updates: Partial<WidgetInstance>) => void;
    updateWidgetRuntime: (dashboardId: string, tabId: string, widgetId: string, updates: Partial<WidgetInstance>) => void;
    deleteWidget: (dashboardId: string, tabId: string, widgetId: string) => void;
    cloneWidget: (dashboardId: string, tabId: string, widgetId: string) => WidgetInstance | null;
    updateTabLayout: (dashboardId: string, tabId: string, widgets: WidgetInstance[]) => void;
    resetTabLayout: (dashboardId: string, tabId: string) => void;
    // Sync group actions
    updateSyncGroupSymbol: (dashboardId: string, groupId: number, symbol: string) => void;
    createSyncGroup: (dashboardId: string, symbol: string) => WidgetSyncGroup;
    setDashboardAdminUnlocked: (dashboardId: string, unlocked: boolean) => void;
    // Move & Reorder actions
    moveDashboard: (dashboardId: string, targetFolderId: string | undefined) => void;
    reorderDashboards: (dashboardIds: string[], folderId: string | undefined) => void;
    // Computed values
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

const DashboardContext = createContext<DashboardContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface DashboardProviderProps {
    children: ReactNode;
}

export function DashboardProvider({ children }: DashboardProviderProps) {
    const [state, dispatch] = useReducer(dashboardReducer, undefined, createInitialState);
    const [localStateReady, setLocalStateReady] = useState(false);
    const [migrationNotice, setMigrationNotice] = useState<DashboardMigrationNotice | null>(null);
    const [recentlyClosed, setRecentlyClosed] = useState<
        Array<{ dashboardId: string; tab: DashboardTab; closedAt: number }>
    >([]);

    const getPreferredActiveTabId = useCallback((dashboard: Dashboard | null | undefined) => {
        if (!dashboard) return null;
        return findPreferredTabId(dashboard.tabs) || dashboard.tabs[0]?.id || null;
    }, []);

    const getRestoredActiveTabId = useCallback(
        (
            dashboard: Dashboard | null | undefined,
            storedViewState: StoredDashboardViewState | null | undefined,
        ) => {
            if (!dashboard) return null;

            const storedTabId = storedViewState?.lastActiveTabIdByDashboard?.[dashboard.id];
            if (storedTabId && dashboard.tabs.some((tab) => tab.id === storedTabId)) {
                return storedTabId;
            }

            return getPreferredActiveTabId(dashboard);
        },
        [getPreferredActiveTabId]
    );

    // Load from localStorage on mount
    useEffect(() => {
        if (typeof window === 'undefined') return;

        let cancelled = false;

        const loadPublishedTemplates = async () => {
            if (typeof fetch !== 'function') return;
            // Track whether the loader produced usable templates. If the
            // backend is unreachable, slow, or returns no data (e.g. the
            // initial admin hasn't published anything yet), we MUST fall
            // back to the bundled `createSystemDashboards()` so the user is
            // never stuck on an empty spinner.
            let published: unknown[] = [];
            try {
                const response = await getPublishedSystemDashboardTemplates();
                published = Array.isArray(response?.data) ? response.data : [];
            } catch (error) {
                console.warn('Failed to load published system dashboard templates:', error);
            }
            if (cancelled) return;
            if (published.length > 0) {
                dispatch({
                    type: 'APPLY_SYSTEM_TEMPLATES',
                    payload: published.map((record) => ({
                        ...(record as { dashboard: Record<string, unknown> }).dashboard,
                        adminUnlocked: false,
                    })) as unknown as Dashboard[],
                });
            } else {
                // Fallback path (DEF-04): bundled system templates always
                // exist via createSystemDashboards(); seed them so the
                // dashboard shell renders something.
                dispatch({
                    type: 'LOAD_STATE',
                    payload: {
                        dashboards: createSystemDashboards(),
                        folders: [
                            {
                                id: INITIAL_FOLDER_ID,
                                name: INITIAL_FOLDER_NAME,
                                order: 0,
                                isExpanded: true,
                            },
                        ],
                        activeDashboardId: createSystemDashboards()[0]?.id ?? null,
                        activeTabId: null,
                    },
                });
            }
        };

        try {
            const storedStorageVersion = localStorage.getItem(STORAGE_VERSION_KEY);
            if (storedStorageVersion !== CURRENT_STORAGE_VERSION) {
                localStorage.removeItem('vnibb-tabs');
                localStorage.removeItem('vnibb-dashboard');
                localStorage.setItem(STORAGE_VERSION_KEY, CURRENT_STORAGE_VERSION);
            }

            const storedDashboards = localStorage.getItem(STORAGE_KEY);
            const storedFolders = localStorage.getItem(FOLDERS_KEY);
            const storedMigrationVersion = localStorage.getItem(MIGRATION_VERSION_KEY);
            const parsedMigrationVersion = storedMigrationVersion ? parseInt(storedMigrationVersion, 10) : 0;
            const migrationVersion = Number.isFinite(parsedMigrationVersion) ? parsedMigrationVersion : 0;

            let dashboards: Dashboard[] = [];
            let folders: DashboardFolder[] = [];
            const migrationNotices: DashboardMigrationNotice[] = [];
            let unreadableStorage = false;
            let unreadableStorageBackedUp = false;

            const markUnreadableStorage = () => {
                if (!unreadableStorage) {
                    unreadableStorageBackedUp = backupUnreadableDashboardStorage(storedDashboards, storedFolders);
                }
                unreadableStorage = true;
            };

            if (storedDashboards) {
                try {
                    const parsedDashboards = JSON.parse(storedDashboards);
                    if (Array.isArray(parsedDashboards)) {
                        dashboards = parsedDashboards;
                    } else {
                        markUnreadableStorage();
                    }
                } catch {
                    markUnreadableStorage();
                }
            }

            if (storedFolders) {
                try {
                    const parsedFolders = JSON.parse(storedFolders);
                    if (Array.isArray(parsedFolders)) {
                        folders = parsedFolders;
                    }
                } catch {
                    folders = [];
                }
            }

            if (unreadableStorage) {
                dashboards = [];
                folders = [];
                migrationNotices.push({
                    tone: 'warning',
                    message: 'Dashboard storage was corrupted and has been reset',
                    detail: unreadableStorageBackedUp
                        ? 'A backup of your previous dashboards has been created'
                        : 'Your previous dashboards could not be recovered',
                });
            }

            // Apply migrations
            const migrations: ((dashboards: Dashboard[]) => { dashboards: Dashboard[]; notice?: DashboardMigrationNotice })[] = [
                (d) => {
                    if (migrationVersion < 1) {
                        d = migrateLegacyDashboardNames(d);
                        d = migrateLegacySidebarDashboards(d);
                    }
                    return { dashboards: d };
                },
                (d) => {
                    if (migrationVersion < 2) {
                        d = migrateManageTabs(d);
                    }
                    return { dashboards: d };
                },
                (d) => {
                    if (migrationVersion < 3) {
                        d = migrateStaleTabs(d);
                    }
                    return { dashboards: d };
                },
                (d) => {
                    if (migrationVersion < 4) {
                        d = migrateLegacyChartWidgets(d);
                    }
                    return { dashboards: d };
                },
                (d) => {
                    if (migrationVersion < 5) {
                        d = migrateEmptyTabs(d);
                    }
                    return { dashboards: d };
                },
                (d) => {
                    if (migrationVersion < 6) {
                        d = migrateLegacyWidgetLayoutBounds(d);
                    }
                    return { dashboards: d };
                },
                (d) => {
                    if (migrationVersion < 7) {
                        d = migrateLegacyWidgetTypes(d);
                    }
                    return { dashboards: d };
                },
            ];

            let migrationChanged = false;
            for (const migration of migrations) {
                const result = migration(dashboards);
                if (result.dashboards !== dashboards) {
                    migrationChanged = true;
                    dashboards = result.dashboards;
                    if (result.notice) {
                        migrationNotices.push(result.notice);
                    }
                }
            }

            // Ensure system dashboards exist
            const systemDashboards = createSystemDashboards();
            for (const sysDash of systemDashboards) {
                const existing = dashboards.find((d) => d.id === sysDash.id);
                if (!existing) {
                    dashboards.push(sysDash);
                }
            }

            // Ensure initial folder exists
            if (!folders.find((f) => f.id === INITIAL_FOLDER_ID)) {
                folders.unshift({
                    id: INITIAL_FOLDER_ID,
                    name: INITIAL_FOLDER_NAME,
                    order: 0,
                    isExpanded: true,
                });
            }

            // Determine active dashboard
            const storedViewState = readStoredDashboardViewState();
            const preferredDashboardId = findPreferredDashboardId(dashboards) || storedViewState.activeDashboardId;
            let activeDashboardId = dashboards.find((d) => d.id === preferredDashboardId)?.id || null;
            if (!activeDashboardId && dashboards.length > 0) {
                activeDashboardId = dashboards.find((d) => d.folderId === INITIAL_FOLDER_ID)?.id || dashboards[0].id;
            }

            const activeDashboard = dashboards.find((d) => d.id === activeDashboardId) || null;
            let activeTabId = getRestoredActiveTabId(activeDashboard, storedViewState);

            if (cancelled) return;

            dispatch({ type: 'LOAD_STATE', payload: { dashboards, folders, activeDashboardId, activeTabId } });
            setLocalStateReady(true);

            if (migrationNotices.length > 0) {
                setMigrationNotice(migrationNotices[0]);
                localStorage.setItem(MIGRATION_VERSION_KEY, String(CURRENT_MIGRATION_VERSION));
            }

            loadPublishedTemplates();
        } catch (error) {
            console.error('Failed to initialize dashboard state:', error);
            const systemDashboards = createSystemDashboards();
            dispatch({
                type: 'LOAD_STATE',
                payload: {
                    dashboards: systemDashboards,
                    folders: [{ id: INITIAL_FOLDER_ID, name: INITIAL_FOLDER_NAME, order: 0, isExpanded: true }],
                    activeDashboardId: systemDashboards[0]?.id || null,
                    activeTabId: null,
                },
            });
            setLocalStateReady(true);
        }

        return () => {
            cancelled = true;
        };
    }, [getRestoredActiveTabId]);

    // Persist to localStorage on state changes
    useEffect(() => {
        if (!localStateReady) return;
        if (typeof window === 'undefined') return;

        const storage = {
            dashboards: state.dashboards,
            folders: state.folders,
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(storage.dashboards));
        localStorage.setItem(FOLDERS_KEY, JSON.stringify(storage.folders));
        writeStoredDashboardViewState({
            activeDashboardId: state.activeDashboardId,
            lastActiveTabIdByDashboard: {},
        });
    }, [state, localStateReady]);

    // Backend sync hook
    useDashboardSync(state, {
        enabled: localStateReady,
        onSyncStart: () => { },
        onSyncError: (error) => { console.error('Dashboard sync error:', error); },
        onSyncSuccess: () => { },
    });

    // Backend load hook
    useLoadFromBackend((loadedDashboards) => {
        if (loadedDashboards.length > 0) {
            dispatch({ type: 'LOAD_STATE', payload: { dashboards: loadedDashboards, folders: state.folders, activeDashboardId: state.activeDashboardId, activeTabId: state.activeTabId } });
        }
    }, localStateReady);

    // Computed values
    const activeDashboard = state.dashboards.find((d) => d.id === state.activeDashboardId) || null;
    const activeTab = activeDashboard?.tabs.find((t) => t.id === state.activeTabId) || null;
    const availableTemplates = Object.keys(TAB_WIDGET_TEMPLATES);

    // Action creators
    const setActiveDashboard = useCallback((id: string) => {
        dispatch({ type: 'SET_ACTIVE_DASHBOARD', payload: { dashboardId: id } });
        captureAnalyticsEvent(ANALYTICS_EVENTS.dashboardSwitched, { dashboardId: id });
    }, []);

    const createDashboard = useCallback((data: DashboardCreate): Dashboard => {
        const now = new Date().toISOString();
        const newDashboard: Dashboard = {
            id: generateId(),
            name: data.name,
            description: data.description,
            folderId: data.folderId,
            order: state.dashboards.filter((d) => d.folderId === data.folderId).length,
            isDefault: data.isDefault || false,
            isEditable: true,
            adminUnlocked: false,
            showGroupLabels: false,
            tabs: [],
            syncGroups: [
                { id: 1, name: 'Group 1', color: DEFAULT_SYNC_GROUP_COLORS[0], currentSymbol: DEFAULT_TICKER },
                { id: 2, name: 'Group 2', color: DEFAULT_SYNC_GROUP_COLORS[1], currentSymbol: DEFAULT_TICKER },
            ],
            createdAt: now,
            updatedAt: now,
        };
        dispatch({ type: 'ADD_DASHBOARD', payload: { dashboard: newDashboard } });
        return newDashboard;
    }, [state.dashboards]);

    const updateDashboard = useCallback((id: string, updates: Partial<Dashboard>) => {
        dispatch({ type: 'UPDATE_DASHBOARD', payload: { dashboardId: id, updates } });
    }, []);

    const updateDashboardRuntime = useCallback((id: string, updates: Partial<Dashboard>) => {
        dispatch({ type: 'UPDATE_DASHBOARD_RUNTIME', payload: { dashboardId: id, updates } });
    }, []);

    const deleteDashboard = useCallback((id: string) => {
        if (id === MAIN_DASHBOARD_ID || id === TECHNICAL_DASHBOARD_ID || id === QUANT_DASHBOARD_ID) {
            return;
        }
        dispatch({ type: 'DELETE_DASHBOARD', payload: { dashboardId: id } });
    }, []);

    const createFolder = useCallback((name: string): DashboardFolder => {
        const newFolder: DashboardFolder = {
            id: generateId(),
            name,
            order: state.folders.length,
            isExpanded: true,
        };
        dispatch({ type: 'ADD_FOLDER', payload: { folder: newFolder } });
        return newFolder;
    }, [state.folders]);

    const updateFolder = useCallback((id: string, updates: Partial<DashboardFolder>) => {
        dispatch({ type: 'UPDATE_FOLDER', payload: { folderId: id, updates } });
    }, []);

    const deleteFolder = useCallback((id: string) => {
        if (id === INITIAL_FOLDER_ID) return;
        dispatch({ type: 'DELETE_FOLDER', payload: { folderId: id } });
    }, []);

    const toggleFolder = useCallback((id: string) => {
        dispatch({ type: 'TOGGLE_FOLDER', payload: { folderId: id } });
    }, []);

    const setActiveTab = useCallback((id: string) => {
        dispatch({ type: 'SET_ACTIVE_TAB', payload: { tabId: id } });
    }, []);

    const createTab = useCallback((dashboardId: string, name: string): DashboardTab => {
        const dashboard = state.dashboards.find((d) => d.id === dashboardId);
        const newTab: DashboardTab = {
            id: generateId(),
            name,
            order: dashboard?.tabs.length || 0,
            widgets: [],
        };
        dispatch({ type: 'ADD_TAB', payload: { dashboardId, tab: newTab } });
        return newTab;
    }, [state.dashboards]);

    const updateTab = useCallback((dashboardId: string, tabId: string, updates: Partial<DashboardTab>) => {
        dispatch({ type: 'UPDATE_TAB', payload: { dashboardId, tabId, updates } });
    }, []);

    const deleteTab = useCallback((dashboardId: string, tabId: string) => {
        const dashboard = state.dashboards.find((d) => d.id === dashboardId);
        const tabToDelete = dashboard?.tabs.find((t) => t.id === tabId);
        if (tabToDelete && dashboard) {
            setRecentlyClosed((prev) => {
                const next = [{ dashboardId, tab: tabToDelete, closedAt: Date.now() }, ...prev].slice(0, 5);
                return next;
            });
        }
        dispatch({ type: 'DELETE_TAB', payload: { dashboardId, tabId } });
    }, [state.dashboards]);

    const reorderTabs = useCallback((dashboardId: string, tabs: DashboardTab[]) => {
        dispatch({ type: 'REORDER_TABS', payload: { dashboardId, tabs } });
    }, []);

    const restoreLastClosedTab = useCallback((): string | null => {
        if (recentlyClosed.length === 0) return null;
        const [mostRecent, ...remaining] = recentlyClosed;
        const dashboard = state.dashboards.find((d) => d.id === mostRecent.dashboardId);
        if (!dashboard) {
            setRecentlyClosed(remaining);
            return null;
        }
        if (dashboard.tabs.some((t) => t.id === mostRecent.tab.id)) {
            setRecentlyClosed(remaining);
            return null;
        }
        setRecentlyClosed(remaining);
        dispatch({ type: 'ADD_TAB', payload: { dashboardId: mostRecent.dashboardId, tab: mostRecent.tab } });
        return mostRecent.tab.id;
    }, [recentlyClosed, state.dashboards]);

    const applyTemplate = useCallback((dashboardId: string, tabId: string, templateName: string) => {
        const template = TAB_WIDGET_TEMPLATES[templateName];
        if (!template) return;
        const widgets = createWidgetsFromTemplate(template, tabId);
        dispatch({ type: 'UPDATE_TAB', payload: { dashboardId, tabId, updates: { widgets } } });
    }, []);

    const addWidget = useCallback((dashboardId: string, tabId: string, widget: WidgetCreate): WidgetInstance => {
        const newWidget: WidgetInstance = {
            id: generateId(),
            type: widget.type,
            tabId,
            syncGroupId: widget.syncGroupId,
            config: widget.config || {},
            layout: {
                ...widget.layout,
                i: generateId(),
            },
        };
        dispatch({ type: 'ADD_WIDGET', payload: { dashboardId, tabId, widget: newWidget } });
        return newWidget;
    }, []);

    const updateWidget = useCallback((dashboardId: string, tabId: string, widgetId: string, updates: Partial<WidgetInstance>) => {
        dispatch({ type: 'UPDATE_WIDGET', payload: { dashboardId, tabId, widgetId, updates } });
    }, []);

    const updateWidgetRuntime = useCallback((dashboardId: string, tabId: string, widgetId: string, updates: Partial<WidgetInstance>) => {
        dispatch({ type: 'UPDATE_WIDGET_RUNTIME', payload: { dashboardId, tabId, widgetId, updates } });
    }, []);

    const deleteWidget = useCallback((dashboardId: string, tabId: string, widgetId: string) => {
        dispatch({ type: 'DELETE_WIDGET', payload: { dashboardId, tabId, widgetId } });
    }, []);

    const cloneWidget = useCallback((dashboardId: string, tabId: string, widgetId: string): WidgetInstance | null => {
        const dashboard = state.dashboards.find((d) => d.id === dashboardId);
        const tab = dashboard?.tabs.find((t) => t.id === tabId);
        const widget = tab?.widgets.find((w) => w.id === widgetId);
        if (!widget) return null;

        const clonedWidget: WidgetInstance = {
            ...widget,
            id: generateId(),
            layout: {
                ...widget.layout,
                i: generateId(),
                x: widget.layout.x + 2,
                y: widget.layout.y + 2,
            },
        };
        dispatch({ type: 'ADD_WIDGET', payload: { dashboardId, tabId, widget: clonedWidget } });
        return clonedWidget;
    }, [state.dashboards]);

    const updateTabLayout = useCallback((dashboardId: string, tabId: string, widgets: WidgetInstance[]) => {
        dispatch({ type: 'UPDATE_TAB_LAYOUT', payload: { dashboardId, tabId, widgets } });
    }, []);

    const resetTabLayout = useCallback((dashboardId: string, tabId: string) => {
        dispatch({ type: 'RESET_TAB_LAYOUT', payload: { dashboardId, tabId } });
    }, []);

    const updateSyncGroupSymbol = useCallback((dashboardId: string, groupId: number, symbol: string) => {
        dispatch({ type: 'UPDATE_SYNC_GROUP', payload: { dashboardId, groupId, symbol } });
    }, []);

    const createSyncGroup = useCallback((dashboardId: string, symbol: string): WidgetSyncGroup => {
        const dashboard = state.dashboards.find((d) => d.id === dashboardId);
        const newGroupId = Math.max(0, ...(dashboard?.syncGroups.map((g) => g.id) || [0])) + 1;
        const newGroup: WidgetSyncGroup = {
            id: newGroupId,
            name: `Group ${newGroupId}`,
            color: DEFAULT_SYNC_GROUP_COLORS[(newGroupId - 1) % DEFAULT_SYNC_GROUP_COLORS.length],
            currentSymbol: symbol,
        };
        dispatch({ type: 'ADD_SYNC_GROUP', payload: { dashboardId, group: newGroup } });
        return newGroup;
    }, [state.dashboards]);

    const setDashboardAdminUnlocked = useCallback((dashboardId: string, unlocked: boolean) => {
        dispatch({ type: 'UPDATE_DASHBOARD_RUNTIME', payload: { dashboardId, updates: { adminUnlocked: unlocked } } });
    }, []);

    const moveDashboard = useCallback((dashboardId: string, targetFolderId: string | undefined) => {
        dispatch({ type: 'MOVE_DASHBOARD', payload: { dashboardId, targetFolderId } });
    }, []);

    const reorderDashboards = useCallback((dashboardIds: string[], folderId: string | undefined) => {
        dispatch({ type: 'REORDER_DASHBOARDS', payload: { dashboardIds, folderId } });
    }, []);

    const dismissMigrationNotice = useCallback(() => {
        setMigrationNotice(null);
    }, []);

    const contextValue: DashboardContextValue = {
        state,
        setActiveDashboard,
        createDashboard,
        updateDashboard,
        updateDashboardRuntime,
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
        restoreLastClosedTab,
        recentlyClosedTabs: recentlyClosed,
        applyTemplate,
        addWidget,
        updateWidget,
        updateWidgetRuntime,
        deleteWidget,
        cloneWidget,
        updateTabLayout,
        resetTabLayout,
        updateSyncGroupSymbol,
        createSyncGroup,
        setDashboardAdminUnlocked,
        moveDashboard,
        reorderDashboards,
        activeDashboard,
        activeTab,
        migrationNotice,
        dismissMigrationNotice,
        backendSync: {
            enabled: config.backendSyncEnabled,
            status: 'idle',
            loadPaused: false,
        },
        availableTemplates,
    };

    return (
        <DashboardContext.Provider value={contextValue}>
            {children}
        </DashboardContext.Provider>
    );
}

export function useDashboard() {
    const context = useContext(DashboardContext);
    if (!context) {
        throw new Error('useDashboard must be used within a DashboardProvider');
    }
    return context;
}

export { DashboardContext };
