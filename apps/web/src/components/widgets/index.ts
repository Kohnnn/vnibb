/**
 * Widget Components Index
 * 
 * Central export for all widget components
 */

// === Core Infrastructure ===
export { WidgetWrapper } from './WidgetWrapper';
export { WidgetLibrary } from './WidgetLibrary';
export { widgetRegistry } from './WidgetRegistry';

// === Sprint V18: UI Components ===
export { WidgetHeader } from './WidgetHeader';
export type { WidgetHeaderProps } from './WidgetHeader';

export {
    Skeleton,
    TableSkeleton,
    ChartSkeleton,
    CardSkeleton
} from './Skeleton';
export type { SkeletonProps, TableSkeletonProps } from './Skeleton';

export {
    WidgetErrorBoundary,
    WidgetErrorFallback,
    WidgetEmptyState,
    WidgetLoadingState
} from './ErrorBoundary';

// === Core Widgets ===
export { TickerInfoWidget } from './TickerInfoWidget';
export { PriceChartWidget } from './PriceChartWidget';
export { KeyMetricsWidget } from './KeyMetricsWidget';
export { ScreenerWidget } from './ScreenerWidget';
export { TickerProfileWidget } from './TickerProfileWidget';
export { ShareStatisticsWidget } from './ShareStatisticsWidget';
export { EarningsHistoryWidget } from './EarningsHistoryWidget';
export { DividendPaymentWidget } from './DividendPaymentWidget';
export { CompanyFilingsWidget } from './CompanyFilingsWidget';
export { StockSplitsWidget } from './StockSplitsWidget';
export { MarketOverviewWidget } from './MarketOverviewWidget';

// === Additional Widgets ===
export { BalanceSheetWidget } from './BalanceSheetWidget';
export { CashFlowWidget } from './CashFlowWidget';
export { IncomeStatementWidget } from './IncomeStatementWidget';
export { FinancialRatiosWidget } from './FinancialRatiosWidget';
export { FinancialStatementsWidget } from './FinancialStatementsWidget';
export { FinancialsWidget } from './FinancialsWidget';
export { ForeignTradingWidget } from './ForeignTradingWidget';
export { MajorShareholdersWidget } from './MajorShareholdersWidget';
export { OfficersManagementWidget } from './OfficersManagementWidget';
export { SubsidiariesWidget } from './SubsidiariesWidget';
export { IntradayTradesWidget } from './IntradayTradesWidget';

// === Market Widgets ===
export { MarketNewsWidget } from './MarketNewsWidget';
export { MarketHeatmapWidget } from './MarketHeatmapWidget';
export { NewsFeedWidget } from './NewsFeedWidget';
export { NewsFlowWidget } from './NewsFlowWidget';
export { SectorPerformanceWidget } from './SectorPerformanceWidget';
export { SectorTopMoversWidget } from './SectorTopMoversWidget';
export { SectorBreakdownWidget } from './SectorBreakdownWidget';
export { IndexComparisonWidget } from './IndexComparisonWidget';
export { EconomicCalendarWidget } from './EconomicCalendarWidget';
export { EventsCalendarWidget } from './EventsCalendarWidget';

// === Analysis Widgets ===
export { ComparisonWidget } from './ComparisonWidget';
export { ComparisonAnalysisWidget } from './ComparisonAnalysisWidget';
export { PeerComparisonWidget } from './PeerComparisonWidget';
export { SimilarStocksWidget } from './SimilarStocksWidget';
export { RSRankingWidget } from './RSRankingWidget';
export { InsiderTradingWidget } from './InsiderTradingWidget';
export { BlockTradeWidget } from './BlockTradeWidget';

// === Trading Widgets ===
export { OrderbookWidget } from './OrderbookWidget';
export { PriceAlertsWidget } from './PriceAlertsWidget';
export { PortfolioTrackerWidget } from './PortfolioTrackerWidget';
export { WatchlistWidget } from './WatchlistWidget';

// === AI Widgets ===
export { AIAnalysisWidget } from './AIAnalysisWidget';
export { AICopilotWidget } from './AICopilotWidget';

// === Utility Widgets ===
export { NotesWidget } from './NotesWidget';
export { QuickStatsWidget } from './QuickStatsWidget';
export { DatabaseBrowserWidget } from './DatabaseBrowserWidget';
export { DatabaseInspectorWidget } from './DatabaseInspectorWidget';

// === Market Overview ===
export { CommoditiesWidget } from './CommoditiesWidget';
export { ForexRatesWidget } from './ForexRatesWidget';

// === Import Styles ===
import './WidgetHeader.css';
import './Skeleton.css';
import './ErrorBoundary.css';
