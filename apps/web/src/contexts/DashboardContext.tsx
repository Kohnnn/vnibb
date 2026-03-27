// Dashboard Context - Central state management for dashboards, tabs, and widgets

'use client';

import {
    createContext,
    useContext,
    useReducer,
    useCallback,
    useEffect,
    useState,
    type ReactNode,
} from 'react';
import type {
    Dashboard,
    DashboardFolder,
    DashboardTab,
    WidgetInstance,
    WidgetSyncGroup,
    DashboardState,
    DashboardCreate,
    TabCreate,
    WidgetCreate,
    generateId,
} from '@/types/dashboard';
import { DEFAULT_SYNC_GROUP_COLORS } from '@/types/dashboard';
import { DEFAULT_TICKER, readStoredTicker } from '@/lib/defaultTicker';
import { findPreferredDashboardId, findPreferredTabId, readStoredUserPreferences } from '@/lib/userPreferences';
import { useDashboardSync } from '@/lib/useDashboardSync';
import { autoFitGridItems, getWidgetDefaultLayout, preserveTemplateGridItems } from '@/lib/dashboardLayout';

// ============================================================================
// Storage Keys
// ============================================================================

const STORAGE_KEY = 'vnibb_dashboards';
const FOLDERS_KEY = 'vnibb_folders';
const STORAGE_VERSION_KEY = 'vnibb-dashboard-version';
const CURRENT_STORAGE_VERSION = 'v73';
const MIGRATION_VERSION_KEY = 'vnibb_migration_version';
const CURRENT_MIGRATION_VERSION = 13;
const LEGACY_DASHBOARD_NAME_RE = /^new dashboard(?:\s*\(\d+\))?$/i;
const LEGACY_SIDEBAR_DASHBOARD_RE = /^(test|dashboard\s*1)$/i;
const LEGACY_MANAGE_TAB_NAME_RE = /^manage\s+tabs?$/i;
const LEGACY_STALE_TAB_RE = /^new\s+tab(?:\s+\d+)?$/i;
const LEGACY_MAIN_DASHBOARD_ID = 'main-default';
const LEGACY_MAIN_DASHBOARD_NAME = 'Main System Dashboard';
const INITIAL_FOLDER_ID = 'folder-initial';
const INITIAL_FOLDER_NAME = 'Initial';
const MAIN_DASHBOARD_ID = 'default-fundamental';
const MAIN_DASHBOARD_NAME = 'Fundamental';
const TECHNICAL_DASHBOARD_ID = 'default-technical';
const QUANT_DASHBOARD_ID = 'default-quant';
const SYSTEM_DASHBOARD_IDS = new Set([MAIN_DASHBOARD_ID, TECHNICAL_DASHBOARD_ID, QUANT_DASHBOARD_ID]);

// ============================================================================
// Default Data & Templates
// ============================================================================

// Helper to generate unique widget ID
const generateWidgetId = (prefix: string): string =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// Template widget definitions (without tabId - will be set on creation)
type TemplateWidget = Omit<WidgetInstance, 'id' | 'tabId' | 'layout'> & {
    layout: Omit<WidgetInstance['layout'], 'i'>;
};

// Overview Tab: TickerInfo, PriceChart, KeyMetrics, Earnings
// Note: Using 24-column grid for finer layout control
const OVERVIEW_TEMPLATE: TemplateWidget[] = [
    {
        type: 'ticker_info',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 8, h: 3, minW: 6, minH: 2 }
    },
    {
        type: 'price_chart',
        syncGroupId: 1,
        config: { timeframe: '1Y', chartType: 'candle' },
        layout: { x: 8, y: 0, w: 16, h: 7, minW: 8, minH: 4 }
    },
    {
        type: 'key_metrics',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 3, w: 8, h: 6, minW: 6, minH: 4 }
    },
    {
        type: 'valuation_multiples',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 9, w: 8, h: 6, minW: 6, minH: 4 }
    },
    {
        type: 'ticker_profile',
        syncGroupId: 1,
        config: {},
        layout: { x: 8, y: 7, w: 8, h: 8, minW: 6, minH: 4 }
    },
    {
        type: 'news_feed',
        syncGroupId: 1,
        config: {},
        layout: { x: 16, y: 7, w: 8, h: 8, minW: 6, minH: 4 }
    }
];


// Financials Tab: unified OpenBB-style statement controls
const FINANCIALS_TEMPLATE: TemplateWidget[] = [
    {
        type: 'unified_financials',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 24, h: 10, minW: 12, minH: 8 }
    }
];

// Quant Tab: seasonality, risk, structure, and liquidity toolkit
const QUANT_TEMPLATE: TemplateWidget[] = [
    {
        type: 'seasonality_heatmap',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 14, h: 12, minW: 10, minH: 8 }
    },
    {
        type: 'sortino_monthly',
        syncGroupId: 1,
        config: {},
        layout: { x: 14, y: 0, w: 10, h: 11, minW: 8, minH: 8 }
    },
    {
        type: 'volume_profile',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 12, w: 8, h: 12, minW: 6, minH: 8 }
    },
    {
        type: 'volume_flow',
        syncGroupId: 1,
        config: {},
        layout: { x: 8, y: 12, w: 8, h: 10, minW: 6, minH: 7 }
    },
    {
        type: 'momentum',
        syncGroupId: 1,
        config: {},
        layout: { x: 16, y: 12, w: 8, h: 10, minW: 6, minH: 7 }
    },
    {
        type: 'gap_analysis',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 24, w: 8, h: 8, minW: 6, minH: 6 }
    },
    {
        type: 'drawdown_recovery',
        syncGroupId: 1,
        config: {},
        layout: { x: 8, y: 24, w: 8, h: 9, minW: 6, minH: 7 }
    },
    {
        type: 'correlation_matrix',
        syncGroupId: 1,
        config: {},
        layout: { x: 16, y: 24, w: 8, h: 10, minW: 8, minH: 8 }
    },
    {
        type: 'signal_summary',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 34, w: 24, h: 6, minW: 12, minH: 4 }
    }
];

// Technical Tab: momentum, volatility, and confirmation signals
const TECHNICAL_TEMPLATE: TemplateWidget[] = [
    {
        type: 'ichimoku',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 12, h: 12, minW: 10, minH: 10 }
    },
    {
        type: 'fibonacci',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 0, w: 12, h: 12, minW: 10, minH: 10 }
    },
    {
        type: 'technical_summary',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 12, w: 8, h: 9, minW: 6, minH: 7 }
    },
    {
        type: 'technical_snapshot',
        syncGroupId: 1,
        config: {},
        layout: { x: 8, y: 12, w: 8, h: 9, minW: 6, minH: 7 }
    },
    {
        type: 'atr_regime',
        syncGroupId: 1,
        config: {},
        layout: { x: 16, y: 12, w: 8, h: 9, minW: 6, minH: 7 }
    },
    {
        type: 'macd_crossovers',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 21, w: 8, h: 9, minW: 6, minH: 7 }
    },
    {
        type: 'rsi_seasonal',
        syncGroupId: 1,
        config: {},
        layout: { x: 8, y: 21, w: 8, h: 9, minW: 6, minH: 7 }
    },
    {
        type: 'bollinger_squeeze',
        syncGroupId: 1,
        config: {},
        layout: { x: 16, y: 21, w: 8, h: 9, minW: 6, minH: 7 }
    },
    {
        type: 'signal_summary',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 30, w: 24, h: 6, minW: 12, minH: 4 }
    }
];

// Comparison Analysis Tab: Multi-ticker comparison toolkit
const COMPARISON_TEMPLATE: TemplateWidget[] = [
    {
        type: 'comparison_analysis',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 24, h: 8, minW: 12, minH: 6 }
    },
    {
        type: 'peer_comparison',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 8, w: 12, h: 6, minW: 6, minH: 4 }
    },
    {
        type: 'sector_performance',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 8, w: 12, h: 6, minW: 6, minH: 4 }
    }
];

// Ownership Tab: Major Shareholders, Officers, Foreign Trading, Insider Deals
const OWNERSHIP_TEMPLATE: TemplateWidget[] = [
    {
        type: 'major_shareholders',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 12, h: 3, minW: 8, minH: 3 }
    },
    {
        type: 'officers_management',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 0, w: 12, h: 9, minW: 8, minH: 6 }
    },
    {
        type: 'foreign_trading',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 3, w: 12, h: 8, minW: 8, minH: 6 }
    },
    {
        type: 'insider_trading',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 9, w: 12, h: 4, minW: 8, minH: 4 }
    }
];

