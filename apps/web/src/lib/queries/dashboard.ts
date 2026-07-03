// Dashboard queries: CRUD operations for dashboards and widgets

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api';
import type { DashboardCreate, WidgetCreate } from '@/types/dashboard';

// ============ Query Keys ============

export const dashboardQueryKeys = {
    dashboards: (userId?: string) => ['dashboards', userId] as const,
    dashboard: (id: number) => ['dashboard', id] as const,
};

// ============ Dashboard Queries ============

export function useDashboards(userId = 'current') {
    return useQuery({
        queryKey: dashboardQueryKeys.dashboards(userId),
        queryFn: () => api.getDashboards(userId),
    });
}

export function useDashboard(id: number, enabled = true) {
    return useQuery({
        queryKey: dashboardQueryKeys.dashboard(id),
        queryFn: () => api.getDashboard(id),
        enabled: enabled && !!id,
    });
}

// ============ Dashboard Mutations ============

export function useCreateDashboard() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: DashboardCreate) => api.createDashboard(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['dashboards'] });
        },
    });
}

export function useUpdateDashboard() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, data }: { id: number; data: Partial<DashboardCreate> }) =>
            api.updateDashboard(id, data),
        onSuccess: (_, { id }) => {
            queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.dashboard(id) });
            queryClient.invalidateQueries({ queryKey: ['dashboards'] });
        },
    });
}

export function useDeleteDashboard() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: number) => api.deleteDashboard(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['dashboards'] });
        },
    });
}

export function useAddWidget() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ dashboardId, data }: { dashboardId: number; data: WidgetCreate }) =>
            api.addWidget(dashboardId, data),
        onSuccess: (_, { dashboardId }) => {
            queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.dashboard(dashboardId) });
        },
    });
}

export function useRemoveWidget() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ dashboardId, widgetId }: { dashboardId: number; widgetId: number }) =>
            api.removeWidget(dashboardId, widgetId),
        onSuccess: (_, { dashboardId }) => {
            queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.dashboard(dashboardId) });
        },
    });
}
