// Widget Definitions - Library of available widgets
import { tradingViewCatalogEntries } from '@/lib/tradingViewWidgets';
import { getWidgetDefaultLayout } from '@/lib/dashboardLayout';
import type { WidgetDefinition, WidgetCategoryInfo, WidgetCategory, WidgetType } from '@/types/dashboard';

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
        id: 'global_markets',
        name: 'Global Markets',
        description: 'TradingView, world indices, forex, and macro context outside VN fundamentals',
        icon: 'Globe'
    },
    {
        id: 'quant',
        name: 'Quant',
        description: 'Institutional-style quantitative and market microstructure tools',
        icon: 'Sigma'
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
        defaultLayout: { w: 4, h: 3, minW: 3, minH: 2 }
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
        defaultLayout: { w: 8, h: 6, minW: 6, minH: 4 },
        recommended: true
    },
    ...tradingViewCatalogEntries,
    {
        type: 'valuation_multiples_chart',
        name: 'Valuation Multiples Chart',
        description: 'Historical P/E, P/B, P/S and EV multiples trend',
        category: 'charting',
        defaultConfig: {},
        defaultLayout: { w: 7, h: 7, minW: 5, minH: 5 }
    },
    {
        type: 'valuation_band',
        name: 'Valuation Band',
        description: 'Historical valuation-multiple distribution and descriptive bands',
        category: 'charting',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 8, minW: 6, minH: 6 }
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
        type: 'earnings_release_recap',
        name: 'Earnings Release Recap',
        description: 'Latest quarter bridge with YoY deltas, cash context, quality checks, and linked news',
        category: 'calendar',
        defaultConfig: {},
        defaultLayout: { w: 10, h: 8, minW: 6, minH: 6 },
        recommended: true,
        searchKeywords: ['earnings', 'quarter', 'results', 'recap', 'release']
    },
    {
        type: 'earnings_season_monitor',
        name: 'Earnings Season Monitor',
        description: 'Track the latest quarterly releases, YoY changes, and high-priority follow-up names',
        category: 'calendar',
        defaultConfig: {},
        defaultLayout: { w: 10, h: 8, minW: 8, minH: 6 },
        recommended: true,
        searchKeywords: ['earnings', 'quarterly', 'release', 'results season', 'monitor']
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
        type: 'investor_event_calendar',
        name: 'Investor Event Calendar',
        description: 'Upcoming holdings and watchlist corporate events',
        category: 'calendar',
        defaultConfig: { manualSymbols: [] },
        defaultLayout: { w: 6, h: 8, minW: 4, minH: 6 },
        searchKeywords: ['portfolio', 'watchlist', 'dividend', 'earnings', 'calendar']
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
        name: 'VNIBB Screener Pro',
        description: 'Native backend-powered Vietnam stock screener and saved scans',
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
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 4 },
        recommended: true
    },
    {
        type: 'bank_metrics',
        name: 'Bank Analytics',
        description: 'Reported bank funding, profitability, and risk ratios when available',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 7, h: 7, minW: 5, minH: 5 }
    },
    {
        type: 'transaction_flow',
        name: 'Transaction Flow',
        description: 'Daily domestic, foreign, and proprietary flow with price overlay',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 7, minW: 6, minH: 5 }
    },
    {
        type: 'industry_bubble',
        name: 'Industry Bubble',
        description: 'Sector-relative bubble chart with configurable X/Y axes and market-cap or volume sizing',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 7, minW: 6, minH: 5 }
    },
    {
        type: 'sector_board',
        name: 'Sector Board',
        description: 'Columnar market board grouped by sector with price, change, and liquidity',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 12, h: 8, minW: 8, minH: 6 }
    },
    {
        type: 'money_flow_trend',
        name: 'Money Flow Trend',
        description: 'RRG-style quadrant scatter with stock trails for sector or VN30 peers',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 9, h: 7, minW: 6, minH: 5 }
    },
    {
        type: 'correlation_matrix',
        name: 'Correlation Matrix',
        description: 'Heatmap of pairwise close-return correlations for sector peers',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 7, minW: 6, minH: 5 }
    },
    {
        type: 'risk_dashboard',
        name: 'Risk Dashboard',
        description: 'Composite quant risk view blending drawdown, volatility, Sortino, and Hurst context',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 8, minW: 6, minH: 6 }
    },
    {
        type: 'quant_summary',
        name: 'Quant Summary',
        description: 'Radar summary of momentum, Hurst, volatility, flow, seasonality, and recovery context',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 10, h: 8, minW: 8, minH: 6 }
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
        type: 'unified_financials',
        name: 'Financial Statements',
        description: 'Unified income statement, balance sheet, cash flow, and ratios workspace',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 24, h: 10, minW: 12, minH: 8 },
        recommended: true,
        searchKeywords: ['financials', 'statements', 'income', 'balance', 'cash flow', 'ratios']
    },
    {
        type: 'financial_snapshot',
        name: 'Financial Snapshot',
        description: 'Compact 4-panel snapshot covering P&L, balance sheet, cash flow, and ratios',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 24, h: 16, minW: 12, minH: 10 },
        recommended: true,
        searchKeywords: ['financial snapshot', 'pl', 'balance sheet', 'cash flow', 'ratios']
    },
    {
        type: 'balance_sheet',
        name: 'Balance Sheet',
        description: 'Assets, liabilities, and equity breakdown',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 4 },
        recommended: true
    },
    {
        type: 'income_statement',
        name: 'Income Statement',
        description: 'Revenue, expenses, and profit analysis',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 4 },
        recommended: true
    },
    {
        type: 'income_sankey',
        name: 'Income Sankey',
        description: 'Sankey-style flow from revenue through cost, operating income, tax, and net income',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 10, h: 8, minW: 8, minH: 6 },
        searchKeywords: ['sankey', 'flow', 'bridge', 'income flow']
    },
    {
        type: 'cash_flow',
        name: 'Cash Flow',
        description: 'Operating, investing, and financing cash flows',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 4 },
        recommended: true
    },
    {
        type: 'cashflow_waterfall',
        name: 'Cash Flow Waterfall',
        description: 'Waterfall bridge from operating, investing, and financing cash flow to net cash change',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 10, h: 8, minW: 8, minH: 6 },
        searchKeywords: ['waterfall', 'cash bridge', 'cash flow bridge', 'flow']
    },

    // Market Data
    {
        type: 'market_overview',
        name: 'Market Overview',
        description: 'Vietnam market indices (VN-INDEX, VN30, HNX, UPCOM)',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 }
    },
    {
        type: 'market_breadth',
        name: 'Market Breadth',
        description: 'Advancers vs decliners by exchange',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 6, minW: 4, minH: 5 }
    },

    // Advanced & Market Widgets
    {
        type: 'watchlist',
        name: 'Watchlist',
        description: 'Custom stock watchlist with live prices',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 3, h: 5, minW: 2, minH: 4 }
    },
    {
        type: 'watchlist_limits_monitor',
        name: 'Watchlist Ceiling/Floor',
        description: 'Live price-board ceiling and floor snapshot for up to 50 watchlist symbols',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 4, minH: 5 }
    },
    {
        type: 'foreign_flow_leaderboard',
        name: 'Foreign Flow Leaderboard',
        description: 'Settlement-qualified foreign net-volume or net-value leaders across 1D, 5D, and 20D windows',
        category: 'ownership',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 }
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
        category: 'global_markets',
        defaultConfig: {},
        defaultLayout: { w: 10, h: 8, minW: 8, minH: 6 },
        searchKeywords: ['global', 'indices', 'macro', 'international']
    },
    {
        type: 'sector_performance',
        name: 'Sector Performance',
        description: 'Vietnam market sector heatmap',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },
    {
        type: 'sector_rotation_radar',
        name: 'Sector Rotation Radar',
        description: 'Sector leaders and laggards in one view',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 }
    },
    {
        type: 'market_movers_sectors',
        name: 'Market Movers & Sectors',
        description: 'Sector performance with top gainers/losers',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 7, minW: 6, minH: 5 }
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
        type: 'alert_activity_inbox',
        name: 'Alert Activity Inbox',
        description: 'Browser-local timeline of observed price, saved-screen, prediction, and insider alert activity',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 },
        searchKeywords: ['alerts', 'activity', 'inbox', 'trigger history']
    },
    {
        type: 'derivatives_contracts_board',
        name: 'Derivatives Contracts',
        description: 'Available futures contracts with expiry schedule and quick filtering',
        category: 'global_markets',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 8, minW: 6, minH: 6 },
        searchKeywords: ['derivatives', 'futures', 'contracts', 'expiry']
    },
    {
        type: 'derivatives_price_history',
        name: 'Derivatives Price History',
        description: 'Historical futures price chart with contract selection and basic stats',
        category: 'global_markets',
        defaultConfig: {},
        defaultLayout: { w: 10, h: 8, minW: 6, minH: 6 },
        searchKeywords: ['derivatives', 'futures', 'history', 'price chart']
    },
    {
        type: 'volume_analysis',
        name: 'Volume Analysis',
        description: 'Volume profile and trends',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },
    {
        type: 'volume_profile',
        name: 'Volume Profile',
        description: 'POC/VAH/VAL volume distribution by price bins',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 }
    },
    {
        type: 'obv_divergence',
        name: 'OBV Divergence',
        description: 'Price vs OBV divergence signal with confidence score',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 }
    },
    {
        type: 'atr_regime',
        name: 'ATR Regime',
        description: 'ATR volatility regime with model position sizing',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 }
    },
    {
        type: 'gap_fill_stats',
        name: 'Gap Fill Stats',
        description: 'Gap-up/down fill probability and average days to fill',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 }
    },
    {
        type: 'volume_delta',
        name: 'Volume Delta',
        description: 'Order-flow proxy from buy/sell pressure and cumulative delta',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 }
    },
    {
        type: 'vwap_bands',
        name: 'VWAP Bands',
        description: 'Intraday VWAP with standard-deviation bands from Mongo trade ticks',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 8, minW: 6, minH: 6 },
        searchKeywords: ['vwap', 'bands', 'microstructure', 'execution', 'intraday']
    },
    {
        type: 'footprint_proxy',
        name: 'Footprint Proxy',
        description: 'Match-type proxy footprint by bar and price level from Mongo intraday trades',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 9, minW: 6, minH: 7 },
        searchKeywords: ['footprint', 'order flow', 'microstructure', 'delta', 'intraday']
    },
    {
        type: 'amihud_illiquidity',
        name: 'Amihud Illiquidity',
        description: 'Rolling 20-day illiquidity ratio to track market depth changes',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 }
    },
    {
        type: 'drawdown_deep_dive',
        name: 'Drawdown Deep Dive',
        description: 'Underwater curve, max drawdown depth, and recovery duration profile',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 7, minW: 6, minH: 5 }
    },
    {
        type: 'hurst_market_structure',
        name: 'Hurst Market Structure',
        description: 'Hurst exponent and autocorrelation lens for trend vs mean-reversion regimes',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 }
    },
    {
        type: 'seasonality_heatmap',
        name: 'Seasonality Heatmap',
        description: 'Month and week return matrix for recurring seasonal patterns',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 7, minW: 6, minH: 5 }
    },
    {
        type: 'seasonality_spiral_heatmap',
        name: 'Spiral Heatmap',
        description: 'Daily or weekly spiral seasonality with old in center, new on outer rings',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 12, h: 13, minW: 8, minH: 10 }
    },
    {
        type: 'volume_flow',
        name: 'Volume Flow',
        description: 'Monthly and cumulative volume delta to track buy/sell pressure divergence',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 }
    },
    {
        type: 'rsi_seasonal',
        name: 'RSI Seasonal',
        description: 'RSI seasonality by month with overbought and oversold frequency',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 }
    },
    {
        type: 'bollinger_squeeze',
        name: 'Bollinger Squeeze',
        description: 'Bollinger width compression and squeeze state detection',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 6, minW: 4, minH: 5 }
    },
    {
        type: 'sortino_monthly',
        name: 'Sortino Monthly',
        description: 'Monthly Sortino and Sharpe comparison for quality-of-returns analysis',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 }
    },
    {
        type: 'gap_analysis',
        name: 'Gap Analysis',
        description: 'Gap-up/down frequency, fill rate, and top gap event table',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 7, h: 7, minW: 5, minH: 5 }
    },
    {
        type: 'macd_crossovers',
        name: 'MACD Crossovers',
        description: 'Bullish and bearish crossover history with 1M and 3M follow-through',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 7, h: 7, minW: 5, minH: 5 }
    },
    {
        type: 'parkinson_volatility',
        name: 'Parkinson Volatility',
        description: 'High-low range volatility with rolling regime classification',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 7, h: 7, minW: 5, minH: 5 }
    },
    {
        type: 'garch_volatility',
        name: 'GARCH Volatility',
        description: 'GARCH(1,1) conditional volatility parameters and in-sample estimate from backend metrics',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 7, h: 7, minW: 5, minH: 5 },
        searchKeywords: ['garch', 'volatility', 'conditional volatility', 'risk']
    },
    {
        type: 'ema_respect',
        name: 'EMA Respect',
        description: 'EMA20/50/200 interaction counts with support and breakdown rates',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 7, h: 7, minW: 5, minH: 5 }
    },
    {
        type: 'drawdown_recovery',
        name: 'Drawdown Recovery',
        description: 'Rolling drawdown from peaks with average recovery duration',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 7, h: 7, minW: 5, minH: 5 }
    },
    {
        type: 'gamma_exposure',
        name: 'Gamma Exposure',
        description: 'Volatility-based gamma regime proxy until options OI integration is available',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 6, minW: 4, minH: 5 }
    },
    {
        type: 'momentum',
        name: 'Momentum',
        description: 'Multi-horizon momentum dashboard with 1M to 12M composite trend score',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 6, minW: 4, minH: 5 }
    },
    {
        type: 'earnings_quality',
        name: 'Earnings Quality',
        description: 'Earnings quality score from margins, cash conversion, and leverage checks',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 6, minW: 4, minH: 5 }
    },
    {
        type: 'smart_money',
        name: 'Smart Money',
        description: 'Institutional flow lens combining foreign trading and block-trade activity',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 6, minW: 4, minH: 5 }
    },
    {
        type: 'relative_rotation',
        name: 'Relative Rotation',
        description: 'Relative Strength rotation quadrant based on RS trend and momentum',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 6, minW: 4, minH: 5 }
    },
    {
        type: 'technical_summary',
        name: 'Technical Summary',
        description: 'Timeframe-specific technical indicator aggregation with data-quality disclosures',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 3, minH: 4 }
    },
    {
        type: 'technical_snapshot',
        name: 'Technical Snapshot',
        description: 'Daily technical indicator overview',
        category: 'charting',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 6, minW: 4, minH: 5 }
    },
    {
        type: 'signal_summary',
        name: 'Signal Summary',
        description: 'Unified BUY/SELL/HOLD view with confidence and key trade levels',
        category: 'charting',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 7, minW: 6, minH: 5 }
    },
    {
        type: 'ichimoku',
        name: 'Ichimoku Cloud',
        description: 'Cloud structure, trend state, and conversion/base-line behavior',
        category: 'charting',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 8, minW: 6, minH: 6 }
    },
    {
        type: 'fibonacci',
        name: 'Fibonacci Retracement',
        description: 'Recent swing map with retracement and extension levels',
        category: 'charting',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 8, minW: 6, minH: 6 }
    },

    // Global & Utility
    {
        type: 'forex_rates',
        name: 'Forex Rates',
        description: 'VND currency exchange rates',
        category: 'global_markets',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 7, minW: 6, minH: 6 },
        searchKeywords: ['fx', 'forex', 'currency', 'usd vnd', 'global']
    },
    {
        type: 'commodities',
        name: 'Commodities',
        description: 'Gold, oil, and commodity prices',
        category: 'global_markets',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 7, minW: 6, minH: 6 },
        searchKeywords: ['commodities', 'gold', 'oil', 'macro', 'global']
    },
    {
        type: 'polymarket',
        name: 'Polymarket',
        description: 'Prediction-market odds and event probabilities for macro and market context',
        category: 'global_markets',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 7, minW: 6, minH: 6 },
        searchKeywords: ['polymarket', 'prediction market', 'odds', 'probability', 'events', 'macro']
    },
    {
        type: 'kalshi',
        name: 'Kalshi',
        description: 'Regulated CFTC prediction-market odds from Kalshi economics, politics, and weather contracts',
        category: 'global_markets',
        defaultConfig: { source: 'kalshi', category: 'all', limit: 20 },
        defaultLayout: { w: 8, h: 7, minW: 6, minH: 6 },
        searchKeywords: ['kalshi', 'prediction market', 'odds', 'cftc', 'regulated']
    },
    {
        type: 'election_odds',
        name: 'Election Odds Composite',
        description: 'Polymarket + Kalshi politics contracts side-by-side with consensus read',
        category: 'global_markets',
        defaultConfig: { source: 'all', category: 'politics', limit: 12 },
        defaultLayout: { w: 8, h: 8, minW: 6, minH: 6 },
        searchKeywords: ['election', 'odds', 'politics', 'composite', 'prediction']
    },
    {
        type: 'prediction_movers',
        name: 'Probability Movers',
        description: 'Top prediction-market 24h probability deltas ranked by absolute movement',
        category: 'global_markets',
        defaultConfig: { windowHours: 24, limit: 12 },
        defaultLayout: { w: 8, h: 8, minW: 6, minH: 6 },
        searchKeywords: ['movers', 'probability', 'delta', 'prediction']
    },
    {
        type: 'macro_calibration',
        name: 'Macro Calibration',
        description: 'Polymarket/Kalshi macro contract consensus with CPI, Fed, recession probability estimates',
        category: 'global_markets',
        defaultConfig: {},
        defaultLayout: { w: 10, h: 8, minW: 8, minH: 6 },
        searchKeywords: ['macro', 'calibration', 'cpi', 'fed', 'recession', 'odds-to-estimate']
    },
    {
        type: 'consensus_odds',
        name: 'Consensus Odds',
        description: 'Multi-source consensus signals (polymarket + kalshi + AI sentiment)',
        category: 'global_markets',
        defaultConfig: {},
        defaultLayout: { w: 10, h: 8, minW: 8, minH: 6 },
        searchKeywords: ['consensus', 'multi-source', 'odds', 'prediction', 'sentiment']
    },
    {
        type: 'top_movers_pulse',
        name: 'Top Movers Pulse',
        description: 'Compact top-of-dashboard strip showing the top three 1h prediction-market movers with sparklines',
        category: 'global_markets',
        defaultConfig: { windowHours: 1, limit: 3 },
        defaultLayout: { w: 12, h: 2, minW: 8, minH: 2 },
        searchKeywords: ['pulse', 'top movers', 'sparkline', 'intraday', 'probability']
    },
    {
        type: 'source_drift',
        name: 'Source Drift',
        description: 'Side-by-side Polymarket vs Kalshi consensus on CPI, Fed, and recession with the spread gap',
        category: 'global_markets',
        defaultConfig: {},
        defaultLayout: { w: 10, h: 4, minW: 8, minH: 4 },
        searchKeywords: ['drift', 'spread', 'polymarket vs kalshi', 'consensus', 'macro']
    },
    {
        type: 'prediction_alerts',
        name: 'Prediction Alerts',
        description: 'Intraday alerts when a prediction-market probability moves more than the threshold',
        category: 'global_markets',
        defaultConfig: { windowHours: 1, minMovementBps: 200, limit: 12 },
        defaultLayout: { w: 8, h: 8, minW: 6, minH: 6 },
        searchKeywords: ['alerts', 'movement', 'probability', 'intraday', 'notify']
    },
    {
        type: 'predictit',
        name: 'PredictIt',
        description: 'Public PredictIt election and general markets with normalised category',
        category: 'global_markets',
        defaultConfig: { source: 'predictit', category: 'all', limit: 20 },
        defaultLayout: { w: 8, h: 7, minW: 6, minH: 6 },
        searchKeywords: ['predictit', 'election', 'politics', 'public markets', 'odds']
    },
    {
        type: 'limitless',
        name: 'Limitless',
        description: 'Crypto-meta prediction markets from Limitless exchange',
        category: 'global_markets',
        defaultConfig: { source: 'limitless', category: 'all', limit: 20 },
        defaultLayout: { w: 8, h: 7, minW: 6, minH: 6 },
        searchKeywords: ['limitless', 'crypto', 'btc', 'eth', 'odds', 'probability']
    },
    {
        type: 'cross_source_calibration',
        name: 'Cross-Source Calibration',
        description: 'Per-topic consensus across all five prediction-market sources with a sources-agree indicator',
        category: 'global_markets',
        defaultConfig: {},
        defaultLayout: { w: 10, h: 6, minW: 8, minH: 4 },
        searchKeywords: ['cross-source', 'calibration', 'consensus', 'agreement', 'macro']
    },
    {
        type: 'manifold',
        name: 'Manifold',
        description: 'Manifold Markets play-money predictions covering AI, macro, space and other long-tail topics',
        category: 'global_markets',
        defaultConfig: { source: 'manifold', category: 'all', limit: 20 },
        defaultLayout: { w: 8, h: 7, minW: 6, minH: 6 },
        searchKeywords: ['manifold', 'ai', 'politics', 'odds', 'long-tail', 'play-money']
    },
    {
        type: 'world_news_monitor',
        name: 'World News Monitor',
        description: 'Live Vietnam and global RSS/Atom news sources with direct article, source, and feed links',
        category: 'global_markets',
        defaultConfig: { region: 'all', category: 'all', limit: 50, freshnessHours: 72 },
        defaultLayout: { w: 12, h: 9, minW: 8, minH: 6 },
        recommended: true,
        searchKeywords: ['world news', 'rss', 'live news', 'vietnam news', 'macro', 'global', 'geopolitics']
    },
    {
        type: 'world_news_map',
        name: 'World News Map',
        description: 'Geographic live-news signal map with country, source, and latest-headline drilldown',
        category: 'global_markets',
        defaultConfig: { region: 'all', category: 'all', limit: 120, freshnessHours: 72 },
        defaultLayout: { w: 12, h: 9, minW: 8, minH: 6 },
        recommended: true,
        searchKeywords: ['world news', 'map', 'geo', 'geography', 'source map', 'global risk', 'macro']
    },
    {
        type: 'world_news_live_stream',
        name: 'World News Live Stream',
        description: 'Polling headline stream for fresh global and Vietnam market-risk signals',
        category: 'global_markets',
        defaultConfig: { region: 'all', category: 'all', limit: 30, freshnessHours: 24, pollSeconds: 60 },
        defaultLayout: { w: 7, h: 9, minW: 5, minH: 6 },
        recommended: true,
        searchKeywords: ['world news', 'live stream', 'rss', 'breaking news', 'risk monitor', 'headlines']
    },
    {
        type: 'world_news_sources',
        name: 'World News Sources',
        description: 'Auditable source registry with homepage, feed, geography, tier, and filter metadata',
        category: 'global_markets',
        defaultConfig: { region: 'all', category: 'all', language: 'all' },
        defaultLayout: { w: 8, h: 9, minW: 5, minH: 6 },
        recommended: true,
        searchKeywords: ['world news', 'sources', 'rss', 'feeds', 'registry', 'audit', 'source transparency']
    },
    {
        type: 'source_transparent_research_notebook',
        name: 'Research Notebook',
        description: 'Pin news, widget snapshots, and VniAgent answers into an exportable, source-preserving research note (browser-local)',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 },
        recommended: true,
        searchKeywords: ['notebook', 'research', 'evidence', 'pin', 'sources', 'export', 'markdown', 'notes']
    },
    {
        type: 'market_lab',
        name: 'Market Lab',
        description: 'Descriptive return, risk, tail, and seasonality statistics derived locally from adjusted EOD history',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 },
        recommended: true,
        searchKeywords: ['market lab', 'statistics', 'volatility', 'sharpe', 'sortino', 'var', 'skew', 'kurtosis', 'seasonality', 'distribution', 'risk']
    },
    {
        type: 'valuation_lab',
        name: 'Valuation Lab',
        description: 'Transparent DCF and reverse-DCF with editable assumptions seeded from VNIBB TTM data',
        category: 'estimates',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 8, minW: 4, minH: 6 },
        recommended: true,
        searchKeywords: ['valuation', 'dcf', 'reverse dcf', 'intrinsic value', 'fair value', 'discount rate', 'wacc', 'fcf', 'fundamental']
    },
    {
        type: 'fundamental_analysis',
        name: 'Fundamental Analysis',
        description: 'Defensive company thesis, strengths, risks, and supporting fundamental analysis when the backend endpoint is available',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 7, minW: 5, minH: 5 },
        recommended: true,
        searchKeywords: ['fundamental analysis', 'thesis', 'strengths', 'risks', 'company analysis']
    },
    {
        type: 'positioning_dashboard',
        name: 'Positioning Dashboard',
        description: 'Foreign / proprietary / domestic net-flow positioning across a VN universe (5D/20D)',
        category: 'ownership',
        defaultConfig: {},
        defaultLayout: { w: 7, h: 8, minW: 5, minH: 5 },
        recommended: true,
        searchKeywords: ['positioning', 'foreign', 'proprietary', 'domestic', 'net flow', 'participants', 'vn30', 'flow']
    },
    {
        type: 'market_structure',
        name: 'Market Structure',
        description: 'Volume-by-price profile with POC/VAH/VAL, key high-volume levels, and foreign-flow tilt',
        category: 'charting',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 9, minW: 4, minH: 6 },
        recommended: true,
        searchKeywords: ['market structure', 'volume profile', 'poc', 'vah', 'val', 'value area', 'key levels', 'support', 'resistance']
    },
    {
        type: 'signal_robustness_lab',
        name: 'Signal Robustness Lab',
        description: 'Cross-sectional descriptive test of a signal threshold across the screener universe with a passing-vs-universe return edge read',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 7, h: 9, minW: 5, minH: 6 },
        recommended: true,
        searchKeywords: ['signal', 'robustness', 'edge', 'rs rating', 'screen', 'cross-sectional', 'hit rate', 'backtest', 'validation']
    },
    {
        type: 'big_flow_monitor',
        name: 'Big Flow Monitor',
        description: 'Market-wide block-trade tape with print-size threshold and foreign/proprietary scope filters',
        category: 'ownership',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 },
        recommended: true,
        searchKeywords: ['block trade', 'big flow', 'large orders', 'prints', 'tape', 'foreign', 'proprietary', 'smart money', 'institutional']
    },
    {
        type: 'edge_half_life',
        name: 'Edge Half-Life',
        description: 'Rolling Sharpe with peak/decay read across 21/63/126D windows — descriptive edge-decay diagnostics',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 },
        recommended: true,
        searchKeywords: ['rolling sharpe', 'edge decay', 'half-life', 'edge half life', 'momentum decay', 'sharpe', 'window sweep']
    },
    {
        type: 'pair_lab',
        name: 'Pair Lab',
        description: 'Two-symbol rolling correlation, log-spread z-score, and AR(1) mean-reversion half-life',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 },
        recommended: true,
        searchKeywords: ['pair', 'pairs', 'correlation', 'spread', 'z-score', 'cointegration', 'mean reversion', 'half-life', 'relative value']
    },
    {
        type: 'monte_carlo_lab',
        name: 'Monte Carlo Lab',
        description: 'IID bootstrap of past daily returns into forward max-drawdown and terminal-return percentile tables',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 7, minW: 4, minH: 5 },
        recommended: true,
        searchKeywords: ['monte carlo', 'bootstrap', 'simulation', 'drawdown cone', 'risk', 'percentile', 'resampling', 'scenario']
    },
    {
        type: 'backtest_lab',
        name: 'Backtest Lab',
        description: 'Schema-driven moving-average crossover backtest with fees, trade list, drawdown, and Sharpe metrics',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 8, minW: 4, minH: 6 },
        recommended: true,
        searchKeywords: ['backtest', 'moving average', 'crossover', 'strategy', 'trade list', 'fees', 'drawdown', 'sharpe']
    },
    {
        type: 'sweep_matrix',
        name: 'Sweep Matrix',
        description: 'Bounded moving-average parameter grid with objective ranking and compact cells',
        category: 'quant',
        defaultConfig: {},
        defaultLayout: { w: 7, h: 8, minW: 5, minH: 6 },
        recommended: true,
        searchKeywords: ['sweep', 'parameter grid', 'moving average', 'crossover', 'optimization', 'sharpe', 'drawdown']
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
        type: 'listing_browser',
        name: 'Listing Browser',
        description: 'Saved views, exchange/index filters, and universe discovery',
        category: 'screener',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 8, minW: 6, minH: 6 },
        searchKeywords: ['listing', 'universe', 'exchange', 'industry', 'browser']
    },
    {
        type: 'market_sentiment',
        name: 'Market Sentiment',
        description: 'Aggregate market mood, trending topics, and most-mentioned stocks',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 8, minW: 6, minH: 6 },
        searchKeywords: ['sentiment', 'market mood', 'topics', 'mentions', 'discovery']
    },
    {
        type: 'ttm_snapshot',
        name: 'TTM Snapshot',
        description: 'Trailing-twelve-month snapshot across income, cash flow, and balance sheet',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 8, minW: 6, minH: 6 },
        searchKeywords: ['ttm', 'snapshot', 'fundamentals', 'trailing twelve month']
    },
    {
        type: 'growth_bridge',
        name: 'Growth Bridge',
        description: 'Annual versus latest comparable-quarter growth for core drivers',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 10, h: 8, minW: 8, minH: 6 },
        searchKeywords: ['growth', 'bridge', 'revenue growth', 'earnings growth', 'fundamentals']
    },
    {
        type: 'ownership_rating_summary',
        name: 'Ownership Rating Summary',
        description: 'Concentration, foreign participation, and insider bias in one ownership scorecard',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 8, minW: 6, minH: 6 },
        searchKeywords: ['ownership', 'rating', 'foreign flow', 'insider bias', 'concentration']
    },
    {
        type: 'derivatives_analytics',
        name: 'Derivatives Analytics',
        description: 'Front-contract pulse and short futures curve analytics',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 10, h: 8, minW: 8, minH: 6 },
        searchKeywords: ['derivatives', 'futures', 'curve', 'analytics', 'term structure']
    },
    {
        type: 'research_browser',
        name: 'External Intelligence Hub',
        description: 'Curated external research links and ticker-aware intelligence sources',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 8, minW: 6, minH: 6 }
    },
    {
        type: 'insider_deal_timeline',
        name: 'Insider Deal Timeline',
        description: 'Recent insider activity and net flow',
        category: 'ownership',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 }
    },
    {
        type: 'alert_settings',
        name: 'Alert Settings',
        description: 'Configure insider alerts and notification delivery preferences',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 4, h: 7, minW: 3, minH: 6 },
        searchKeywords: ['alert', 'notification', 'browser notification', 'email preference']
    },
    {
        type: 'block_trade',
        name: 'Block Trade Alerts',
        description: 'Large negotiated prints with buy/sell and participant context',
        category: 'analysis',
        defaultConfig: {},
        defaultLayout: { w: 6, h: 7, minW: 4, minH: 5 },
        searchKeywords: ['block trade', 'large trades', 'smart money', 'negotiated']
    },
    {
        type: 'ownership_changes',
        name: 'Ownership Changes',
        description: 'Latest major shareholder snapshot',
        category: 'ownership',
        defaultConfig: {},
        defaultLayout: { w: 5, h: 6, minW: 4, minH: 5 }
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
        description: 'Order book depth with cached/reference labels when live pricing is unavailable',
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
        type: 'news_corporate_actions',
        name: 'News + Corporate Actions',
        description: 'Company news with dividends and insider deals',
        category: 'core_data',
        defaultConfig: {},
        defaultLayout: { w: 8, h: 7, minW: 6, minH: 5 }
    },
    {
        type: 'ai_analysis',
        name: 'VniAgent Analysis',
        description: 'Deep fundamental and technical analysis using your configured OpenRouter model',
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

// Single source of truth: every widget's effective default layout is derived from the
// size contract in `@/lib/dashboardLayout` (WIDGET_LAYOUT_BEHAVIORS). The inline
// `defaultLayout` literals above are initialization placeholders only; they are always
// overwritten here so library/copilot insertion sizes match real placement behavior.
widgetDefinitions.forEach((widget) => {
    const { x: _x, y: _y, ...size } = getWidgetDefaultLayout(widget.type);
    widget.defaultLayout = size;
});

export type WidgetLibrarySectionId =
    | 'fundamentals'
    | 'market'
    | 'charting'
    | 'global_markets'
    | 'quant_signals'
    | 'ownership'
    | 'news_events'
    | 'ai_research'
    | 'screeners_tools';

export interface WidgetLibrarySectionInfo {
    id: WidgetLibrarySectionId;
    name: string;
    description: string;
    icon: string;
}

export const widgetLibrarySections: WidgetLibrarySectionInfo[] = [
    {
        id: 'fundamentals',
        name: 'Fundamentals',
        description: 'Statements, ratios, valuation, and issuer-level fundamentals',
        icon: 'BarChart3',
    },
    {
        id: 'market',
        name: 'Market Pulse',
        description: 'Tape, movers, breadth, sector rotation, and market context',
        icon: 'Activity',
    },
    {
        id: 'charting',
        name: 'Charting',
        description: 'Price charts and visual technical workspaces',
        icon: 'TrendingUp',
    },
    {
        id: 'global_markets',
        name: 'Global Markets',
        description: 'TradingView, world indices, FX, macro, and global risk context',
        icon: 'Globe',
    },
    {
        id: 'quant_signals',
        name: 'Quant & Signals',
        description: 'Factor, momentum, seasonality, and signal-driven widgets',
        icon: 'Sigma',
    },
    {
        id: 'ownership',
        name: 'Ownership',
        description: 'Shareholders, insiders, officers, and capital structure context',
        icon: 'Users',
    },
    {
        id: 'news_events',
        name: 'News & Events',
        description: 'Headlines, filings, earnings calendars, and corporate actions',
        icon: 'Newspaper',
    },
    {
        id: 'ai_research',
        name: 'AI & Research',
        description: 'Comparison, research workflows, and assisted analysis surfaces',
        icon: 'Brain',
    },
    {
        id: 'screeners_tools',
        name: 'Screeners & Tools',
        description: 'Screening, watchlists, alerts, notes, and utility workflows',
        icon: 'Layers',
    },
];

const DEFAULT_WIDGET_LIBRARY_SECTION_BY_CATEGORY: Record<WidgetCategory, WidgetLibrarySectionId> = {
    core_data: 'fundamentals',
    charting: 'charting',
    global_markets: 'global_markets',
    calendar: 'news_events',
    ownership: 'ownership',
    estimates: 'ai_research',
    screener: 'screeners_tools',
    analysis: 'ai_research',
    quant: 'quant_signals',
};

const WIDGET_LIBRARY_SECTION_OVERRIDES: Partial<Record<WidgetType, WidgetLibrarySectionId>> = {
    market_overview: 'market',
    market_news: 'market',
    top_movers: 'market',
    market_breadth: 'market',
    sector_performance: 'market',
    market_heatmap: 'market',
    sector_board: 'market',
    market_movers_sectors: 'market',
    sector_rotation_radar: 'market',
    index_comparison: 'market',
    transaction_flow: 'market',
    money_flow_trend: 'market',
    industry_bubble: 'market',
    bank_metrics: 'fundamentals',
    financial_ratios: 'fundamentals',
    income_statement: 'fundamentals',
    balance_sheet: 'fundamentals',
    cash_flow: 'fundamentals',
    income_sankey: 'fundamentals',
    cashflow_waterfall: 'fundamentals',
    unified_financials: 'fundamentals',
    financial_snapshot: 'fundamentals',
    quick_stats: 'fundamentals',
    dividend_ladder: 'fundamentals',
    earnings_history: 'news_events',
    earnings_release_recap: 'news_events',
    dividend_payment: 'news_events',
    stock_splits: 'news_events',
    company_filings: 'news_events',
    news_feed: 'news_events',
    events_calendar: 'news_events',
    earnings_season_monitor: 'news_events',
    news_corporate_actions: 'news_events',
    derivatives_contracts_board: 'global_markets',
    derivatives_price_history: 'global_markets',
    peer_comparison: 'ai_research',
    comparison_analysis: 'ai_research',
    ai_analysis: 'ai_research',
    research_browser: 'ai_research',
    analyst_estimates: 'ai_research',
    fundamental_analysis: 'fundamentals',
    watchlist: 'screeners_tools',
    watchlist_limits_monitor: 'screeners_tools',
    foreign_flow_leaderboard: 'ownership',
    portfolio_tracker: 'screeners_tools',
    price_alerts: 'screeners_tools',
    notes: 'screeners_tools',
    listing_browser: 'screeners_tools',
    market_sentiment: 'ai_research',
    ttm_snapshot: 'fundamentals',
    growth_bridge: 'fundamentals',
    ownership_rating_summary: 'ownership',
    derivatives_analytics: 'global_markets',
    database_inspector: 'screeners_tools',
    intraday_trades: 'screeners_tools',
    block_trade: 'screeners_tools',
    orderbook: 'screeners_tools',
    foreign_trading: 'ownership',
};

const LEGACY_WIDGET_TYPE_ALIASES = {
    company_profile: 'ticker_profile',
    financials: 'unified_financials',
    institutional_ownership: 'major_shareholders',
    database_browser: 'database_inspector',
    // Retired the hardcoded/sample economic_calendar widget in favor of the live
    // TradingView economic calendar embed. Saved dashboards auto-migrate.
    economic_calendar: 'tradingview_economic_calendar',
} as const;

export function normalizeWidgetType(type: string | null | undefined): WidgetDefinition['type'] | null {
    if (!type) return null;
    const normalized = LEGACY_WIDGET_TYPE_ALIASES[type as keyof typeof LEGACY_WIDGET_TYPE_ALIASES] || type;
    return widgetDefinitions.some((widget) => widget.type === normalized)
        ? (normalized as WidgetDefinition['type'])
        : null;
}

// Helper to get widget definition by type
export function getWidgetDefinition(type: string): WidgetDefinition | undefined {
    const normalizedType = normalizeWidgetType(type);
    if (!normalizedType) return undefined;
    return widgetDefinitions.find(w => w.type === normalizedType);
}

export function getWidgetLibrarySectionId(type: WidgetType | string): WidgetLibrarySectionId | null {
    const normalizedType = normalizeWidgetType(type);
    if (!normalizedType) return null;

    const override = WIDGET_LIBRARY_SECTION_OVERRIDES[normalizedType];
    if (override) {
        return override;
    }

    const widget = getWidgetDefinition(normalizedType);
    if (!widget) {
        return null;
    }

    return DEFAULT_WIDGET_LIBRARY_SECTION_BY_CATEGORY[widget.category];
}

// Helper to get widgets by category
export function getWidgetsByCategory(category: WidgetCategory): WidgetDefinition[] {
    return widgetDefinitions.filter(w => w.category === category);
}
