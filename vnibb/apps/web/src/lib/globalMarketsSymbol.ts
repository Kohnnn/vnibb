export const DEFAULT_GLOBAL_MARKETS_SYMBOL = 'NASDAQ:VFS';
export const GLOBAL_MARKETS_SYMBOL_STORAGE_KEY = 'vnibb-global-markets-symbol';

const GLOBAL_MARKETS_SYMBOL_PATTERN = /^[A-Z0-9:_!./-]+$/;

export function normalizeGlobalMarketsSymbol(rawSymbol: string | null | undefined): string | null {
  const normalized = String(rawSymbol || '').trim().toUpperCase();
  if (!normalized) return null;

  if (!GLOBAL_MARKETS_SYMBOL_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

export function readStoredGlobalMarketsSymbol(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_GLOBAL_MARKETS_SYMBOL;
  }

  const normalized = normalizeGlobalMarketsSymbol(
    window.localStorage.getItem(GLOBAL_MARKETS_SYMBOL_STORAGE_KEY),
  );

  return normalized || DEFAULT_GLOBAL_MARKETS_SYMBOL;
}

export function writeStoredGlobalMarketsSymbol(symbol: string): string | null {
  const normalized = normalizeGlobalMarketsSymbol(symbol);
  if (!normalized) return null;

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(GLOBAL_MARKETS_SYMBOL_STORAGE_KEY, normalized);
  }

  return normalized;
}
