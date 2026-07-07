// Constants for Dashboard Context - extracted from DashboardContext.tsx

// Storage Keys
export const STORAGE_KEY = 'vnibb_dashboards';
export const FOLDERS_KEY = 'vnibb_folders';
export const STORAGE_VERSION_KEY = 'vnibb-dashboard-version';
export const CURRENT_STORAGE_VERSION = 'v74';
export const MIGRATION_VERSION_KEY = 'vnibb_migration_version';
export const CURRENT_MIGRATION_VERSION = 22;
export const LAST_VIEW_STATE_KEY = 'vnibb-dashboard-last-view';
export const DASHBOARD_RECOVERY_BACKUP_KEY = 'vnibb_dashboards_recovery_backup_v1';

// Dashboard IDs
export const LEGACY_MAIN_DASHBOARD_ID = 'main-default';
export const MAIN_DASHBOARD_ID = 'default-fundamental';
export const MAIN_DASHBOARD_NAME = 'Fundamental';
export const TECHNICAL_DASHBOARD_ID = 'default-technical';
export const QUANT_DASHBOARD_ID = 'default-quant';
export const GLOBAL_MARKETS_DASHBOARD_ID = 'default-global-markets';
export const GLOBAL_MARKETS_DASHBOARD_NAME = 'Global Markets';

// Folder IDs
export const INITIAL_FOLDER_ID = 'folder-initial';
export const INITIAL_FOLDER_NAME = 'Initial';

// System Dashboard IDs
export const SYSTEM_DASHBOARD_IDS = new Set([MAIN_DASHBOARD_ID, TECHNICAL_DASHBOARD_ID, QUANT_DASHBOARD_ID]);
export const GLOBAL_SYSTEM_TEMPLATE_IDS = new Set([
    MAIN_DASHBOARD_ID,
    TECHNICAL_DASHBOARD_ID,
    QUANT_DASHBOARD_ID,
    GLOBAL_MARKETS_DASHBOARD_ID,
]);

// Legacy Regex Patterns
export const LEGACY_DASHBOARD_NAME_RE = /^new dashboard(?:\s*\(\d+\))?$/i;
export const LEGACY_SIDEBAR_DASHBOARD_RE = /^(test|dashboard\s*1)$/i;
export const LEGACY_MANAGE_TAB_NAME_RE = /^manage\s+tabs?$/i;
export const LEGACY_STALE_TAB_RE = /^new\s+tab(?:\s+\d+)?$/i;

// Tab Templates
export const MAIN_TAB_TEMPLATES = [
    { name: 'Overview', widgets: [] as any[] },
    { name: 'Financials', widgets: [] as any[] },
    { name: 'Technical', widgets: [] as any[] },
    { name: 'Quant', widgets: [] as any[] },
    { name: 'Market', widgets: [] as any[] },
    { name: 'Ownership', widgets: [] as any[] },
    { name: 'Calendar', widgets: [] as any[] },
    { name: 'Trading', widgets: [] as any[] },
    { name: 'Comparison', widgets: [] as any[] },
] as const;