// Calendar Tab: Events, Dividends, Economic Calendar
const CALENDAR_TEMPLATE: TemplateWidget[] = [
    {
        type: 'events_calendar',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 12, h: 5, minW: 6, minH: 3 }
    },
    {
        type: 'dividend_payment',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 0, w: 12, h: 5, minW: 8, minH: 3 }
    },
    {
        type: 'economic_calendar',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 5, w: 12, h: 7, minW: 6, minH: 4 }
    }
];

// Immutable Main Dashboard templates: dense multi-tab system workspace
const MAIN_MACRO_TEMPLATE: TemplateWidget[] = [
    {
        type: 'market_overview',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 8, h: 4, minW: 6, minH: 3 }
    },
    {
        type: 'top_movers',
        syncGroupId: 1,
        config: {},
        layout: { x: 8, y: 0, w: 8, h: 4, minW: 6, minH: 3 }
    },
    {
        type: 'market_heatmap',
        syncGroupId: 1,
        config: {},
        layout: { x: 16, y: 0, w: 8, h: 8, minW: 6, minH: 5 }
    },
    {
        type: 'screener',
        syncGroupId: 1,
        config: { preset: 'value_momentum' },
        layout: { x: 0, y: 4, w: 16, h: 8, minW: 12, minH: 6 }
    },
];

const MAIN_DEEP_DIVE_TEMPLATE: TemplateWidget[] = [
    {
        type: 'price_chart',
        syncGroupId: 1,
        config: { timeframe: '1Y', chartType: 'candle' },
        layout: { x: 0, y: 0, w: 16, h: 11, minW: 10, minH: 8 }
    },
    {
        type: 'ticker_info',
        syncGroupId: 1,
        config: {},
        layout: { x: 16, y: 5, w: 8, h: 6, minW: 6, minH: 4 }
    },
    {
        type: 'ticker_profile',
        syncGroupId: 1,
        config: {},
        layout: { x: 16, y: 0, w: 8, h: 5, minW: 6, minH: 4 }
    },
    {
        type: 'institutional_ownership',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 11, w: 10, h: 5, minW: 8, minH: 3 }
    },
    {
        type: 'financial_ratios',
        syncGroupId: 1,
        config: {},
        layout: { x: 10, y: 11, w: 14, h: 12, minW: 10, minH: 9 }
    },
];

const MAIN_QUANT_TEMPLATE: TemplateWidget[] = [
    {
        type: 'seasonality_heatmap',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 14, h: 12, minW: 10, minH: 9 }
    },
    {
        type: 'sortino_monthly',
        syncGroupId: 1,
        config: {},
        layout: { x: 14, y: 0, w: 10, h: 11, minW: 8, minH: 9 }
    },
    {
        type: 'volume_profile',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 12, w: 8, h: 10, minW: 6, minH: 8 }
    },
    {
        type: 'volume_flow',
        syncGroupId: 1,
        config: {},
        layout: { x: 8, y: 12, w: 8, h: 10, minW: 6, minH: 8 }
    },
    {
        type: 'momentum',
        syncGroupId: 1,
        config: {},
        layout: { x: 16, y: 12, w: 8, h: 10, minW: 6, minH: 8 }
    },
    {
        type: 'gap_analysis',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 22, w: 8, h: 9, minW: 6, minH: 7 }
    },
    {
        type: 'drawdown_recovery',
        syncGroupId: 1,
        config: {},
        layout: { x: 8, y: 22, w: 8, h: 10, minW: 6, minH: 8 }
    },
    {
        type: 'gap_fill_stats',
        syncGroupId: 1,
        config: {},
        layout: { x: 16, y: 22, w: 8, h: 9, minW: 6, minH: 7 }
    },
];

const MAIN_TECHNICAL_TEMPLATE: TemplateWidget[] = [
    {
        type: 'ichimoku',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 12, h: 12, minW: 10, minH: 10 }
    },
    {
        type: 'fibonacci',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 0, w: 12, h: 12, minW: 10, minH: 10 }
    },
    {
        type: 'technical_summary',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 12, w: 8, h: 10, minW: 6, minH: 8 }
    },
    {
        type: 'technical_snapshot',
        syncGroupId: 1,
        config: {},
        layout: { x: 8, y: 12, w: 8, h: 9, minW: 6, minH: 7 }
    },
    {
        type: 'atr_regime',
        syncGroupId: 1,
        config: {},
        layout: { x: 16, y: 12, w: 8, h: 9, minW: 6, minH: 7 }
    },
    {
        type: 'macd_crossovers',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 22, w: 8, h: 10, minW: 6, minH: 8 }
    },
    {
        type: 'bollinger_squeeze',
        syncGroupId: 1,
        config: {},
        layout: { x: 8, y: 22, w: 8, h: 10, minW: 6, minH: 8 }
    },
    {
        type: 'rsi_seasonal',
        syncGroupId: 1,
        config: {},
        layout: { x: 16, y: 22, w: 8, h: 10, minW: 6, minH: 8 }
    }
];

const MAIN_TRADING_TEMPLATE: TemplateWidget[] = [
    {
        type: 'transaction_flow',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 12, h: 8, minW: 8, minH: 4 }
    },
    {
        type: 'orderbook',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 0, w: 7, h: 8, minW: 6, minH: 6 }
    },
    {
        type: 'foreign_trading',
        syncGroupId: 1,
        config: {},
        layout: { x: 19, y: 0, w: 5, h: 8, minW: 4, minH: 6 }
    },
    {
        type: 'intraday_trades',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 8, w: 12, h: 7, minW: 8, minH: 4 }
    },
    {
        type: 'block_trade',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 8, w: 12, h: 7, minW: 8, minH: 4 }
    },
];

const MAIN_MARKET_TEMPLATE: TemplateWidget[] = [
    {
        type: 'market_overview',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 8, h: 9, minW: 6, minH: 6 }
    },
    {
        type: 'top_movers',
        syncGroupId: 1,
        config: {},
        layout: { x: 8, y: 0, w: 8, h: 9, minW: 6, minH: 7 }
    },
    {
        type: 'market_breadth',
        syncGroupId: 1,
        config: {},
        layout: { x: 16, y: 0, w: 8, h: 7, minW: 6, minH: 5 }
    },
    {
        type: 'market_heatmap',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 9, w: 14, h: 11, minW: 10, minH: 8 }
    },
    {
        type: 'sector_board',
        syncGroupId: 1,
        config: {},
        layout: { x: 14, y: 9, w: 10, h: 12, minW: 8, minH: 10 }
    },
    {
        type: 'money_flow_trend',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 21, w: 14, h: 10, minW: 10, minH: 8 }
    },
    {
        type: 'industry_bubble',
        syncGroupId: 1,
        config: {},
        layout: { x: 14, y: 21, w: 10, h: 10, minW: 8, minH: 8 }
    },
];

const MAIN_COMPARISON_TEMPLATE: TemplateWidget[] = [
    {
        type: 'comparison_analysis',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 14, h: 11, minW: 10, minH: 8 }
    },
    {
        type: 'peer_comparison',
        syncGroupId: 1,
        config: {},
        layout: { x: 14, y: 0, w: 10, h: 10, minW: 8, minH: 8 }
    },
    {
        type: 'rs_ranking',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 11, w: 24, h: 10, minW: 10, minH: 8 }
    },
];

const MAIN_FUNDAMENTALS_TEMPLATE: TemplateWidget[] = [
    {
        type: 'financial_ratios',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 10, h: 14, minW: 8, minH: 11 }
    },
    {
        type: 'income_statement',
        syncGroupId: 1,
        config: {},
        layout: { x: 10, y: 0, w: 14, h: 14, minW: 10, minH: 9 }
    },
    {
        type: 'balance_sheet',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 14, w: 14, h: 12, minW: 10, minH: 9 }
    },
    {
        type: 'cash_flow',
        syncGroupId: 1,
        config: {},
        layout: { x: 14, y: 14, w: 10, h: 12, minW: 8, minH: 8 }
    },
];

