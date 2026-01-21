// Widget Registry - maps widget types to components

import type { WidgetType } from '@/types/dashboard';
import { TickerInfoWidget } from './TickerInfoWidget';
import { TickerProfileWidget } from './TickerProfileWidget';
import { PriceChartWidget } from './PriceChartWidget';
import { KeyMetricsWidget } from './KeyMetricsWidget';
import { ShareStatisticsWidget } from './ShareStatisticsWidget';
import { ScreenerWidget } from './ScreenerWidget';
import { EarningsHistoryWidget } from './EarningsHistoryWidget';
import { DividendPaymentWidget } from './DividendPaymentWidget';
import { ValuationWidget } from './ValuationWidget';
import { StockSplitsWidget } from './StockSplitsWidget';

import { CompanyFilingsWidget } from './CompanyFilingsWidget';
import { NewsFeedWidget } from './NewsFeedWidget';
import { EventsCalendarWidget } from './EventsCalendarWidget';
import { MajorShareholdersWidget } from './MajorShareholdersWidget';
import { OfficersManagementWidget } from './OfficersManagementWidget';
import { IntradayTradesWidget } from './IntradayTradesWidget';
import { FinancialRatiosWidget } from './FinancialRatiosWidget';
import { ForeignTradingWidget } from './ForeignTradingWidget';
import { SubsidiariesWidget } from './SubsidiariesWidget';
import { BalanceSheetWidget } from './BalanceSheetWidget';
import { IncomeStatementWidget } from './IncomeStatementWidget';
import { CashFlowWidget } from './CashFlowWidget';
import { MarketOverviewWidget } from './MarketOverviewWidget';
import { WatchlistWidget } from './WatchlistWidget';
import { PeerComparisonWidget } from './PeerComparisonWidget';
import { ComparisonWidget } from './ComparisonWidget';
import { AICopilotWidget } from './AICopilotWidget';
import { TopMoversWidget } from './TopMoversWidget';
import { WorldIndicesWidget } from './WorldIndicesWidget';
import { SectorPerformanceWidget } from './SectorPerformanceWidget';
import { PortfolioTrackerWidget } from './PortfolioTrackerWidget';
import { PriceAlertsWidget } from './PriceAlertsWidget';
import { EconomicCalendarWidget } from './EconomicCalendarWidget';
import { VolumeAnalysisWidget } from './VolumeAnalysisWidget';
import { TechnicalSummaryWidget } from './TechnicalSummaryWidget';
import { ForexRatesWidget } from './ForexRatesWidget';
import { CommoditiesWidget } from './CommoditiesWidget';
import { SimilarStocksWidget } from './SimilarStocksWidget';
import { QuickStatsWidget } from './QuickStatsWidget';
import { NotesWidget } from './NotesWidget';
import { SectorTopMoversWidget } from './SectorTopMoversWidget';
import { RSRankingWidget } from './RSRankingWidget';
import { InsiderTradingWidget } from './InsiderTradingWidget';
import { BlockTradeWidget } from './BlockTradeWidget';
import { AlertSettingsPanel } from './AlertSettingsPanel';
import { MarketHeatmapWidget } from './MarketHeatmapWidget';
import { DatabaseInspectorWidget } from './DatabaseInspectorWidget';
import { OrderbookWidget } from './OrderbookWidget';
import { IndexComparisonWidget } from './IndexComparisonWidget';
import { MarketNewsWidget } from './MarketNewsWidget';
import { SectorBreakdownWidget } from './SectorBreakdownWidget';
import { ComparisonAnalysisWidget } from './ComparisonAnalysisWidget';
import { NewsFlowWidget } from './NewsFlowWidget';
import { AIAnalysisWidget } from './AIAnalysisWidget';
import { DatabaseBrowserWidget } from './DatabaseBrowserWidget';
import { FinancialsWidget } from './FinancialsWidget';
import type { ComponentType } from 'react';

