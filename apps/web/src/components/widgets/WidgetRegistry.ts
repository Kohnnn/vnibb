// Widget Registry - maps widget types to components

import type { WidgetConfig, WidgetType } from '@/types/dashboard';
import type { WidgetGroupId } from '@/types/widget';
import { TickerInfoWidget } from './TickerInfoWidget';
import { TickerProfileWidget } from './TickerProfileWidget';
import { KeyMetricsWidget } from './KeyMetricsWidget';
import { ShareStatisticsWidget } from './ShareStatisticsWidget';
import { EarningsHistoryWidget } from './EarningsHistoryWidget';
import { EarningsReleaseRecapWidget } from './EarningsReleaseRecapWidget';
import { EarningsSeasonMonitorWidget } from './EarningsSeasonMonitorWidget';
import { DerivativesContractsBoardWidget } from './DerivativesContractsBoardWidget';
import { DerivativesPriceHistoryWidget } from './DerivativesPriceHistoryWidget';
import { DividendPaymentWidget } from './DividendPaymentWidget';
import { ValuationWidget } from './ValuationWidget';
import { ValuationMultiplesChartWidget } from './ValuationMultiplesChartWidget';
import { ValuationBandWidget } from './ValuationBandWidget';
import { StockSplitsWidget } from './StockSplitsWidget';

import { CompanyFilingsWidget } from './CompanyFilingsWidget';
import { EventsCalendarWidget } from './EventsCalendarWidget';
import { AnalystEstimatesWidget } from './AnalystEstimatesWidget';
import { MajorShareholdersWidget } from './MajorShareholdersWidget';
import { OfficersManagementWidget } from './OfficersManagementWidget';
import { IntradayTradesWidget } from './IntradayTradesWidget';
import { FinancialRatiosWidget } from './FinancialRatiosWidget';
import { FinancialSnapshotWidget } from './FinancialSnapshotWidget';
import { BankMetricsWidget } from './BankMetricsWidget';
import { TransactionFlowWidget } from './TransactionFlowWidget';
import { MoneyFlowTrendWidget } from './MoneyFlowTrendWidget';
import { CorrelationMatrixWidget } from './CorrelationMatrixWidget';
import { ForeignTradingWidget } from './ForeignTradingWidget';
import { SubsidiariesWidget } from './SubsidiariesWidget';
import { BalanceSheetWidget } from './BalanceSheetWidget';
import { IncomeStatementWidget } from './IncomeStatementWidget';
import { CashFlowWidget } from './CashFlowWidget';
import { IncomeSankeyWidget } from './IncomeSankeyWidget';
import { CashflowWaterfallWidget } from './CashflowWaterfallWidget';
import { MarketOverviewWidget } from './MarketOverviewWidget';
import { WatchlistWidget } from './WatchlistWidget';
import { AICopilotWidget } from './AICopilotWidget';
import { TopMoversWidget } from './TopMoversWidget';
import { WorldIndicesWidget } from './WorldIndicesWidget';
import { SectorPerformanceWidget } from './SectorPerformanceWidget';
import { EconomicCalendarWidget } from './EconomicCalendarWidget';
import { VolumeAnalysisWidget } from './VolumeAnalysisWidget';
import { VolumeProfileWidget } from './VolumeProfileWidget';
import { OBVDivergenceWidget } from './OBVDivergenceWidget';
import { ATRRegimeWidget } from './ATRRegimeWidget';
import { GapFillStatsWidget } from './GapFillStatsWidget';
import { VolumeDeltaWidget } from './VolumeDeltaWidget';
import { VWAPBandsWidget } from './VWAPBandsWidget';
import { FootprintProxyWidget } from './FootprintProxyWidget';
import { AmihudIlliquidityWidget } from './AmihudIlliquidityWidget';
import { DrawdownDeepDiveWidget } from './DrawdownDeepDiveWidget';
import { HurstMarketStructureWidget } from './HurstMarketStructureWidget';
import { SeasonalityHeatmapWidget } from './SeasonalityHeatmapWidget';
import { SeasonalitySpiralHeatmapWidget } from './SeasonalitySpiralHeatmapWidget';
import { TechnicalSummaryWidget } from './TechnicalSummaryWidget';
import { ForexRatesWidget } from './ForexRatesWidget';
import { CommoditiesWidget } from './CommoditiesWidget';
import { SimilarStocksWidget } from './SimilarStocksWidget';
import { ListingBrowserWidget } from './ListingBrowserWidget';
import { QuickStatsWidget } from './QuickStatsWidget';
import { NotesWidget } from './NotesWidget';
import { SectorTopMoversWidget } from './SectorTopMoversWidget';
import { RSRankingWidget } from './RSRankingWidget';
import { InsiderTradingWidget } from './InsiderTradingWidget';
import { BlockTradeWidget } from './BlockTradeWidget';
import { AlertSettingsPanel } from './AlertSettingsPanel';
import { DatabaseInspectorWidget } from './DatabaseInspectorWidget';
import { OrderbookWidget } from './OrderbookWidget';
import { IndexComparisonWidget } from './IndexComparisonWidget';
import { MarketNewsWidget } from './MarketNewsWidget';
import { WorldNewsLiveStreamWidget } from './WorldNewsLiveStreamWidget';
import { WorldNewsMapWidget } from './WorldNewsMapWidget';
import { WorldNewsMonitorWidget } from './WorldNewsMonitorWidget';
import { WorldNewsSourcesWidget } from './WorldNewsSourcesWidget';
import { SectorBreakdownWidget } from './SectorBreakdownWidget';
import { MarketMoversSectorsWidget } from './MarketMoversSectorsWidget';
import { NewsFlowWidget } from './NewsFlowWidget';
import { AIAnalysisWidget } from './AIAnalysisWidget';
import { NewsCorporateActionsWidget } from './NewsCorporateActionsWidget';
import { DividendLadderWidget } from './DividendLadderWidget';
import { InsiderDealTimelineWidget } from './InsiderDealTimelineWidget';
import { SectorRotationRadarWidget } from './SectorRotationRadarWidget';
import { MarketBreadthWidget } from './MarketBreadthWidget';
import { TechnicalSnapshotWidget } from './TechnicalSnapshotWidget';
import { SignalSummaryWidget } from './SignalSummaryWidget';
import { IchimokuWidget } from './IchimokuWidget';
import { FibonacciWidget } from './FibonacciWidget';
import { OwnershipChangesWidget } from './OwnershipChangesWidget';
import { VolumeFlowWidget } from './VolumeFlowWidget';
import { RSISeasonalWidget } from './RSISeasonalWidget';
import { BollingerSqueezeWidget } from './BollingerSqueezeWidget';
import { SortinoMonthlyWidget } from './SortinoMonthlyWidget';
import { GapAnalysisWidget } from './GapAnalysisWidget';
import { MACDCrossoverWidget } from './MACDCrossoverWidget';
import { ParkinsonVolatilityWidget } from './ParkinsonVolatilityWidget';
import { EMARespectWidget } from './EMARespectWidget';
import { DrawdownRecoveryWidget } from './DrawdownRecoveryWidget';
import { GammaExposureWidget } from './GammaExposureWidget';
import { MomentumWidget } from './MomentumWidget';
import { EarningsQualityWidget } from './EarningsQualityWidget';
import { SmartMoneyWidget } from './SmartMoneyWidget';
import { RelativeRotationWidget } from './RelativeRotationWidget';
import { RiskDashboardWidget } from './RiskDashboardWidget';
import { QuantSummaryWidget } from './QuantSummaryWidget';
import { MarketSentimentWidget } from './MarketSentimentWidget';
import { TTMSnapshotWidget } from './TTMSnapshotWidget';
import { GrowthBridgeWidget } from './GrowthBridgeWidget';
import { OwnershipRatingSummaryWidget } from './OwnershipRatingSummaryWidget';
import { DerivativesAnalyticsWidget } from './DerivativesAnalyticsWidget';
import {
    tradingViewWidgetDescriptions,
    tradingViewWidgetNames,
} from '@/lib/tradingViewWidgets';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import type { DynamicOptionsLoadingProps } from 'next/dynamic';
import { createElement, type ComponentType } from 'react';
import dynamic from 'next/dynamic';

