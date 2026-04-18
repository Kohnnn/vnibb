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
import { AmihudIlliquidityWidget } from './AmihudIlliquidityWidget';
import { DrawdownDeepDiveWidget } from './DrawdownDeepDiveWidget';
import { HurstMarketStructureWidget } from './HurstMarketStructureWidget';
import { SeasonalityHeatmapWidget } from './SeasonalityHeatmapWidget';
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
    tradingViewWidgetDefaultLayouts,
    tradingViewWidgetDescriptions,
    tradingViewWidgetNames,
} from '@/lib/tradingViewWidgets';
import type { ComponentType } from 'react';
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

function createTradingViewDynamicWidget(exportName: string): ComponentType<WidgetProps> {
    return dynamic(
        () => import('./TradingViewNativeWidgets').then((module) => module[exportName as keyof typeof module] as any),
        {
            ssr: false,
            loading: () => null,
        }
    ) as ComponentType<WidgetProps>;
}

const PriceChartWidget = dynamic(
    () => import('./PriceChartWidget').then((m) => m.PriceChartWidget as any),
    {
        ssr: false,
        loading: () => null,
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
        loading: () => null,
    }
) as ComponentType<WidgetProps>;

const ComparisonAnalysisWidget = dynamic(
    () => import('./ComparisonAnalysisWidget').then((m) => m.ComparisonAnalysisWidget as any),
    {
        ssr: false,
        loading: () => null,
    }
) as ComponentType<WidgetProps>;

const ResearchBrowserWidget = dynamic(() => import('./ResearchBrowserWidget'), {
    ssr: false,
    loading: () => null,
}) as ComponentType<WidgetProps>;

const ScreenerWidget = dynamic(
    () => import('./ScreenerWidget').then((m) => m.ScreenerWidget as any),
    {
        ssr: false,
        loading: () => null,
    }
) as ComponentType<WidgetProps>;

const NewsFeedWidget = dynamic(
    () => import('./NewsFeedWidget').then((m) => m.NewsFeedWidget as any),
    {
        ssr: false,
        loading: () => null,
    }
) as ComponentType<WidgetProps>;

const IndustryBubbleWidget = dynamic(
    () => import('./IndustryBubbleWidget').then((m) => m.IndustryBubbleWidget as any),
    {
        ssr: false,
        loading: () => null,
    }
) as ComponentType<WidgetProps>;

const SectorBoardWidget = dynamic(
    () => import('./SectorBoardWidget').then((m) => m.SectorBoardWidget as any),
    {
        ssr: false,
        loading: () => null,
    }
) as ComponentType<WidgetProps>;

const PeerComparisonWidget = dynamic(
    () => import('./PeerComparisonWidget').then((m) => m.PeerComparisonWidget as any),
    {
        ssr: false,
        loading: () => null,
    }
) as ComponentType<WidgetProps>;

const ComparisonWidget = dynamic(
    () => import('./ComparisonWidget').then((m) => m.ComparisonWidget as any),
    {
        ssr: false,
        loading: () => null,
    }
) as ComponentType<WidgetProps>;

const PortfolioTrackerWidget = dynamic(
    () => import('./PortfolioTrackerWidget').then((m) => m.PortfolioTrackerWidget as any),
    {
        ssr: false,
        loading: () => null,
    }
) as ComponentType<WidgetProps>;

const PriceAlertsWidget = dynamic(
    () => import('./PriceAlertsWidget').then((m) => m.PriceAlertsWidget as any),
    {
        ssr: false,
        loading: () => null,
    }
) as ComponentType<WidgetProps>;

const MarketHeatmapWidget = dynamic(
    () => import('./MarketHeatmapWidget').then((m) => m.MarketHeatmapWidget as any),
    {
        ssr: false,
        loading: () => null,
    }
) as ComponentType<WidgetProps>;

