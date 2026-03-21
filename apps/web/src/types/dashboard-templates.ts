import type { WidgetType } from './dashboard';

export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  thumbnail?: string;
  category: 'trading' | 'analysis' | 'research' | 'overview';
  widgets: Array<{
    type: WidgetType;
    layout: { x: number; y: number; w: number; h: number };
    config?: Record<string, any>;
  }>;
}

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
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
      { type: 'relative_rotation', layout: { x: 16, y: 0, w: 8, h: 5 } },
      { type: 'momentum', layout: { x: 0, y: 5, w: 8, h: 5 } },
      { type: 'drawdown_recovery', layout: { x: 8, y: 5, w: 8, h: 5 } },
      { type: 'sortino_monthly', layout: { x: 16, y: 5, w: 8, h: 5 } },
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
      { type: 'sector_performance', layout: { x: 0, y: 5, w: 8, h: 6 } },
      { type: 'index_comparison', layout: { x: 8, y: 6, w: 8, h: 5 } },
      { type: 'top_movers', layout: { x: 16, y: 5, w: 8, h: 6 } },
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
      { type: 'financial_ratios', layout: { x: 8, y: 8, w: 8, h: 6 } },
      { type: 'price_chart', layout: { x: 16, y: 8, w: 8, h: 6 } },
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
    id: 'custom',
    name: 'Custom',
    description: 'Start from an empty tab and assemble your own layout.',
    category: 'overview',
    widgets: [],
  },
];
