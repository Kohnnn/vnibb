
/**
 * Utility functions for frontend technical analysis calculations.
 * Used for real-time overlays and indicators on the Price Chart.
 */

export interface OHLCData {
    time: number | string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

/**
 * Calculate Simple Moving Average (SMA)
 */
export function calculateSMA(data: OHLCData[], period: number) {
    const sma = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            sma.push({ time: data[i].time, value: undefined });
            continue;
        }

        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].close;
        }
        sma.push({ time: data[i].time, value: sum / period });
    }
    return sma.filter(item => item.value !== undefined);
}

/**
 * Calculate Exponential Moving Average (EMA)
 */
export function calculateEMA(data: OHLCData[], period: number) {
    const ema = [];
    const k = 2 / (period + 1);
    let prevEma: number | null = null;

    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            ema.push({ time: data[i].time, value: undefined });
            continue;
        }

        if (prevEma === null) {
            // Initial SMA as first EMA
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += data[i - j].close;
            }
            prevEma = sum / period;
        } else {
            prevEma = data[i].close * k + prevEma * (1 - k);
        }

        ema.push({ time: data[i].time, value: prevEma });
    }
    return ema.filter(item => item.value !== undefined);
}

/**
 * Calculate Bollinger Bands
 */
export function calculateBollingerBands(data: OHLCData[], period: number, stdDev: number) {
    const upper = [];
    const middle = [];
    const lower = [];

    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            continue;
        }

        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].close;
        }
        const avg = sum / period;

        let squareDiffSum = 0;
        for (let j = 0; j < period; j++) {
            squareDiffSum += Math.pow(data[i - j].close - avg, 2);
        }
        const sd = Math.sqrt(squareDiffSum / period);

        upper.push({ time: data[i].time, value: avg + stdDev * sd });
        middle.push({ time: data[i].time, value: avg });
        lower.push({ time: data[i].time, value: avg - stdDev * sd });
    }

    return { upper, middle, lower };
}

/**
 * Transform data to Heikin-Ashi candlesticks
 */
export function transformHeikinAshi(data: OHLCData[]): OHLCData[] {
    const haData: OHLCData[] = [];
    let prevHAOpen = data[0].open;
    let prevHAClose = data[0].close;

    for (let i = 0; i < data.length; i++) {
        const item = data[i];

        const haClose = (item.open + item.high + item.low + item.close) / 4;
        const haOpen = (prevHAOpen + prevHAClose) / 2;
        const haHigh = Math.max(item.high, haOpen, haClose);
        const haLow = Math.min(item.low, haOpen, haClose);

        haData.push({
            time: item.time,
            open: haOpen,
            high: haHigh,
            low: haLow,
            close: haClose,
            volume: item.volume
        });

        prevHAOpen = haOpen;
        prevHAClose = haClose;
    }

    return haData;
}

/**
 * Calculate RSI (Relative Strength Index)
 */
export function calculateRSI(data: OHLCData[], period: number = 14) {
    const rsi = [];
    let gains = 0;
    let losses = 0;

    for (let i = 1; i < data.length; i++) {
        const change = data[i].close - data[i - 1].close;
        if (i <= period) {
            if (change > 0) gains += change;
            else losses -= change;

            if (i === period) {
                let averageGain = gains / period;
                let averageLoss = losses / period;
                let rs = averageLoss === 0 ? 100 : averageGain / averageLoss;
                rsi.push({ time: data[i].time, value: 100 - (100 / (1 + rs)) });
            } else {
                rsi.push({ time: data[i].time, value: undefined });
            }
        } else {
            let averageGain = ((gains * (period - 1)) + (change > 0 ? change : 0)) / period;
            let averageLoss = ((losses * (period - 1)) + (change < 0 ? -change : 0)) / period;
            gains = averageGain;
            losses = averageLoss;
            let rs = averageLoss === 0 ? 100 : averageGain / averageLoss;
            rsi.push({ time: data[i].time, value: 100 - (100 / (1 + rs)) });
        }
    }
    return rsi.filter(item => item.value !== undefined) as { time: number | string; value: number }[];
}

