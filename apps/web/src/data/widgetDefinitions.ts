// Widget Definitions - Library of available widgets
import type { WidgetDefinition, WidgetCategoryInfo, WidgetCategory } from '@/types/dashboard';

// ============================================================================
// Category definitions
// ============================================================================

export const widgetCategories: WidgetCategoryInfo[] = [
    {
        id: 'core_data',
        name: 'Core Data',
        description: 'Essential company information and data',
        icon: 'Activity'
    },
    {
        id: 'charting',
        name: 'Charting',
        description: 'Price charts and technical analysis',
        icon: 'TrendingUp'
    },
    {
        id: 'calendar',
        name: 'Calendar',
        description: 'Events, earnings, and corporate actions',
        icon: 'Calendar'
    },
    {
        id: 'ownership',
        name: 'Ownership',
        description: 'Institutional and insider ownership data',
        icon: 'Users'
    },
    {
        id: 'estimates',
        name: 'Estimates',
        description: 'Analyst estimates and recommendations',
        icon: 'BarChart3'
    },
    {
        id: 'screener',
        name: 'Screener',
        description: 'Stock screening and filtering tools',
        icon: 'Search'
    },
    {
        id: 'analysis',
        name: 'Analysis',
        description: 'AI-powered insights and deep research',
        icon: 'Brain'
    }
];


// ============================================================================
// Widget definitions
// ============================================================================