export interface WidgetProps {
    id: string;
    symbol?: string;
    config?: WidgetConfig;
    initialSymbols?: string[];
    onSymbolClick?: (symbol: string) => void;
    hideHeader?: boolean;
    onRemove?: () => void;
    widgetGroup?: WidgetGroupId;
}

const DynamicWidgetLoading: (loadingProps: DynamicOptionsLoadingProps) => React.ReactNode = () => {
    return createElement(WidgetSkeleton, { lines: 6 }) as unknown as React.ReactNode;
}

const DynamicChartWidgetLoading: (loadingProps: DynamicOptionsLoadingProps) => React.ReactNode = () => {
    return createElement(WidgetSkeleton, { variant: 'chart' }) as unknown as React.ReactNode;
}

function createTradingViewDynamicWidget(exportName: string): ComponentType<WidgetProps> {
    return dynamic(
        () => import('./TradingViewNativeWidgets').then((module) => module[exportName as keyof typeof module] as any),
        {
            ssr: false,
            loading: DynamicChartWidgetLoading,
        }
    ) as ComponentType<WidgetProps>;
}

const PriceChartWidget = dynamic(
    () => import('./PriceChartWidget').then((m) => m.PriceChartWidget as any),
    {
        ssr: false,
        loading: DynamicChartWidgetLoading,
    }
) as ComponentType<WidgetProps>;

