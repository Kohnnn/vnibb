// Template definitions for Dashboard Context - extracted from DashboardContext.tsx

import type { Dashboard, WidgetInstance, DashboardTab, WidgetSyncGroup } from '@/types/dashboard';
import { DEFAULT_SYNC_GROUP_COLORS } from '@/types/dashboard';
import { DEFAULT_TICKER } from '@/lib/defaultTicker';
import { normalizeWidgetType } from '@/data/widgetDefinitions';
import { getWidgetDefaultLayout } from '@/lib/dashboardLayout';

import {
    MAIN_DASHBOARD_ID,
    TECHNICAL_DASHBOARD_ID,
    QUANT_DASHBOARD_ID,
    GLOBAL_MARKETS_DASHBOARD_ID,
    GLOBAL_MARKETS_DASHBOARD_NAME,
    INITIAL_FOLDER_ID,
    INITIAL_FOLDER_NAME,
    LEGACY_DASHBOARD_NAME_RE,
    LEGACY_SIDEBAR_DASHBOARD_RE,
    LEGACY_MANAGE_TAB_NAME_RE,
    LEGACY_STALE_TAB_RE,
    SYSTEM_DASHBOARD_IDS,
} from './constants';

// ============================================================================
// Widget ID Generator
// ============================================================================

export function generateWidgetId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============================================================================
// Template Widget Type
// ============================================================================

type TemplateWidget = Omit<WidgetInstance, 'id' | 'tabId' | 'layout'> & {
    layout: Omit<WidgetInstance['layout'], 'i'>;
};

// ============================================================================
// Overview Tab Template
// ============================================================================

const OVERVIEW_TEMPLATE: TemplateWidget[] = [
    { type: 'ticker_info', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 8, h: 3, minW: 6, minH: 2 } },
    { type: 'price_chart', syncGroupId: 1, config: { timeframe: '1Y', chartType: 'candle' }, layout: { x: 8, y: 0, w: 16, h: 7, minW: 8, minH: 4 } },
    { type: 'key_metrics', syncGroupId: 1, config: {}, layout: { x: 0, y: 3, w: 8, h: 6, minW: 6, minH: 4 } },
    { type: 'valuation_multiples', syncGroupId: 1, config: {}, layout: { x: 0, y: 9, w: 8, h: 6, minW: 6, minH: 4 } },
    { type: 'ticker_profile', syncGroupId: 1, config: {}, layout: { x: 8, y: 7, w: 8, h: 8, minW: 6, minH: 4 } },
    { type: 'news_feed', syncGroupId: 1, config: {}, layout: { x: 16, y: 7, w: 8, h: 8, minW: 6, minH: 4 } },
];

// ============================================================================
// Financials Tab Template
// ============================================================================

const FINANCIALS_TEMPLATE: TemplateWidget[] = [
    { type: 'unified_financials', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 24, h: 10, minW: 12, minH: 8 } },
];

// ============================================================================
// Quant Tab Template
// ============================================================================

const QUANT_TEMPLATE: TemplateWidget[] = [
    { type: 'seasonality_heatmap', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 14, h: 12, minW: 10, minH: 8 } },
    { type: 'sortino_monthly', syncGroupId: 1, config: {}, layout: { x: 14, y: 0, w: 10, h: 11, minW: 8, minH: 8 } },
    { type: 'volume_profile', syncGroupId: 1, config: {}, layout: { x: 0, y: 12, w: 8, h: 12, minW: 6, minH: 8 } },
    { type: 'volume_flow', syncGroupId: 1, config: {}, layout: { x: 8, y: 12, w: 8, h: 10, minW: 6, minH: 7 } },
    { type: 'momentum', syncGroupId: 1, config: {}, layout: { x: 16, y: 12, w: 8, h: 10, minW: 6, minH: 7 } },
    { type: 'gap_analysis', syncGroupId: 1, config: {}, layout: { x: 0, y: 24, w: 8, h: 8, minW: 6, minH: 6 } },
    { type: 'drawdown_recovery', syncGroupId: 1, config: {}, layout: { x: 8, y: 24, w: 8, h: 9, minW: 6, minH: 7 } },
    { type: 'correlation_matrix', syncGroupId: 1, config: {}, layout: { x: 16, y: 24, w: 8, h: 10, minW: 8, minH: 8 } },
    { type: 'signal_summary', syncGroupId: 1, config: {}, layout: { x: 0, y: 34, w: 24, h: 6, minW: 12, minH: 4 } },
];

// ============================================================================
// Technical Tab Template
// ============================================================================

