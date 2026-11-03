// VND formatting utilities for Vietnam stock market data
import { EMPTY_VALUE } from '@/lib/units'

/**
 * Format a number as VND currency with unit suffixes
 * Examples: 75800 → "VND75,800", 30000000000 → "VND30bn"
 */
export function formatVND(value: number | null | undefined, options?: {
    showCurrency?: boolean;
    decimals?: number;
}): string {
    // Brand v1.1: unavailable is `n/a`, never a hyphen that reads as a value.
    if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;

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
    return EMPTY_VALUE;
}

/**
 * Format a percentage value
 * Example: 0.1523 → "15.23%", -0.05 → "-5.00%"
 */
export function formatPercent(value: number | null | undefined, decimals = 2): string {
    // Brand v1.1: missing is `n/a`, and a measured zero takes no sign.
    if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';

    // Check if value is already a percentage (> 1 or < -1)
    const isRaw = Math.abs(value) > 1;
    const percent = isRaw ? value : value * 100;

    // Brand v1.1: the sign follows the rendered digits, so a change that
    // rounds to 0.00 is `0.00%`, never `-0.00%`.
    const body = Math.abs(percent).toFixed(decimals);
    const sign = Number(body) === 0 ? '' : percent < 0 ? '-' : '+';
    return `${sign}${body}%`;
}

export function readDividendYield(value: unknown, unit: unknown): number | null {
    if (unit !== 'percent') return null;
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
    const percent = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(percent) && percent >= 0 ? percent : null;
}

export function formatDividendYield(value: number | null | undefined, decimals = 2): string {
    // Brand v1.1 separates unavailable (`n/a`) from not meaningful (`n/m`).
    if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
    if (value < 0) return 'n/m';
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
        return { text: 'n/a', colorClass: 'text-[var(--text-muted)]' };
    }

    const text = formatPercent(change);
    const colorClass = change > 0
        ? 'text-[var(--color-positive)]'
        : change < 0
            ? 'text-[var(--color-negative)]'
            : 'text-[var(--text-muted)]';

    return { text, colorClass };
}

/**
 * Format a large number (volume, shares)
 * Example: 1234567 → "1.23M"
 */
export function formatNumber(value: number | null | undefined, decimals = 2): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';

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
    // Brand v1.1: `n/a` is an unavailable value, `n/m` a ratio that is not
    // meaningful. A missing ratio is unavailable, so it must not read as a
    // hyphen (which the spec reserves for nothing at all).
    if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
    return value.toFixed(decimals);
}

/**
 * Format date to YYYY-MM-DD
 */
export function formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toISOString().split('T')[0];
}
