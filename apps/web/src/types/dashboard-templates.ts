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
    id: 'trading-pro',
    name: 'Trading Pro',
    description: 'Full trading setup with charts, orderbook, and market depth',
    category: 'trading',
    widgets: [
      { type: 'price_chart', layout: { x: 0, y: 0, w: 16, h: 8 } },
      { type: 'orderbook', layout: { x: 16, y: 0, w: 8, h: 8 } },
      { type: 'intraday_trades', layout: { x: 0, y: 8, w: 12, h: 6 } },
      { type: 'key_metrics', layout: { x: 12, y: 8, w: 12, h: 6 } },
    ],
  },
  {
    id: 'fundamental-research',
    name: 'Fundamental Research',
    description: 'Deep dive into company financials and valuation',
    category: 'research',
    widgets: [
      { type: 'ticker_info', layout: { x: 0, y: 0, w: 8, h: 4 } },
      { type: 'income_statement', layout: { x: 8, y: 0, w: 16, h: 6 } },
      { type: 'balance_sheet', layout: { x: 0, y: 4, w: 12, h: 6 } },
      { type: 'financial_ratios', layout: { x: 12, y: 4, w: 12, h: 6 } },
      { type: 'comparison_analysis', layout: { x: 0, y: 10, w: 24, h: 8 } },
    ],
  },
  {
    id: 'market-overview',
    name: 'Market Overview',
    description: "Bird's eye view of the entire market",
    category: 'overview',
    widgets: [
      { type: 'market_overview', layout: { x: 0, y: 0, w: 24, h: 3 } },
      { type: 'market_heatmap', layout: { x: 0, y: 3, w: 16, h: 8 } },
      { type: 'top_movers', layout: { x: 16, y: 3, w: 8, h: 4 } },
      { type: 'sector_top_movers', layout: { x: 16, y: 7, w: 8, h: 4 } },
    ],
  },
  {
    id: 'news-analysis',
    name: 'News & Events',
    description: 'Stay updated with market news and events',
    category: 'analysis',
    widgets: [
      { type: 'news_flow', layout: { x: 0, y: 0, w: 12, h: 10 } },
      { type: 'events_calendar', layout: { x: 12, y: 0, w: 12, h: 5 } },
      { type: 'earnings_history', layout: { x: 12, y: 5, w: 12, h: 5 } },
    ],
  },
  {
    id: 'screener-focused',
    name: 'Stock Screener',
    description: 'Find your next investment opportunity',
    category: 'analysis',
    widgets: [
      { type: 'screener', layout: { x: 0, y: 0, w: 24, h: 12 } },
      { type: 'price_chart', layout: { x: 0, y: 12, w: 16, h: 8 } },
      { type: 'key_metrics', layout: { x: 16, y: 12, w: 8, h: 8 } },
    ],
  },
];