const TECHNICAL_TEMPLATE: TemplateWidget[] = [
    { type: 'ichimoku', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 12, h: 12, minW: 10, minH: 10 } },
    { type: 'fibonacci', syncGroupId: 1, config: {}, layout: { x: 12, y: 0, w: 12, h: 12, minW: 10, minH: 10 } },
    { type: 'technical_summary', syncGroupId: 1, config: {}, layout: { x: 0, y: 12, w: 8, h: 9, minW: 6, minH: 7 } },
    { type: 'technical_snapshot', syncGroupId: 1, config: {}, layout: { x: 8, y: 12, w: 8, h: 9, minW: 6, minH: 7 } },
    { type: 'atr_regime', syncGroupId: 1, config: {}, layout: { x: 16, y: 12, w: 8, h: 9, minW: 6, minH: 7 } },
    { type: 'macd_crossovers', syncGroupId: 1, config: {}, layout: { x: 0, y: 21, w: 8, h: 9, minW: 6, minH: 7 } },
    { type: 'rsi_seasonal', syncGroupId: 1, config: {}, layout: { x: 8, y: 21, w: 8, h: 9, minW: 6, minH: 7 } },
    { type: 'bollinger_squeeze', syncGroupId: 1, config: {}, layout: { x: 16, y: 21, w: 8, h: 9, minW: 6, minH: 7 } },
    { type: 'signal_summary', syncGroupId: 1, config: {}, layout: { x: 0, y: 30, w: 24, h: 6, minW: 12, minH: 4 } },
];

// ============================================================================
// Global Markets Templates
// ============================================================================

const GLOBAL_MARKETS_TEMPLATE: TemplateWidget[] = [
    { type: 'tradingview_ticker_tape', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 24, h: 4, minW: 12, minH: 3 } },
    { type: 'tradingview_chart', syncGroupId: 1, config: { symbol: 'AMEX:SPY', useLinkedSymbol: false, allow_symbol_change: false }, layout: { x: 0, y: 4, w: 14, h: 10, minW: 10, minH: 8 } },
    { type: 'tradingview_technical_analysis', syncGroupId: 1, config: { symbol: 'AMEX:SPY', useLinkedSymbol: false }, layout: { x: 14, y: 4, w: 10, h: 10, minW: 8, minH: 8 } },
    { type: 'tradingview_market_overview', syncGroupId: 1, config: {}, layout: { x: 0, y: 14, w: 12, h: 8, minW: 8, minH: 6 } },
    { type: 'tradingview_market_data', syncGroupId: 1, config: {}, layout: { x: 12, y: 14, w: 12, h: 8, minW: 8, minH: 6 } },
    { type: 'world_news_map', syncGroupId: 1, config: { region: 'all', category: 'all', limit: 120, freshnessHours: 72 }, layout: { x: 0, y: 37, w: 12, h: 9, minW: 8, minH: 6 } },
    { type: 'world_news_live_stream', syncGroupId: 1, config: { region: 'all', category: 'all', limit: 30, freshnessHours: 24, pollSeconds: 60 }, layout: { x: 12, y: 37, w: 12, h: 9, minW: 6, minH: 6 } },
    { type: 'world_news_monitor', syncGroupId: 1, config: { region: 'all', category: 'all', limit: 50, freshnessHours: 72 }, layout: { x: 0, y: 46, w: 16, h: 9, minW: 8, minH: 6 } },
    { type: 'world_news_sources', syncGroupId: 1, config: { region: 'all', category: 'all', language: 'all' }, layout: { x: 16, y: 46, w: 8, h: 9, minW: 5, minH: 6 } },
];

const GLOBAL_MARKETS_SCREENER_TEMPLATE: TemplateWidget[] = [
    { type: 'tradingview_ticker_tape', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 24, h: 4, minW: 12, minH: 3 } },
    { type: 'tradingview_screener', syncGroupId: 1, config: {}, layout: { x: 0, y: 4, w: 24, h: 24, minW: 12, minH: 12 } },
];

const GLOBAL_MARKETS_CRYPTO_TEMPLATE: TemplateWidget[] = [
    { type: 'tradingview_ticker_tape', syncGroupId: 1, config: { symbolsPreset: 'crypto_majors' }, layout: { x: 0, y: 0, w: 24, h: 4, minW: 12, minH: 3 } },
    { type: 'tradingview_crypto_market', syncGroupId: 1, config: { market: 'crypto', screener_type: 'crypto_mkt' }, layout: { x: 0, y: 4, w: 14, h: 14, minW: 8, minH: 8 } },
    { type: 'tradingview_chart', syncGroupId: 1, config: { symbol: 'BINANCE:BTCUSDT', useLinkedSymbol: false, allow_symbol_change: false }, layout: { x: 14, y: 4, w: 10, h: 14, minW: 8, minH: 8 } },
    { type: 'tradingview_crypto_heatmap', syncGroupId: 1, config: {}, layout: { x: 0, y: 18, w: 24, h: 10, minW: 12, minH: 8 } },
];