const MAIN_NEWS_TEMPLATE: TemplateWidget[] = [
    {
        type: 'news_feed',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 12, h: 8, minW: 8, minH: 6 }
    },
    {
        type: 'news_corporate_actions',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 0, w: 12, h: 8, minW: 8, minH: 6 }
    },
    {
        type: 'events_calendar',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 8, w: 12, h: 4, minW: 8, minH: 3 }
    },
    {
        type: 'market_news',
        syncGroupId: 1,
        config: {},
        layout: { x: 12, y: 8, w: 12, h: 10, minW: 8, minH: 6 }
    },
];

const INITIAL_FUNDAMENTAL_TEMPLATE: TemplateWidget[] = [
    {
        type: 'ticker_info',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 6, h: 6, minW: 5, minH: 4 }
    },
    {
        type: 'key_metrics',
        syncGroupId: 1,
        config: {},
        layout: { x: 6, y: 0, w: 8, h: 9, minW: 6, minH: 8 }
    },
    {
        type: 'ticker_profile',
        syncGroupId: 1,
        config: {},
        layout: { x: 14, y: 0, w: 10, h: 6, minW: 8, minH: 5 }
    },
    {
        type: 'unified_financials',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 9, w: 24, h: 10, minW: 14, minH: 8 }
    },
];

const INITIAL_TECHNICAL_TEMPLATE: TemplateWidget[] = [
    {
        type: 'price_chart',
        syncGroupId: 1,
        config: { timeframe: '1Y', chartType: 'candle' },
        layout: { x: 0, y: 0, w: 24, h: 11, minW: 12, minH: 8 }
    },
    {
        type: 'macd_crossovers',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 11, w: 8, h: 9, minW: 6, minH: 7 }
    },
    {
        type: 'rsi_seasonal',
        syncGroupId: 1,
        config: {},
        layout: { x: 8, y: 11, w: 8, h: 9, minW: 6, minH: 7 }
    },
    {
        type: 'bollinger_squeeze',
        syncGroupId: 1,
        config: {},
        layout: { x: 16, y: 11, w: 8, h: 9, minW: 6, minH: 7 }
    },
    {
        type: 'signal_summary',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 20, w: 24, h: 6, minW: 12, minH: 4 }
    },
];

const INITIAL_QUANT_TEMPLATE: TemplateWidget[] = [
    {
        type: 'seasonality_heatmap',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 0, w: 14, h: 12, minW: 10, minH: 9 }
    },
    {
        type: 'sortino_monthly',
        syncGroupId: 1,
        config: {},
        layout: { x: 14, y: 0, w: 10, h: 11, minW: 8, minH: 9 }
    },
    {
        type: 'drawdown_recovery',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 12, w: 7, h: 12, minW: 6, minH: 9 }
    },
    {
        type: 'gap_analysis',
        syncGroupId: 1,
        config: {},
        layout: { x: 7, y: 12, w: 7, h: 10, minW: 6, minH: 8 }
    },
    {
        type: 'correlation_matrix',
        syncGroupId: 1,
        config: {},
        layout: { x: 14, y: 12, w: 10, h: 13, minW: 9, minH: 10 }
    },
    {
        type: 'signal_summary',
        syncGroupId: 1,
        config: {},
        layout: { x: 0, y: 25, w: 24, h: 6, minW: 12, minH: 4 }
    },
];

// Map template name to widgets
const DASHBOARD_TEMPLATES: Record<string, TemplateWidget[]> = {
    overview: OVERVIEW_TEMPLATE,
    financials: FINANCIALS_TEMPLATE,
    quant: QUANT_TEMPLATE,
    technical: TECHNICAL_TEMPLATE,
    trading: MAIN_TRADING_TEMPLATE,
    market: MAIN_MARKET_TEMPLATE,
    comparison: COMPARISON_TEMPLATE,
    ownership: OWNERSHIP_TEMPLATE,
    calendar: CALENDAR_TEMPLATE,
};

// Map tab names to template names for migration
const TAB_NAME_TO_TEMPLATE: Record<string, string> = {
    'overview': 'overview',
    'overview 1': 'overview',
    'financials': 'financials',
    'quant': 'quant',
    'quant & technical': 'quant',
    'quant and technical': 'quant',
    'technical analysis': 'technical',
    'technical': 'technical',
    'trading': 'trading',
    'trade': 'trading',
    'comparison analysis': 'comparison',
    'comparison': 'comparison',
    'ownership': 'ownership',
    'calendar': 'calendar',
    'market': 'market',
    'market analysis': 'market',
    'market-analysis': 'market',
};

// Migration: Apply templates to empty tabs that should have widgets
const migrateEmptyTabs = (dashboards: Dashboard[]): Dashboard[] => {
    return dashboards.map(dashboard => ({
        ...dashboard,
        tabs: dashboard.tabs.map(tab => {
            // Skip tabs that already have widgets
            if (tab.widgets.length > 0) return tab;

            // Find matching template by tab name (case-insensitive)
            const templateName = TAB_NAME_TO_TEMPLATE[tab.name.toLowerCase()];
            if (!templateName) return tab;

            const template = DASHBOARD_TEMPLATES[templateName];
            if (!template) return tab;

            // Apply template to empty tab
            const widgets = createWidgetsFromTemplate(template, tab.id);
            return { ...tab, widgets };
        }),
    }));
};

const migrateLegacyDashboardNames = (dashboards: Dashboard[]): Dashboard[] => {
    const usedNames = new Set(
        dashboards
            .filter((dashboard) => !LEGACY_DASHBOARD_NAME_RE.test(dashboard.name.trim()))
            .map((dashboard) => dashboard.name.trim().toLowerCase())
    );

    let dashboardNumber = 1;
    const nextDashboardName = () => {
        while (usedNames.has(`dashboard ${dashboardNumber}`)) {
            dashboardNumber += 1;
        }
        const candidate = `Dashboard ${dashboardNumber}`;
        usedNames.add(candidate.toLowerCase());
        dashboardNumber += 1;
        return candidate;
    };

    return dashboards.map((dashboard) => {
        if (!LEGACY_DASHBOARD_NAME_RE.test(dashboard.name.trim())) {
            usedNames.add(dashboard.name.trim().toLowerCase());
            return dashboard;
        }

        return {
            ...dashboard,
            name: nextDashboardName(),
            updatedAt: new Date().toISOString(),
        };
    });
};

const migrateLegacyChartWidgets = (dashboards: Dashboard[]): Dashboard[] => {
    return dashboards.map((dashboard) => ({
        ...dashboard,
        tabs: dashboard.tabs.map((tab) => ({
            ...tab,
            widgets: tab.widgets.map((widget) => {
                const widgetType = widget.type as string;
                if (widgetType !== 'tradingview_chart') {
                    return widget;
                }

                return {
                    ...widget,
                    type: 'price_chart',
                };
            }),
        })),
    }));
};

const countDashboardWidgets = (dashboard: Dashboard): number => {
    return dashboard.tabs.reduce((total, tab) => total + tab.widgets.length, 0);
};

const migrateLegacySidebarDashboards = (dashboards: Dashboard[]): Dashboard[] => {
    const filteredDashboards = dashboards.filter((dashboard) => {
        if (!LEGACY_SIDEBAR_DASHBOARD_RE.test(dashboard.name.trim())) {
            return true;
        }

        if (dashboards.length <= 1) {
            return true;
        }

        return countDashboardWidgets(dashboard) > 0;
    });

    if (filteredDashboards.length === 0) {
        return dashboards;
    }

    const usedNames = new Set(
        filteredDashboards
            .filter((dashboard) => !LEGACY_SIDEBAR_DASHBOARD_RE.test(dashboard.name.trim()))
            .map((dashboard) => dashboard.name.trim().toLowerCase())
    );

    let dashboardNumber = 1;
    const nextDashboardName = () => {
        while (usedNames.has(`dashboard ${dashboardNumber}`)) {
            dashboardNumber += 1;
        }
        const candidate = `Dashboard ${dashboardNumber}`;
        usedNames.add(candidate.toLowerCase());
        dashboardNumber += 1;
        return candidate;
    };

    return filteredDashboards.map((dashboard) => {
        if (!LEGACY_SIDEBAR_DASHBOARD_RE.test(dashboard.name.trim())) {
            return dashboard;
        }

        return {
            ...dashboard,
            name: nextDashboardName(),
            updatedAt: new Date().toISOString(),
        };
    });
};

