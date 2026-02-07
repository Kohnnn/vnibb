export function toTradingViewSymbol(symbol: string, exchange?: string) {
  const trimmed = symbol?.trim();
  if (!trimmed) return '';
  if (trimmed.includes(':')) return trimmed.toUpperCase();

  const normalizedExchange = exchange?.trim().toUpperCase();
  if (!normalizedExchange) return trimmed.toUpperCase();

  const mapped = normalizeExchange(normalizedExchange);
  return mapped ? `${mapped}:${trimmed.toUpperCase()}` : trimmed.toUpperCase();
}

function normalizeExchange(exchange: string) {
  if (['HOSE', 'HSX'].includes(exchange)) return 'HOSE';
  if (exchange === 'HNX') return 'HNX';
  if (['UPCOM', 'UPCO'].includes(exchange)) return 'UPCOM';
  return exchange;
}
