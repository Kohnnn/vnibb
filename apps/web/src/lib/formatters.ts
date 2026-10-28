// VND formatting utilities for Vietnam stock market data

/**
 * Format a number as VND currency with unit suffixes
 * Examples: 75800 → "VND75,800", 30000000000 → "VND30bn"
 */
export function formatVND(value: number | null | undefined, options?: {
    showCurrency?: boolean;
    decimals?: number;
}): string {
    if (value === null || value === undefined) return '-';

    const { showCurrency = true, decimals = 0 } = options || {};
    const prefix = showCurrency ? 'VND' : '';

    const absValue = Math.abs(value);
    const sign = value < 0 ? '-' : '';

    // Trillion (nghìn tỷ)
    if (absValue >= 1_000_000_000_000) {
        return `${sign}${prefix}${(absValue / 1_000_000_000_000).toFixed(1)}tn`;
    }

    // Billion (tỷ)
    if (absValue >= 1_000_000_000) {
        return `${sign}${prefix}${(absValue / 1_000_000_000).toFixed(1)}bn`;
    }

    // Million (triệu)
    if (absValue >= 1_000_000) {
        return `${sign}${prefix}${(absValue / 1_000_000).toFixed(1)}mn`;
    }

    // Thousand
    if (absValue >= 1_000) {
        return `${sign}${prefix}${absValue.toLocaleString('en-US', { maximumFractionDigits: decimals })}`;
    }

    return `${sign}${prefix}${absValue.toFixed(decimals)}`;
}

export function formatDividendPayout(row: {
    cash_dividend?: number | null;
    stock_dividend?: number | null;
    dividend_ratio?: number | string | null;
    value?: number | null;
}): string {
    const cash = row.cash_dividend;
    const stock = row.stock_dividend;
    if (cash != null && cash !== 0 && stock != null && stock !== 0) {
        return `${formatVND(cash)} + ${stock.toFixed(2)}% stock`;
    }
    if (stock != null && stock !== 0) return `${stock.toFixed(2)}% stock`;
    if (cash != null) return formatVND(cash);
    if (stock != null) return `${stock.toFixed(2)}% stock`;
    if (row.dividend_ratio != null) return String(row.dividend_ratio);
    if (row.value != null) return formatVND(row.value);
    return '-';
}

/**
 * Format a percentage value
 * Example: 0.1523 → "15.23%", -0.05 → "-5.00%"
 */
export function formatPercent(value: number | null | undefined, decimals = 2): string {
    if (value === null || value === undefined) return '-';

    // Check if value is already a percentage (> 1 or < -1)
    const isRaw = Math.abs(value) > 1;
    const percent = isRaw ? value : value * 100;

    const formatted = percent.toFixed(decimals);
    return `${percent >= 0 ? '+' : ''}${formatted}%`;
}

export function readDividendYield(value: unknown, unit: unknown): number | null {
    if (unit !== 'percent') return null;
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
    const percent = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(percent) && percent >= 0 ? percent : null;
}

export function formatDividendYield(value: number | null | undefined, decimals = 2): string {
    if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return '-';
    return `${value.toFixed(decimals)}%`;
}

/**
 * Format price change with color class
 */
export function formatPriceChange(change: number | null | undefined): {
    text: string;
    colorClass: string;
} {
    if (change === null || change === undefined) {
        return { text: '-', colorClass: 'text-gray-500' };
    }

    const text = formatPercent(change);
    const colorClass = change > 0
        ? 'text-green-500'
        : change < 0
            ? 'text-red-500'
            : 'text-gray-500';

    return { text, colorClass };
}

/**
 * Format a large number (volume, shares)
 * Example: 1234567 → "1.23M"
 */
export function formatNumber(value: number | null | undefined, decimals = 2): string {
    if (value === null || value === undefined) return '-';

    const absValue = Math.abs(value);
    const sign = value < 0 ? '-' : '';

    if (absValue >= 1_000_000_000) {
        return `${sign}${(absValue / 1_000_000_000).toFixed(decimals)}B`;
    }

    if (absValue >= 1_000_000) {
        return `${sign}${(absValue / 1_000_000).toFixed(decimals)}M`;
    }

    if (absValue >= 1_000) {
        return `${sign}${(absValue / 1_000).toFixed(decimals)}K`;
    }

    return `${sign}${absValue.toFixed(decimals)}`;
}

/**
 * Format ratio (PE, PB, etc.)
 */
export function formatRatio(value: number | null | undefined, decimals = 2): string {
    if (value === null || value === undefined) return '-';
    return value.toFixed(decimals);
}

/**
 * Format date to YYYY-MM-DD
 */
export function formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toISOString().split('T')[0];
}
