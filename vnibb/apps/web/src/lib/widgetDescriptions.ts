import type { WidgetType } from '@/types/dashboard'

export interface WidgetDescription {
  purpose: string
  calculation: string
  interpretation: string
  advanced_insights?: string[]
  limitations?: string[]
  pro_tips?: string[]
}

export const WIDGET_DESCRIPTIONS: Partial<Record<WidgetType, WidgetDescription>> = {
  price_chart: {
    purpose: 'Provides a live lightweight chart for the selected ticker with timeframe switching and multiple display modes.',
    calculation: 'Fetches VNIBB historical OHLCV data for the chosen range, merges the latest quote when available, and renders it with lightweight-charts.',
    interpretation: 'Use candlesticks for structure, line mode for clean trend reading, and area mode for quick momentum context. The volume bars help confirm participation.',
    advanced_insights: [
      '1D and 5D are best for tactical tape reading, while 1Y and 3Y are better for regime and swing structure.',
      'Merged latest-quote handling makes the right edge of the chart more realistic during live sessions than pure EOD history alone.',
    ],
    limitations: [
      'This chart is intentionally lighter than the full licensed TradingView Charting Library and does not yet support saved drawings or advanced studies.',
      'Intraday bars are inferred from daily history and live quote merging, so it should be treated as a decision aid rather than a tick-perfect tape tool.',
    ],
    pro_tips: [
      'Start with 1Y or 3Y to find structure, then drop to 1M or 5D to refine entries around support and resistance.',
    ],
  },
  market_overview: {
    purpose: 'Summarizes the state of the broader market before you drill into single-stock work.',
    calculation: 'Aggregates index-level moves, breadth, and market-level performance snapshots from the current market payload.',
    interpretation: 'Use it to judge whether the tape is risk-on, risk-off, narrow, or broad. Single-stock setups are more reliable when market context agrees.',
    advanced_insights: [
      'A strong stock in a weak market can still work, but you should usually demand better entry levels and tighter invalidation.',
    ],
    limitations: [
      'Market overview compresses many moving parts and can miss important sector rotation under the surface.',
    ],
  },
  top_movers: {
    purpose: 'Shows which names are driving the session on the upside and downside.',
    calculation: 'Ranks stocks by percentage move and liquidity filters from the active market snapshot.',
    interpretation: 'Helpful for spotting leadership, capitulation, or crowded momentum. Fast movers matter more when liquidity is real, not thin.',
    advanced_insights: [
      'Look for repeat appearances over several sessions. Durable leaders usually persist rather than appearing once and disappearing.',
    ],
  },
  market_heatmap: {
    purpose: 'Visualizes where capital is flowing across the market in one glance.',
    calculation: 'Uses stock-level move, size, and sector grouping to render relative market pressure on a heatmap canvas.',
    interpretation: 'Large green blocks suggest broad leadership; isolated green in a red field often means defensive or idiosyncratic strength.',
    limitations: [
      'Heatmaps are excellent for breadth intuition but poor for precise timing by themselves.',
    ],
  },
  screener: {
    purpose: 'Filters the market into a smaller actionable universe based on your current preset or criteria.',
    calculation: 'Applies the selected screen logic to the latest market and fundamentals payload.',
    interpretation: 'Use it as an idea-generation surface. The best candidates still need follow-up in chart, fundamentals, and ownership widgets.',
    pro_tips: [
      'Treat screen output as a watchlist generator, not a final ranking of conviction.',
    ],
  },
  listing_browser: {
    purpose: 'Explores the listed universe through exchange, index-group, industry, and search filters with saved discovery views.',
    calculation: 'Starts from the VNIBB symbol universe, then layers local filters and optional saved views without mutating the underlying market dataset.',
    interpretation: 'Use it when you want to scan the universe before moving into single-stock analysis. It is a discovery surface, not a ranking engine.',
    pro_tips: [
      'Save recurring exchange or index-group views so you can reopen the same discovery slice quickly.',
    ],
  },
  ttm_snapshot: {
    purpose: 'Provides a compact trailing-twelve-month pulse across income, cash flow, and balance-sheet scale.',
    calculation: 'Uses the latest TTM-normalized income, cash flow, and balance-sheet rows, then converts key values into the active unit display.',
    interpretation: 'Useful when you want a fast current-state read on revenue, profitability, cash generation, and balance-sheet scale before opening full statements.',
  },
  growth_bridge: {
    purpose: 'Compares annual growth with the latest comparable-quarter growth for core financial drivers.',
    calculation: 'Uses the backend growth endpoint to pair annual YoY growth with the latest quarter matched against the same quarter last year.',
    interpretation: 'Use it to see whether growth is accelerating, stalling, or diverging between the annual base and the latest quarter signal.',
    limitations: [
      'The quarter side is based on comparable-quarter growth, not simple quarter-over-quarter seasonally noisy changes.',
    ],
  },
  ownership_rating_summary: {
    purpose: 'Summarizes ownership concentration, foreign participation, and insider bias into a compact scorecard.',
    calculation: 'Combines shareholder concentration, holder-type mix, foreign-flow direction, and insider sentiment into a lightweight composite score.',
    interpretation: 'Use it to judge whether the ownership base looks constructive, overly concentrated, or distribution-prone before doing deeper ownership work.',
    limitations: [
      'This is a synthesis layer over available ownership and insider datasets, not a regulatory ownership-quality grade.',
    ],
  },
  derivatives_analytics: {
    purpose: 'Shows the front-contract pulse and a short futures curve view across the nearest listed contracts.',
    calculation: 'Combines the contract ladder with recent contract histories to derive 20-day return, realized volatility, volume, and front-to-back curve shape.',
    interpretation: 'Use it to spot whether the near curve looks flat, contango, or backwardated and whether the front contract is building momentum or cooling off.',
  },
  market_sentiment: {
    purpose: 'Summarizes the broad market mood from recent news and highlights the topics and stocks getting the most attention.',
    calculation: 'Aggregates article-level sentiment into a market mood summary, then layers trending topics and mention frequency as discovery signals.',
    interpretation: 'Use it to see whether the market narrative is risk-on, risk-off, or indecisive before drilling into single-stock work.',
    limitations: [
      'News sentiment is a context layer, not a trading signal by itself.',
      'Topic and ticker mention frequency can lag the tape during fast intraday reversals.',
    ],
  },
  ticker_profile: {
    purpose: 'Provides the business identity, exchange context, and recent corporate profile details for the selected company.',
    calculation: 'Combines cached profile metadata, website, listing context, and related corporate actions or dividend details.',
    interpretation: 'Use it to confirm what the company actually does before comparing its valuation or technical setup against peers.',
  },
  major_shareholders: {
    purpose: 'Shows who owns the stock and how concentrated that ownership base appears.',
    calculation: 'Organizes shareholder and institutional ownership records into a ranked ownership view.',
    interpretation: 'Concentrated ownership can support strong trends but can also reduce float and increase gap risk if sentiment changes.',
  },
  seasonality_heatmap: {
    purpose: 'Shows how the stock has historically performed by month so you can spot recurring seasonal strength and weakness.',
    calculation: 'Groups daily price history by month and year, then calculates each month\'s return and the long-run monthly averages.',
    interpretation: 'Greener months have historically been stronger. Redder months have historically been weaker. Use it as context, not a standalone trigger.',
    advanced_insights: [
      'In Vietnam, some stronger seasonal windows can cluster around AGM season, dividend announcements, and post-Tet liquidity normalization.',
      'The current month is often the most valuable row because it shows how the live month is tracking versus its long-run tendency.',
    ],
    limitations: [
      'Seasonality is descriptive, not predictive. One regime change can overwhelm a long-run monthly average.',
      'Small-cap names with short histories can show noisy month effects that do not persist.',
    ],
    pro_tips: [
      'Use seasonality as a context layer with support/resistance and signal confirmation, not as a standalone timing rule.',
    ],
  },
  sortino_monthly: {
    purpose: 'Highlights which months have delivered the best downside-adjusted return profile.',
    calculation: 'Computes monthly return quality using downside deviation instead of total volatility, so only harmful downside moves are penalized.',
    interpretation: 'Higher Sortino values suggest cleaner upside with less downside noise. Negative or weak readings signal poor reward for risk.',
    advanced_insights: [
      'Sortino is often more useful than Sharpe for equities because upside volatility is not treated as a penalty.',
      'A month with fewer but deeper negative returns can look much worse on Sortino even if the average return still appears respectable.',
    ],
    limitations: [
      'A small sample of monthly observations can produce unstable ratios, especially in young listings.',
      'The metric can look artificially strong when downside deviations are very sparse in a trending sample.',
    ],
    pro_tips: [
      'Compare Sortino with the Sharpe companion series to detect months where tail risk is doing most of the damage.',
    ],
  },
  macd_crossovers: {
    purpose: 'Tracks MACD crossover behavior and how price usually responds after momentum flips.',
    calculation: 'Compares the MACD line with its signal line, then summarizes historical crossover events and forward returns.',
    interpretation: 'Bullish crossovers can support continuation if price confirms. Bearish crossovers warn that momentum is fading or reversing.',
  },
  bollinger_squeeze: {
    purpose: 'Identifies when volatility compresses and a larger move may be building.',
    calculation: 'Measures Bollinger Band width relative to price to detect squeeze and expansion regimes.',
    interpretation: 'Very narrow bands often precede breakouts. Expansion after a squeeze suggests the market is choosing direction.',
  },
  volume_profile: {
    purpose: 'Shows where the most trading activity has occurred across price levels.',
    calculation: 'Buckets historical trading into price bands, sums volume in each band, then marks the point of control and value area.',
    interpretation: 'High-volume nodes often act like magnets or support/resistance. Thin zones are easier for price to move through quickly.',
  },
  rsi_seasonal: {
    purpose: 'Shows whether RSI behavior tends to be seasonally hot or cold in specific months.',
    calculation: 'Computes RSI from price history, then aggregates monthly averages and overbought or oversold frequencies.',
    interpretation: 'Persistently high seasonal RSI can mean momentum months. Repeated low readings can hint at mean-reversion windows.',
  },
  volume_flow: {
    purpose: 'Estimates whether buyers or sellers controlled the tape across the selected period.',
    calculation: 'Uses price position inside each candle\'s range to proxy buy volume, sell volume, and cumulative delta.',
    interpretation: 'Positive delta suggests accumulation. Negative delta suggests distribution. Divergence vs price can be especially useful.',
  },
  ema_respect: {
    purpose: 'Measures how reliably price reacts to key EMAs as support or resistance.',
    calculation: 'Checks repeated interactions with selected EMAs and scores whether price bounces, holds, or breaks through them.',
    interpretation: 'High respect means the moving average is behaving like a meaningful level. Fragile readings mean it is not reliable right now.',
  },
  drawdown_recovery: {
    purpose: 'Shows how deep the stock usually falls from peaks and how long recoveries tend to take.',
    calculation: 'Builds an underwater curve from rolling peaks, then measures drawdown depth and recovery duration statistics.',
    interpretation: 'Shallow drawdowns with fast recoveries suggest resilience. Deep, persistent drawdowns signal weaker trend quality.',
    advanced_insights: [
      'Time underwater is often the harder behavioral burden than drawdown depth because capital and conviction stay trapped for longer.',
      'A stock that recovers quickly from pullbacks can sustain higher momentum multiples because holders are rewarded faster.',
    ],
    limitations: [
      'Past recovery speed does not guarantee future recoveries, especially after business-model or credit-quality breaks.',
    ],
    pro_tips: [
      'Pair this widget with support/resistance and signal summary to judge whether a fresh drawdown looks normal or regime-breaking.',
    ],
  },
  gap_analysis: {
    purpose: 'Summarizes how often the stock gaps and whether those gaps tend to fill.',
    calculation: 'Measures the difference between each open and the prior close, then classifies direction, size, and fill behavior.',
    interpretation: 'Frequent fills can favor mean reversion. Persistent unfilled gaps can indicate stronger directional conviction.',
  },
  gap_fill_stats: {
    purpose: 'Focuses specifically on the probability and speed of gap fills.',
    calculation: 'Tracks recent gap events and records whether price returned to the prior close within the same session or shortly after.',
    interpretation: 'Higher fill rates make gaps less durable. Lower fill rates imply gaps may carry more trend information.',
  },
  momentum: {
    purpose: 'Combines multiple return windows to show how strong the trend is across timeframes.',
    calculation: 'Aggregates 1M, 3M, 6M, and 12M-style return measures into a composite momentum profile.',
    interpretation: 'Broad strength across windows supports continuation. Mixed short- and long-term readings often signal a regime change.',
  },
  parkinson_volatility: {
    purpose: 'Measures realized volatility using intraperiod high-low ranges rather than just closes.',
    calculation: 'Applies the Parkinson estimator to high and low data to capture price movement efficiency.',
    interpretation: 'Higher readings mean a wider realized trading range. Falling readings often reflect calmer or compressed conditions.',
  },
  amihud_illiquidity: {
    purpose: 'Estimates how much price moves for each unit of traded value.',
    calculation: 'Divides absolute return by traded value to approximate daily price impact and rolling liquidity conditions.',
    interpretation: 'Higher illiquidity means small amounts of trading can move price more. Lower readings suggest smoother execution.',
  },
  technical_summary: {
    purpose: 'Rolls up the main technical studies into a single directional summary.',
    calculation: 'Combines moving averages, oscillators, trend strength, support/resistance, and Fibonacci context from the full technical payload.',
    interpretation: 'Use this as a high-level read of technical posture before drilling into individual widgets for confirmation.',
  },
  technical_snapshot: {
    purpose: 'Provides a quick daily snapshot of the most important technical indicators.',
    calculation: 'Fetches the latest technical indicator set and presents the current values in a condensed view.',
    interpretation: 'Helpful for a quick regime check. Confirm important changes with the more detailed widgets below it.',
  },
  signal_summary: {
    purpose: 'Condenses the main technical evidence into a single actionable view for buying, selling, or waiting.',
    calculation: 'Uses the existing technical summary counts, nearest support and resistance, and momentum regime to estimate confidence and trade context.',
    interpretation: 'Treat it as a decision aid, not a guarantee. Higher confidence matters most when the key levels and indicator details agree.',
    advanced_insights: [
      'The best signal summaries are rarely the loudest ones. Balanced evidence with clear trend context is usually more durable than a fast oscillator spike.',
      'Volume confirmation matters most when the directional score is already positive or negative; it should confirm, not dominate, the call.',
    ],
    limitations: [
      'This is still a compression layer over multiple indicators, so it can understate nuance around major events or sudden regime shifts.',
    ],
    pro_tips: [
      'Read this widget last. It works best as the conclusion after checking structure, trend, and risk levels above it.',
    ],
  },
  ichimoku: {
    purpose: 'Maps trend direction, support zones, and momentum structure using the Ichimoku cloud framework.',
    calculation: 'Plots Tenkan-sen, Kijun-sen, Senkou Span A/B, and Chikou Span from rolling high-low midpoints and shifted cloud projections.',
    interpretation: 'Price above the cloud is generally bullish, below is bearish, and the Tenkan/Kijun relationship helps confirm momentum.',
  },
  fibonacci: {
    purpose: 'Shows the stock\'s nearest retracement and extension levels from the most important recent swing.',
    calculation: 'Finds the dominant recent swing high and low, then applies standard Fibonacci ratios such as 23.6%, 38.2%, 50%, and 61.8%.',
    interpretation: 'Use the nearest level as a reaction zone. Strong bounces or clean breaks around 38.2%, 50%, and 61.8% usually matter most.',
  },
  financial_ratios: {
    purpose: 'Organizes valuation, profitability, liquidity, leverage, and cash-flow ratios into one table.',
    calculation: 'Uses reported financial statement data and derived ratios across yearly, quarterly, or TTM views.',
    interpretation: 'Focus on trend direction and peer context, not a single point reading. Improving multi-period trends usually matter most.',
    advanced_insights: [
      'Ratios become far more useful when you read them by cluster: valuation with profitability, liquidity with leverage, and growth with efficiency.',
      'Banking and non-banking names should not be interpreted with identical ratio priorities.',
    ],
    limitations: [
      'Accounting changes, restructuring years, and one-off asset sales can distort a single-period ratio view.',
    ],
    pro_tips: [
      'OpenBB-style reading starts with row emphasis on totals, then uses the trend column to separate temporary noise from structural change.',
    ],
  },
  comparison_analysis: {
    purpose: 'Compares the selected stock against its peers on the same analytical canvas.',
    calculation: 'Aligns peer fundamentals and market metrics so valuation, quality, and growth differences are directly comparable.',
    interpretation: 'Use it to find relative outliers such as cheaper valuations, stronger profitability, or weaker balance-sheet quality.',
    advanced_insights: [
      'A stock can be cheap for good reason, so valuation outliers should always be read together with profitability and leverage outliers.',
      'Mini trend context matters because a single cheap multiple can be much less interesting if the price trend is structurally deteriorating.',
    ],
    limitations: [
      'Peer sets can drift if sector classification is broad or the company is transitioning across business lines.',
    ],
    pro_tips: [
      'Look for repeated green cells across several categories rather than one isolated best-in-class metric.',
    ],
  },
  correlation_matrix: {
    purpose: 'Shows how tightly the selected stock has been moving with its nearest sector peers.',
    calculation: 'Builds close-to-close return series for the selected stock and peer set, then computes pairwise return correlation across the chosen window.',
    interpretation: 'High positive values suggest the stocks often move together. Low or negative values can highlight diversification or dispersion candidates.',
    advanced_insights: [
      'The most useful row is usually the selected symbol versus peers, not the full matrix by itself.',
      'A loose cluster often means stock-specific narratives are dominating sector beta.',
    ],
    limitations: [
      'Correlation does not imply leadership or causality; it only measures co-movement over the chosen lookback.',
    ],
    pro_tips: [
      'Use the most-correlated names for relative-strength confirmation and the least-correlated names when looking for dispersion setups.',
    ],
  },
  transaction_flow: {
    purpose: 'Breaks each session into domestic, foreign, and proprietary participation so you can see who drove the tape.',
    calculation: 'Uses transaction-flow decomposition and overlays price to compare net participation against the session close.',
    interpretation: 'Rising price with supportive flow suggests healthier sponsorship. Divergence between price and flow often matters more than a single large print.',
  },
  money_flow_trend: {
    purpose: 'Maps sector peers into strength and trend quadrants to show where leadership is rotating.',
    calculation: 'Normalizes relative strength and trend proxies against a benchmark, then plots recent trails for each peer.',
    interpretation: 'Names in the bullish quadrant with improving trails are typically stronger candidates than those drifting into weakening or bearish quadrants.',
  },
  industry_bubble: {
    purpose: 'Compares sector peers on valuation, quality, growth, or leverage dimensions in one exploratory chart.',
    calculation: 'Places each peer on user-selected X and Y metrics and sizes bubbles by a third metric such as market cap or revenue.',
    interpretation: 'Outliers far from the sector average are usually the most interesting. The selected symbol matters most when it is meaningfully displaced from the peer cluster.',
  },
  sector_board: {
    purpose: 'Shows sector leadership in a tape-style board with the most active names for each industry bucket.',
    calculation: 'Ranks sector constituents by the selected sort key and groups them into sector columns with sector-level performance summaries.',
    interpretation: 'Helpful for spotting leadership concentration. Strong sectors with several aligned names usually carry more weight than one isolated mover.',
  },
  market_news: {
    purpose: 'Surfaces broad market headlines that can affect sector and ticker context.',
    calculation: 'Aggregates recent market stories and sorts them by recency and relevance.',
    interpretation: 'Best used to understand narrative and event risk around your current symbol, sector, and broader market regime.',
  },
}
