export function formatScreenerValue(value: any, format?: string): string {
  if (value === null || value === undefined) return '—';
  
  switch (format) {
    case 'currency':
      return formatCurrency(value);
    case 'percent':
      return `${(value * 100).toFixed(2)}%`;
    case 'change':
      const prefix = value >= 0 ? '+' : '';
      return `${prefix}${(value * 100).toFixed(2)}%`;
    case 'number':
      return formatNumber(value);
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
