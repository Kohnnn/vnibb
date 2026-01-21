// Financial Charts Utilities
// Shared formatting and color constants for financial statement charts

/**
 * Format large financial values with VND currency prefix
 * Uses Vietnamese financial notation: bn (billion), mn (million), k (thousand)
 */
export function formatFinancialValue(value: number | null | undefined): string {
    if (value === null || value === undefined || isNaN(value)) return '-';

    const absValue = Math.abs(value);
    const sign = value < 0 ? '-' : '';

    if (absValue >= 1e12) return `${sign}VND${(absValue / 1e12).toFixed(1)}tn`;
    if (absValue >= 1e9) return `${sign}VND${(absValue / 1e9).toFixed(1)}bn`;
    if (absValue >= 1e6) return `${sign}VND${(absValue / 1e6).toFixed(1)}mn`;
    if (absValue >= 1e3) return `${sign}VND${(absValue / 1e3).toFixed(1)}k`;
    return `${sign}VND${absValue.toLocaleString()}`;
}

/**
 * Shorter format for chart axis labels
 */
export function formatAxisValue(value: number): string {
    if (value === 0) return '0';

    const absValue = Math.abs(value);
    const sign = value < 0 ? '-' : '';

    if (absValue >= 1e12) return `${sign}${(absValue / 1e12).toFixed(0)}T`;
    if (absValue >= 1e9) return `${sign}${(absValue / 1e9).toFixed(0)}B`;
    if (absValue >= 1e6) return `${sign}${(absValue / 1e6).toFixed(0)}M`;
    if (absValue >= 1e3) return `${sign}${(absValue / 1e3).toFixed(0)}K`;
    return `${sign}${absValue}`;
}

/**
 * Format percentage values
 */
export function formatPercent(value: number | null | undefined): string {
    if (value === null || value === undefined || isNaN(value)) return '-';
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export function formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined || isNaN(value)) return '-';
    return value.toLocaleString('vi-VN');
}

export function formatRatio(value: number | null | undefined): string {
    if (value === null || value === undefined || isNaN(value)) return '-';
    return value.toFixed(2);
}

export function formatVND(value: number | null | undefined, options?: { showCurrency?: boolean }): string {
    if (value === null || value === undefined || isNaN(value)) return '-';
    const formatted = Math.abs(value).toLocaleString('vi-VN');
    if (options?.showCurrency === false) return formatted;
    // Simple VND formatting for now, or reuse formatFinancialValue logic if improved
    return `${value < 0 ? '-' : ''}${formatted} VND`;
}

/**
 * OpenBB Pro-inspired dark theme chart colors
 */
export const chartColors = {
    // Primary metrics
    revenue: '#3B82F6',      // Blue - Revenue/Sales
    profit: '#10B981',       // Green - Profit/Income
    expense: '#EF4444',      // Red - Expenses/Costs

    // Balance sheet
    assets: '#8B5CF6',       // Purple - Assets
    liabilities: '#F59E0B',  // Orange - Liabilities
    equity: '#06B6D4',       // Cyan - Equity

    // Cash flow
    operating: '#22C55E',    // Green - Operating CF
    investing: '#F97316',    // Orange - Investing CF
    financing: '#A855F7',    // Purple - Financing CF
    freeCashFlow: '#14B8A6', // Teal - FCF

    // Margins
    grossMargin: '#60A5FA',  // Light Blue
    operatingMargin: '#34D399', // Light Green
    netMargin: '#FBBF24',    // Yellow

    // Grid and text
    grid: '#374151',         // Gray-700
    text: '#9CA3AF',         // Gray-400
    background: '#111827',   // Gray-900
};

/**
 * Common chart configuration for dark theme
 */
export const chartConfig = {
    margin: { top: 10, right: 10, left: 0, bottom: 0 },
    style: {
        fontSize: 10,
        fontFamily: 'ui-monospace, monospace',
    },
};

/**
 * Calculate YoY growth percentage
 */
export function calculateYoYGrowth(current: number | undefined, previous: number | undefined): number | null {
    if (!current || !previous || previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Calculate margin percentage
 */
export function calculateMargin(numerator: number | undefined, denominator: number | undefined): number | null {
    if (!numerator || !denominator || denominator === 0) return null;
    return (numerator / denominator) * 100;
}