export interface WidgetProps {
    id: string;
    symbol?: string;
    onSymbolClick?: (symbol: string) => void;
    hideHeader?: boolean;
    onRemove?: () => void;
}

// Main widget registry
export const widgetRegistry: Record<string, ComponentType<WidgetProps>> = {
    // Core widgets
    ticker_info: TickerInfoWidget as ComponentType<WidgetProps>,
    ticker_profile: TickerProfileWidget as ComponentType<WidgetProps>,
    price_chart: PriceChartWidget as ComponentType<WidgetProps>,
    key_metrics: KeyMetricsWidget as ComponentType<WidgetProps>,
    share_statistics: ShareStatisticsWidget as ComponentType<WidgetProps>,
    screener: ScreenerWidget as ComponentType<WidgetProps>,
    company_profile: TickerProfileWidget as ComponentType<WidgetProps>,
    earnings_history: EarningsHistoryWidget as ComponentType<WidgetProps>,
    dividend_payment: DividendPaymentWidget as ComponentType<WidgetProps>,
    valuation_multiples: ValuationWidget as ComponentType<WidgetProps>,
    stock_splits: StockSplitsWidget as ComponentType<WidgetProps>,

    // Financial widgets
    financials: FinancialsWidget as ComponentType<WidgetProps>,
    unified_financials: FinancialsWidget as ComponentType<WidgetProps>,
    income_statement: IncomeStatementWidget as ComponentType<WidgetProps>,
    balance_sheet: BalanceSheetWidget as ComponentType<WidgetProps>,
    cash_flow: CashFlowWidget as ComponentType<WidgetProps>,
    financial_ratios: FinancialRatiosWidget as ComponentType<WidgetProps>,

    // Company info widgets
    company_filings: CompanyFilingsWidget as ComponentType<WidgetProps>,
    major_shareholders: MajorShareholdersWidget as ComponentType<WidgetProps>,
    officers_management: OfficersManagementWidget as ComponentType<WidgetProps>,
    subsidiaries: SubsidiariesWidget as ComponentType<WidgetProps>,

    // Market & Trading widgets
    intraday_trades: IntradayTradesWidget as ComponentType<WidgetProps>,
    foreign_trading: ForeignTradingWidget as ComponentType<WidgetProps>,
    market_overview: MarketOverviewWidget as ComponentType<WidgetProps>,
    watchlist: WatchlistWidget as ComponentType<WidgetProps>,

    // Comparison & Analysis widgets
    peer_comparison: PeerComparisonWidget as ComponentType<WidgetProps>,
    comparison_widget: ComparisonWidget as ComponentType<WidgetProps>,
    comparison_analysis: ComparisonAnalysisWidget as ComponentType<WidgetProps>,
    index_comparison: IndexComparisonWidget as ComponentType<WidgetProps>,

    // News & Events widgets
    news_feed: NewsFeedWidget as ComponentType<WidgetProps>,
    market_news: MarketNewsWidget as ComponentType<WidgetProps>,
    news_flow: NewsFlowWidget as ComponentType<WidgetProps>,
    events_calendar: EventsCalendarWidget as ComponentType<WidgetProps>,

    // Special widgets
    ai_copilot: AICopilotWidget as ComponentType<WidgetProps>,
    ai_analysis: AIAnalysisWidget as ComponentType<WidgetProps>,
    top_movers: TopMoversWidget as ComponentType<WidgetProps>,
    sector_top_movers: SectorTopMoversWidget as ComponentType<WidgetProps>,
    world_indices: WorldIndicesWidget as ComponentType<WidgetProps>,
    sector_performance: SectorPerformanceWidget as ComponentType<WidgetProps>,
    sector_breakdown: SectorBreakdownWidget as ComponentType<WidgetProps>,

    // Portfolio & Alerts
    portfolio_tracker: PortfolioTrackerWidget as ComponentType<WidgetProps>,
    price_alerts: PriceAlertsWidget as ComponentType<WidgetProps>,
    alert_settings: AlertSettingsPanel as ComponentType<WidgetProps>,

    // Analytics widgets
    volume_analysis: VolumeAnalysisWidget as ComponentType<WidgetProps>,
    technical_summary: TechnicalSummaryWidget as ComponentType<WidgetProps>,
    similar_stocks: SimilarStocksWidget as ComponentType<WidgetProps>,
    quick_stats: QuickStatsWidget as ComponentType<WidgetProps>,

    // Reference widgets
    economic_calendar: EconomicCalendarWidget as ComponentType<WidgetProps>,
    forex_rates: ForexRatesWidget as ComponentType<WidgetProps>,
    commodities: CommoditiesWidget as ComponentType<WidgetProps>,

    // Additional widgets
    notes: NotesWidget as ComponentType<WidgetProps>,
    rs_ranking: RSRankingWidget as ComponentType<WidgetProps>,
    insider_trading: InsiderTradingWidget as ComponentType<WidgetProps>,
    block_trade: BlockTradeWidget as ComponentType<WidgetProps>,
    market_heatmap: MarketHeatmapWidget as ComponentType<WidgetProps>,
    orderbook: OrderbookWidget as ComponentType<WidgetProps>,
    database_inspector: DatabaseInspectorWidget as ComponentType<WidgetProps>,
    database_browser: DatabaseBrowserWidget as ComponentType<WidgetProps>,
};