const TradingViewChartWidget = createTradingViewDynamicWidget('TradingViewChartWidget');
const TradingViewSymbolOverviewWidget = createTradingViewDynamicWidget('TradingViewSymbolOverviewWidget');
const TradingViewMiniChartWidget = createTradingViewDynamicWidget('TradingViewMiniChartWidget');
const TradingViewMarketSummaryWidget = createTradingViewDynamicWidget('TradingViewMarketSummaryWidget');
const TradingViewMarketOverviewWidget = createTradingViewDynamicWidget('TradingViewMarketOverviewWidget');
const TradingViewStockMarketWidget = createTradingViewDynamicWidget('TradingViewStockMarketWidget');
const TradingViewMarketDataWidget = createTradingViewDynamicWidget('TradingViewMarketDataWidget');
const TradingViewTickerTapeWidget = createTradingViewDynamicWidget('TradingViewTickerTapeWidget');
const TradingViewTickerTagWidget = createTradingViewDynamicWidget('TradingViewTickerTagWidget');
const TradingViewSingleTickerWidget = createTradingViewDynamicWidget('TradingViewSingleTickerWidget');
const TradingViewTickerWidget = createTradingViewDynamicWidget('TradingViewTickerWidget');
const TradingViewStockHeatmapWidget = createTradingViewDynamicWidget('TradingViewStockHeatmapWidget');
const TradingViewCryptoHeatmapWidget = createTradingViewDynamicWidget('TradingViewCryptoHeatmapWidget');
const TradingViewForexCrossRatesWidget = createTradingViewDynamicWidget('TradingViewForexCrossRatesWidget');
const TradingViewEtfHeatmapWidget = createTradingViewDynamicWidget('TradingViewEtfHeatmapWidget');
const TradingViewForexHeatmapWidget = createTradingViewDynamicWidget('TradingViewForexHeatmapWidget');
const TradingViewScreenerWidget = createTradingViewDynamicWidget('TradingViewScreenerWidget');
const TradingViewCryptoMarketWidget = createTradingViewDynamicWidget('TradingViewCryptoMarketWidget');
const TradingViewSymbolInfoWidget = createTradingViewDynamicWidget('TradingViewSymbolInfoWidget');
const TradingViewTechnicalAnalysisWidget = createTradingViewDynamicWidget('TradingViewTechnicalAnalysisWidget');
const TradingViewFundamentalDataWidget = createTradingViewDynamicWidget('TradingViewFundamentalDataWidget');
const TradingViewCompanyProfileWidget = createTradingViewDynamicWidget('TradingViewCompanyProfileWidget');
const TradingViewTopStoriesWidget = createTradingViewDynamicWidget('TradingViewTopStoriesWidget');
const TradingViewEconomicCalendarWidget = createTradingViewDynamicWidget('TradingViewEconomicCalendarWidget');
const TradingViewEconomicMapWidget = createTradingViewDynamicWidget('TradingViewEconomicMapWidget');

const FinancialsWidget = dynamic(
    () => import('./FinancialsWidget').then((m) => m.FinancialsWidget as any),
    {
        ssr: false,
        loading: DynamicWidgetLoading,
    }
) as ComponentType<WidgetProps>;

const ComparisonAnalysisWidget = dynamic(
    () => import('./ComparisonAnalysisWidget').then((m) => m.ComparisonAnalysisWidget as any),
    {
        ssr: false,
        loading: DynamicWidgetLoading,
    }
) as ComponentType<WidgetProps>;

const ResearchBrowserWidget = dynamic(() => import('./ResearchBrowserWidget'), {
    ssr: false,
    loading: DynamicWidgetLoading,
}) as ComponentType<WidgetProps>;

const ScreenerWidget = dynamic(
    () => import('./ScreenerWidget').then((m) => m.ScreenerWidget as any),
    {
        ssr: false,
        loading: DynamicWidgetLoading,
    }
) as ComponentType<WidgetProps>;

const NewsFeedWidget = dynamic(
    () => import('./NewsFeedWidget').then((m) => m.NewsFeedWidget as any),
    {
        ssr: false,
        loading: DynamicWidgetLoading,
    }
) as ComponentType<WidgetProps>;

const IndustryBubbleWidget = dynamic(
    () => import('./IndustryBubbleWidget').then((m) => m.IndustryBubbleWidget as any),
    {
        ssr: false,
        loading: DynamicChartWidgetLoading,
    }
) as ComponentType<WidgetProps>;

const SectorBoardWidget = dynamic(
    () => import('./SectorBoardWidget').then((m) => m.SectorBoardWidget as any),
    {
        ssr: false,
        loading: DynamicWidgetLoading,
    }
) as ComponentType<WidgetProps>;

const PeerComparisonWidget = dynamic(
    () => import('./PeerComparisonWidget').then((m) => m.PeerComparisonWidget as any),
    {
        ssr: false,
        loading: DynamicWidgetLoading,
    }
) as ComponentType<WidgetProps>;

const PortfolioTrackerWidget = dynamic(
    () => import('./PortfolioTrackerWidget').then((m) => m.PortfolioTrackerWidget as any),
    {
        ssr: false,
        loading: DynamicWidgetLoading,
    }
) as ComponentType<WidgetProps>;

const PriceAlertsWidget = dynamic(
    () => import('./PriceAlertsWidget').then((m) => m.PriceAlertsWidget as any),
    {
        ssr: false,
        loading: DynamicWidgetLoading,
    }
) as ComponentType<WidgetProps>;

const MarketHeatmapWidget = dynamic(
    () => import('./MarketHeatmapWidget').then((m) => m.MarketHeatmapWidget as any),
    {
        ssr: false,
        loading: DynamicChartWidgetLoading,
    }
) as ComponentType<WidgetProps>;