const migrateLegacyManageTabs = (dashboards: Dashboard[]): Dashboard[] => {
    return dashboards.map((dashboard) => {
        if (dashboard.tabs.length === 0) {
            return dashboard;
        }

        const sortedTabs = [...dashboard.tabs].sort((a, b) => a.order - b.order);
        const filteredTabs = sortedTabs.filter(
            (tab) => !(LEGACY_MANAGE_TAB_NAME_RE.test(tab.name.trim()) && tab.widgets.length === 0)
        );

        if (filteredTabs.length === sortedTabs.length) {
            return dashboard;
        }

        const fallbackTabs = filteredTabs.length > 0 ? filteredTabs : sortedTabs.slice(0, 1);
        const normalizedTabs = fallbackTabs.map((tab, index) => ({
            ...tab,
            name:
                filteredTabs.length === 0 &&
                index === 0 &&
                LEGACY_MANAGE_TAB_NAME_RE.test(tab.name.trim())
                    ? 'Overview 1'
                    : tab.name,
            order: index,
        }));

        return {
            ...dashboard,
            tabs: normalizedTabs,
            updatedAt: new Date().toISOString(),
        };
    });
};

const migrateStaleNewTabs = (dashboards: Dashboard[]): Dashboard[] => {
    return dashboards.map((dashboard) => {
        if (dashboard.tabs.length === 0) {
            return {
                ...dashboard,
                tabs: [createDefaultTab('Overview 1', 0)],
                updatedAt: new Date().toISOString(),
            };
        }

        const sortedTabs = [...dashboard.tabs].sort((a, b) => a.order - b.order);
        const filteredTabs = sortedTabs.filter((tab, index) => {
            const isLegacyStale = LEGACY_STALE_TAB_RE.test(tab.name.trim());
            if (!isLegacyStale) {
                return true;
            }

            const isPrimaryTab = index === 0;
            return isPrimaryTab && tab.widgets.length > 0;
        });

        if (filteredTabs.length === sortedTabs.length) {
            return dashboard;
        }

        const fallbackTabs = filteredTabs.length > 0 ? filteredTabs : sortedTabs.slice(0, 1);
        const normalizedTabs = fallbackTabs.map((tab, index) => ({
                ...tab,
                name:
                    index === 0 && LEGACY_STALE_TAB_RE.test(tab.name.trim())
                        ? 'Overview 1'
                        : tab.name,
                order: index,
            }));

        return {
            ...dashboard,
            tabs: normalizedTabs,
            updatedAt: new Date().toISOString(),
        };
    });
};

const isLegacyFolderName = (name: string): boolean => {
    const normalized = name.trim().toLowerCase();
    return !normalized || normalized === 'test' || normalized.includes('new folder');
};

const migrateSidebarClutter = (
    dashboards: Dashboard[],
    folders: DashboardFolder[]
): { dashboards: Dashboard[]; folders: DashboardFolder[] } => {
    const cleanedFolders = folders.filter((folder) => !isLegacyFolderName(folder.name));
    const validFolderIds = new Set(cleanedFolders.map((folder) => folder.id));

    const normalizedDashboards = dashboards.map((dashboard) => {
        if (!dashboard.folderId || validFolderIds.has(dashboard.folderId)) {
            return dashboard;
        }

        return {
            ...dashboard,
            folderId: undefined,
            updatedAt: new Date().toISOString(),
        };
    });

    const usedFolderIds = new Set(
        normalizedDashboards
            .map((dashboard) => dashboard.folderId)
            .filter((folderId): folderId is string => Boolean(folderId))
    );

    return {
        dashboards: normalizedDashboards,
        folders: cleanedFolders.filter((folder) => usedFolderIds.has(folder.id)),
    };
};

// Convert template widgets to actual widget instances
const createWidgetsFromTemplate = (template: TemplateWidget[], tabId: string): WidgetInstance[] => {
    return preserveTemplateGridItems(template).map((tw) => {
        const widgetId = generateWidgetId(tw.type);
        return {
            id: widgetId,
            type: tw.type,
            tabId,
            syncGroupId: tw.syncGroupId,
            config: tw.config,
            layout: {
                i: widgetId,
                ...tw.layout,
            },
        };
    });
};

// Create a tab with pre-populated widgets from template
const createTabWithTemplate = (
    name: string,
    order: number,
    templateName: string
): DashboardTab => {
    const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const template = DASHBOARD_TEMPLATES[templateName] || [];
    const widgets = createWidgetsFromTemplate(template, tabId);

    return {
        id: tabId,
        name,
        order,
        widgets,
    };
};

const createDefaultTab = (name: string, order: number): DashboardTab => ({
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name,
    order,
    widgets: [],
});

type SystemDashboardTabSpec = {
    idSuffix: string;
    name: string;
    template: TemplateWidget[];
};

const createSystemDashboardTab = (
    dashboardId: string,
    spec: SystemDashboardTabSpec,
    order: number,
): DashboardTab => {
    const tabId = `tab-${dashboardId}-${spec.idSuffix}`;
    return {
        id: tabId,
        name: spec.name,
        order,
        widgets: createWidgetsFromTemplate(spec.template, tabId),
    };
};

const createMainDashboardTabs = (): DashboardTab[] => {
    const macroId = 'tab-main-macro-discovery';
    const deepDiveId = 'tab-main-deep-dive';
    const quantId = 'tab-main-quant';
    const technicalId = 'tab-main-technical';
    const tradingId = 'tab-main-trading';
    const comparisonId = 'tab-main-comparison';
    const fundamentalsId = 'tab-main-fundamentals';
    const marketId = 'tab-main-market';
    const newsId = 'tab-main-news-events';

    return [
        {
            id: macroId,
            name: 'Overview',
            order: 0,
            widgets: createWidgetsFromTemplate(MAIN_MACRO_TEMPLATE, macroId),
        },
        {
            id: deepDiveId,
            name: 'Equity Analysis',
            order: 1,
            widgets: createWidgetsFromTemplate(MAIN_DEEP_DIVE_TEMPLATE, deepDiveId),
        },
        {
            id: quantId,
            name: 'Quant',
            order: 2,
            widgets: createWidgetsFromTemplate(MAIN_QUANT_TEMPLATE, quantId),
        },
        {
            id: technicalId,
            name: 'Technical',
            order: 3,
            widgets: createWidgetsFromTemplate(MAIN_TECHNICAL_TEMPLATE, technicalId),
        },
        {
            id: tradingId,
            name: 'Trading',
            order: 4,
            widgets: createWidgetsFromTemplate(MAIN_TRADING_TEMPLATE, tradingId),
        },
        {
            id: comparisonId,
            name: 'Comparison',
            order: 5,
            widgets: createWidgetsFromTemplate(MAIN_COMPARISON_TEMPLATE, comparisonId),
        },
        {
            id: fundamentalsId,
            name: 'Fundamentals',
            order: 6,
            widgets: createWidgetsFromTemplate(MAIN_FUNDAMENTALS_TEMPLATE, fundamentalsId),
        },
        {
            id: marketId,
            name: 'Market',
            order: 7,
            widgets: createWidgetsFromTemplate(MAIN_MARKET_TEMPLATE, marketId),
        },
        {
            id: newsId,
            name: 'News & Events',
            order: 8,
            widgets: createWidgetsFromTemplate(MAIN_NEWS_TEMPLATE, newsId),
        },
    ];
};

const createInitialFolder = (): DashboardFolder => ({
    id: INITIAL_FOLDER_ID,
    name: INITIAL_FOLDER_NAME,
    order: 0,
    isExpanded: true,
});

const createSystemDashboard = (
    id: string,
    name: string,
    tabs: SystemDashboardTabSpec[],
    order: number,
    description: string,
): Dashboard => {
    const timestamp = new Date().toISOString();

    return {
        id,
        name,
        description,
        folderId: INITIAL_FOLDER_ID,
        order,
        isDefault: order === 0,
        isEditable: false,
        isDeletable: false,
        showGroupLabels: true,
        tabs: tabs.map((tab, index) => createSystemDashboardTab(id, tab, index)),
        syncGroups: [
            { id: 1, name: 'Group 1', color: DEFAULT_SYNC_GROUP_COLORS[0], currentSymbol: DEFAULT_TICKER },
        ],
        createdAt: timestamp,
        updatedAt: timestamp,
    };
};