// Default layouts for each widget type - ENLARGED for better visibility
export const defaultWidgetLayouts: Record<WidgetType, { w: number; h: number; minW?: number; minH?: number }> = {
    ticker_info: { w: 4, h: 5, minW: 3, minH: 4 },
    valuation_multiples: { w: 4, h: 6, minW: 3, minH: 5 },
    ticker_profile: { w: 4, h: 6, minW: 3, minH: 5 },

    price_chart: { w: 8, h: 8, minW: 6, minH: 6 },
    key_metrics: { w: 4, h: 10, minW: 3, minH: 8 },
    share_statistics: { w: 4, h: 7, minW: 3, minH: 5 },
    screener: { w: 12, h: 10, minW: 8, minH: 8 },
    company_profile: { w: 5, h: 6, minW: 4, minH: 5 },
    financials: { w: 5, h: 7, minW: 4, minH: 5 },
    earnings_history: { w: 7, h: 7, minW: 5, minH: 5 },
    dividend_payment: { w: 7, h: 7, minW: 5, minH: 5 },
    stock_splits: { w: 7, h: 5, minW: 4, minH: 4 },
    company_filings: { w: 7, h: 7, minW: 5, minH: 5 },
    insider_trading: { w: 7, h: 7, minW: 5, minH: 5 },
    institutional_ownership: { w: 7, h: 7, minW: 5, minH: 5 },
    analyst_estimates: { w: 7, h: 7, minW: 5, minH: 5 },
    news_feed: { w: 5, h: 7, minW: 4, minH: 5 },
    events_calendar: { w: 5, h: 7, minW: 4, minH: 5 },
    major_shareholders: { w: 5, h: 7, minW: 4, minH: 5 },
    officers_management: { w: 5, h: 7, minW: 4, minH: 5 },
    intraday_trades: { w: 5, h: 7, minW: 4, minH: 5 },
    financial_ratios: { w: 7, h: 7, minW: 5, minH: 5 },
    foreign_trading: { w: 5, h: 7, minW: 4, minH: 5 },
    subsidiaries: { w: 5, h: 6, minW: 4, minH: 5 },
    balance_sheet: { w: 7, h: 7, minW: 5, minH: 5 },
    income_statement: { w: 7, h: 7, minW: 5, minH: 5 },
    cash_flow: { w: 7, h: 7, minW: 5, minH: 5 },
    market_overview: { w: 5, h: 7, minW: 4, minH: 5 },
    watchlist: { w: 4, h: 7, minW: 3, minH: 5 },
    peer_comparison: { w: 8, h: 6, minW: 6, minH: 5 },
    top_movers: { w: 5, h: 7, minW: 4, minH: 5 },
    world_indices: { w: 5, h: 7, minW: 4, minH: 5 },
    sector_performance: { w: 5, h: 7, minW: 4, minH: 5 },
    portfolio_tracker: { w: 6, h: 8, minW: 4, minH: 6 },
    price_alerts: { w: 4, h: 7, minW: 3, minH: 5 },
    economic_calendar: { w: 5, h: 7, minW: 4, minH: 5 },
    volume_analysis: { w: 5, h: 7, minW: 4, minH: 5 },
    technical_summary: { w: 5, h: 7, minW: 4, minH: 5 },
    forex_rates: { w: 5, h: 7, minW: 4, minH: 5 },
    commodities: { w: 5, h: 7, minW: 4, minH: 5 },
    similar_stocks: { w: 4, h: 6, minW: 3, minH: 5 },
    quick_stats: { w: 5, h: 7, minW: 4, minH: 5 },
    notes: { w: 4, h: 6, minW: 3, minH: 5 },
    sector_top_movers: { w: 10, h: 7, minW: 8, minH: 6 },
    ai_copilot: { w: 5, h: 8, minW: 4, minH: 6 },
    rs_ranking: { w: 5, h: 8, minW: 4, minH: 6 },
    block_trade: { w: 6, h: 7, minW: 4, minH: 5 },
    alert_settings: { w: 4, h: 7, minW: 3, minH: 6 },
    market_heatmap: { w: 8, h: 8, minW: 6, minH: 6 },
    database_inspector: { w: 6, h: 8, minW: 4, minH: 6 },
    orderbook: { w: 4, h: 8, minW: 3, minH: 6 },
    index_comparison: { w: 4, h: 4, minW: 3, minH: 3 },
    market_news: { w: 4, h: 6, minW: 3, minH: 4 },
    sector_breakdown: { w: 4, h: 6, minW: 3, minH: 4 },
    comparison_analysis: { w: 8, h: 10, minW: 6, minH: 8 },
    news_flow: { w: 4, h: 8, minW: 3, minH: 6 },
    ai_analysis: { w: 6, h: 10, minW: 4, minH: 8 },
    unified_financials: { w: 8, h: 10, minW: 6, minH: 8 },
    database_browser: { w: 6, h: 8, minW: 4, minH: 6 },
};