const GLOBAL_MARKETS_WORLD_NEWS_TEMPLATE: TemplateWidget[] = [
    { type: 'world_news_map', syncGroupId: 1, config: { region: 'all', category: 'all', limit: 120, freshnessHours: 72 }, layout: { x: 0, y: 0, w: 14, h: 12, minW: 8, minH: 8 } },
    { type: 'world_news_live_stream', syncGroupId: 1, config: { region: 'all', category: 'all', limit: 40, freshnessHours: 24, pollSeconds: 60 }, layout: { x: 14, y: 0, w: 10, h: 12, minW: 6, minH: 8 } },
    { type: 'world_news_monitor', syncGroupId: 1, config: { region: 'all', category: 'all', limit: 60, freshnessHours: 72 }, layout: { x: 0, y: 12, w: 16, h: 10, minW: 10, minH: 8 } },
    { type: 'world_news_sources', syncGroupId: 1, config: { region: 'all', category: 'all', language: 'all' }, layout: { x: 16, y: 12, w: 8, h: 10, minW: 8, minH: 8 } },
];

const GLOBAL_MARKETS_OVERVIEW_TEMPLATE: TemplateWidget[] = [
    { type: 'tradingview_ticker_tape', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 24, h: 4, minW: 12, minH: 3 } },
    { type: 'tradingview_chart', syncGroupId: 1, config: { symbol: 'AMEX:SPY', useLinkedSymbol: false, allow_symbol_change: false }, layout: { x: 0, y: 4, w: 14, h: 10, minW: 10, minH: 8 } },
    { type: 'tradingview_technical_analysis', syncGroupId: 1, config: { symbol: 'AMEX:SPY', useLinkedSymbol: false }, layout: { x: 14, y: 4, w: 10, h: 10, minW: 8, minH: 8 } },
    { type: 'tradingview_market_overview', syncGroupId: 1, config: {}, layout: { x: 0, y: 14, w: 12, h: 8, minW: 8, minH: 6 } },
    { type: 'tradingview_market_data', syncGroupId: 1, config: {}, layout: { x: 12, y: 14, w: 12, h: 8, minW: 8, minH: 6 } },
];

// ============================================================================
// Comparison Tab Template
// ============================================================================

const COMPARISON_TEMPLATE: TemplateWidget[] = [
    { type: 'comparison_analysis', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 24, h: 8, minW: 12, minH: 6 } },
    { type: 'peer_comparison', syncGroupId: 1, config: {}, layout: { x: 0, y: 8, w: 12, h: 6, minW: 6, minH: 4 } },
    { type: 'sector_performance', syncGroupId: 1, config: {}, layout: { x: 12, y: 8, w: 12, h: 6, minW: 6, minH: 4 } },
];

// ============================================================================
// Ownership Tab Template
// ============================================================================

const OWNERSHIP_TEMPLATE: TemplateWidget[] = [
    { type: 'major_shareholders', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 6, h: 8, minW: 6, minH: 6 } },
    { type: 'ownership_rating_summary', syncGroupId: 1, config: {}, layout: { x: 6, y: 0, w: 6, h: 8, minW: 6, minH: 6 } },
    { type: 'officers_management', syncGroupId: 1, config: {}, layout: { x: 12, y: 0, w: 6, h: 8, minW: 6, minH: 6 } },
    { type: 'share_statistics', syncGroupId: 1, config: {}, layout: { x: 18, y: 0, w: 6, h: 8, minW: 6, minH: 6 } },
    { type: 'subsidiaries', syncGroupId: 1, config: {}, layout: { x: 0, y: 8, w: 8, h: 8, minW: 6, minH: 6 } },
    { type: 'foreign_trading', syncGroupId: 1, config: {}, layout: { x: 8, y: 8, w: 8, h: 8, minW: 6, minH: 6 } },
    { type: 'insider_trading', syncGroupId: 1, config: {}, layout: { x: 16, y: 8, w: 8, h: 8, minW: 6, minH: 6 } },
];

// ============================================================================
// Calendar Tab Template
// ============================================================================

const CALENDAR_TEMPLATE: TemplateWidget[] = [
    { type: 'events_calendar', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 12, h: 5, minW: 6, minH: 3 } },
    { type: 'dividend_payment', syncGroupId: 1, config: {}, layout: { x: 12, y: 0, w: 12, h: 5, minW: 8, minH: 3 } },
    { type: 'tradingview_economic_calendar', syncGroupId: 1, config: {}, layout: { x: 12, y: 5, w: 12, h: 7, minW: 6, minH: 4 } },
];