const createMainSystemDashboard = (): Dashboard => {
    return createSystemDashboard(
        MAIN_DASHBOARD_ID,
        MAIN_DASHBOARD_NAME,
        [
            { idSuffix: 'fundamentals', name: 'Fundamentals', template: MAIN_FUNDAMENTALS_TEMPLATE },
            { idSuffix: 'overview', name: 'Overview', template: MAIN_DEEP_DIVE_TEMPLATE },
            { idSuffix: 'company', name: 'Company', template: INITIAL_FUNDAMENTAL_TEMPLATE },
            { idSuffix: 'ownership', name: 'Ownership', template: OWNERSHIP_TEMPLATE },
            { idSuffix: 'comparison', name: 'Comparison', template: MAIN_COMPARISON_TEMPLATE },
            { idSuffix: 'news-events', name: 'News & Events', template: MAIN_NEWS_TEMPLATE },
        ],
        0,
        'Default fundamental workspace with ownership and financial statement context.',
    );
};

const createTechnicalSystemDashboard = (): Dashboard => {
    return createSystemDashboard(
        TECHNICAL_DASHBOARD_ID,
        'Technical',
        [
            { idSuffix: 'technical', name: 'Technical', template: MAIN_TECHNICAL_TEMPLATE },
            { idSuffix: 'overview', name: 'Overview', template: INITIAL_TECHNICAL_TEMPLATE },
            { idSuffix: 'trading', name: 'Trading', template: MAIN_TRADING_TEMPLATE },
            { idSuffix: 'market', name: 'Market', template: MAIN_MARKET_TEMPLATE },
        ],
        1,
        'Default technical workspace with chart structure, momentum, and conclusion signal.',
    );
};

const createQuantSystemDashboard = (): Dashboard => {
    return createSystemDashboard(
        QUANT_DASHBOARD_ID,
        'Quant',
        [
            { idSuffix: 'quant', name: 'Quant', template: MAIN_QUANT_TEMPLATE },
            { idSuffix: 'overview', name: 'Overview', template: INITIAL_QUANT_TEMPLATE },
            { idSuffix: 'comparison', name: 'Comparison', template: MAIN_COMPARISON_TEMPLATE },
            { idSuffix: 'market', name: 'Market', template: MAIN_MARKET_TEMPLATE },
        ],
        2,
        'Default quant workspace focused on seasonality, drawdown, and cross-metric context.',
    );
};

const ensureInitialFolderPresent = (folders: DashboardFolder[]): DashboardFolder[] => {
    const validFolders = Array.isArray(folders) ? folders.filter(Boolean) : [];
    const existingInitial = validFolders.find(
        (folder) => folder.id === INITIAL_FOLDER_ID || folder.name.trim().toLowerCase() === INITIAL_FOLDER_NAME.toLowerCase()
    );
    const initialFolder = existingInitial
        ? { ...existingInitial, id: INITIAL_FOLDER_ID, name: INITIAL_FOLDER_NAME, order: 0, isExpanded: true }
        : createInitialFolder();

    const otherFolders = validFolders
        .filter((folder) => folder.id !== existingInitial?.id && folder.id !== INITIAL_FOLDER_ID)
        .sort((a, b) => a.order - b.order)
        .map((folder, index) => ({ ...folder, order: index + 1 }));

    return [initialFolder, ...otherFolders];
};

const migrateDashboardPermissions = (dashboards: Dashboard[]): Dashboard[] => {
    return dashboards.map((dashboard) => {
        const isSystem = SYSTEM_DASHBOARD_IDS.has(dashboard.id) || dashboard.name === LEGACY_MAIN_DASHBOARD_NAME;
        return {
            ...dashboard,
            isEditable: isSystem ? false : dashboard.isEditable ?? true,
            isDeletable: isSystem ? false : dashboard.isDeletable ?? true,
        };
    });
};

const ensureMainDashboardPresent = (dashboards: Dashboard[]): Dashboard[] => {
    const validDashboards = Array.isArray(dashboards) ? dashboards.filter(Boolean) : [];
    const permissionsMigrated = migrateDashboardPermissions(validDashboards);

    const fallbackFundamental = createMainSystemDashboard();
    const fallbackTechnical = createTechnicalSystemDashboard();
    const fallbackQuant = createQuantSystemDashboard();

    const existingFundamental = permissionsMigrated.find(
        (dashboard) =>
            dashboard.id === MAIN_DASHBOARD_ID ||
            dashboard.id === LEGACY_MAIN_DASHBOARD_ID ||
            dashboard.name === LEGACY_MAIN_DASHBOARD_NAME ||
            dashboard.name === MAIN_DASHBOARD_NAME
    );
    const existingTechnical = permissionsMigrated.find((dashboard) => dashboard.id === TECHNICAL_DASHBOARD_ID || dashboard.name === 'Technical');
    const existingQuant = permissionsMigrated.find((dashboard) => dashboard.id === QUANT_DASHBOARD_ID || dashboard.name === 'Quant');

    const buildSystemDashboard = (existing: Dashboard | undefined, fallback: Dashboard, order: number): Dashboard => ({
        ...(existing || fallback),
        id: fallback.id,
        name: fallback.name,
        description: fallback.description,
        folderId: INITIAL_FOLDER_ID,
        order,
        isDefault: order === 0,
        isEditable: false,
        isDeletable: false,
        tabs: fallback.tabs,
        syncGroups: Array.isArray(existing?.syncGroups) && existing.syncGroups.length > 0
            ? existing.syncGroups
            : fallback.syncGroups,
        createdAt: existing?.createdAt || fallback.createdAt,
        updatedAt: new Date().toISOString(),
    });

    const systemDashboards = [
        buildSystemDashboard(existingFundamental, fallbackFundamental, 0),
        buildSystemDashboard(existingTechnical, fallbackTechnical, 1),
        buildSystemDashboard(existingQuant, fallbackQuant, 2),
    ];

    const nonSystemDashboards = permissionsMigrated
        .filter((dashboard) => !SYSTEM_DASHBOARD_IDS.has(dashboard.id) && dashboard.name !== LEGACY_MAIN_DASHBOARD_NAME)
        .sort((a, b) => a.order - b.order)
        .map((dashboard, index) => ({
            ...dashboard,
            order: index + systemDashboards.length,
            isEditable: dashboard.isEditable ?? true,
            isDeletable: dashboard.isDeletable ?? true,
        }));

    return [...systemDashboards, ...nonSystemDashboards];
};

const canEditDashboard = (dashboard?: Dashboard | null): boolean => {
    return (dashboard?.isEditable ?? true) !== false;
};

const canDeleteDashboard = (dashboard?: Dashboard | null): boolean => {
    return (dashboard?.isDeletable ?? true) !== false;
};

// ============================================================================
// Actions
// ============================================================================

type DashboardAction =
    | { type: 'SET_STATE'; payload: DashboardState }
    | { type: 'SET_ACTIVE_DASHBOARD'; payload: string }
    | { type: 'SET_ACTIVE_TAB'; payload: string }
    | { type: 'ADD_DASHBOARD'; payload: Dashboard }
    | { type: 'UPDATE_DASHBOARD'; payload: { id: string; updates: Partial<Dashboard> } }
    | { type: 'DELETE_DASHBOARD'; payload: string }
    | { type: 'ADD_FOLDER'; payload: DashboardFolder }
    | { type: 'UPDATE_FOLDER'; payload: { id: string; updates: Partial<DashboardFolder> } }
    | { type: 'DELETE_FOLDER'; payload: string }
    | { type: 'ADD_TAB'; payload: { dashboardId: string; tab: DashboardTab } }
    | { type: 'UPDATE_TAB'; payload: { dashboardId: string; tabId: string; updates: Partial<DashboardTab> } }
    | { type: 'DELETE_TAB'; payload: { dashboardId: string; tabId: string } }
    | { type: 'REORDER_TABS'; payload: { dashboardId: string; tabs: DashboardTab[] } }
    | { type: 'ADD_WIDGET'; payload: { dashboardId: string; tabId: string; widget: WidgetInstance } }
    | { type: 'UPDATE_WIDGET'; payload: { dashboardId: string; tabId: string; widgetId: string; updates: Partial<WidgetInstance> } }
    | { type: 'DELETE_WIDGET'; payload: { dashboardId: string; tabId: string; widgetId: string } }
    | { type: 'UPDATE_TAB_LAYOUT'; payload: { dashboardId: string; tabId: string; widgets: WidgetInstance[] } }
    | { type: 'RESET_TAB_LAYOUT'; payload: { dashboardId: string; tabId: string } }
    | { type: 'UPDATE_SYNC_GROUP'; payload: { dashboardId: string; groupId: number; symbol: string } }
    | { type: 'ADD_SYNC_GROUP'; payload: { dashboardId: string; group: WidgetSyncGroup } }
    | { type: 'MOVE_DASHBOARD'; payload: { dashboardId: string; targetFolderId: string | undefined } }
    | { type: 'REORDER_DASHBOARDS'; payload: { dashboardIds: string[]; folderId: string | undefined } };

