// Backend sync hooks for dashboard persistence

import { useEffect, useRef, useCallback } from 'react';
import { env } from '@/lib/env';
import * as api from '@/lib/api';
import type { Dashboard, DashboardState } from '@/types/dashboard';

// Debounce delay for auto-save (ms)
const SYNC_DEBOUNCE_MS = 2000;

// Backend API URL check
const BACKEND_URL = env.apiUrl;


interface UseDashboardSyncOptions {
    enabled?: boolean;
    onSyncError?: (error: Error) => void;
    onSyncSuccess?: () => void;
}

/**
 * Check if backend is available
 */
export async function checkBackendHealth(): Promise<boolean> {
    try {
        const response = await fetch(`${BACKEND_URL.replace('/api/v1', '')}/health`);
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Hook to sync dashboard state to backend with debouncing
 */
export function useDashboardSync(
    state: DashboardState,
    options: UseDashboardSyncOptions = {}
) {
    const { enabled = true, onSyncError, onSyncSuccess } = options;
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const previousState = useRef<string>('');
    const isBackendAvailable = useRef<boolean | null>(null);

    // Check backend availability on mount
    useEffect(() => {
        if (!enabled) return;

        checkBackendHealth().then((available) => {
            isBackendAvailable.current = available;
            if (available) {
                console.log('[DashboardSync] Backend connected');
            } else {
                console.log('[DashboardSync] Backend unavailable, using localStorage only');
            }
        });
    }, [enabled]);

    // Debounced sync to backend
    const syncToBackend = useCallback(async (dashboards: Dashboard[]) => {
        if (!isBackendAvailable.current) return;

        try {
            // For each dashboard, sync to backend
            // Note: This is a simplified version - in production you'd want
            // to track which dashboards changed and only sync those
            for (const dashboard of dashboards) {
                // Skip if no numeric ID (means it's not persisted to backend yet)
                const numericIdMatch = dashboard.id.match(/^(\d+)$/);
                const dashboardId = numericIdMatch ? parseInt(numericIdMatch[1], 10) : null;

                if (!dashboardId) {
                    // If it's a string ID like "dash-...", it might be a new local-only dashboard
                    // For now we only sync dashboards that have a numeric ID (synced from backend)
                    continue;
                }

                // Transform frontend dashboard to backend format
                const backendPayload = {
                    name: dashboard.name,
                    description: dashboard.description,
                    is_default: dashboard.isDefault,
                    layout_config: {
                        tabs: dashboard.tabs,
                        syncGroups: dashboard.syncGroups,
                        showGroupLabels: dashboard.showGroupLabels,
                        folderId: dashboard.folderId,
                        order: dashboard.order,
                    },
                };

                await api.updateDashboard(dashboardId, backendPayload);
                console.log('[DashboardSync] Synced dashboard:', dashboard.name);
            }

            onSyncSuccess?.();
        } catch (error) {
            console.error('[DashboardSync] Sync failed:', error);
            onSyncError?.(error as Error);
        }
    }, [onSyncError, onSyncSuccess]);

    // Watch for state changes and debounce sync
    useEffect(() => {
        if (!enabled || !state.dashboards.length) return;

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
                    console.log('[DashboardSync] Backend unavailable, skipping load');
                    return;
                }

                const response = await api.getDashboards();
                if (response.data && response.data.length > 0) {
                    // Transform backend dashboards to frontend format
                    const frontendDashboards = response.data.map((d: any) => ({
                        id: String(d.id),
                        name: d.name,
                        description: d.description,
                        isDefault: d.is_default,
                        showGroupLabels: d.layout_config?.showGroupLabels ?? true,
                        folderId: d.layout_config?.folderId,
                        order: d.layout_config?.order ?? 0,
                        tabs: d.layout_config?.tabs ?? [],
                        syncGroups: d.layout_config?.syncGroups ?? [],
                        createdAt: d.created_at || new Date().toISOString(),
                        updatedAt: d.updated_at || new Date().toISOString(),
                    }));

                    onLoad(frontendDashboards);
                    console.log('[DashboardSync] Loaded dashboards from backend');
                }
            } catch (error) {
                console.error('[DashboardSync] Failed to load from backend:', error);
            }
        }

        loadDashboards();
        loadedRef.current = true;
    }, [enabled, onLoad]);
}
