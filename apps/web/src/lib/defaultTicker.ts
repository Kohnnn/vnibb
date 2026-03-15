export const DEFAULT_TICKER = 'VCI';
export const GLOBAL_SYMBOL_STORAGE_KEY = 'vnibb-global-symbol';

const TICKER_PATTERN = /^[A-Z0-9]{3}$/;

export function normalizeTickerSymbol(rawSymbol: string | null | undefined): string | null {
  const raw = String(rawSymbol || '').toUpperCase().trim();
  if (!raw) return null;

  const tokens = raw.split(/[^A-Z0-9]+/).filter(Boolean);
  const candidate = tokens[0] || raw;

  if (!TICKER_PATTERN.test(candidate)) return null;
  return candidate;
}

export function readStoredTicker(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_TICKER;
  }

  const normalized = normalizeTickerSymbol(window.localStorage.getItem(GLOBAL_SYMBOL_STORAGE_KEY));
  return normalized || DEFAULT_TICKER;
}

export function writeStoredTicker(symbol: string): string | null {
  const normalized = normalizeTickerSymbol(symbol);
  if (!normalized) return null;

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(GLOBAL_SYMBOL_STORAGE_KEY, normalized);
  }

  return normalized;
}