// ============================================================================
// Reducer
// ============================================================================

function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
    const getDashboard = (dashboardId: string) => {
        return state.dashboards.find((dashboard) => dashboard.id === dashboardId) || null;
    };

    const isEditableDashboardId = (dashboardId: string) => {
        return canEditDashboard(getDashboard(dashboardId));
    };

    const isDeletableDashboardId = (dashboardId: string) => {
        return canDeleteDashboard(getDashboard(dashboardId));
    };

    switch (action.type) {
        case 'SET_STATE': {
            const dashboards = ensureMainDashboardPresent(action.payload.dashboards);
            const activeDashboardId = dashboards.some((dashboard) => dashboard.id === action.payload.activeDashboardId)
                ? action.payload.activeDashboardId
                : dashboards[0]?.id || null;
            const activeDashboard = dashboards.find((dashboard) => dashboard.id === activeDashboardId) || dashboards[0];
            const activeTabId = activeDashboard?.tabs.some((tab) => tab.id === action.payload.activeTabId)
                ? action.payload.activeTabId
                : activeDashboard?.tabs[0]?.id || null;

            return {
                ...action.payload,
                dashboards,
                activeDashboardId,
                activeTabId,
            };
        }

        case 'SET_ACTIVE_DASHBOARD':
            return { ...state, activeDashboardId: action.payload };

        case 'SET_ACTIVE_TAB':
            return { ...state, activeTabId: action.payload };

        case 'ADD_DASHBOARD':
            return {
                ...state,
                dashboards: [
                    ...state.dashboards,
                    {
                        ...action.payload,
                        isEditable: action.payload.isEditable ?? true,
                        isDeletable: action.payload.isDeletable ?? true,
                    },
                ],
            };

        case 'UPDATE_DASHBOARD': {
            if (!isEditableDashboardId(action.payload.id)) {
                return state;
            }

            const { isEditable: _ignoreEditable, isDeletable: _ignoreDeletable, ...safeUpdates } = action.payload.updates;
            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.id
                        ? { ...d, ...safeUpdates, updatedAt: new Date().toISOString() }
                        : d
                ),
            };
        }

        case 'DELETE_DASHBOARD':
            {
                if (!isDeletableDashboardId(action.payload)) {
                    return state;
                }

                const remainingDashboards = ensureMainDashboardPresent(
                    state.dashboards.filter((d) => d.id !== action.payload)
                );

                if (remainingDashboards.length === 0) {
                    const defaultDashboard = createMainSystemDashboard();
                    return {
                        ...state,
                        dashboards: [defaultDashboard],
                        activeDashboardId: defaultDashboard.id,
                        activeTabId: defaultDashboard.tabs[0]?.id || null,
                    };
                }

                const orderedDashboards = [...remainingDashboards].sort((a, b) => a.order - b.order);
                const nextActiveDashboardId =
                    state.activeDashboardId === action.payload ||
                    !remainingDashboards.some((dashboard) => dashboard.id === state.activeDashboardId)
                        ? orderedDashboards[0]?.id || null
                        : state.activeDashboardId;

                const nextActiveDashboard =
                    remainingDashboards.find((dashboard) => dashboard.id === nextActiveDashboardId) ||
                    orderedDashboards[0];
                const sortedTabs = [...(nextActiveDashboard?.tabs || [])].sort(
                    (a, b) => a.order - b.order
                );
                const nextActiveTabId =
                    sortedTabs.find((tab) => tab.id === state.activeTabId)?.id ||
                    sortedTabs[0]?.id ||
                    null;

                return {
                    ...state,
                    dashboards: remainingDashboards,
                    activeDashboardId: nextActiveDashboardId,
                    activeTabId: nextActiveTabId,
                };
            }

        case 'ADD_FOLDER':
            return {
                ...state,
                folders: [...state.folders, action.payload],
            };

        case 'UPDATE_FOLDER':
            if (action.payload.id === INITIAL_FOLDER_ID) {
                return {
                    ...state,
                    folders: state.folders.map((f) =>
                        f.id === action.payload.id
                            ? { ...f, isExpanded: action.payload.updates.isExpanded ?? f.isExpanded }
                            : f
                    ),
                };
            }
            return {
                ...state,
                folders: state.folders.map((f) =>
                    f.id === action.payload.id ? { ...f, ...action.payload.updates } : f
                ),
            };

        case 'DELETE_FOLDER':
            if (action.payload === INITIAL_FOLDER_ID) {
                return state;
            }
            return {
                ...state,
                folders: state.folders.filter((f) => f.id !== action.payload),
                // Move dashboards out of deleted folder
                dashboards: state.dashboards.map((d) =>
                    d.folderId === action.payload ? { ...d, folderId: undefined } : d
                ),
            };

        case 'ADD_TAB': {
            if (!isEditableDashboardId(action.payload.dashboardId)) {
                return state;
            }

            return {
                ...state,
                dashboards: state.dashboards.map((d) =>
                    d.id === action.payload.dashboardId
                        ? { ...d, tabs: [...d.tabs, action.payload.tab], updatedAt: new Date().toISOString() }
                        : d
                ),
            };
        }

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
            // Sort by order to get the first tab correctly
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
                            tabs: d.tabs.map((t) =>
                                t.id === action.payload.tabId
                                    ? { ...t, widgets: [...t.widgets, action.payload.widget] }
                                    : t
                            ),
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

        case 'UPDATE_SYNC_GROUP': {
            if (!isEditableDashboardId(action.payload.dashboardId)) {
                return state;
            }

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
        }

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
            const orderedEditableIds = dashboardIds.filter((dashboardId) => !SYSTEM_DASHBOARD_IDS.has(dashboardId));
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

                    const newIndex = orderedEditableIds.indexOf(d.id);
                    if (newIndex !== -1) {
                        return { ...d, order: newIndex + 1, folderId, updatedAt: new Date().toISOString() };
                    }
                    return d;
                }),
            };
        }

        default:
            return state;
    }
}

// ============================================================================
// Context
// ============================================================================