// Main widget registry
export const widgetRegistry: Record<WidgetType, ComponentType<WidgetProps>> = {
    // Core widgets
    ticker_info: TickerInfoWidget as ComponentType<WidgetProps>,
    ticker_profile: TickerProfileWidget as ComponentType<WidgetProps>,
    price_chart: PriceChartWidget as ComponentType<WidgetProps>,
    tradingview_chart: TradingViewChartWidget as ComponentType<WidgetProps>,
    tradingview_symbol_overview: TradingViewSymbolOverviewWidget as ComponentType<WidgetProps>,
    tradingview_mini_chart: TradingViewMiniChartWidget as ComponentType<WidgetProps>,
    tradingview_market_summary: TradingViewMarketSummaryWidget as ComponentType<WidgetProps>,
    tradingview_market_overview: TradingViewMarketOverviewWidget as ComponentType<WidgetProps>,
    tradingview_stock_market: TradingViewStockMarketWidget as ComponentType<WidgetProps>,
    tradingview_market_data: TradingViewMarketDataWidget as ComponentType<WidgetProps>,
    tradingview_ticker_tape: TradingViewTickerTapeWidget as ComponentType<WidgetProps>,
    tradingview_ticker_tag: TradingViewTickerTagWidget as ComponentType<WidgetProps>,
    tradingview_single_ticker: TradingViewSingleTickerWidget as ComponentType<WidgetProps>,
    tradingview_ticker: TradingViewTickerWidget as ComponentType<WidgetProps>,
    tradingview_stock_heatmap: TradingViewStockHeatmapWidget as ComponentType<WidgetProps>,
    tradingview_crypto_heatmap: TradingViewCryptoHeatmapWidget as ComponentType<WidgetProps>,
    tradingview_forex_cross_rates: TradingViewForexCrossRatesWidget as ComponentType<WidgetProps>,
    tradingview_etf_heatmap: TradingViewEtfHeatmapWidget as ComponentType<WidgetProps>,
    tradingview_forex_heatmap: TradingViewForexHeatmapWidget as ComponentType<WidgetProps>,
    tradingview_screener: TradingViewScreenerWidget as ComponentType<WidgetProps>,
    tradingview_crypto_market: TradingViewCryptoMarketWidget as ComponentType<WidgetProps>,
    tradingview_symbol_info: TradingViewSymbolInfoWidget as ComponentType<WidgetProps>,
    tradingview_technical_analysis: TradingViewTechnicalAnalysisWidget as ComponentType<WidgetProps>,
    tradingview_fundamental_data: TradingViewFundamentalDataWidget as ComponentType<WidgetProps>,
    tradingview_company_profile: TradingViewCompanyProfileWidget as ComponentType<WidgetProps>,
    tradingview_top_stories: TradingViewTopStoriesWidget as ComponentType<WidgetProps>,
    tradingview_economic_calendar: TradingViewEconomicCalendarWidget as ComponentType<WidgetProps>,
    tradingview_economic_map: TradingViewEconomicMapWidget as ComponentType<WidgetProps>,
    key_metrics: KeyMetricsWidget as ComponentType<WidgetProps>,
    share_statistics: ShareStatisticsWidget as ComponentType<WidgetProps>,
    screener: ScreenerWidget as ComponentType<WidgetProps>,
    earnings_history: EarningsHistoryWidget as ComponentType<WidgetProps>,
    earnings_release_recap: EarningsReleaseRecapWidget as ComponentType<WidgetProps>,
    earnings_season_monitor: EarningsSeasonMonitorWidget as ComponentType<WidgetProps>,
    derivatives_contracts_board: DerivativesContractsBoardWidget as ComponentType<WidgetProps>,
    derivatives_price_history: DerivativesPriceHistoryWidget as ComponentType<WidgetProps>,
    dividend_payment: DividendPaymentWidget as ComponentType<WidgetProps>,
    valuation_multiples: ValuationWidget as ComponentType<WidgetProps>,
    valuation_multiples_chart: ValuationMultiplesChartWidget as ComponentType<WidgetProps>,
    valuation_band: ValuationBandWidget as ComponentType<WidgetProps>,
    stock_splits: StockSplitsWidget as ComponentType<WidgetProps>,

    // Financial widgets
    unified_financials: FinancialsWidget as ComponentType<WidgetProps>,
    financial_snapshot: FinancialSnapshotWidget as ComponentType<WidgetProps>,
    income_statement: IncomeStatementWidget as ComponentType<WidgetProps>,
    balance_sheet: BalanceSheetWidget as ComponentType<WidgetProps>,
    cash_flow: CashFlowWidget as ComponentType<WidgetProps>,
    income_sankey: IncomeSankeyWidget as ComponentType<WidgetProps>,
    cashflow_waterfall: CashflowWaterfallWidget as ComponentType<WidgetProps>,
    financial_ratios: FinancialRatiosWidget as ComponentType<WidgetProps>,
    bank_metrics: BankMetricsWidget as ComponentType<WidgetProps>,
    transaction_flow: TransactionFlowWidget as ComponentType<WidgetProps>,
    industry_bubble: IndustryBubbleWidget as ComponentType<WidgetProps>,
    sector_board: SectorBoardWidget as ComponentType<WidgetProps>,
    money_flow_trend: MoneyFlowTrendWidget as ComponentType<WidgetProps>,
    correlation_matrix: CorrelationMatrixWidget as ComponentType<WidgetProps>,

    // Company info widgets
    company_filings: CompanyFilingsWidget as ComponentType<WidgetProps>,
    major_shareholders: MajorShareholdersWidget as ComponentType<WidgetProps>,
    analyst_estimates: AnalystEstimatesWidget as ComponentType<WidgetProps>,
    officers_management: OfficersManagementWidget as ComponentType<WidgetProps>,
    subsidiaries: SubsidiariesWidget as ComponentType<WidgetProps>,

    // Market & Trading widgets
    intraday_trades: IntradayTradesWidget as ComponentType<WidgetProps>,
    foreign_trading: ForeignTradingWidget as ComponentType<WidgetProps>,
    market_overview: MarketOverviewWidget as ComponentType<WidgetProps>,
    watchlist: WatchlistWidget as ComponentType<WidgetProps>,

    // Comparison & Analysis widgets
    peer_comparison: PeerComparisonWidget as ComponentType<WidgetProps>,
    comparison_analysis: ComparisonAnalysisWidget as ComponentType<WidgetProps>,
    index_comparison: IndexComparisonWidget as ComponentType<WidgetProps>,

    // News & Events widgets
    news_feed: NewsFeedWidget as ComponentType<WidgetProps>,
    market_news: MarketNewsWidget as ComponentType<WidgetProps>,
    world_news_monitor: WorldNewsMonitorWidget as ComponentType<WidgetProps>,
    world_news_map: WorldNewsMapWidget as ComponentType<WidgetProps>,
    world_news_live_stream: WorldNewsLiveStreamWidget as ComponentType<WidgetProps>,
    world_news_sources: WorldNewsSourcesWidget as ComponentType<WidgetProps>,
    news_flow: NewsFlowWidget as ComponentType<WidgetProps>,
    news_corporate_actions: NewsCorporateActionsWidget as ComponentType<WidgetProps>,
    dividend_ladder: DividendLadderWidget as ComponentType<WidgetProps>,
    events_calendar: EventsCalendarWidget as ComponentType<WidgetProps>,

    // Special widgets
    ai_copilot: AICopilotWidget as ComponentType<WidgetProps>,
    ai_analysis: AIAnalysisWidget as ComponentType<WidgetProps>,
    top_movers: TopMoversWidget as ComponentType<WidgetProps>,
    sector_top_movers: SectorTopMoversWidget as ComponentType<WidgetProps>,
    world_indices: WorldIndicesWidget as ComponentType<WidgetProps>,
    sector_performance: SectorPerformanceWidget as ComponentType<WidgetProps>,
    sector_breakdown: SectorBreakdownWidget as ComponentType<WidgetProps>,
    market_movers_sectors: MarketMoversSectorsWidget as ComponentType<WidgetProps>,
    sector_rotation_radar: SectorRotationRadarWidget as ComponentType<WidgetProps>,
    market_breadth: MarketBreadthWidget as ComponentType<WidgetProps>,

    // Portfolio & Alerts
    portfolio_tracker: PortfolioTrackerWidget as ComponentType<WidgetProps>,
    price_alerts: PriceAlertsWidget as ComponentType<WidgetProps>,
    alert_settings: AlertSettingsPanel as ComponentType<WidgetProps>,

    // Analytics widgets
    volume_analysis: VolumeAnalysisWidget as ComponentType<WidgetProps>,
    volume_profile: VolumeProfileWidget as ComponentType<WidgetProps>,
    obv_divergence: OBVDivergenceWidget as ComponentType<WidgetProps>,
    atr_regime: ATRRegimeWidget as ComponentType<WidgetProps>,
    gap_fill_stats: GapFillStatsWidget as ComponentType<WidgetProps>,
    volume_delta: VolumeDeltaWidget as ComponentType<WidgetProps>,
    vwap_bands: VWAPBandsWidget as ComponentType<WidgetProps>,
    footprint_proxy: FootprintProxyWidget as ComponentType<WidgetProps>,
    amihud_illiquidity: AmihudIlliquidityWidget as ComponentType<WidgetProps>,
    drawdown_deep_dive: DrawdownDeepDiveWidget as ComponentType<WidgetProps>,
    hurst_market_structure: HurstMarketStructureWidget as ComponentType<WidgetProps>,
    seasonality_heatmap: SeasonalityHeatmapWidget as ComponentType<WidgetProps>,
    seasonality_spiral_heatmap: SeasonalitySpiralHeatmapWidget as ComponentType<WidgetProps>,
    technical_summary: TechnicalSummaryWidget as ComponentType<WidgetProps>,
    technical_snapshot: TechnicalSnapshotWidget as ComponentType<WidgetProps>,
    signal_summary: SignalSummaryWidget as ComponentType<WidgetProps>,
    ichimoku: IchimokuWidget as ComponentType<WidgetProps>,
    fibonacci: FibonacciWidget as ComponentType<WidgetProps>,
    volume_flow: VolumeFlowWidget as ComponentType<WidgetProps>,
    rsi_seasonal: RSISeasonalWidget as ComponentType<WidgetProps>,
    bollinger_squeeze: BollingerSqueezeWidget as ComponentType<WidgetProps>,
    sortino_monthly: SortinoMonthlyWidget as ComponentType<WidgetProps>,
    gap_analysis: GapAnalysisWidget as ComponentType<WidgetProps>,
    macd_crossovers: MACDCrossoverWidget as ComponentType<WidgetProps>,
    parkinson_volatility: ParkinsonVolatilityWidget as ComponentType<WidgetProps>,
    ema_respect: EMARespectWidget as ComponentType<WidgetProps>,
    drawdown_recovery: DrawdownRecoveryWidget as ComponentType<WidgetProps>,
    gamma_exposure: GammaExposureWidget as ComponentType<WidgetProps>,
    momentum: MomentumWidget as ComponentType<WidgetProps>,
    earnings_quality: EarningsQualityWidget as ComponentType<WidgetProps>,
    smart_money: SmartMoneyWidget as ComponentType<WidgetProps>,
    relative_rotation: RelativeRotationWidget as ComponentType<WidgetProps>,
    risk_dashboard: RiskDashboardWidget as ComponentType<WidgetProps>,
    quant_summary: QuantSummaryWidget as ComponentType<WidgetProps>,
    market_sentiment: MarketSentimentWidget as ComponentType<WidgetProps>,
    ttm_snapshot: TTMSnapshotWidget as ComponentType<WidgetProps>,
    growth_bridge: GrowthBridgeWidget as ComponentType<WidgetProps>,
    ownership_rating_summary: OwnershipRatingSummaryWidget as ComponentType<WidgetProps>,
    derivatives_analytics: DerivativesAnalyticsWidget as ComponentType<WidgetProps>,
    similar_stocks: SimilarStocksWidget as ComponentType<WidgetProps>,
    listing_browser: ListingBrowserWidget as ComponentType<WidgetProps>,
    quick_stats: QuickStatsWidget as ComponentType<WidgetProps>,

    // Reference widgets
    economic_calendar: EconomicCalendarWidget as ComponentType<WidgetProps>,
    forex_rates: ForexRatesWidget as ComponentType<WidgetProps>,
    commodities: CommoditiesWidget as ComponentType<WidgetProps>,

    // Additional widgets
    notes: NotesWidget as ComponentType<WidgetProps>,
    research_browser: ResearchBrowserWidget as ComponentType<WidgetProps>,
    rs_ranking: RSRankingWidget as ComponentType<WidgetProps>,
    insider_trading: InsiderTradingWidget as ComponentType<WidgetProps>,
    insider_deal_timeline: InsiderDealTimelineWidget as ComponentType<WidgetProps>,
    block_trade: BlockTradeWidget as ComponentType<WidgetProps>,
    ownership_changes: OwnershipChangesWidget as ComponentType<WidgetProps>,
    market_heatmap: MarketHeatmapWidget as ComponentType<WidgetProps>,
    orderbook: OrderbookWidget as ComponentType<WidgetProps>,
    database_inspector: DatabaseInspectorWidget as ComponentType<WidgetProps>,
};



