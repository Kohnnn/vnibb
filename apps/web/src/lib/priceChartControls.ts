import type { AdvancedChartMode, AdvancedChartTimeframe } from '@/components/chart/TradingViewAdvancedChart';

export const PRICE_CHART_TIMEFRAME_OPTIONS: ReadonlyArray<{ value: AdvancedChartTimeframe; label: string }> = [
  { value: '1D', label: '1D' },
  { value: '5D', label: '5D' },
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: '3Y', label: '3Y' },
  { value: '5Y', label: '5Y' },
  { value: 'MAX', label: 'MAX' },
  { value: 'YTD', label: 'YTD' },
];

export const PRICE_CHART_MODE_OPTIONS: ReadonlyArray<{ value: AdvancedChartMode; label: string }> = [
  { value: 'candles', label: 'Candles' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
];

export function normalizePriceChartTimeframe(value: unknown): AdvancedChartTimeframe {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (normalized === 'ALL') return 'MAX';
  if (normalized === '1W') return '5D';
  return PRICE_CHART_TIMEFRAME_OPTIONS.find(option => option.value === normalized)?.value ?? '1Y';
}

export function normalizePriceChartMode(value: unknown): AdvancedChartMode {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'candle' || normalized === 'candlestick') return 'candles';
  return PRICE_CHART_MODE_OPTIONS.find(option => option.value === normalized)?.value ?? 'candles';
}
