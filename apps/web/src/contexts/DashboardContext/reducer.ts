// Dashboard Reducer - extracted from DashboardContext.tsx

import type { DashboardState, DashboardAction, DashboardTab } from './types';
import { autoFitGridItems, getWidgetDefaultLayout } from '@/lib/dashboardLayout';
import { isEditableDashboardId, canEditDashboard } from './helpers';
import {
    SYSTEM_DASHBOARD_IDS,
    MAIN_DASHBOARD_ID,
    TECHNICAL_DASHBOARD_ID,
    QUANT_DASHBOARD_ID,
    INITIAL_FOLDER_ID,
} from './constants';

// #102: one place decides which tab an active dashboard shows. Every action
// that changes the active dashboard must resolve its tab in the same dispatch,
// otherwise the body renders a permanent no-tab spinner and the URL drops its
// `tab` param. The current tab is kept only when it belongs to the dashboard.
function resolveActiveTabId(tabs: DashboardTab[], preferredTabId: string | null): string | null {
    if (preferredTabId && tabs.some((tab) => tab.id === preferredTabId)) {
        return preferredTabId;
    }
    return [...tabs].sort((a, b) => a.order - b.order)[0]?.id ?? null;
}

// ============================================================================
// Reducer
// ============================================================================

export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
    switch (action.type) {
        case 'LOAD_STATE': {
            // #102: restore paths (storage, backend snapshot, the error fallback)
            // can name a dashboard whose tab id is stale or missing. Normalize
            // here so no load path can leave the body on a no-tab spinner.
            const activeDashboard = action.payload.dashboards.find(
                (d) => d.id === action.payload.activeDashboardId
            );
            return {
                ...state,
                dashboards: action.payload.dashboards,
                folders: action.payload.folders,
                activeDashboardId: action.payload.activeDashboardId,
                activeTabId: activeDashboard
                    ? resolveActiveTabId(activeDashboard.tabs, action.payload.activeTabId)
                    : action.payload.activeTabId,
            };
        }

        case 'SET_ACTIVE_DASHBOARD': {
            // Resolve the tab in the same dispatch as the dashboard change: a
            // header/workspace click must never leave an active dashboard with
            // an unresolvable (stale or foreign) activeTabId, which rendered an
            // indefinite no-tab spinner (#102).
            const targetDashboard = state.dashboards.find((d) => d.id === action.payload.dashboardId);
            const requestedTabId = action.payload.tabId;
            const activeTabId = requestedTabId === undefined
                ? resolveActiveTabId(targetDashboard?.tabs ?? [], state.activeTabId)
                : requestedTabId;
            return {
                ...state,
                activeDashboardId: action.payload.dashboardId,
                activeTabId,
            };
        }

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

        case 'DELETE_DASHBOARD': {
            const dashboards = state.dashboards.filter((d) => d.id !== action.payload.dashboardId);
            const deletedActive = state.activeDashboardId === action.payload.dashboardId;
            const nextActive = deletedActive ? dashboards[0] ?? null : null;
            return {
                ...state,
                dashboards,
                activeDashboardId: deletedActive ? nextActive?.id ?? null : state.activeDashboardId,
                // #102: deleting the active workspace switches dashboards, so
                // resolve its tab here too instead of keeping a foreign tab id.
                activeTabId: deletedActive
                    ? resolveActiveTabId(nextActive?.tabs ?? [], null)
                    : state.activeTabId,
            };
        }

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
                            tabs: d.tabs.map((t) => {
                                if (t.id !== action.payload.tabId) return t;
                                const widget = action.payload.widget;
                                const y = Number.isFinite(widget.layout.y)
                                    ? widget.layout.y
                                    : t.widgets.reduce((bottom, existing) => Math.max(bottom, existing.layout.y + existing.layout.h), 0);
                                return {
                                    ...t,
                                    widgets: [...t.widgets, y === widget.layout.y ? widget : { ...widget, layout: { ...widget.layout, y } }],
                                };
                            }),
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
                            tabs: d.tabs.map((t) =>
                                t.id === action.payload.tabId
                                    ? {
                                        ...t,
                                        widgets: t.widgets.map((w) =>
                                            w.id === action.payload.widgetId
                                                ? { ...w, ...action.payload.updates, layout: w.layout }
                                                : w
                                        ),
                                    }
                                    : t
                            ),
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
            // #110: a published record can arrive empty or malformed (partial
            // response, failed publish). Only a template that actually carries a
            // usable tab list may replace the bundled layout — otherwise an empty
            // `tabs` array wiped a working system workspace and left it tabless.
            const systemTemplates = action.payload.filter(
                (template) => Array.isArray(template.tabs) && template.tabs.length > 0
            );
            const existingIds = new Set(state.dashboards.map((d) => d.id));
            const merged = state.dashboards.map((d) => {
                const template = systemTemplates.find((t) => t.id === d.id);
                if (!template) return d;

                return {
                    ...d,
                    tabs: template.tabs,
                    syncGroups: template.syncGroups,
                    globalMarketsSymbol: template.globalMarketsSymbol,
                    updatedAt: new Date().toISOString(),
                };
            });
            const appended = systemTemplates.filter((t) => !existingIds.has(t.id));
            // #110: an empty or malformed published response must leave the
            // bundled layout untouched — `appended` is only non-empty when a
            // record carried a usable tab list (filter above).
            const dashboards = appended.length > 0 ? [...merged, ...appended] : merged;
            // #102/#110: published templates arrive after the first paint. A
            // workspace opened before they landed has no tab to resolve to, so
            // resolve it here — in the same dispatch — instead of leaving the
            // body on a no-tab spinner. An already-valid active tab is kept.
            const activeDashboard = dashboards.find((d) => d.id === state.activeDashboardId);
            const activeTabId = activeDashboard
                ? resolveActiveTabId(activeDashboard.tabs, state.activeTabId)
                : state.activeTabId;
            return {
                ...state,
                dashboards,
                activeTabId,
            };
        }

        default:
            return state;
    }
}
