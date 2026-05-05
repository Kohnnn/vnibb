import { tokens } from '@/styles/tokens';

/**
 * Get a color value from tokens
 */
export function getColor(
  color: 'success' | 'danger' | 'warning' | 'chart',
  variant: 'main' | 'light' | 'dark' | 'bg' = 'main'
): string {
  if (color === 'chart') {
    return tokens.colors.chart.blue;
  }
  return (tokens.colors[color] as any)[variant];
}

/**
 * Get price change color
 */
export function getPriceColor(change: number | null): string {
  if (change === null) return tokens.colors.neutral[400];
  if (change > 0) return tokens.colors.success.main;
  if (change < 0) return tokens.colors.danger.main;
  return tokens.colors.neutral[400];
}

/**
 * Get price change background
 */
export function getPriceBgColor(change: number | null): string {
  if (change === null) return 'transparent';
  if (change > 0) return tokens.colors.success.bg;
  if (change < 0) return tokens.colors.danger.bg;
  return 'transparent';
}

/**
 * Format number with color class
 */
export function formatWithColor(value: number): { text: string; className: string } {
  const text = value >= 0 ? `+${value.toFixed(2)}%` : `${value.toFixed(2)}%`;
  const className = value > 0 ? 'text-green-500' : value < 0 ? 'text-red-500' : 'text-gray-400';
  return { text, className };
}
