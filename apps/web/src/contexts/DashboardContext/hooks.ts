// Custom hooks for Dashboard Context

import { useContext } from 'react';
import { DashboardContext } from './index';
import type { Dashboard, DashboardTab, WidgetInstance, WidgetSyncGroup } from '@/types/dashboard';
import type { DashboardContextValue } from './types';

// Hook to access dashboard context
export function useDashboard(): DashboardContextValue {
    const context = useContext(DashboardContext);
    if (!context) {
        throw new Error('useDashboard must be used within a DashboardProvider');
    }
    return context;
}

// Hook to get active dashboard
export function useActiveDashboard(): Dashboard | null {
    const { activeDashboard } = useDashboard();
    return activeDashboard;
}

// Hook to get active tab
export function useActiveTab(): DashboardTab | null {
    const { activeTab } = useDashboard();
    return activeTab;
}

// Hook to get widgets for active tab
export function useActiveTabWidgets(): WidgetInstance[] {
    const activeTab = useActiveTab();
    return activeTab?.widgets || [];
}

// Hook to get sync groups for active dashboard
export function useSyncGroups(): WidgetSyncGroup[] {
    const activeDashboard = useActiveDashboard();
    return activeDashboard?.syncGroups || [];
}

// Hook to check if backend sync is enabled and its status
export function useBackendSync() {
    const { backendSync } = useDashboard();
    return backendSync;
}

// Hook to get available templates
export function useAvailableTemplates(): string[] {
    const { availableTemplates } = useDashboard();
    return availableTemplates;
}

// Hook to get migration notice
export function useMigrationNotice() {
    const { migrationNotice, dismissMigrationNotice } = useDashboard();
    return { migrationNotice, dismissMigrationNotice };
}
