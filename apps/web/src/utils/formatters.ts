import { EMPTY_VALUE, formatPercent } from '@/lib/units'

function normalizeLikelyPercent(value: number): number {
  let normalized = value
  while (Math.abs(normalized) > 100) {
    normalized /= 100
  }
  return normalized
}

export function formatScreenerValue(value: any, format?: string): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  const numericValue = Number(value)
  const isNumeric = Number.isFinite(numericValue)
  
  switch (format) {
    case 'currency':
      return isNumeric ? formatCurrency(numericValue) : String(value);
    case 'percent':
      // Provider percent fields arrive in percentage points (a 0.75% move is
      // `0.75`), so `input: 'auto'` would rescale anything under 1 into 75%.
      return isNumeric
        ? formatPercent(normalizeLikelyPercent(numericValue), { input: 'percent', decimals: 2 })
        : String(value);
    case 'change':
      if (!isNumeric) return String(value)
      return formatPercent(normalizeLikelyPercent(numericValue), { input: 'percent', decimals: 2, signed: true })
    case 'number':
      return isNumeric ? formatNumber(numericValue) : String(value);
    default:
      return String(value);
  }
}

function formatCurrency(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(0);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}
