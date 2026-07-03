// Helper functions for Dashboard Context

import type { Dashboard } from '@/types/dashboard';

// Dashboard IDs that are not editable
const SYSTEM_DASHBOARD_IDS = new Set(['default-fundamental', 'default-technical', 'default-quant']);

// Check if a dashboard ID is editable
export function isEditableDashboardId(dashboardId: string): boolean {
    if (dashboardId === 'default-fundamental') return false;
    if (dashboardId === 'default-technical') return false;
    if (dashboardId === 'default-quant') return false;
    return true;
}

// Check if a dashboard is editable
export function canEditDashboard(dashboard: Dashboard): boolean {
    if (dashboard.isEditable === false) return false;
    if (SYSTEM_DASHBOARD_IDS.has(dashboard.id)) return false;
    return true;
}