// Main widget registry
export const widgetRegistry: Record<string, ComponentType<WidgetProps>> = {
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
    comparison_widget: ComparisonWidget as ComponentType<WidgetProps>,
    comparison_analysis: ComparisonAnalysisWidget as ComponentType<WidgetProps>,
    index_comparison: IndexComparisonWidget as ComponentType<WidgetProps>,

    // News & Events widgets
    news_feed: NewsFeedWidget as ComponentType<WidgetProps>,
    market_news: MarketNewsWidget as ComponentType<WidgetProps>,
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
    amihud_illiquidity: AmihudIlliquidityWidget as ComponentType<WidgetProps>,
    drawdown_deep_dive: DrawdownDeepDiveWidget as ComponentType<WidgetProps>,
    hurst_market_structure: HurstMarketStructureWidget as ComponentType<WidgetProps>,
    seasonality_heatmap: SeasonalityHeatmapWidget as ComponentType<WidgetProps>,
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


// Default layouts for each widget type - ENLARGED for better visibility
export const defaultWidgetLayouts: Record<WidgetType, { w: number; h: number; minW?: number; minH?: number }> = {
    ticker_info: { w: 9, h: 8, minW: 7, minH: 6 },
    valuation_multiples: { w: 4, h: 6, minW: 3, minH: 5 },
    valuation_multiples_chart: { w: 7, h: 7, minW: 5, minH: 5 },
    valuation_band: { w: 8, h: 8, minW: 6, minH: 6 },
    ticker_profile: { w: 4, h: 6, minW: 3, minH: 5 },

    price_chart: { w: 16, h: 10, minW: 10, minH: 8 },
    ...tradingViewWidgetDefaultLayouts,
    key_metrics: { w: 8, h: 11, minW: 6, minH: 8 },
    share_statistics: { w: 4, h: 7, minW: 3, minH: 5 },
    screener: { w: 12, h: 10, minW: 8, minH: 8 },
    earnings_history: { w: 7, h: 7, minW: 5, minH: 5 },
    earnings_release_recap: { w: 10, h: 8, minW: 6, minH: 6 },
    earnings_season_monitor: { w: 10, h: 8, minW: 8, minH: 6 },
    derivatives_contracts_board: { w: 8, h: 8, minW: 6, minH: 6 },
    derivatives_price_history: { w: 10, h: 8, minW: 6, minH: 6 },
    dividend_payment: { w: 7, h: 7, minW: 5, minH: 5 },
    stock_splits: { w: 7, h: 5, minW: 4, minH: 4 },
    company_filings: { w: 7, h: 7, minW: 5, minH: 5 },
    insider_trading: { w: 7, h: 6, minW: 4, minH: 4 },
    analyst_estimates: { w: 7, h: 7, minW: 5, minH: 5 },
    news_feed: { w: 5, h: 7, minW: 4, minH: 5 },
    events_calendar: { w: 5, h: 7, minW: 4, minH: 5 },
    major_shareholders: { w: 5, h: 6, minW: 4, minH: 4 },
    officers_management: { w: 5, h: 6, minW: 4, minH: 4 },
    intraday_trades: { w: 5, h: 6, minW: 4, minH: 4 },
    financial_ratios: { w: 10, h: 18, minW: 8, minH: 14 },
    financial_snapshot: { w: 24, h: 16, minW: 12, minH: 10 },
    bank_metrics: { w: 7, h: 7, minW: 5, minH: 5 },
    transaction_flow: { w: 8, h: 8, minW: 6, minH: 4 },
    industry_bubble: { w: 10, h: 12, minW: 8, minH: 9 },
    sector_board: { w: 12, h: 15, minW: 10, minH: 12 },
    money_flow_trend: { w: 14, h: 12, minW: 10, minH: 9 },
    correlation_matrix: { w: 8, h: 7, minW: 6, minH: 5 },
    foreign_trading: { w: 8, h: 7, minW: 5, minH: 4 },
    subsidiaries: { w: 5, h: 6, minW: 4, minH: 5 },
    balance_sheet: { w: 14, h: 18, minW: 10, minH: 14 },
    income_statement: { w: 14, h: 18, minW: 10, minH: 14 },
    cash_flow: { w: 10, h: 18, minW: 8, minH: 14 },
    income_sankey: { w: 10, h: 8, minW: 8, minH: 6 },
    cashflow_waterfall: { w: 10, h: 8, minW: 8, minH: 6 },
    market_overview: { w: 5, h: 7, minW: 4, minH: 5 },
    watchlist: { w: 4, h: 7, minW: 3, minH: 5 },
    peer_comparison: { w: 8, h: 6, minW: 6, minH: 5 },
    top_movers: { w: 5, h: 7, minW: 4, minH: 5 },
    world_indices: { w: 10, h: 8, minW: 8, minH: 6 },
    sector_performance: { w: 5, h: 7, minW: 4, minH: 5 },
    sector_rotation_radar: { w: 6, h: 7, minW: 4, minH: 5 },
    market_breadth: { w: 8, h: 9, minW: 6, minH: 7 },
    portfolio_tracker: { w: 6, h: 8, minW: 4, minH: 6 },
    price_alerts: { w: 4, h: 7, minW: 3, minH: 5 },
    economic_calendar: { w: 5, h: 7, minW: 4, minH: 5 },
    volume_analysis: { w: 5, h: 7, minW: 4, minH: 5 },
    volume_profile: { w: 12, h: 11, minW: 8, minH: 8 },
    obv_divergence: { w: 6, h: 7, minW: 4, minH: 5 },
    atr_regime: { w: 6, h: 7, minW: 4, minH: 5 },
    gap_fill_stats: { w: 8, h: 9, minW: 6, minH: 7 },
    volume_delta: { w: 6, h: 7, minW: 4, minH: 5 },
    amihud_illiquidity: { w: 6, h: 7, minW: 4, minH: 5 },
    drawdown_deep_dive: { w: 8, h: 7, minW: 6, minH: 5 },
    hurst_market_structure: { w: 6, h: 7, minW: 4, minH: 5 },
    seasonality_heatmap: { w: 14, h: 13, minW: 10, minH: 10 },
    technical_summary: { w: 5, h: 7, minW: 4, minH: 5 },
    technical_snapshot: { w: 5, h: 6, minW: 4, minH: 5 },
    signal_summary: { w: 24, h: 8, minW: 12, minH: 6 },
    ichimoku: { w: 12, h: 14, minW: 10, minH: 10 },
    fibonacci: { w: 12, h: 12, minW: 10, minH: 9 },
    volume_flow: { w: 8, h: 9, minW: 6, minH: 5 },
    rsi_seasonal: { w: 8, h: 12, minW: 6, minH: 9 },
    bollinger_squeeze: { w: 8, h: 12, minW: 6, minH: 9 },
    sortino_monthly: { w: 10, h: 10, minW: 7, minH: 5 },
    gap_analysis: { w: 8, h: 10, minW: 6, minH: 8 },
    macd_crossovers: { w: 8, h: 12, minW: 6, minH: 9 },
    parkinson_volatility: { w: 7, h: 7, minW: 5, minH: 5 },
    ema_respect: { w: 7, h: 7, minW: 5, minH: 5 },
    drawdown_recovery: { w: 8, h: 11, minW: 6, minH: 8 },
    gamma_exposure: { w: 6, h: 6, minW: 4, minH: 5 },
    momentum: { w: 8, h: 8, minW: 5, minH: 4 },
    earnings_quality: { w: 6, h: 6, minW: 4, minH: 5 },
    smart_money: { w: 6, h: 6, minW: 4, minH: 5 },
    relative_rotation: { w: 6, h: 6, minW: 4, minH: 5 },
    risk_dashboard: { w: 12, h: 11, minW: 8, minH: 8 },
    quant_summary: { w: 24, h: 10, minW: 10, minH: 8 },
    market_sentiment: { w: 8, h: 8, minW: 6, minH: 6 },
    ttm_snapshot: { w: 8, h: 8, minW: 6, minH: 6 },
    growth_bridge: { w: 10, h: 8, minW: 8, minH: 6 },
    ownership_rating_summary: { w: 8, h: 8, minW: 6, minH: 6 },
    derivatives_analytics: { w: 10, h: 8, minW: 8, minH: 6 },
    forex_rates: { w: 8, h: 7, minW: 6, minH: 6 },
    commodities: { w: 8, h: 6, minW: 5, minH: 4 },
    similar_stocks: { w: 4, h: 6, minW: 3, minH: 5 },
    listing_browser: { w: 8, h: 8, minW: 6, minH: 6 },
    quick_stats: { w: 6, h: 6, minW: 6, minH: 5 },
    notes: { w: 4, h: 6, minW: 3, minH: 5 },
    research_browser: { w: 8, h: 8, minW: 6, minH: 6 },
    sector_top_movers: { w: 10, h: 7, minW: 8, minH: 6 },
    dividend_ladder: { w: 5, h: 7, minW: 4, minH: 5 },
    ai_copilot: { w: 5, h: 8, minW: 4, minH: 6 },
    rs_ranking: { w: 5, h: 8, minW: 4, minH: 6 },
    insider_deal_timeline: { w: 6, h: 7, minW: 4, minH: 5 },
    block_trade: { w: 6, h: 7, minW: 4, minH: 5 },
    ownership_changes: { w: 5, h: 6, minW: 4, minH: 5 },
    alert_settings: { w: 4, h: 7, minW: 3, minH: 6 },
    market_heatmap: { w: 12, h: 15, minW: 10, minH: 12 },
    database_inspector: { w: 6, h: 8, minW: 4, minH: 6 },
    orderbook: { w: 4, h: 7, minW: 3, minH: 4 },
    index_comparison: { w: 4, h: 4, minW: 3, minH: 3 },
    market_news: { w: 14, h: 8, minW: 10, minH: 6 },
    sector_breakdown: { w: 4, h: 6, minW: 3, minH: 4 },
    market_movers_sectors: { w: 8, h: 7, minW: 6, minH: 5 },
    comparison_analysis: { w: 8, h: 10, minW: 6, minH: 8 },
    news_flow: { w: 4, h: 8, minW: 3, minH: 6 },
    news_corporate_actions: { w: 8, h: 7, minW: 6, minH: 5 },
    ai_analysis: { w: 6, h: 10, minW: 4, minH: 8 },
    unified_financials: { w: 24, h: 18, minW: 16, minH: 12 },
};

Object.assign(defaultWidgetLayouts, {
    price_chart: { w: 16, h: 10, minW: 10, minH: 8 },
    key_metrics: { w: 12, h: 8, minW: 8, minH: 6 },
    share_statistics: { w: 8, h: 8, minW: 6, minH: 6 },
    screener: { w: 16, h: 10, minW: 12, minH: 8 },
    major_shareholders: { w: 8, h: 8, minW: 6, minH: 6 },
    officers_management: { w: 8, h: 8, minW: 6, minH: 6 },
    insider_trading: { w: 8, h: 8, minW: 6, minH: 6 },
    foreign_trading: { w: 8, h: 8, minW: 6, minH: 6 },
    subsidiaries: { w: 8, h: 8, minW: 6, minH: 6 },
    intraday_trades: { w: 12, h: 8, minW: 8, minH: 6 },
    transaction_flow: { w: 12, h: 10, minW: 8, minH: 6 },
    financial_ratios: { w: 12, h: 10, minW: 8, minH: 8 },
    income_statement: { w: 12, h: 10, minW: 8, minH: 8 },
    balance_sheet: { w: 12, h: 10, minW: 8, minH: 8 },
    cash_flow: { w: 12, h: 10, minW: 8, minH: 8 },
    market_breadth: { w: 8, h: 10, minW: 6, minH: 7 },
    sector_board: { w: 12, h: 15, minW: 10, minH: 12 },
    money_flow_trend: { w: 14, h: 12, minW: 10, minH: 9 },
    quant_summary: { w: 24, h: 8, minW: 10, minH: 6 },
    relative_rotation: { w: 12, h: 10, minW: 8, minH: 8 },
    ttm_snapshot: { w: 8, h: 8, minW: 6, minH: 6 },
    growth_bridge: { w: 10, h: 8, minW: 8, minH: 6 },
    ownership_rating_summary: { w: 8, h: 8, minW: 6, minH: 6 },
    derivatives_analytics: { w: 10, h: 8, minW: 8, minH: 6 },
    technical_summary: { w: 8, h: 10, minW: 6, minH: 8 },
    signal_summary: { w: 24, h: 8, minW: 12, minH: 6 },
    similar_stocks: { w: 6, h: 8, minW: 5, minH: 6 },
    block_trade: { w: 12, h: 8, minW: 8, minH: 6 },
    orderbook: { w: 12, h: 8, minW: 8, minH: 6 },
    market_news: { w: 12, h: 9, minW: 8, minH: 6 },
} satisfies Partial<Record<WidgetType, { w: number; h: number; minW?: number; minH?: number }>>);


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
    screener: 'Stock Screener',
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
    amihud_illiquidity: 'Amihud Illiquidity',
    drawdown_deep_dive: 'Drawdown Deep Dive',
    hurst_market_structure: 'Hurst Market Structure',
    seasonality_heatmap: 'Seasonality Heatmap',
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
    screener: 'Filter stocks by 80+ criteria',
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
    amihud_illiquidity: 'Price impact per traded value with rolling liquidity trend',
    drawdown_deep_dive: 'Underwater drawdown curve with depth and recovery statistics',
    hurst_market_structure: 'Hurst exponent with persistence and mean-reversion structure clues',
    seasonality_heatmap: 'Year by month return heatmap for seasonal structure',
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
    orderbook: 'Real-time Level 2 depth',
    index_comparison: 'Major indices performance',
    market_news: 'Broad market news stream',
    sector_breakdown: 'Market cap by industry',
    market_movers_sectors: 'Sector performance with top movers',
    comparison_analysis: 'Side-by-side fundamentals',
    news_flow: 'Unified chronological flow',
    news_corporate_actions: 'Company news with dividends and insider deals',
    ai_analysis: 'Automated deep-dive research',
    unified_financials: 'Balance Sheet, Income, Cash Flow with tabs',
};
