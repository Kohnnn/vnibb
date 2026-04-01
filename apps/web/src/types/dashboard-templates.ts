import type { WidgetType } from './dashboard';

export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  thumbnail?: string;
  category: 'trading' | 'analysis' | 'research' | 'overview' | 'global';
  widgets: Array<{
    type: WidgetType;
    layout: { x: number; y: number; w: number; h: number };
    config?: Record<string, any>;
  }>;
}

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    id: 'global-markets',
    name: 'Global Markets',
    description: 'TradingView-first workspace for crypto, global indices, forex, and macro market context.',
    category: 'global',
    widgets: [
      { type: 'tradingview_ticker_tape', layout: { x: 0, y: 0, w: 24, h: 4 } },
      { type: 'tradingview_chart', layout: { x: 0, y: 4, w: 15, h: 10 }, config: { symbol: 'NASDAQ:QQQ' } },
      { type: 'tradingview_technical_analysis', layout: { x: 15, y: 4, w: 9, h: 10 }, config: { symbol: 'NASDAQ:QQQ' } },
      { type: 'market_overview', layout: { x: 0, y: 14, w: 8, h: 7 } },
      { type: 'forex_rates', layout: { x: 8, y: 14, w: 8, h: 7 } },
      { type: 'commodities', layout: { x: 16, y: 14, w: 8, h: 7 } },
      { type: 'world_indices', layout: { x: 0, y: 21, w: 10, h: 8 } },
      { type: 'market_news', layout: { x: 10, y: 21, w: 14, h: 8 }, config: { mode: 'all' } },
    ],
  },
  {
    id: 'earnings-season',
    name: 'Earnings Season',
    description: 'Monitor fresh quarterly releases and jump quickly into statement and ratio follow-up work.',
    category: 'research',
    widgets: [
      { type: 'earnings_season_monitor', layout: { x: 0, y: 0, w: 14, h: 8 } },
      { type: 'events_calendar', layout: { x: 14, y: 0, w: 10, h: 8 } },
      { type: 'financial_ratios', layout: { x: 0, y: 8, w: 8, h: 6 } },
      { type: 'income_statement', layout: { x: 8, y: 8, w: 8, h: 6 } },
      { type: 'cash_flow', layout: { x: 16, y: 8, w: 8, h: 6 } },
    ],
  },
  {
    id: 'getting-started',
    name: 'Getting Started',
    description: 'A balanced first workspace with the market pulse, movers, a screener, and one core chart.',
    category: 'overview',
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
    category: 'trading',
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
    category: 'research',
    widgets: [
      { type: 'income_statement', layout: { x: 0, y: 0, w: 12, h: 7 } },
      { type: 'balance_sheet', layout: { x: 12, y: 0, w: 12, h: 7 } },
      { type: 'financial_ratios', layout: { x: 0, y: 7, w: 8, h: 6 } },
      { type: 'peer_comparison', layout: { x: 8, y: 7, w: 8, h: 6 } },
      { type: 'cash_flow', layout: { x: 16, y: 7, w: 8, h: 6 } },
    ],
  },
  {
    id: 'quant-researcher',
    name: 'Quant Researcher',
    description: 'Signal stack for trend, mean reversion, volatility, and factor rotation.',
    category: 'analysis',
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
    category: 'analysis',
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
    category: 'overview',
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
    category: 'overview',
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
    category: 'overview',
    widgets: [
      { type: 'news_feed', layout: { x: 0, y: 0, w: 12, h: 8 } },
      { type: 'market_news', layout: { x: 12, y: 0, w: 12, h: 8 } },
      { type: 'events_calendar', layout: { x: 0, y: 8, w: 12, h: 6 } },
      { type: 'price_chart', layout: { x: 12, y: 8, w: 12, h: 6 } },
    ],
  },
  {
    id: 'income-investor',
    name: 'Income Investor',
    description: 'Track dividend quality, payout durability, and price support around income ideas.',
    category: 'research',
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
    category: 'analysis',
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
    category: 'analysis',
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
    category: 'analysis',
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
    category: 'analysis',
    widgets: [
      { type: 'correlation_matrix', layout: { x: 0, y: 0, w: 12, h: 7 } },
      { type: 'industry_bubble', layout: { x: 12, y: 0, w: 12, h: 7 } },
      { type: 'peer_comparison', layout: { x: 0, y: 7, w: 12, h: 7 } },
      { type: 'price_chart', layout: { x: 12, y: 7, w: 12, h: 7 } },
    ],
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Start from an empty tab and assemble your own layout.',
    category: 'overview',
    widgets: [],
  },
];
