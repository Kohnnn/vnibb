import type { WidgetType } from '@/types/dashboard'

export interface WidgetDescription {
  purpose: string
  calculation: string
  interpretation: string
}

export const WIDGET_DESCRIPTIONS: Partial<Record<WidgetType, WidgetDescription>> = {
  price_chart: {
    purpose: 'Provides a full-featured price chart for the selected ticker with drawing tools, indicator overlays, and timeframe switching.',
    calculation: 'Uses TradingView advanced charting by default, with an optional VNIBB local-history mode for supported Vietnamese exchanges.',
    interpretation: 'Use TradingView mode for annotation and indicator work. Use local mode when you want a lightweight clean price-history view from VNIBB data.',
  },
  seasonality_heatmap: {
    purpose: 'Shows how the stock has historically performed by month so you can spot recurring seasonal strength and weakness.',
    calculation: 'Groups daily price history by month and year, then calculates each month\'s return and the long-run monthly averages.',
    interpretation: 'Greener months have historically been stronger. Redder months have historically been weaker. Use it as context, not a standalone trigger.',
  },
  sortino_monthly: {
    purpose: 'Highlights which months have delivered the best downside-adjusted return profile.',
    calculation: 'Computes monthly return quality using downside deviation instead of total volatility, so only harmful downside moves are penalized.',
    interpretation: 'Higher Sortino values suggest cleaner upside with less downside noise. Negative or weak readings signal poor reward for risk.',
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
  },
  comparison_analysis: {
    purpose: 'Compares the selected stock against its peers on the same analytical canvas.',
    calculation: 'Aligns peer fundamentals and market metrics so valuation, quality, and growth differences are directly comparable.',
    interpretation: 'Use it to find relative outliers such as cheaper valuations, stronger profitability, or weaker balance-sheet quality.',
  },
  market_news: {
    purpose: 'Surfaces broad market headlines that can affect sector and ticker context.',
    calculation: 'Aggregates recent market stories and sorts them by recency and relevance.',
    interpretation: 'Best used to understand narrative and event risk around your current symbol, sector, and broader market regime.',
  },
}
