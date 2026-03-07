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
    id: 'day-trader',
    name: 'Day Trader',
    description: 'Real-time price action, order flow, and intraday execution context.',
    category: 'trading',
    widgets: [
      { type: 'price_chart', layout: { x: 0, y: 0, w: 14, h: 8 } },
      { type: 'volume_flow', layout: { x: 14, y: 0, w: 10, h: 4 } },
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
    id: 'custom',
    name: 'Custom',
    description: 'Start from an empty tab and assemble your own layout.',
    category: 'overview',
    widgets: [],
  },
];