interface DashboardContextValue {
    state: DashboardState;
    // Dashboard actions
    setActiveDashboard: (id: string) => void;
    createDashboard: (data: DashboardCreate) => Dashboard;
    updateDashboard: (id: string, updates: Partial<Dashboard>) => void;
    deleteDashboard: (id: string) => void;
    // Folder actions
    createFolder: (name: string) => DashboardFolder;
    updateFolder: (id: string, updates: Partial<DashboardFolder>) => void;
    deleteFolder: (id: string) => void;
    toggleFolder: (id: string) => void;
    // Tab actions
    setActiveTab: (id: string) => void;
    createTab: (dashboardId: string, name: string) => DashboardTab;
    updateTab: (dashboardId: string, tabId: string, updates: Partial<DashboardTab>) => void;
    deleteTab: (dashboardId: string, tabId: string) => void;
    reorderTabs: (dashboardId: string, tabs: DashboardTab[]) => void;
    applyTemplate: (dashboardId: string, tabId: string, templateName: string) => void;
    // Widget actions
    addWidget: (dashboardId: string, tabId: string, widget: WidgetCreate) => WidgetInstance;
    updateWidget: (dashboardId: string, tabId: string, widgetId: string, updates: Partial<WidgetInstance>) => void;
    deleteWidget: (dashboardId: string, tabId: string, widgetId: string) => void;
    cloneWidget: (dashboardId: string, tabId: string, widgetId: string) => WidgetInstance | null;
    updateTabLayout: (dashboardId: string, tabId: string, widgets: WidgetInstance[]) => void;
    resetTabLayout: (dashboardId: string, tabId: string) => void;
    // Sync group actions
    updateSyncGroupSymbol: (dashboardId: string, groupId: number, symbol: string) => void;
    createSyncGroup: (dashboardId: string, symbol: string) => WidgetSyncGroup;
    // Move & Reorder actions
    moveDashboard: (dashboardId: string, targetFolderId: string | undefined) => void;
    reorderDashboards: (dashboardIds: string[], folderId: string | undefined) => void;
    // Computed values
    activeDashboard: Dashboard | null;
    activeTab: DashboardTab | null;
    // Template helpers
    availableTemplates: string[];
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface DashboardProviderProps {
    children: ReactNode;
}

export function DashboardProvider({ children }: DashboardProviderProps) {
    const [state, dispatch] = useReducer(dashboardReducer, {
        dashboards: [],
        folders: [],
        activeDashboardId: null,
        activeTabId: null,
    });

    const getPreferredActiveTabId = useCallback((dashboard: Dashboard | null | undefined) => {
        if (!dashboard) return null;
        return findPreferredTabId(dashboard.tabs) || dashboard.tabs[0]?.id || null;
    }, []);

    // Load from localStorage on mount
    useEffect(() => {
        if (typeof window === 'undefined') return;

        try {
            const storedStorageVersion = localStorage.getItem(STORAGE_VERSION_KEY);
            if (storedStorageVersion !== CURRENT_STORAGE_VERSION) {
                localStorage.removeItem('vnibb-tabs');
                localStorage.removeItem('vnibb-dashboard');
                localStorage.setItem(STORAGE_VERSION_KEY, CURRENT_STORAGE_VERSION);
            }

            const storedDashboards = localStorage.getItem(STORAGE_KEY);
            const storedFolders = localStorage.getItem(FOLDERS_KEY);
            const storedMigrationVersion = localStorage.getItem(MIGRATION_VERSION_KEY);
            const migrationVersion = storedMigrationVersion ? parseInt(storedMigrationVersion, 10) : 0;

            let dashboards: Dashboard[] = [];
            let folders: DashboardFolder[] = [];

            if (storedDashboards) {
                dashboards = JSON.parse(storedDashboards);
                if (!Array.isArray(dashboards)) {
                    dashboards = [];
                }
            }
            if (storedFolders) {
                folders = JSON.parse(storedFolders);
                if (!Array.isArray(folders)) {
                    folders = [];
                }
            }

            // Ensure permanent immutable main dashboard exists
            if (dashboards.length === 0) {
                dashboards = [createMainSystemDashboard()];
                folders = [createInitialFolder()];
            } else if (migrationVersion < CURRENT_MIGRATION_VERSION) {
                if (migrationVersion < 2) {
                    dashboards = migrateEmptyTabs(dashboards);
                }

                if (migrationVersion < 3) {
                    dashboards = migrateLegacyDashboardNames(dashboards);
                }

                if (migrationVersion < 4) {
                    dashboards = migrateLegacyChartWidgets(dashboards);
                }

                if (migrationVersion < 5) {
                    const cleaned = migrateSidebarClutter(dashboards, folders);
                    dashboards = cleaned.dashboards;
                    folders = cleaned.folders;
                }

                if (migrationVersion < 6) {
                    dashboards = migrateLegacyManageTabs(dashboards);
                }

                if (migrationVersion < 7) {
                    dashboards = migrateStaleNewTabs(dashboards);
                }

                if (migrationVersion < 8) {
                    dashboards = migrateLegacyChartWidgets(dashboards);
                }

                if (migrationVersion < 9) {
                    dashboards = migrateDashboardPermissions(dashboards);
                }

                if (migrationVersion < 10) {
                    folders = ensureInitialFolderPresent(folders);
                }

                // Final safety validation for all widgets
                dashboards = dashboards.map(d => ({
                    ...d,
                    tabs: d.tabs.map(t => ({
                        ...t,
                        widgets: t.widgets.filter(w => {
                            if (!w.type || typeof w.type !== 'string') {
                                console.warn('Removing invalid widget (missing type):', w);
                                return false;
                            }
                            return true;
                        })
                    }))
                }));

                // Save migration version
                localStorage.setItem(MIGRATION_VERSION_KEY, String(CURRENT_MIGRATION_VERSION));
            }

            dashboards = migrateLegacySidebarDashboards(dashboards);
            dashboards = migrateStaleNewTabs(dashboards);
            const cleanedSidebar = migrateSidebarClutter(dashboards, folders);
            dashboards = cleanedSidebar.dashboards;
            folders = cleanedSidebar.folders;
            folders = ensureInitialFolderPresent(folders);
            dashboards = ensureMainDashboardPresent(dashboards);
            const preferredSymbol = readStoredTicker();
            dashboards = dashboards.map((dashboard) => ({
                ...dashboard,
                syncGroups: dashboard.syncGroups.map((group) => ({
                    ...group,
                    currentSymbol:
                        !group.currentSymbol || group.currentSymbol === 'VNM'
                            ? preferredSymbol
                            : group.currentSymbol,
                })),
            }));

            if (dashboards.length === 0) {
                dashboards = [createMainSystemDashboard()];
                folders = [createInitialFolder()];
            }

            const preferredView = readStoredUserPreferences().defaultTab;
            const activeDashboardId =
                findPreferredDashboardId(dashboards, preferredView) || dashboards[0]?.id || null;
            const activeDashboard = dashboards.find((dashboard) => dashboard.id === activeDashboardId) || dashboards[0];
            const activeTabId = getPreferredActiveTabId(activeDashboard);

            dispatch({
                type: 'SET_STATE',
                payload: { dashboards, folders, activeDashboardId, activeTabId },
            });
        } catch (error) {
            console.error('Failed to load dashboards from storage:', error);
            const defaultDashboard = createMainSystemDashboard();
            dispatch({
                type: 'SET_STATE',
                payload: {
                    dashboards: [defaultDashboard],
                    folders: [createInitialFolder()],
                    activeDashboardId: defaultDashboard.id,
                    activeTabId: getPreferredActiveTabId(defaultDashboard),
                },
            });
        }
    }, [getPreferredActiveTabId]);

    // Save to localStorage on state change
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (state.dashboards.length === 0) return;

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.dashboards));
            localStorage.setItem(FOLDERS_KEY, JSON.stringify(state.folders));
        } catch (error) {
            console.error('Failed to save dashboards to storage:', error);
        }
    }, [state.dashboards, state.folders]);

    // Sync to backend (debounced)
    const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');

    useDashboardSync(state, {
        enabled: true,
        onSyncSuccess: () => setSyncStatus('synced'),
        onSyncError: () => setSyncStatus('error'),
    });

    // ========================================================================
    // Dashboard Actions
    // ========================================================================

    const setActiveDashboard = useCallback((id: string) => {
        dispatch({ type: 'SET_ACTIVE_DASHBOARD', payload: id });
        const dashboard = state.dashboards.find((d) => d.id === id);
        const preferredTabId = getPreferredActiveTabId(dashboard);
        if (preferredTabId) {
            dispatch({ type: 'SET_ACTIVE_TAB', payload: preferredTabId });
        }
    }, [getPreferredActiveTabId, state.dashboards]);

    const createDashboard = useCallback((data: DashboardCreate): Dashboard => {
        const now = new Date().toISOString();
        const dashboard: Dashboard = {
            id: `dash-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name: data.name,
            description: data.description,
            folderId: data.folderId,
            order: state.dashboards.length,
            isDefault: data.isDefault || false,
            isEditable: true,
            isDeletable: true,
            showGroupLabels: true,
            tabs: [createDefaultTab('Overview 1', 0)],
            syncGroups: [
                { id: 1, name: 'Group 1', color: DEFAULT_SYNC_GROUP_COLORS[0], currentSymbol: DEFAULT_TICKER },
            ],
            createdAt: now,
            updatedAt: now,
        };
        dispatch({ type: 'ADD_DASHBOARD', payload: dashboard });
        return dashboard;
    }, [state.dashboards.length]);

    const updateDashboard = useCallback((id: string, updates: Partial<Dashboard>) => {
        dispatch({ type: 'UPDATE_DASHBOARD', payload: { id, updates } });
    }, []);

    const deleteDashboard = useCallback((id: string) => {
        dispatch({ type: 'DELETE_DASHBOARD', payload: id });
    }, []);

    // ========================================================================
    // Folder Actions
    // ========================================================================

    const createFolder = useCallback((name: string): DashboardFolder => {
        const folder: DashboardFolder = {
            id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name,
            order: state.folders.length,
            isExpanded: true,
        };
        dispatch({ type: 'ADD_FOLDER', payload: folder });
        return folder;
    }, [state.folders.length]);

    const updateFolder = useCallback((id: string, updates: Partial<DashboardFolder>) => {
        dispatch({ type: 'UPDATE_FOLDER', payload: { id, updates } });
    }, []);

    const deleteFolder = useCallback((id: string) => {
        dispatch({ type: 'DELETE_FOLDER', payload: id });
    }, []);

    const toggleFolder = useCallback((id: string) => {
        const folder = state.folders.find((f) => f.id === id);
        if (folder) {
            dispatch({ type: 'UPDATE_FOLDER', payload: { id, updates: { isExpanded: !folder.isExpanded } } });
        }
    }, [state.folders]);

    // ========================================================================
    // Tab Actions
    // ========================================================================

    const setActiveTab = useCallback((id: string) => {
        dispatch({ type: 'SET_ACTIVE_TAB', payload: id });
    }, []);

    const createTab = useCallback((dashboardId: string, name: string): DashboardTab => {
        const dashboard = state.dashboards.find((d) => d.id === dashboardId);
        const tab = createDefaultTab(name, dashboard?.tabs.length || 0);
        dispatch({ type: 'ADD_TAB', payload: { dashboardId, tab } });
        return tab;
    }, [state.dashboards]);

    const updateTab = useCallback((dashboardId: string, tabId: string, updates: Partial<DashboardTab>) => {
        dispatch({ type: 'UPDATE_TAB', payload: { dashboardId, tabId, updates } });
    }, []);

    const deleteTab = useCallback((dashboardId: string, tabId: string) => {
        dispatch({ type: 'DELETE_TAB', payload: { dashboardId, tabId } });
    }, []);

    const reorderTabs = useCallback((dashboardId: string, tabs: DashboardTab[]) => {
        dispatch({ type: 'REORDER_TABS', payload: { dashboardId, tabs } });
    }, []);

    const applyTemplate = useCallback((dashboardId: string, tabId: string, templateName: string) => {
        const template = DASHBOARD_TEMPLATES[templateName];
        if (!template) {
            console.warn(`Template "${templateName}" not found. Available: ${Object.keys(DASHBOARD_TEMPLATES).join(', ')}`);
            return;
        }

        const widgets = createWidgetsFromTemplate(template, tabId);
        dispatch({ type: 'UPDATE_TAB_LAYOUT', payload: { dashboardId, tabId, widgets } });
    }, []);

    // ========================================================================
    // Widget Actions
    // ========================================================================

    const addWidget = useCallback((dashboardId: string, tabId: string, data: WidgetCreate): WidgetInstance => {
        // Get default layout constraints from WidgetRegistry
        const defaults = getWidgetDefaultLayout(data.type);
        const widgetId = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        const widget: WidgetInstance = {
            id: widgetId,
            type: data.type,
            tabId,
            syncGroupId: data.syncGroupId,
            config: data.config || {},
            layout: {
                i: widgetId,
                x: data.layout?.x ?? 0,
                y: data.layout?.y ?? Infinity, // Place at bottom if not specified
                w: data.layout?.w ?? defaults.w,
                h: data.layout?.h ?? defaults.h,
                minW: data.layout?.minW ?? defaults.minW ?? 3,
                minH: data.layout?.minH ?? defaults.minH ?? 2,
            },
        };
        dispatch({ type: 'ADD_WIDGET', payload: { dashboardId, tabId, widget } });
        return widget;
    }, []);

    const updateWidget = useCallback((
        dashboardId: string,
        tabId: string,
        widgetId: string,
        updates: Partial<WidgetInstance>
    ) => {
        dispatch({ type: 'UPDATE_WIDGET', payload: { dashboardId, tabId, widgetId, updates } });
    }, []);

    const deleteWidget = useCallback((dashboardId: string, tabId: string, widgetId: string) => {
        dispatch({ type: 'DELETE_WIDGET', payload: { dashboardId, tabId, widgetId } });
    }, []);

    const updateTabLayout = useCallback((dashboardId: string, tabId: string, widgets: WidgetInstance[]) => {
        dispatch({ type: 'UPDATE_TAB_LAYOUT', payload: { dashboardId, tabId, widgets } });
    }, []);

    const resetTabLayout = useCallback((dashboardId: string, tabId: string) => {
        dispatch({ type: 'RESET_TAB_LAYOUT', payload: { dashboardId, tabId } });
    }, []);

    const cloneWidget = useCallback((dashboardId: string, tabId: string, widgetId: string): WidgetInstance | null => {
        const dashboard = state.dashboards.find(d => d.id === dashboardId);
        const tab = dashboard?.tabs.find(t => t.id === tabId);
        const widget = tab?.widgets.find(w => w.id === widgetId);

        if (!widget) return null;

        const newWidgetId = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const clonedWidget: WidgetInstance = {
            ...widget,
            id: newWidgetId,
            layout: {
                ...widget.layout,
                i: newWidgetId,
                x: widget.layout.x,
                y: widget.layout.y + widget.layout.h, // Place below original
            },
        };

        dispatch({ type: 'ADD_WIDGET', payload: { dashboardId, tabId, widget: clonedWidget } });
        return clonedWidget;
    }, [state.dashboards]);

    // ========================================================================
    // Sync Group Actions
    // ========================================================================

    const updateSyncGroupSymbol = useCallback((dashboardId: string, groupId: number, symbol: string) => {
        dispatch({ type: 'UPDATE_SYNC_GROUP', payload: { dashboardId, groupId, symbol } });
    }, []);

    const createSyncGroup = useCallback((dashboardId: string, symbol: string): WidgetSyncGroup => {
        const dashboard = state.dashboards.find((d) => d.id === dashboardId);
        const nextId = (dashboard?.syncGroups.length || 0) + 1;
        const colorIndex = (nextId - 1) % DEFAULT_SYNC_GROUP_COLORS.length;
        const group: WidgetSyncGroup = {
            id: nextId,
            name: `Group ${nextId}`,
            color: DEFAULT_SYNC_GROUP_COLORS[colorIndex],
            currentSymbol: symbol,
        };
        dispatch({ type: 'ADD_SYNC_GROUP', payload: { dashboardId, group } });
        return group;
    }, [state.dashboards]);

    // ========================================================================
    // Move & Reorder Actions
    // ========================================================================

    const moveDashboard = useCallback((dashboardId: string, targetFolderId: string | undefined) => {
        dispatch({ type: 'MOVE_DASHBOARD', payload: { dashboardId, targetFolderId } });
    }, []);

    const reorderDashboards = useCallback((dashboardIds: string[], folderId: string | undefined) => {
        dispatch({ type: 'REORDER_DASHBOARDS', payload: { dashboardIds, folderId } });
    }, []);

    // ========================================================================
    // Computed Values
    // ========================================================================

    const activeDashboard = state.dashboards.find((d) => d.id === state.activeDashboardId) || null;
    const activeTab = activeDashboard?.tabs.find((t) => t.id === state.activeTabId) || null;

    // ========================================================================
    // Context Value
    // ========================================================================

    const value: DashboardContextValue = {
        state,
        setActiveDashboard,
        createDashboard,
        updateDashboard,
        deleteDashboard,
        createFolder,
        updateFolder,
        deleteFolder,
        toggleFolder,
        setActiveTab,
        createTab,
        updateTab,
        deleteTab,
        reorderTabs,
        applyTemplate,
        addWidget,
        updateWidget,
        deleteWidget,
        cloneWidget,
        updateTabLayout,
        resetTabLayout,
        updateSyncGroupSymbol,
        createSyncGroup,
        moveDashboard,
        reorderDashboards,
        activeDashboard,
        activeTab,
        availableTemplates: Object.keys(DASHBOARD_TEMPLATES),
    };

    return (
        <DashboardContext.Provider value={value}>
            {children}
        </DashboardContext.Provider>
    );
}

// ============================================================================
// Hook
// ============================================================================

export function useDashboard() {
    const context = useContext(DashboardContext);
    if (!context) {
        throw new Error('useDashboard must be used within a DashboardProvider');
    }
    return context;
}