// Widget display names
export const widgetNames: Record<WidgetType, string> = {
    ticker_info: 'Ticker Info',
    valuation_multiples: 'Valuation Multiples',
    ticker_profile: 'Company Profile',

    price_chart: 'Price Chart',
    key_metrics: 'Key Metrics',
    share_statistics: 'Share Statistics',
    screener: 'Stock Screener',
    company_profile: 'Company Profile',
    financials: 'Financials',
    earnings_history: 'Earnings History',
    dividend_payment: 'Dividend Payment',
    stock_splits: 'Stock Splits',
    company_filings: 'Company Filings',
    insider_trading: 'Insider Trading',
    institutional_ownership: 'Institutional Ownership',
    analyst_estimates: 'Analyst Estimates',
    news_feed: 'Company News',
    events_calendar: 'Events Calendar',
    major_shareholders: 'Major Shareholders',
    officers_management: 'Officers & Management',
    intraday_trades: 'Intraday Trades',
    financial_ratios: 'Financial Ratios',
    foreign_trading: 'Foreign Trading',
    subsidiaries: 'Subsidiaries',
    balance_sheet: 'Balance Sheet',
    income_statement: 'Income Statement',
    cash_flow: 'Cash Flow',
    market_overview: 'Market Overview',
    watchlist: 'Watchlist',
    peer_comparison: 'Peer Comparison',
    top_movers: 'Top Gainers/Losers',
    world_indices: 'World Indices',
    sector_performance: 'Sector Performance',
    portfolio_tracker: 'Portfolio Tracker',
    price_alerts: 'Price Alerts',
    economic_calendar: 'Economic Calendar',
    volume_analysis: 'Volume Analysis',
    technical_summary: 'Technical Summary',
    forex_rates: 'Forex Rates',
    commodities: 'Commodities',
    similar_stocks: 'Similar Stocks',
    quick_stats: 'Quick Stats',
    notes: 'Notes',
    sector_top_movers: 'Sector Top Movers',
    ai_copilot: 'AI Copilot',
    rs_ranking: 'RS Rankings',
    block_trade: 'Block Trade Alerts',
    alert_settings: 'Alert Settings',
    market_heatmap: 'Market Heatmap',
    database_inspector: 'Data Browser',
    orderbook: 'Order Book',
    index_comparison: 'Index Comparison',
    market_news: 'Market News',
    sector_breakdown: 'Sector Breakdown',
    comparison_analysis: 'Comparison Analysis',
    news_flow: 'News Flow',
    ai_analysis: 'AI Analysis',
    unified_financials: 'Financial Statements (Unified)',
    database_browser: 'Database Browser',
};

