// TypeScript types for dashboard, widgets, tabs, and sync groups

// ============================================================================
// Layout Types (React-Grid-Layout compatible)
// ============================================================================

export interface WidgetLayout {
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
    maxW?: number;
    maxH?: number;
    static?: boolean;
}

// ============================================================================
// Widget Types
// ============================================================================

export type WidgetType =
    | 'ticker_info'
    | 'ticker_profile'
    | 'valuation_multiples'
    | 'price_chart'

    | 'key_metrics'
    | 'share_statistics'
    | 'screener'
    | 'company_profile'
    | 'financials'
    | 'earnings_history'
    | 'dividend_payment'
    | 'stock_splits'
    | 'company_filings'
    | 'insider_trading'
    | 'institutional_ownership'
    | 'analyst_estimates'
    | 'news_feed'
    | 'events_calendar'
    | 'major_shareholders'
    | 'officers_management'
    | 'intraday_trades'
    | 'financial_ratios'
    | 'foreign_trading'
    | 'subsidiaries'
    | 'balance_sheet'
    | 'income_statement'
    | 'cash_flow'
    | 'market_overview'
    | 'watchlist'
    | 'peer_comparison'
    | 'top_movers'
    | 'world_indices'
    | 'sector_performance'
    | 'portfolio_tracker'
    | 'price_alerts'
    | 'economic_calendar'
    | 'volume_analysis'
    | 'technical_summary'
    | 'forex_rates'
    | 'commodities'
    | 'similar_stocks'
    | 'quick_stats'
    | 'notes'
    | 'sector_top_movers'
    | 'ai_copilot'
    | 'rs_ranking'
    | 'block_trade'
    | 'alert_settings'
    | 'market_heatmap'
    | 'database_inspector'
    | 'orderbook'
    | 'index_comparison'
    | 'market_news'
    | 'sector_breakdown'
    | 'comparison_analysis'
    | 'news_flow'
    | 'ai_analysis'
    | 'unified_financials'
    | 'database_browser';




export interface WidgetConfig {
    symbol?: string;
    timeframe?: string;
    indicators?: string[];
    refreshInterval?: number;
    [key: string]: unknown;
}

import { WidgetGroupId } from './widget';

export interface WidgetInstance {
    id: string;
    type: WidgetType;
    tabId: string;
    syncGroupId?: number;    // Optional group membership for ticker sync
    widgetGroup?: WidgetGroupId;
    config: WidgetConfig;
    layout: WidgetLayout;
}


// ============================================================================
// Widget Sync Groups (for ticker synchronization)
// ============================================================================

export interface WidgetSyncGroup {
    id: number;
    name: string;           // e.g., "Group 1", "Group 2"
    color: string;          // Hex color for visual distinction
    currentSymbol: string;  // Synced ticker for this group
}

export const DEFAULT_SYNC_GROUP_COLORS = [
    '#3B82F6', // Blue
    '#10B981', // Green
    '#F59E0B', // Amber
    '#EF4444', // Red
    '#8B5CF6', // Purple
    '#EC4899', // Pink
    '#06B6D4', // Cyan
    '#F97316', // Orange
];

// ============================================================================
// Dashboard Tabs
// ============================================================================

export interface DashboardTab {
    id: string;
    name: string;
    order: number;
    widgets: WidgetInstance[];
}

// ============================================================================
// Dashboard & Folder Types
// ============================================================================

export interface DashboardFolder {
    id: string;
    name: string;
    parentId?: string;      // For nested folders
    order: number;
    isExpanded: boolean;
}

export interface Dashboard {
    id: string;
    name: string;
    description?: string;
    folderId?: string;      // Optional folder membership
    order: number;
    isDefault: boolean;
    showGroupLabels: boolean; // Controls visibility of sync badges on widgets
    tabs: DashboardTab[];
    syncGroups: WidgetSyncGroup[];
    createdAt: string;
    updatedAt: string;
}

// ============================================================================
// Dashboard State (for context)
// ============================================================================

export interface DashboardState {
    dashboards: Dashboard[];
    folders: DashboardFolder[];
    activeDashboardId: string | null;
    activeTabId: string | null;
}

// ============================================================================
// CRUD Types
// ============================================================================

export interface DashboardCreate {
    name: string;
    description?: string;
    folderId?: string;
    isDefault?: boolean;
}

export interface DashboardUpdate {
    name?: string;
    description?: string;
    folderId?: string;
    isDefault?: boolean;
    layout_config?: Record<string, any>;
}

export interface TabCreate {
    name: string;
    order?: number;
}

export interface TabUpdate {
    name?: string;
    order?: number;
}

export interface WidgetCreate {
    type: WidgetType;
    tabId: string;
    syncGroupId?: number;
    config?: WidgetConfig;
    layout: Omit<WidgetLayout, 'i'>;
}

// ============================================================================
// Widget Library Definitions
// ============================================================================

export interface WidgetDefinition {
    type: WidgetType;
    name: string;
    description: string;
    category: WidgetCategory;
    defaultConfig: WidgetConfig;
    defaultLayout: { w: number; h: number; minW: number; minH: number };
}

export type WidgetCategory =
    | 'core_data'
    | 'charting'
    | 'calendar'
    | 'ownership'
    | 'estimates'
    | 'screener'
    | 'analysis';


export interface WidgetCategoryInfo {
    id: WidgetCategory;
    name: string;
    description: string;
    icon: string; // Lucide icon name
}

// ============================================================================
// Utility Types
// ============================================================================

export type SidebarItem =
    | { type: 'folder'; data: DashboardFolder }
    | { type: 'dashboard'; data: Dashboard };

// Helper to generate unique IDs
export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