/**
 * Calculate MACD
 */
export function calculateMACD(data: OHLCData[], fast: number = 12, slow: number = 26, signal: number = 9) {
    const fastEma = calculateEMA(data, fast);
    const slowEma = calculateEMA(data, slow);

    const macdLine: { time: number | string; value: number }[] = [];
    const macdDataForSignal: any[] = [];

    // Map by time for alignment
    const slowMap = new Map(slowEma.map(d => [d.time.toString(), d.value]));

    fastEma.forEach(f => {
        const s = slowMap.get(f.time.toString());
        if (s !== undefined && f.value !== undefined) {
            const val = f.value - s;
            macdLine.push({ time: f.time, value: val });
            macdDataForSignal.push({ time: f.time, close: val });
        }
    });

    const signalLine = calculateEMA(macdDataForSignal as any, signal);
    const signalMap = new Map(signalLine.map(d => [d.time.toString(), d.value]));

    const histogram = macdLine.map(m => {
        const sig = signalMap.get(m.time.toString());
        return {
            time: m.time,
            value: sig !== undefined ? m.value - sig : undefined
        };
    }).filter(h => h.value !== undefined) as { time: number | string; value: number }[];

    return {
        macdLine: macdLine as { time: number | string; value: number }[],
        signalLine: signalLine.filter(s => s.value !== undefined) as { time: number | string; value: number }[],
        histogram
    };
}

/**
 * Calculate Stochastic Oscillator (%K and %D)
 */
export function calculateStochastic(data: OHLCData[], kPeriod: number = 14, dPeriod: number = 3) {
    const kLine: { time: number | string; value: number }[] = [];
    const dLine: { time: number | string; value: number }[] = [];

    for (let i = kPeriod - 1; i < data.length; i++) {
        let lowestLow = Infinity;
        let highestHigh = -Infinity;

        for (let j = 0; j < kPeriod; j++) {
            const item = data[i - j];
            if (item.low < lowestLow) lowestLow = item.low;
            if (item.high > highestHigh) highestHigh = item.high;
        }

        const range = highestHigh - lowestLow;
        const k = range === 0 ? 50 : ((data[i].close - lowestLow) / range) * 100;
        kLine.push({ time: data[i].time, value: k });
    }

    // Calculate %D (SMA of %K)
    for (let i = dPeriod - 1; i < kLine.length; i++) {
        let sum = 0;
        for (let j = 0; j < dPeriod; j++) {
            sum += kLine[i - j].value;
        }
        dLine.push({ time: kLine[i].time, value: sum / dPeriod });
    }

    return { kLine, dLine };
}

/**
 * Calculate On-Balance Volume (OBV)
 */
export function calculateOBV(data: OHLCData[]) {
    const obv: { time: number | string; value: number }[] = [];
    let runningOBV = 0;

    for (let i = 0; i < data.length; i++) {
        if (i === 0) {
            runningOBV = data[i].volume || 0;
        } else {
            const priceChange = data[i].close - data[i - 1].close;
            const volume = data[i].volume || 0;

            if (priceChange > 0) {
                runningOBV += volume;
            } else if (priceChange < 0) {
                runningOBV -= volume;
            }
            // If price unchanged, OBV stays the same
        }
        obv.push({ time: data[i].time, value: runningOBV });
    }

    return obv;
}

/**
 * Calculate Volume Moving Average
 */
export function calculateVolumeMA(data: OHLCData[], period: number = 20) {
    const volumeMA: { time: number | string; value: number }[] = [];

    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].volume || 0;
        }
        volumeMA.push({ time: data[i].time, value: sum / period });
    }

    return volumeMA;
}

/**
 * Calculate Pivot Points (Standard)
 */
