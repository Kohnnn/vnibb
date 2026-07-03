// Dashboard API endpoints

import { fetchAPI } from '../client';
import type {
    Dashboard,
    DashboardCreate,
    DashboardUpdate,
    SystemDashboardTemplateBundleResponse,
    SystemDashboardTemplateListResponse,
    WidgetCreate,
} from '@/types/dashboard';

export async function getDashboards(userId = 'anonymous'): Promise<{ count: number; data: Dashboard[] }> {
    return fetchAPI<{ count: number; data: Dashboard[] }>('/dashboard', {
        params: { user_id: userId },
    });
}

export async function getDashboard(id: number): Promise<Dashboard> {
    return fetchAPI<Dashboard>(`/dashboard/${id}`);
}

export async function createDashboard(data: DashboardCreate): Promise<Dashboard> {
    return fetchAPI<Dashboard>('/dashboard', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export async function updateDashboard(
    id: number,
    updates: DashboardUpdate
): Promise<Dashboard> {
    return fetchAPI<Dashboard>(`/dashboard/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
    });
}

export async function deleteDashboard(id: number): Promise<void> {
    return fetchAPI<void>(`/dashboard/${id}`, {
        method: 'DELETE',
    });
}

export async function addWidget(dashboardId: number, data: WidgetCreate): Promise<Dashboard> {
    return fetchAPI<Dashboard>(`/dashboard/${dashboardId}/widget`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export async function removeWidget(dashboardId: number, widgetId: number): Promise<void> {
    return fetchAPI<void>(`/dashboard/${dashboardId}/widget/${widgetId}`, {
        method: 'DELETE',
    });
}

export async function getPublishedSystemDashboardTemplates(): Promise<SystemDashboardTemplateListResponse> {
    return fetchAPI<SystemDashboardTemplateListResponse>('/dashboard/system-templates');
}

export async function getAdminSystemDashboardTemplateBundle(): Promise<SystemDashboardTemplateBundleResponse> {
    return fetchAPI<SystemDashboardTemplateBundleResponse>('/admin/system-dashboard-templates/bundle');
}

export async function saveAdminSystemDashboardTemplate(
    dashboardKey: string,
    dashboard: Dashboard
): Promise<unknown> {
    return fetchAPI<unknown>('/admin/system-dashboard-templates', {
        method: 'PUT',
        body: JSON.stringify({ dashboard_key: dashboardKey, dashboard }),
    });
}