// Widget display names
export const widgetNames: Record<WidgetType, string> = {
    ticker_info: 'Ticker Info',
    valuation_multiples: 'Valuation Multiples',
    valuation_multiples_chart: 'Valuation Multiples Chart',
    valuation_band: 'Valuation Band',
    ticker_profile: 'Company Profile',

    price_chart: 'Price Chart',
    ...tradingViewWidgetNames,
    key_metrics: 'Key Metrics',
    share_statistics: 'Share Statistics',
    screener: 'VNIBB Screener Pro',
    earnings_history: 'Earnings History',
    earnings_release_recap: 'Earnings Release Recap',
    earnings_season_monitor: 'Earnings Season Monitor',
    derivatives_contracts_board: 'Derivatives Contracts',
    derivatives_price_history: 'Derivatives Price History',
    dividend_payment: 'Dividend Payment',
    stock_splits: 'Stock Splits',
    company_filings: 'Company Filings',
    insider_trading: 'Insider Trading',
    analyst_estimates: 'Analyst Estimates',
    news_feed: 'Company News',
    events_calendar: 'Events Calendar',
    major_shareholders: 'Major Shareholders',
    officers_management: 'Officers & Management',
    intraday_trades: 'Intraday Trades',
    financial_ratios: 'Financial Ratios',
    financial_snapshot: 'Financial Snapshot',
    bank_metrics: 'Bank Analytics',
    transaction_flow: 'Transaction Flow',
    industry_bubble: 'Industry Bubble',
    sector_board: 'Sector Board',
    money_flow_trend: 'Money Flow Trend',
    correlation_matrix: 'Correlation Matrix',
    foreign_trading: 'Foreign Trading',
    subsidiaries: 'Subsidiaries',
    balance_sheet: 'Balance Sheet',
    income_statement: 'Income Statement',
    cash_flow: 'Cash Flow',
    income_sankey: 'Income Sankey',
    cashflow_waterfall: 'Cash Flow Waterfall',
    market_overview: 'Market Overview',
    watchlist: 'Watchlist',
    peer_comparison: 'Peer Comparison',
    top_movers: 'Top Gainers/Losers',
    world_indices: 'World Indices',
    sector_performance: 'Sector Performance',
    sector_rotation_radar: 'Sector Rotation Radar',
    market_breadth: 'Market Breadth',
    portfolio_tracker: 'Portfolio Tracker',
    price_alerts: 'Price Alerts',
    economic_calendar: 'Economic Calendar',
    volume_analysis: 'Volume Analysis',
    volume_profile: 'Volume Profile',
    obv_divergence: 'OBV Divergence',
    atr_regime: 'ATR Regime',
    gap_fill_stats: 'Gap Fill Stats',
    volume_delta: 'Volume Delta',
    vwap_bands: 'VWAP Bands',
    footprint_proxy: 'Footprint Proxy',
    amihud_illiquidity: 'Amihud Illiquidity',
    drawdown_deep_dive: 'Drawdown Deep Dive',
    hurst_market_structure: 'Hurst Market Structure',
    seasonality_heatmap: 'Seasonality Heatmap',
    seasonality_spiral_heatmap: 'Daily Spiral Heatmap',
    technical_summary: 'Technical Summary',
    technical_snapshot: 'Technical Snapshot',
    signal_summary: 'Signal Summary',
    ichimoku: 'Ichimoku Cloud',
    fibonacci: 'Fibonacci Retracement',
    volume_flow: 'Volume Flow',
    rsi_seasonal: 'RSI Seasonal',
    bollinger_squeeze: 'Bollinger Squeeze',
    sortino_monthly: 'Sortino Monthly',
    gap_analysis: 'Gap Analysis',
    macd_crossovers: 'MACD Crossovers',
    parkinson_volatility: 'Parkinson Volatility',
    ema_respect: 'EMA Respect',
    drawdown_recovery: 'Drawdown Recovery',
    gamma_exposure: 'Gamma Exposure',
    momentum: 'Momentum',
    earnings_quality: 'Earnings Quality',
    smart_money: 'Smart Money',
    relative_rotation: 'Relative Rotation',
    risk_dashboard: 'Risk Dashboard',
    quant_summary: 'Quant Summary',
    market_sentiment: 'Market Sentiment',
    ttm_snapshot: 'TTM Snapshot',
    growth_bridge: 'Growth Bridge',
    ownership_rating_summary: 'Ownership Rating Summary',
    derivatives_analytics: 'Derivatives Analytics',
    forex_rates: 'Forex Rates',
    commodities: 'Commodities',
    similar_stocks: 'Similar Stocks',
    listing_browser: 'Listing Browser',
    quick_stats: 'Quick Stats',
    notes: 'Notes',
    research_browser: 'External Intelligence Hub',
    sector_top_movers: 'Sector Top Movers',
    dividend_ladder: 'Dividend Ladder',
    ai_copilot: 'AI Copilot',
    rs_ranking: 'RS Rankings',
    insider_deal_timeline: 'Insider Deal Timeline',
    block_trade: 'Block Trade Alerts',
    ownership_changes: 'Ownership Changes',
    alert_settings: 'Alert Settings',
    market_heatmap: 'Market Heatmap',
    database_inspector: 'Data Browser',
    orderbook: 'Order Book',
    index_comparison: 'Index Comparison',
    market_news: 'Market News',
    world_news_monitor: 'World News Monitor',
    world_news_map: 'World News Map',
    world_news_live_stream: 'World News Live Stream',
    world_news_sources: 'World News Sources',
    sector_breakdown: 'Sector Breakdown',
    market_movers_sectors: 'Market Movers & Sectors',
    comparison_analysis: 'Comparison Analysis',
    news_flow: 'News Flow',
    news_corporate_actions: 'News + Corporate Actions',
    ai_analysis: 'AI Analysis',
    unified_financials: 'Financial Statements (Unified)',
};

