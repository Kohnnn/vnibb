// Backend sync hooks for dashboard persistence

import { useEffect, useRef, useCallback } from 'react';
import { probeBackendReadiness } from '@/lib/backendHealth'
import * as api from '@/lib/api';
import { logClientError, logClientInfo } from '@/lib/clientLogger';
import type { Dashboard, DashboardState } from '@/types/dashboard';

// Debounce delay for auto-save (ms)
const SYNC_DEBOUNCE_MS = 2000;
const LOCAL_DASHBOARD_ID_PREFIX = 'dash-';

interface BackendDashboardRecord {
    id: number | string;
    name: string;
    description?: string | null;
    is_default?: boolean;
    layout_config?: {
        tabs?: Dashboard['tabs'];
        syncGroups?: Dashboard['syncGroups'];
        showGroupLabels?: boolean;
        folderId?: string;
        order?: number;
    } | null;
    created_at?: string;
    updated_at?: string;
}

interface UseDashboardSyncOptions {
    enabled?: boolean;
    onSyncStart?: () => void;
    onSyncError?: (error: Error) => void;
    onSyncSuccess?: () => void;
    onDashboardIdReconciled?: (localId: string, dashboard: Dashboard) => void;
}

function parseNumericDashboardId(id: string): number | null {
    const numericIdMatch = id.match(/^(\d+)$/);
    return numericIdMatch ? parseInt(numericIdMatch[1], 10) : null;
}

function isPendingLocalDashboard(dashboard: Dashboard): boolean {
    return dashboard.id.startsWith(LOCAL_DASHBOARD_ID_PREFIX);
}

/**
 * Strip undefined / null values so backend Pydantic doesn't reject the body
 * for incidental optional fields. The backend contract is documented in
 * DashboardUpdate; this projection keeps the payload minimal and stable.
 */
function toBackendPayload(dashboard: Dashboard): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        name: dashboard.name,
        is_default: dashboard.isDefault,
        layout_config: {
            tabs: dashboard.tabs,
            syncGroups: dashboard.syncGroups,
            showGroupLabels: dashboard.showGroupLabels,
            folderId: dashboard.folderId,
            order: dashboard.order,
        },
    };
    if (dashboard.description !== undefined && dashboard.description !== null) {
        payload.description = dashboard.description;
    }
    return payload;
}

function toFrontendDashboard(record: BackendDashboardRecord): Dashboard {
    return {
        id: String(record.id),
        name: record.name,
        description: record.description ?? undefined,
        isDefault: Boolean(record.is_default),
        isEditable: true,
        isDeletable: true,
        showGroupLabels: record.layout_config?.showGroupLabels ?? true,
        folderId: record.layout_config?.folderId,
        order: record.layout_config?.order ?? 0,
        tabs: record.layout_config?.tabs ?? [],
        syncGroups: record.layout_config?.syncGroups ?? [],
        createdAt: record.created_at || new Date().toISOString(),
        updatedAt: record.updated_at || new Date().toISOString(),
    };
}

/**
 * Check if backend is available
 */
export async function checkBackendHealth(): Promise<boolean> {
    const { healthOk, dataOk } = await probeBackendReadiness(8000)
    return healthOk && dataOk
}

/**
 * Hook to sync dashboard state to backend with debouncing
 */
