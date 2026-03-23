// Technical Analysis types

export type Signal = 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
export type Timeframe = 'D' | 'W' | 'M';

export interface IndicatorDetail {
    name: string;
    value: any;
    signal: Signal;
}

export interface SignalSummary {
    symbol: string;
    overall_signal: Signal;
    buy_count: number;
    sell_count: number;
    neutral_count: number;
    total_indicators: number;
    indicators: IndicatorDetail[];
    trend_strength: string;
}

export interface TechnicalIndicators {
    moving_averages: MovingAveragesResponse;
    oscillators: OscillatorsResponse;
    volatility: VolatilityResponse;
}

export interface MovingAveragesResponse {
    sma: Record<string, number>;
    ema: Record<string, number>;
    signals: Record<string, string>;
    current_price: number | null;
}

export interface RSIResponse {
    value: number | null;
    signal: string;
    zone: string;
    period: number;
}

export interface MACDResponse {
    macd: number | null;
    signal_line: number | null;
    histogram: number | null;
    signal: string;
    params: { fast: number; slow: number; signal: number };
}

export interface StochasticResponse {
    k: number | null;
    d: number | null;
    signal: string;
    params: { k_period: number; d_period: number };
}

export interface OscillatorsResponse {
    rsi: RSIResponse;
    macd: MACDResponse;
    stochastic: StochasticResponse;
}

export interface BollingerBandsResponse {
    upper: number | null;
    middle: number | null;
    lower: number | null;
    current_price: number | null;
    percent_b: number | null;
    signal: string;
    params: { period: number; std_dev: number };
}

export interface ADXResponse {
    adx: number | null;
    plus_di: number | null;
    minus_di: number | null;
    trend_strength: string;
    signal: string;
}

export interface VolumeResponse {
    volume: number | null;
    volume_ma: number | null;
    relative_volume: number | null;
    volume_desc: string;
    signal: string;
    params: { period: number };
}

export interface VolatilityResponse {
    bollinger_bands: BollingerBandsResponse;
    adx: ADXResponse;
    volume: VolumeResponse | null;
    ichimoku_cloud: any | null;
}

export interface SupportResistanceResponse {
    support: number[];
    resistance: number[];
    current_price: number | null;
    nearest_support: number | null;
    nearest_resistance: number | null;
    support_proximity_pct: number | null;
    resistance_proximity_pct: number | null;
}

export interface FibonacciResponse {
    levels: Record<string, number>;
    period_high: number | null;
    period_low: number | null;
    current_price: number | null;
    trend: string;
    lookback_days: number;
}

export interface IchimokuPoint {
    date: string;
    close: number;
    tenkan_sen: number | null;
    kijun_sen: number | null;
    senkou_span_a: number | null;
    senkou_span_b: number | null;
    chikou_span: number | null;
}

export interface IchimokuSignalSummary {
    cloud_trend: string;
    tk_cross: string;
    cloud_twist: string | null;
    strength: string;
}

export interface IchimokuSeriesResponse {
    symbol: string;
    period: string;
    data: IchimokuPoint[];
    signal: IchimokuSignalSummary;
}

export interface SwingPoint {
    price: number;
    date: string;
}

export interface NearestFibonacciLevel {
    level: string;
    price: number;
    distance_pct: number;
}

export interface FibonacciPricePoint {
    date: string;
    close: number;
    high?: number | null;
    low?: number | null;
}

export interface FibonacciRetracementResponse {
    symbol: string;
    lookback_days: number;
    direction: string;
    swing_high: SwingPoint;
    swing_low: SwingPoint;
    levels: Record<string, number>;
    current_price: number;
    nearest_level: NearestFibonacciLevel;
    price_data: FibonacciPricePoint[];
}

export interface LevelsResponse {
    support_resistance: SupportResistanceResponse;
    fibonacci: FibonacciResponse;
}

export interface FullTechnicalAnalysis {
    symbol: string;
    timeframe: Timeframe;
    moving_averages: MovingAveragesResponse;
    oscillators: OscillatorsResponse;
    volatility: VolatilityResponse;
    levels: LevelsResponse;
    signals: SignalSummary;
    generated_at: string;
}
