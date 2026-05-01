import type { WidgetType } from './dashboard';

export type DashboardTemplateCategory =
  | 'market'
  | 'fundamentals'
  | 'technical'
  | 'quant'
  | 'research'
  | 'global';

export interface DashboardTemplateCategoryInfo {
  id: DashboardTemplateCategory;
  label: string;
  description: string;
}

export const DASHBOARD_TEMPLATE_CATEGORIES: DashboardTemplateCategoryInfo[] = [
  {
    id: 'market',
    label: 'Market',
    description: 'Tape, breadth, movers, sectors, and market-wide context.',
  },
  {
    id: 'fundamentals',
    label: 'Fundamentals',
    description: 'Financial statements, balance-sheet work, and long-horizon research.',
  },
  {
    id: 'technical',
    label: 'Technical',
    description: 'Charts, setups, and short-term execution surfaces.',
  },
  {
    id: 'quant',
    label: 'Quant',
    description: 'Signal stacks, factor views, and systematic monitoring.',
  },
  {
    id: 'research',
    label: 'Research',
    description: 'News, events, comparison, and thematic investigation workflows.',
  },
  {
    id: 'global',
    label: 'Global',
    description: 'Macro, FX, global indices, and non-Vietnam market context.',
  },
];

export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  thumbnail?: string;
  category: DashboardTemplateCategory;
  widgets: Array<{
    type: WidgetType;
    layout: { x: number; y: number; w: number; h: number };
    config?: Record<string, unknown>;
  }>;
}

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    id: 'global-markets',
    name: 'Global Markets',
    description: 'TradingView-native workspace for charts, macro watchlists, heatmaps, and global event flow.',
    category: 'global',
    widgets: [
      { type: 'tradingview_ticker_tape', layout: { x: 0, y: 0, w: 24, h: 4 } },
      { type: 'tradingview_chart', layout: { x: 0, y: 4, w: 14, h: 10 }, config: { symbol: 'NASDAQ:VFS' } },
      { type: 'tradingview_technical_analysis', layout: { x: 14, y: 4, w: 10, h: 10 }, config: { symbol: 'NASDAQ:VFS' } },
      { type: 'tradingview_market_overview', layout: { x: 0, y: 14, w: 12, h: 8 } },
      { type: 'tradingview_market_data', layout: { x: 12, y: 14, w: 12, h: 8 } },
      { type: 'tradingview_forex_cross_rates', layout: { x: 0, y: 22, w: 8, h: 7 } },
      { type: 'tradingview_stock_heatmap', layout: { x: 8, y: 22, w: 8, h: 7 } },
      { type: 'tradingview_top_stories', layout: { x: 16, y: 22, w: 8, h: 7 }, config: { feedMode: 'all_symbols' } },
      { type: 'world_news_monitor', layout: { x: 0, y: 29, w: 12, h: 8 }, config: { region: 'all', category: 'all', limit: 50, freshnessHours: 72 } },
    ],
  },
  {
    id: 'earnings-season',
    name: 'Earnings Season',
    description: 'Monitor fresh quarterly releases and jump quickly into statement and ratio follow-up work.',
    category: 'research',
    widgets: [
      { type: 'earnings_season_monitor', layout: { x: 0, y: 0, w: 12, h: 8 } },
      { type: 'earnings_release_recap', layout: { x: 12, y: 0, w: 12, h: 8 } },
      { type: 'financial_ratios', layout: { x: 0, y: 8, w: 8, h: 6 } },
      { type: 'income_statement', layout: { x: 8, y: 8, w: 8, h: 6 } },
      { type: 'company_filings', layout: { x: 16, y: 8, w: 8, h: 6 } },
    ],
  },
  {
    id: 'getting-started',
    name: 'Getting Started',
    description: 'A balanced first workspace with the market pulse, movers, a screener, and one core chart.',
    category: 'market',
    widgets: [
      { type: 'market_overview', layout: { x: 0, y: 0, w: 8, h: 5 } },
      { type: 'top_movers', layout: { x: 8, y: 0, w: 8, h: 5 } },
      { type: 'market_news', layout: { x: 16, y: 0, w: 8, h: 5 } },
      { type: 'price_chart', layout: { x: 0, y: 5, w: 12, h: 7 } },
      { type: 'screener', layout: { x: 12, y: 5, w: 12, h: 7 } },
    ],
  },
  {
    id: 'day-trader',
    name: 'Day Trader',
    description: 'Real-time price action, order flow, and intraday execution context.',
    category: 'technical',
    widgets: [
      { type: 'price_chart', layout: { x: 0, y: 0, w: 14, h: 8 } },
      { type: 'transaction_flow', layout: { x: 14, y: 0, w: 10, h: 4 } },
      { type: 'macd_crossovers', layout: { x: 14, y: 4, w: 10, h: 4 } },
      { type: 'intraday_trades', layout: { x: 0, y: 8, w: 12, h: 6 } },
      { type: 'orderbook', layout: { x: 12, y: 8, w: 12, h: 6 } },
    ],
  },
  {
    id: 'fundamental-analyst',
    name: 'Fundamental Analyst',
    description: 'Financial statements, ratios, and peer context for long-horizon research.',
    category: 'fundamentals',
    widgets: [
      { type: 'financial_snapshot', layout: { x: 0, y: 0, w: 24, h: 10 } },
      { type: 'financial_ratios', layout: { x: 0, y: 10, w: 8, h: 6 } },
      { type: 'peer_comparison', layout: { x: 8, y: 10, w: 8, h: 6 } },
      { type: 'earnings_release_recap', layout: { x: 16, y: 10, w: 8, h: 6 } },
    ],
  },
  {
    id: 'quant-researcher',
    name: 'Quant Researcher',
    description: 'Signal stack for trend, mean reversion, volatility, and factor rotation.',
    category: 'quant',
    widgets: [
      { type: 'bollinger_squeeze', layout: { x: 0, y: 0, w: 8, h: 5 } },
      { type: 'ema_respect', layout: { x: 8, y: 0, w: 8, h: 5 } },
      { type: 'money_flow_trend', layout: { x: 16, y: 0, w: 8, h: 5 } },
      { type: 'momentum', layout: { x: 0, y: 5, w: 8, h: 5 } },
      { type: 'drawdown_recovery', layout: { x: 8, y: 5, w: 8, h: 5 } },
      { type: 'sortino_monthly', layout: { x: 16, y: 5, w: 8, h: 5 } },
    ],
  },
  {
    id: 'money-flow-monitor',
    name: 'Money Flow Monitor',
    description: 'Track sector-relative rotation, transaction flow, and price context in one workspace.',
    category: 'market',
    widgets: [
      { type: 'money_flow_trend', layout: { x: 0, y: 0, w: 12, h: 7 } },
      { type: 'transaction_flow', layout: { x: 12, y: 0, w: 12, h: 7 } },
      { type: 'industry_bubble', layout: { x: 0, y: 7, w: 12, h: 7 } },
      { type: 'price_chart', layout: { x: 12, y: 7, w: 12, h: 7 } },
    ],
  },
  {
    id: 'market-overview',
    name: 'Market Overview',
    description: 'Macro breadth, sector rotation, and index context for scanning the full tape quickly.',
    category: 'market',
    widgets: [
      { type: 'market_overview', layout: { x: 0, y: 0, w: 7, h: 5 } },
      { type: 'market_heatmap', layout: { x: 7, y: 0, w: 10, h: 6 } },
      { type: 'market_breadth', layout: { x: 17, y: 0, w: 7, h: 5 } },
      { type: 'sector_board', layout: { x: 0, y: 5, w: 16, h: 7 } },
      { type: 'index_comparison', layout: { x: 16, y: 5, w: 8, h: 5 } },
      { type: 'top_movers', layout: { x: 16, y: 10, w: 8, h: 5 } },
    ],
  },
  {
    id: 'sector-monitor',
    name: 'Sector Monitor',
    description: 'Market-wide sector board, top movers, and breadth for tape-reading sessions.',
    category: 'market',
    widgets: [
      { type: 'sector_board', layout: { x: 0, y: 0, w: 16, h: 8 } },
      { type: 'market_overview', layout: { x: 16, y: 0, w: 8, h: 5 } },
      { type: 'top_movers', layout: { x: 16, y: 5, w: 8, h: 5 } },
      { type: 'market_breadth', layout: { x: 0, y: 8, w: 8, h: 5 } },
      { type: 'sector_performance', layout: { x: 8, y: 8, w: 8, h: 5 } },
      { type: 'market_heatmap', layout: { x: 16, y: 10, w: 8, h: 5 } },
    ],
  },
  {
    id: 'news-watcher',
    name: 'News Watcher',
    description: 'Headline flow, events, and market-moving company updates in one tab.',
    category: 'research',
    widgets: [
      { type: 'news_feed', layout: { x: 0, y: 0, w: 12, h: 8 } },
      { type: 'market_news', layout: { x: 12, y: 0, w: 12, h: 8 } },
      { type: 'events_calendar', layout: { x: 0, y: 8, w: 12, h: 6 } },
      { type: 'price_chart', layout: { x: 12, y: 8, w: 12, h: 6 } },
      { type: 'world_news_monitor', layout: { x: 0, y: 14, w: 12, h: 8 }, config: { region: 'all', category: 'all', limit: 50, freshnessHours: 72 } },
    ],
  },
  {
    id: 'income-investor',
    name: 'Income Investor',
    description: 'Track dividend quality, payout durability, and price support around income ideas.',
    category: 'fundamentals',
    widgets: [
      { type: 'dividend_payment', layout: { x: 0, y: 0, w: 8, h: 6 } },
      { type: 'dividend_ladder', layout: { x: 8, y: 0, w: 8, h: 6 } },
      { type: 'financial_ratios', layout: { x: 16, y: 0, w: 8, h: 6 } },
      { type: 'cash_flow', layout: { x: 0, y: 6, w: 12, h: 7 } },
      { type: 'price_chart', layout: { x: 12, y: 6, w: 12, h: 7 } },
    ],
  },
  {
    id: 'comparison-lab',
    name: 'Comparison Lab',
    description: 'Peer benchmarking with sector averages, trend overlays, and ranked strength context.',
    category: 'research',
    widgets: [
      { type: 'peer_comparison', layout: { x: 0, y: 0, w: 14, h: 8 } },
      { type: 'comparison_analysis', layout: { x: 14, y: 0, w: 10, h: 8 } },
      { type: 'rs_ranking', layout: { x: 0, y: 8, w: 8, h: 6 } },
      { type: 'industry_bubble', layout: { x: 8, y: 8, w: 8, h: 6 } },
      { type: 'price_chart', layout: { x: 16, y: 8, w: 8, h: 6 } },
    ],
  },
  {
    id: 'industry-explorer',
    name: 'Industry Explorer',
    description: 'Visualize sector peers across valuation, growth, and market-cap dimensions.',
    category: 'research',
    widgets: [
      { type: 'industry_bubble', layout: { x: 0, y: 0, w: 12, h: 8 } },
      { type: 'comparison_analysis', layout: { x: 12, y: 0, w: 12, h: 8 } },
      { type: 'financial_ratios', layout: { x: 0, y: 8, w: 8, h: 6 } },
      { type: 'correlation_matrix', layout: { x: 8, y: 8, w: 16, h: 6 } },
    ],
  },
  {
    id: 'bank-analyst',
    name: 'Bank Analyst',
    description: 'Bank-native funding, profitability, and risk analytics with balance-sheet context and peer support.',
    category: 'fundamentals',
    widgets: [
      { type: 'bank_metrics', layout: { x: 0, y: 0, w: 10, h: 7 } },
      { type: 'financial_ratios', layout: { x: 10, y: 0, w: 14, h: 7 } },
      { type: 'balance_sheet', layout: { x: 0, y: 7, w: 12, h: 7 } },
      { type: 'comparison_analysis', layout: { x: 12, y: 7, w: 12, h: 7 } },
    ],
  },
  {
    id: 'correlation-lab',
    name: 'Correlation Lab',
    description: 'Analyze sector peer correlations alongside bubble and price context.',
    category: 'quant',
    widgets: [
      { type: 'correlation_matrix', layout: { x: 0, y: 0, w: 12, h: 7 } },
      { type: 'industry_bubble', layout: { x: 12, y: 0, w: 12, h: 7 } },
      { type: 'peer_comparison', layout: { x: 0, y: 7, w: 12, h: 7 } },
      { type: 'price_chart', layout: { x: 12, y: 7, w: 12, h: 7 } },
    ],
  },
];
