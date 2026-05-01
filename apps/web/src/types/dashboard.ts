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
    | 'tradingview_chart'
    | 'tradingview_symbol_overview'
    | 'tradingview_mini_chart'
    | 'tradingview_market_summary'
    | 'tradingview_market_overview'
    | 'tradingview_stock_market'
    | 'tradingview_market_data'
    | 'tradingview_ticker_tape'
    | 'tradingview_ticker_tag'
    | 'tradingview_single_ticker'
    | 'tradingview_ticker'
    | 'tradingview_stock_heatmap'
    | 'tradingview_crypto_heatmap'
    | 'tradingview_forex_cross_rates'
    | 'tradingview_etf_heatmap'
    | 'tradingview_forex_heatmap'
    | 'tradingview_screener'
    | 'tradingview_crypto_market'
    | 'tradingview_symbol_info'
    | 'tradingview_technical_analysis'
    | 'tradingview_fundamental_data'
    | 'tradingview_company_profile'
    | 'tradingview_top_stories'
    | 'tradingview_economic_calendar'
    | 'tradingview_economic_map'
    | 'valuation_multiples_chart'
    | 'valuation_band'

    | 'key_metrics'
    | 'share_statistics'
    | 'screener'
    | 'earnings_history'
    | 'earnings_release_recap'
    | 'earnings_season_monitor'
    | 'derivatives_contracts_board'
    | 'derivatives_price_history'
    | 'listing_browser'
    | 'dividend_payment'
    | 'stock_splits'
    | 'company_filings'
    | 'insider_trading'
    | 'analyst_estimates'
    | 'news_feed'
    | 'events_calendar'
    | 'major_shareholders'
    | 'officers_management'
    | 'intraday_trades'
    | 'financial_ratios'
    | 'bank_metrics'
    | 'transaction_flow'
    | 'industry_bubble'
    | 'sector_board'
    | 'money_flow_trend'
    | 'correlation_matrix'
    | 'foreign_trading'
    | 'subsidiaries'
    | 'balance_sheet'
    | 'income_statement'
    | 'cash_flow'
    | 'income_sankey'
    | 'cashflow_waterfall'
    | 'market_overview'
    | 'watchlist'
    | 'peer_comparison'
    | 'top_movers'
    | 'world_indices'
    | 'world_news_monitor'
    | 'sector_performance'
    | 'market_movers_sectors'
    | 'sector_rotation_radar'
    | 'market_breadth'
    | 'portfolio_tracker'
    | 'price_alerts'
    | 'economic_calendar'
    | 'volume_analysis'
    | 'volume_profile'
    | 'obv_divergence'
    | 'atr_regime'
    | 'gap_fill_stats'
    | 'volume_delta'
    | 'amihud_illiquidity'
    | 'drawdown_deep_dive'
    | 'hurst_market_structure'
    | 'seasonality_heatmap'
    | 'technical_summary'
    | 'technical_snapshot'
    | 'signal_summary'
    | 'ichimoku'
    | 'fibonacci'
    | 'volume_flow'
    | 'rsi_seasonal'
    | 'bollinger_squeeze'
    | 'sortino_monthly'
    | 'gap_analysis'
    | 'macd_crossovers'
    | 'parkinson_volatility'
    | 'ema_respect'
    | 'drawdown_recovery'
    | 'gamma_exposure'
    | 'momentum'
    | 'earnings_quality'
    | 'smart_money'
    | 'relative_rotation'
    | 'risk_dashboard'
    | 'quant_summary'
    | 'market_sentiment'
    | 'ttm_snapshot'
    | 'growth_bridge'
    | 'ownership_rating_summary'
    | 'derivatives_analytics'
    | 'forex_rates'
    | 'commodities'
    | 'similar_stocks'
    | 'quick_stats'
    | 'notes'
    | 'research_browser'
    | 'sector_top_movers'
    | 'ai_copilot'
    | 'rs_ranking'
    | 'insider_deal_timeline'
    | 'block_trade'
    | 'ownership_changes'
    | 'alert_settings'
    | 'market_heatmap'
    | 'database_inspector'
    | 'orderbook'
    | 'index_comparison'
    | 'market_news'
    | 'sector_breakdown'
    | 'comparison_analysis'
    | 'news_flow'
    | 'news_corporate_actions'
    | 'dividend_ladder'
    | 'ai_analysis'
    | 'unified_financials'
    | 'financial_snapshot';




export interface WidgetConfig {
    symbol?: string;
    timeframe?: string;
    indicators?: string[];
    refreshInterval?: number;
    collapsed?: boolean;
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
    '#22D3EE', // Cyan Light
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
    globalMarketsSymbol?: string;
    folderId?: string;      // Optional folder membership
    order: number;
    isDefault: boolean;
    isEditable?: boolean;
    isDeletable?: boolean;
    adminUnlocked?: boolean;
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

export interface SystemDashboardTemplateRecord {
    dashboard_key: string;
    status: 'draft' | 'published';
    version: number;
    dashboard: Dashboard;
    notes?: string | null;
    updated_by?: string | null;
    updated_at: string;
    published_at?: string | null;
}

export interface SystemDashboardTemplateListResponse {
    count: number;
    data: SystemDashboardTemplateRecord[];
}

export interface SystemDashboardTemplateBundleResponse {
    dashboard_key: string;
    draft: SystemDashboardTemplateRecord | null;
    published: SystemDashboardTemplateRecord | null;
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
    defaultLayout: {
        w: number;
        h: number;
        minW: number;
        minH: number;
        maxW?: number;
        maxH?: number;
    };
    recommended?: boolean;
    searchKeywords?: string[];
}

export type WidgetCategory =
    | 'core_data'
    | 'charting'
    | 'global_markets'
    | 'calendar'
    | 'ownership'
    | 'estimates'
    | 'screener'
    | 'analysis'
    | 'quant';


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
