import { formatPercent } from '@/lib/units'

function normalizeLikelyPercent(value: number): number {
  let normalized = value
  while (Math.abs(normalized) > 100) {
    normalized /= 100
  }
  return normalized
}

export function formatScreenerValue(value: any, format?: string): string {
  if (value === null || value === undefined) return '—';

  const numericValue = Number(value)
  const isNumeric = Number.isFinite(numericValue)
  
  switch (format) {
    case 'currency':
      return isNumeric ? formatCurrency(numericValue) : String(value);
    case 'percent':
      return isNumeric
        ? formatPercent(normalizeLikelyPercent(numericValue), { input: 'auto', decimals: 2 })
        : String(value);
    case 'change':
      if (!isNumeric) return String(value)
      const normalized = normalizeLikelyPercent(numericValue)
      const formatted = formatPercent(normalized, { input: 'auto', decimals: 2 })
      return normalized > 0 ? `+${formatted}` : formatted
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