export const widgetDefinitions: WidgetDefinition[] = [
    // Core Data
    {
        type: 'ticker_info',
        name: 'Ticker Info',
        description: 'Basic stock information including price, change, and volume',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 3, minW: 3, minH: 2 }
    },
    {
        type: 'ticker_profile',
        name: 'Company Profile',
        description: 'Detailed company profile with sector, industry, and description',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 5, minW: 4, minH: 3 }
    },
    {
        type: 'key_metrics',
        name: 'Key Metrics',
        description: 'Financial metrics including P/E, EPS, Market Cap, and more',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 6, minW: 4, minH: 4 }
    },
    {
        type: 'share_statistics',
        name: 'Share Statistics',
        description: 'Shares outstanding, float, short interest data',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 5, minW: 3, minH: 3 }
    },
    {
        type: 'news_feed',
        name: 'Company News',
        description: 'Latest news and announcements for the company',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },

    // Charting
    {
        type: 'price_chart',
        name: 'Price Chart',
        description: 'Interactive price chart with candlestick/line options',
        category: 'charting',
        defaultConfig: { timeframe: '1Y', chartType: 'candle' },
        defaultLayout: { w: 12, h: 7, minW: 6, minH: 4 }
    },

    // Calendar
    {
        type: 'earnings_history',
        name: 'Earnings History',
        description: 'Historical earnings per share and surprises',
        category: 'calendar',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 5, minW: 4, minH: 3 }
    },
    {
        type: 'events_calendar',
        name: 'Events Calendar',
        description: 'Corporate events: dividends, AGMs, stock splits, rights issues',
        category: 'calendar',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },
    {
        type: 'dividend_payment',
        name: 'Dividend Payment',
        description: 'Dividend history and payment schedule',
        category: 'calendar',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 5, minW: 4, minH: 3 }
    },
    {
        type: 'stock_splits',
        name: 'Stock Splits',
        description: 'Historical stock split information',
        category: 'calendar',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 4, minW: 3, minH: 2 }
    },
    {
        type: 'company_filings',
        name: 'Company Filings',
        description: 'SEC filings and regulatory documents',
        category: 'calendar',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 6, minW: 4, minH: 4 }
    },

    // Ownership
    {
        type: 'institutional_ownership',
        name: 'Institutional Ownership',
        description: 'Institutional holders and their positions',
        category: 'ownership',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 6, minW: 4, minH: 4 }
    },
    {
        type: 'insider_trading',
        name: 'Insider Trading',
        description: 'Insider buying and selling activity',
        category: 'ownership',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 6, minW: 4, minH: 4 }
    },
    {
        type: 'major_shareholders',
        name: 'Major Shareholders',
        description: 'Major shareholders and ownership breakdown',
        category: 'ownership',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },
    {
        type: 'officers_management',
        name: 'Officers & Management',
        description: 'Company executives and management team',
        category: 'ownership',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },

    // Estimates
    {
        type: 'analyst_estimates',
        name: 'Analyst Estimates',
        description: 'Analyst price targets and recommendations',
        category: 'estimates',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 5, minW: 4, minH: 3 }
    },

    // Screener
    {
        type: 'screener',
        name: 'Stock Screener',
        description: 'Filter stocks by various criteria',
        category: 'screener',
        defaultConfig: {},
        defaultLayout: { w: 12, h: 9, minW: 8, minH: 6 }
    },

    // Additional Core Data
    {
        type: 'intraday_trades',
        name: 'Intraday Trades',
        description: 'Real-time intraday price and volume data',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },
    {
        type: 'financial_ratios',
        name: 'Financial Ratios',
        description: 'Historical P/E, P/B, ROE, ROA, margins and more',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 4 }
    },
    {
        type: 'foreign_trading',
        name: 'Foreign Trading',
        description: 'Foreign investor buy/sell volumes and net flow',
        category: 'ownership',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },
    {
        type: 'subsidiaries',
        name: 'Subsidiaries',
        description: 'Company subsidiaries and affiliates with ownership %',
        category: 'ownership',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 6, minW: 3, minH: 4 }
    },

    // Financial Statements
    {
        type: 'balance_sheet',
        name: 'Balance Sheet',
        description: 'Assets, liabilities, and equity breakdown',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 4 }
    },
    {
        type: 'income_statement',
        name: 'Income Statement',
        description: 'Revenue, expenses, and profit analysis',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 4 }
    },
    {
        type: 'cash_flow',
        name: 'Cash Flow',
        description: 'Operating, investing, and financing cash flows',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 4 }
    },

    // Market Data
    {
        type: 'market_overview',
        name: 'Market Overview',
        description: 'Vietnam market indices (VN-INDEX, VN30, HNX, UPCOM)',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },

    // Advanced & Market Widgets
    {
        type: 'watchlist',
        name: 'Watchlist',
        description: 'Custom stock watchlist with live prices',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 4, h: 7, minW: 2, minH: 4 }
    },
    {
        type: 'peer_comparison',
        name: 'Peer Comparison',
        description: 'Compare stocks side-by-side on key metrics',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 6, minW: 4, minH: 4 }
    },
    {
        type: 'top_movers',
        name: 'Top Gainers/Losers',
        description: 'Daily top gainers and losers',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },
    {
        type: 'world_indices',
        name: 'World Indices',
        description: 'Global market indices (S&P 500, Nikkei, DAX, etc.)',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },
    {
        type: 'sector_performance',
        name: 'Sector Performance',
        description: 'Vietnam market sector heatmap',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },

    // Portfolio & Alerts
    {
        type: 'portfolio_tracker',
        name: 'Portfolio Tracker',
        description: 'Track holdings with real-time P&L, sector allocation, and CSV export',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 8, minW: 4, minH: 6 }
    },
    {
        type: 'price_alerts',
        name: 'Price Alerts',
        description: 'Set price alerts for stocks',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 4, h: 7, minW: 2, minH: 4 }
    },
    {
        type: 'economic_calendar',
        name: 'Economic Calendar',
        description: 'Macro events and economic indicators',
        category: 'calendar',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },

    // Technical Analysis
    {
        type: 'volume_analysis',
        name: 'Volume Analysis',
        description: 'Volume profile and trends',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },
    {
        type: 'technical_summary',
        name: 'Technical Summary',
        description: 'Technical indicators with buy/sell signals',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },

    // Global & Utility
    {
        type: 'forex_rates',
        name: 'Forex Rates',
        description: 'VND currency exchange rates',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },
    {
        type: 'commodities',
        name: 'Commodities',
        description: 'Gold, oil, and commodity prices',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },
    {
        type: 'similar_stocks',
        name: 'Similar Stocks',
        description: 'Find stocks similar to current symbol',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 4, h: 6, minW: 2, minH: 4 }
    },
    {
        type: 'quick_stats',
        name: 'Quick Stats',
        description: 'Summary statistics at a glance',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },
    {
        type: 'notes',
        name: 'Notes',
        description: 'Personal notes for stocks',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 4, h: 6, minW: 2, minH: 4 }
    },
    {
        type: 'database_inspector',
        name: 'Data Browser',
        description: 'Browse and filter database tables',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 8, minW: 4, minH: 6 }
    },
    {
        type: 'orderbook',
        name: 'Order Book',
        description: 'Real-time order book depth',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 4, h: 8, minW: 3, minH: 6 }
    },
    {
        type: 'index_comparison',
        name: 'Index Comparison',
        description: 'Compare major market indices',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 }
    },
    {
        type: 'market_news',
        name: 'Market News',
        description: 'Global market news and sentiment',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 4, h: 6, minW: 3, minH: 4 }
    },
    {
        type: 'sector_breakdown',
        name: 'Sector Breakdown',
        description: 'Market capitalization by sector',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 4, h: 6, minW: 3, minH: 4 }
    },
    {
        type: 'comparison_analysis',
        name: 'Comparison Analysis',
        description: 'Side-by-side comparison of multiple stocks',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 10, minW: 6, minH: 8 }
    },
    {
        type: 'news_flow',
        name: 'News Flow',
        description: 'Chronological market and ticker news flow',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 4, h: 8, minW: 3, minH: 6 }
    },
    {
        type: 'ai_analysis',
        name: 'AI Analysis',
        description: 'Deep fundamental and technical analysis using Gemini AI',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 10, minW: 4, minH: 6 }
    },
    {
        type: 'sector_top_movers',

        name: 'Sector Top Movers',
        description: 'Vietnamese-style sector columns with top gainers by sector',
        category: 'core_data',
        defaultConfig: { timeframe: 'day' },
        defaultLayout: { w: 10, h: 7, minW: 6, minH: 5 }
    }
];

// Helper to get widget definition by type
export function getWidgetDefinition(type: string): WidgetDefinition | undefined {
    return widgetDefinitions.find(w => w.type === type);
}

// Helper to get widgets by category
export function getWidgetsByCategory(category: WidgetCategory): WidgetDefinition[] {
    return widgetDefinitions.filter(w => w.category === category);
}