// ============================================================================
// Main Dashboard Macro Template
// ============================================================================

const MAIN_MACRO_TEMPLATE: TemplateWidget[] = [
    { type: 'market_overview', syncGroupId: 1, config: {}, layout: { x: 0, y: 0, w: 8, h: 8, minW: 6, minH: 6 } },
    { type: 'top_movers', syncGroupId: 1, config: {}, layout: { x: 8, y: 0, w: 8, h: 8, minW: 6, minH: 6 } },
    { type: 'market_sentiment', syncGroupId: 1, config: {}, layout: { x: 16, y: 0, w: 8, h: 8, minW: 6, minH: 6 } },
    { type: 'market_heatmap', syncGroupId: 1, config: {}, layout: { x: 0, y: 8, w: 12, h: 12, minW: 10, minH: 10 } },
    { type: 'listing_browser', syncGroupId: 1, config: {}, layout: { x: 12, y: 8, w: 12, h: 12, minW: 8, minH: 8 } },
];

// ============================================================================
// Create Widgets From Template
// ============================================================================

export function createWidgetsFromTemplate(template: TemplateWidget[], tabId: string): WidgetInstance[] {
    return template.map((widget) => ({
        ...widget,
        id: generateWidgetId(widget.type),
        tabId,
        layout: {
            ...widget.layout,
            i: generateWidgetId(widget.type),
        },
    }));
}

// ============================================================================
// Count Dashboard Widgets
// ============================================================================

export function countDashboardWidgets(dashboard: Dashboard): number {
    return dashboard.tabs.reduce((total, tab) => total + tab.widgets.length, 0);
}

// ============================================================================
// Main Tab Templates (for system dashboards)
// ============================================================================

export const MAIN_TAB_TEMPLATES = [
    { name: 'Overview', widgets: OVERVIEW_TEMPLATE },
    { name: 'Financials', widgets: FINANCIALS_TEMPLATE },
    { name: 'Technical', widgets: TECHNICAL_TEMPLATE },
    { name: 'Quant', widgets: QUANT_TEMPLATE },
    { name: 'Market', widgets: [] as TemplateWidget[] },
    { name: 'Ownership', widgets: OWNERSHIP_TEMPLATE },
    { name: 'Calendar', widgets: CALENDAR_TEMPLATE },
    { name: 'Trading', widgets: [] as TemplateWidget[] },
    { name: 'Comparison', widgets: COMPARISON_TEMPLATE },
] as const;

// ============================================================================
// Tab Widget Templates Map
// ============================================================================

export const TAB_WIDGET_TEMPLATES: Record<string, TemplateWidget[]> = {
    overview: OVERVIEW_TEMPLATE,
    financials: FINANCIALS_TEMPLATE,
    quant: QUANT_TEMPLATE,
    technical: TECHNICAL_TEMPLATE,
    trading: [] as TemplateWidget[],
    market: [] as TemplateWidget[],
    comparison: COMPARISON_TEMPLATE,
    ownership: OWNERSHIP_TEMPLATE,
    calendar: CALENDAR_TEMPLATE,
    macro: MAIN_MACRO_TEMPLATE,
    global_markets: GLOBAL_MARKETS_TEMPLATE,
    global_markets_overview: GLOBAL_MARKETS_OVERVIEW_TEMPLATE,
    global_markets_screener: GLOBAL_MARKETS_SCREENER_TEMPLATE,
    global_markets_crypto: GLOBAL_MARKETS_CRYPTO_TEMPLATE,
    global_markets_world_news: GLOBAL_MARKETS_WORLD_NEWS_TEMPLATE,
};

// ============================================================================
// Tab Name to Template Key Map
// ============================================================================

export const TAB_NAME_TO_TEMPLATE_KEY: Record<string, string> = {
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

// Export all template arrays for use elsewhere
export {
    OVERVIEW_TEMPLATE,
    FINANCIALS_TEMPLATE,
    QUANT_TEMPLATE,
    TECHNICAL_TEMPLATE,
    GLOBAL_MARKETS_TEMPLATE,
    GLOBAL_MARKETS_SCREENER_TEMPLATE,
    GLOBAL_MARKETS_CRYPTO_TEMPLATE,
    GLOBAL_MARKETS_WORLD_NEWS_TEMPLATE,
    GLOBAL_MARKETS_OVERVIEW_TEMPLATE,
    COMPARISON_TEMPLATE,
    OWNERSHIP_TEMPLATE,
    CALENDAR_TEMPLATE,
    MAIN_MACRO_TEMPLATE,
};