export const widgetDescriptions: Record<WidgetType, string> = {
    ticker_info: 'Real-time price and basic info',
    valuation_multiples: 'P/E, P/B, and P/S vs historical',
    valuation_multiples_chart: 'Historical valuation multiples trend',
    valuation_band: 'Statistical valuation bands highlighting current multiple vs mean and sigma range',
    ticker_profile: 'Detailed company description',
    price_chart: 'Professional candlestick charting',
    ...tradingViewWidgetDescriptions,
    key_metrics: 'Summary of critical financial ratios',
    share_statistics: 'Share float and ownership data',
    screener: 'Native backend-powered Vietnam stock screener and saved scans',
    earnings_history: 'Latest-first quarterly revenue, earnings, and margin history',
    earnings_release_recap: 'Quarter bridge with YoY deltas, cash context, quality checks, and linked news',
    earnings_season_monitor: 'Latest quarterly releases with quick revenue, earnings, and margin cross-checks',
    derivatives_contracts_board: 'Available futures contracts with expiry schedule and quick filtering',
    derivatives_price_history: 'Historical futures price chart with contract selection and basic stats',
    dividend_payment: 'Dividend history and yields',
    stock_splits: 'History of corporate splits',
    company_filings: 'Direct SEC/HOSE documents',
    insider_trading: 'Recent executive transactions',
    analyst_estimates: 'Forecasts and price targets',
    news_feed: 'Ticker-specific news timeline',
    events_calendar: 'Upcoming corporate events',
    major_shareholders: 'Top 10 institutional owners',
    officers_management: 'Management team biography',
    intraday_trades: 'Live tick-by-tick tape',
    financial_ratios: 'Deep dive ratio analysis',
    financial_snapshot: 'Compact 4-panel snapshot covering P&L, balance sheet, cash flow, and ratios',
    bank_metrics: 'Bank-specific funding, profitability, and risk analytics',
    transaction_flow: 'Daily domestic, foreign, and proprietary flow with price overlay',
    industry_bubble: 'Sector-relative bubble chart for valuation and quality metrics',
    sector_board: 'Columnar sector tape with price, change, and liquidity',
    money_flow_trend: 'RRG-style quadrant scatter showing trend and strength rotation',
    correlation_matrix: 'Sector peer return correlation heatmap',
    foreign_trading: 'Foreign inflow/outflow tracker',
    subsidiaries: 'Company organizational tree',
    balance_sheet: 'Assets, liabilities, and equity',
    income_statement: 'P&L, revenue and profits',
    cash_flow: 'Operating and free cash flow',
    income_sankey: 'Revenue-to-profit flow diagram showing how sales convert into net income',
    cashflow_waterfall: 'Waterfall bridge from operating, investing, and financing cash flow to net change',
    market_overview: 'Vietnam market index ribbon',
    watchlist: 'Custom symbol monitoring',
    peer_comparison: 'Sector relative performance',
    top_movers: 'Gainers, losers, and volume spikes',
    world_indices: 'Global market performance',
    sector_performance: 'Industry-wide returns',
    sector_rotation_radar: 'Leadership shift by sector',
    market_breadth: 'Advancers vs decliners by exchange',
    portfolio_tracker: 'Personal holdings P&L',
    price_alerts: 'Target price notifications',
    economic_calendar: 'Macroeconomic events',
    volume_analysis: 'Historical volume distribution',
    volume_profile: 'POC/VAH/VAL volume profile by price range',
    obv_divergence: 'Price and OBV divergence scanner',
    atr_regime: 'ATR volatility regime and model sizing',
    gap_fill_stats: 'Gap fill probability and fill timing',
    volume_delta: 'Buy/sell pressure proxy with cumulative delta divergence',
    vwap_bands: 'Intraday VWAP with trade-tick standard-deviation bands',
    footprint_proxy: 'Match-type proxy footprint by bar and price level',
    amihud_illiquidity: 'Price impact per traded value with rolling liquidity trend',
    drawdown_deep_dive: 'Underwater drawdown curve with depth and recovery statistics',
    hurst_market_structure: 'Hurst exponent with persistence and mean-reversion structure clues',
    seasonality_heatmap: 'Year by month/week return heatmap for seasonal structure',
    seasonality_spiral_heatmap: 'Daily return spiral from oldest center-adjacent cells to newest outer cells',
    technical_summary: 'Indicator-based signals',
    technical_snapshot: 'Daily technical indicator snapshot',
    signal_summary: 'Unified buy, sell, and hold summary distilled from technical indicators',
    ichimoku: 'Ichimoku cloud trend structure with conversion and base lines',
    fibonacci: 'Swing-based Fibonacci retracement map with nearest level context',
    volume_flow: 'Order-flow proxy from close-position weighted volume delta',
    rsi_seasonal: 'Monthly RSI profile with overbought and oversold frequencies',
    bollinger_squeeze: 'Current Bollinger width and squeeze status signal',
    sortino_monthly: 'Month-by-month downside-adjusted return profile',
    gap_analysis: 'Gap-up/down frequencies, fill rate, and largest gap events',
    macd_crossovers: 'Bullish and bearish MACD crossover history with forward returns',
    parkinson_volatility: 'High-low volatility estimator with rolling regime classification',
    ema_respect: 'EMA20/50/200 support and breakdown behavior scoring',
    drawdown_recovery: 'Rolling underwater curve and recovery-time statistics',
    gamma_exposure: 'Gamma regime proxy derived from volatility structure while options OI feed is pending',
    momentum: '1M/3M/6M/12M momentum profile with composite trend score',
    earnings_quality: 'Quality score from profitability, cash conversion, and leverage checks',
    smart_money: 'Foreign flow and block-trade bias to infer accumulation vs distribution',
    relative_rotation: 'Relative Strength rating trend and quadrant classification',
    risk_dashboard: 'Composite view of drawdown, volatility, Sortino, and Hurst-style structure risk',
    quant_summary: 'Radar view of momentum, volatility, flow, seasonality, and regime context',
    market_sentiment: 'Discovery widget for aggregate news mood, trending topics, and most-mentioned stocks',
    ttm_snapshot: 'Trailing-twelve-month pulse for revenue, profitability, cash flow, and balance-sheet scale',
    growth_bridge: 'Annual versus latest comparable-quarter growth bridge for core financial drivers',
    ownership_rating_summary: 'Synthesized ownership quality view across concentration, foreign participation, and insider bias',
    derivatives_analytics: 'Front-contract pulse and short futures curve analytics across the contract ladder',
    forex_rates: 'Currency exchange (VND pairs)',
    commodities: 'Gold, oil, and metals',
    similar_stocks: 'Stocks with high correlation',
    listing_browser: 'Exchange and industry browser for the listed universe',
    quick_stats: 'Market at a glance',
    notes: 'Symbol-specific research notes',
    research_browser: 'Curated external intelligence links by ticker',
    sector_top_movers: 'Best stocks in each sector',
    dividend_ladder: 'Upcoming dividend events',
    ai_copilot: 'Natural language analysis',
    rs_ranking: 'Relative Strength Leaders',
    insider_deal_timeline: 'Recent insider activity timeline',
    block_trade: 'Large order tracking',
    ownership_changes: 'Major shareholder snapshot',
    alert_settings: 'Notification preferences',
    market_heatmap: 'Interactive market treemap',
    database_inspector: 'Raw data explorer',
    orderbook: 'Order book depth with cached/reference pricing labels',
    index_comparison: 'Major indices performance',
    market_news: 'Broad market news stream',
    world_news_monitor: 'Live Vietnam and global RSS/Atom headlines with source and feed links',
    world_news_map: 'Geographic live-news signal map with country, source, and latest-headline drilldown',
    world_news_live_stream: 'Polling headline stream for fresh global and Vietnam market-risk signals',
    world_news_sources: 'Auditable source registry with homepage, feed, geography, tier, and filter metadata',
    sector_breakdown: 'Market cap by industry',
    market_movers_sectors: 'Sector performance with top movers',
    comparison_analysis: 'Side-by-side fundamentals',
    news_flow: 'Unified chronological flow',
    news_corporate_actions: 'Company news with dividends and insider deals',
    ai_analysis: 'Automated deep-dive research',
    unified_financials: 'Balance Sheet, Income, Cash Flow with tabs',
};