export const widgetDescriptions: Record<WidgetType, string> = {
    ticker_info: 'Real-time price and basic info',
    valuation_multiples: 'P/E, P/B, and P/S vs historical',
    ticker_profile: 'Detailed company description',
    price_chart: 'Professional candlestick charting',
    key_metrics: 'Summary of critical financial ratios',
    share_statistics: 'Share float and ownership data',
    screener: 'Filter stocks by 80+ criteria',
    company_profile: 'Full company background',
    financials: 'Consolidated financial reports',
    earnings_history: 'Historical earnings surprises',
    dividend_payment: 'Dividend history and yields',
    stock_splits: 'History of corporate splits',
    company_filings: 'Direct SEC/HOSE documents',
    insider_trading: 'Recent executive transactions',
    institutional_ownership: 'Major fund holdings',
    analyst_estimates: 'Forecasts and price targets',
    news_feed: 'Ticker-specific news timeline',
    events_calendar: 'Upcoming corporate events',
    major_shareholders: 'Top 10 institutional owners',
    officers_management: 'Management team biography',
    intraday_trades: 'Live tick-by-tick tape',
    financial_ratios: 'Deep dive ratio analysis',
    foreign_trading: 'Foreign inflow/outflow tracker',
    subsidiaries: 'Company organizational tree',
    balance_sheet: 'Assets, liabilities, and equity',
    income_statement: 'P&L, revenue and profits',
    cash_flow: 'Operating and free cash flow',
    market_overview: 'Vietnam market index ribbon',
    watchlist: 'Custom symbol monitoring',
    peer_comparison: 'Sector relative performance',
    top_movers: 'Gainers, losers, and volume spikes',
    world_indices: 'Global market performance',
    sector_performance: 'Industry-wide returns',
    portfolio_tracker: 'Personal holdings P&L',
    price_alerts: 'Target price notifications',
    economic_calendar: 'Macroeconomic events',
    volume_analysis: 'Historical volume distribution',
    technical_summary: 'Indicator-based signals',
    forex_rates: 'Currency exchange (VND pairs)',
    commodities: 'Gold, oil, and metals',
    similar_stocks: 'Stocks with high correlation',
    quick_stats: 'Market at a glance',
    notes: 'Symbol-specific research notes',
    sector_top_movers: 'Best stocks in each sector',
    ai_copilot: 'Natural language analysis',
    rs_ranking: 'Relative Strength Leaders',
    block_trade: 'Large order tracking',
    alert_settings: 'Notification preferences',
    market_heatmap: 'Interactive market treemap',
    database_inspector: 'Raw data explorer',
    orderbook: 'Real-time Level 2 depth',
    index_comparison: 'Major indices performance',
    market_news: 'Broad market news stream',
    sector_breakdown: 'Market cap by industry',
    comparison_analysis: 'Side-by-side fundamentals',
    news_flow: 'Unified chronological flow',
    ai_analysis: 'Automated deep-dive research',
    unified_financials: 'Balance Sheet, Income, Cash Flow with tabs',
    database_browser: 'Inspect database tables and sync status',
};