export function useDashboardSync(
    state: DashboardState,
    options: UseDashboardSyncOptions = {}
) {
    const { enabled = true, onSyncStart, onSyncError, onSyncSuccess, onDashboardIdReconciled } = options;
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const previousState = useRef<string>('');
    const isBackendAvailable = useRef<boolean | null>(null);
    const previousDashboards = useRef<Dashboard[]>(state.dashboards);
    const latestDashboards = useRef<Dashboard[]>(state.dashboards);
    const pendingCreateIds = useRef<Set<string>>(new Set());
    const inFlightSync = useRef<boolean>(false);
    const loggedFirstFailure = useRef<boolean>(false);

    useEffect(() => {
        latestDashboards.current = state.dashboards;
    }, [state.dashboards]);

    // Check backend availability on mount
    useEffect(() => {
        if (!enabled) return;

        checkBackendHealth().then((available) => {
            isBackendAvailable.current = available;
            if (available) {
                logClientInfo('[DashboardSync] Backend connected');
            } else {
                logClientInfo('[DashboardSync] Backend unavailable, using localStorage only');
            }
        });
    }, [enabled]);

    // Debounced sync to backend
    const syncToBackend = useCallback(async (dashboards: Dashboard[]) => {
        if (!isBackendAvailable.current) return;

        // Guard against overlapping sync runs which were a source of duplicate
        // 422s on transient placeholder IDs in production. The hook still
        // detects state changes via the effect below; this only short-circuits
        // the re-entry.
        if (inFlightSync.current) {
            return;
        }
        inFlightSync.current = true;

        onSyncStart?.();
        try {
            const currentDashboardIds = new Set(dashboards.map((dashboard) => dashboard.id));

            for (const previousDashboard of previousDashboards.current) {
                const dashboardId = parseNumericDashboardId(previousDashboard.id);
                if (!dashboardId || currentDashboardIds.has(previousDashboard.id)) {
                    continue;
                }

                await api.deleteDashboard(dashboardId);
                logClientInfo('[DashboardSync] Deleted dashboard from backend:', previousDashboard.name);
            }

            for (const dashboard of dashboards) {
                const dashboardId = parseNumericDashboardId(dashboard.id);

                // Skip PATCH until the create round-trip assigns a numeric ID.
                // Previously the code PATCH'd `dash-xxx` placeholders which
                // resolves to PATCH /api/v1/dashboard/ (empty id) and 422s.
                if (!dashboardId) {
                    if (!isPendingLocalDashboard(dashboard) || pendingCreateIds.current.has(dashboard.id)) {
                        continue;
                    }

                    pendingCreateIds.current.add(dashboard.id);
                    try {
                        const createdDashboard = await api.createDashboard(
                            toBackendPayload(dashboard)
                        ) as unknown as BackendDashboardRecord;
                        const createdFrontendDashboard = toFrontendDashboard(createdDashboard);

                        if (!latestDashboards.current.some((item) => item.id === dashboard.id)) {
                            const createdDashboardId = parseNumericDashboardId(createdFrontendDashboard.id);
                            if (createdDashboardId) {
                                await api.deleteDashboard(createdDashboardId);
                            }
                            continue;
                        }

                        onDashboardIdReconciled?.(dashboard.id, createdFrontendDashboard);
                        logClientInfo('[DashboardSync] Created dashboard in backend:', dashboard.name);
                    } finally {
                        pendingCreateIds.current.delete(dashboard.id);
                    }
                    continue;
                }

                // Has a numeric ID; safe to PATCH.
                try {
                    await api.updateDashboard(dashboardId, toBackendPayload(dashboard));
                    logClientInfo('[DashboardSync] Synced dashboard:', dashboard.name);
                } catch (patchError) {
                    if (!loggedFirstFailure.current) {
                        loggedFirstFailure.current = true;
                        logClientError('[DashboardSync] First PATCH failure (subsequent errors suppressed):', patchError);
                    } else {
                        logClientInfo('[DashboardSync] PATCH failed (suppressed):', String((patchError as Error)?.message ?? patchError));
                    }
                    throw patchError;
                }
            }

            previousDashboards.current = dashboards;
            onSyncSuccess?.();
        } catch (error) {
            logClientError('[DashboardSync] Sync failed:', error);
            onSyncError?.(error as Error);
        } finally {
            inFlightSync.current = false;
        }
    }, [onDashboardIdReconciled, onSyncError, onSyncSuccess, onSyncStart]);

    // Watch for state changes and debounce sync
    useEffect(() => {
        if (!enabled || (!state.dashboards.length && !previousDashboards.current.length)) return;

        const stateHash = JSON.stringify(state.dashboards);
        if (stateHash === previousState.current) return;

        previousState.current = stateHash;

        // Clear existing timeout
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        // Debounce sync
        timeoutRef.current = setTimeout(() => {
            syncToBackend(state.dashboards);
        }, SYNC_DEBOUNCE_MS);

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [enabled, state.dashboards, syncToBackend]);
}

/**
 * Hook to load dashboards from backend on initial mount
 */
export function useLoadFromBackend(
    onLoad: (dashboards: Dashboard[]) => void,
    enabled = true
) {
    const loadedRef = useRef(false);

    useEffect(() => {
        if (!enabled || loadedRef.current) return;

        async function loadDashboards() {
            try {
                const isAvailable = await checkBackendHealth();
                if (!isAvailable) {
                    logClientInfo('[DashboardSync] Backend unavailable, skipping load');
                    return;
                }

                const response = await api.getDashboards();
                if (response.data && response.data.length > 0) {
                    const frontendDashboards = response.data.map((dashboard) =>
                        toFrontendDashboard(dashboard as unknown as BackendDashboardRecord)
                    );

                    onLoad(frontendDashboards);
                    logClientInfo('[DashboardSync] Loaded dashboards from backend');
                }
            } catch (error) {
                logClientError('[DashboardSync] Failed to load from backend:', error);
            }
        }

        loadDashboards();
        loadedRef.current = true;
    }, [enabled, onLoad]);
}
