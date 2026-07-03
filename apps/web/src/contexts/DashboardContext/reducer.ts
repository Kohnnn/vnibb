// Dashboard Reducer - extracted from DashboardContext.tsx

import type { DashboardState, DashboardAction } from './types';
import { autoFitGridItems, compactGridItems, getWidgetDefaultLayout } from '@/lib/dashboardLayout';
import { isEditableDashboardId, canEditDashboard } from './helpers';
import {
    SYSTEM_DASHBOARD_IDS,
    MAIN_DASHBOARD_ID,
    TECHNICAL_DASHBOARD_ID,
    QUANT_DASHBOARD_ID,
    INITIAL_FOLDER_ID,
} from './constants';

// ============================================================================
// Reducer
// ============================================================================

export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
    switch (action.type) {
        case 'LOAD_STATE':
            return {
                ...state,
                dashboards: action.payload.dashboards,
                folders: action.payload.folders,
                activeDashboardId: action.payload.activeDashboardId,
                activeTabId: action.payload.activeTabId,
            };

        case 'SET_ACTIVE_DASHBOARD':
            return {
                ...state,
                activeDashboardId: action.payload.dashboardId,
            };

        case 'ADD_DASHBOARD':
            return {
                ...state,
                dashboards: [...state.dashboards, action.payload.dashboard],
            };

        case 'UPDATE_DASHBOARD': {
            if (!isEditableDashboardId(action.payload.dashboardId)) {
                return state;
            }
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? { ...d, ...action.payload.updates, updatedAt: new Date().toISOString() }
                        : d
                ),
            };
        }

        case 'UPDATE_DASHBOARD_RUNTIME':
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? { ...d, ...action.payload.updates }
                        : d
                ),
            };

        case 'DELETE_DASHBOARD':
            return {
                ...state,
                dashboards: state.dashboards.filter((d) => d.id !== action.payload.dashboardId),
                activeDashboardId:
                    state.activeDashboardId === action.payload.dashboardId
                        ? state.dashboards.find((d) => d.id !== action.payload.dashboardId)?.id || null
                        : state.activeDashboardId,
            };

        case 'ADD_FOLDER':
            return {
                ...state,
                folders: [...state.folders, action.payload.folder],
            };

        case 'UPDATE_FOLDER':
            return {
                ...state,
                folders: state.folders.map((f) =>
                    f.id === action.payload.folderId ? { ...f, ...action.payload.updates } : f
                ),
            };

        case 'DELETE_FOLDER':
            return {
                ...state,
                folders: state.folders.filter((f) => f.id !== action.payload.folderId),
                dashboards: state.dashboards.map((d) =>
                    d.folderId === action.payload.folderId ? { ...d, folderId: undefined } : d
                ),
            };

        case 'TOGGLE_FOLDER':
            return {
                ...state,
                folders: state.folders.map((f) =>
                    f.id === action.payload.folderId ? { ...f, isExpanded: !f.isExpanded } : f
                ),
            };

        case 'SET_ACTIVE_TAB':
            return {
                ...state,
                activeTabId: action.payload.tabId,
            };

        case 'ADD_TAB':
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? { ...d, tabs: [...d.tabs, action.payload.tab], updatedAt: new Date().toISOString() }
                        : d
                ),
                activeTabId: action.payload.tab.id,
            };

        case 'UPDATE_TAB': {
            if (!isEditableDashboardId(action.payload.dashboardId)) {
                return state;
            }
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
            if (!isEditableDashboardId(action.payload.dashboardId)) {
                return state;
            }

            const targetDashboard = state.dashboards.find((d) => d.id === action.payload.dashboardId);
            const remainingTabs = targetDashboard?.tabs.filter((t) => t.id !== action.payload.tabId) || [];
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
            if (!isEditableDashboardId(action.payload.dashboardId)) {
                return state;
            }
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
            if (!isEditableDashboardId(action.payload.dashboardId)) {
                return state;
            }
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
            if (!isEditableDashboardId(action.payload.dashboardId)) {
                return state;
            }
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

        case 'UPDATE_WIDGET_RUNTIME':
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? {
                            ...d,
                            tabs: d.tabs.map((t) => {
                                if (t.id !== action.payload.tabId) {
                                    return t;
                                }

                                const nextWidgets = t.widgets.map((w) =>
                                    w.id === action.payload.widgetId
                                        ? { ...w, ...action.payload.updates }
                                        : w
                                );

                                return {
                                    ...t,
                                    widgets: action.payload.updates.layout
                                        ? compactGridItems(nextWidgets)
                                        : nextWidgets,
                                };
                            }),
                            updatedAt: new Date().toISOString(),
                        }
                        : d
                ),
            };

        case 'DELETE_WIDGET': {
            if (!isEditableDashboardId(action.payload.dashboardId)) {
                return state;
            }
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
            if (!isEditableDashboardId(action.payload.dashboardId)) {
                return state;
            }
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
            if (!isEditableDashboardId(action.payload.dashboardId)) {
                return state;
            }
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? {
                            ...d,
                            tabs: d.tabs.map((t) => {
                                if (t.id !== action.payload.tabId) return t;
                                const resetWidgets = autoFitGridItems(t.widgets.map((w) => {
                                    const defaults = getWidgetDefaultLayout(w.type);
                                    return {
                                        ...w,
                                        layout: {
                                            ...w.layout,
                                            x: 0,
                                            y: 0,
                                            w: defaults.w,
                                            h: defaults.h,
                                            minW: defaults.minW ?? 3,
                                            minH: defaults.minH ?? 2,
                                        },
                                    };
                                }));
                                return { ...t, widgets: resetWidgets };
                            }),
                            updatedAt: new Date().toISOString(),
                        }
                        : d
                ),
            };
        }

        case 'UPDATE_SYNC_GROUP':
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

        case 'ADD_SYNC_GROUP': {
            if (!isEditableDashboardId(action.payload.dashboardId)) {
                return state;
            }
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
            if (!isEditableDashboardId(action.payload.dashboardId)) {
                return state;
            }
            if (action.payload.targetFolderId === INITIAL_FOLDER_ID) {
                return state;
            }
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
            if (folderId === INITIAL_FOLDER_ID) {
                return state;
            }
            return {
                ...state,
                dashboards: state.dashboards.map((d) => {
                    if (!canEditDashboard(d)) {
                        return {
                            ...d,
                            folderId: INITIAL_FOLDER_ID,
                            order: d.id === MAIN_DASHBOARD_ID ? 0 : d.id === TECHNICAL_DASHBOARD_ID ? 1 : 2,
                        };
                    }

                    const newIndex = dashboardIds.indexOf(d.id);
                    if (newIndex !== -1) {
                        return { ...d, order: newIndex + 1, folderId, updatedAt: new Date().toISOString() };
                    }
                    return d;
                }),
            };
        }

        case 'APPLY_SYSTEM_TEMPLATES': {
            const systemTemplates = action.payload;
            return {
                ...state,
                dashboards: state.dashboards.map((d) => {
                    const template = systemTemplates.find((t) => t.id === d.id);
                    if (!template) return d;

                    return {
                        ...d,
                        tabs: template.tabs,
                        syncGroups: template.syncGroups,
                        globalMarketsSymbol: template.globalMarketsSymbol,
                        updatedAt: new Date().toISOString(),
                    };
                }),
            };
        }

        default:
            return state;
    }
}