export function calculatePivotPoints(data: OHLCData[]) {
    if (data.length === 0) return null;

    // Use the most recent complete candle
    const lastCandle = data[data.length - 1];
    const { high, low, close } = lastCandle;

    const pivot = (high + low + close) / 3;
    const r1 = 2 * pivot - low;
    const s1 = 2 * pivot - high;
    const r2 = pivot + (high - low);
    const s2 = pivot - (high - low);
    const r3 = high + 2 * (pivot - low);
    const s3 = low - 2 * (high - pivot);

    return {
        pivot,
        r1, r2, r3,
        s1, s2, s3,
    };
}

/**
 * Calculate ATR (Average True Range)
 */
export function calculateATR(data: OHLCData[], period: number = 14) {
    const atr: { time: number | string; value: number }[] = [];
    const trueRanges: number[] = [];

    for (let i = 0; i < data.length; i++) {
        let tr: number;
        if (i === 0) {
            tr = data[i].high - data[i].low;
        } else {
            const highLow = data[i].high - data[i].low;
            const highPrevClose = Math.abs(data[i].high - data[i - 1].close);
            const lowPrevClose = Math.abs(data[i].low - data[i - 1].close);
            tr = Math.max(highLow, highPrevClose, lowPrevClose);
        }
        trueRanges.push(tr);

        if (i >= period - 1) {
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += trueRanges[i - j];
            }
            atr.push({ time: data[i].time, value: sum / period });
        }
    }

    return atr;
}

/**
 * Calculate Volume Profile (price distribution)
 */
export function calculateVolumeProfile(data: OHLCData[], numBins: number = 20) {
    if (data.length === 0) return [];

    // Find price range
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    for (const item of data) {
        if (item.low < minPrice) minPrice = item.low;
        if (item.high > maxPrice) maxPrice = item.high;
    }

    const priceRange = maxPrice - minPrice;
    if (priceRange === 0) return [];

    const binSize = priceRange / numBins;
    const bins: { price: number; volume: number }[] = [];

    // Initialize bins
    for (let i = 0; i < numBins; i++) {
        bins.push({
            price: minPrice + (i + 0.5) * binSize,
            volume: 0,
        });
    }

    // Distribute volume across bins
    for (const item of data) {
        const volume = item.volume || 0;
        const avgPrice = (item.high + item.low) / 2;
        const binIndex = Math.min(Math.floor((avgPrice - minPrice) / binSize), numBins - 1);
        if (binIndex >= 0 && binIndex < numBins) {
            bins[binIndex].volume += volume;
        }
    }

    return bins;
}

/**
 * Get date range for timeframe
 */
export function getDateRangeForTimeframe(timeframe: string): { startDate: string; endDate: string; interval: string } {
    const now = new Date();
    const endDate = now.toISOString().split('T')[0];
    let startDate: Date;
    let interval = '1D';

    switch (timeframe) {
        case '1D':
            startDate = new Date(now);
            startDate.setDate(startDate.getDate() - 1);
            interval = '1m';
            break;
        case '5D':
            startDate = new Date(now);
            startDate.setDate(startDate.getDate() - 5);
            interval = '15m';
            break;
        case '1M':
            startDate = new Date(now);
            startDate.setMonth(startDate.getMonth() - 1);
            interval = '1D';
            break;
        case '3M':
            startDate = new Date(now);
            startDate.setMonth(startDate.getMonth() - 3);
            interval = '1D';
            break;
        case '6M':
            startDate = new Date(now);
            startDate.setMonth(startDate.getMonth() - 6);
            interval = '1D';
            break;
        case '1Y':
            startDate = new Date(now);
            startDate.setFullYear(startDate.getFullYear() - 1);
            interval = '1D';
            break;
        case '5Y':
            startDate = new Date(now);
            startDate.setFullYear(startDate.getFullYear() - 5);
            interval = '1W';
            break;
        case 'ALL':
            startDate = new Date('2000-01-01');
            interval = '1M';
            break;
        default:
            startDate = new Date(now);
            startDate.setFullYear(startDate.getFullYear() - 1);
            interval = '1D';
    }

    return {
        startDate: startDate.toISOString().split('T')[0],
        endDate,
        interval,
    };
}
