export const DEFAULT_GLOBAL_MARKETS_SYMBOL = 'AMEX:SPY';
export const GLOBAL_MARKETS_SYMBOL_STORAGE_KEY = 'vnibb-global-markets-symbol';
export const LEGACY_GLOBAL_MARKETS_SYMBOLS = new Set(['NASDAQ:VFS', 'SP:SPX']);

// Track C migration: any value that doesn't include an exchange prefix (i.e.
// has no colon) is a VN ticker that leaked from `applySelectedSymbol` into
// the TradingView channel during prior versions. Reset to the canonical
// default so TV widgets render correctly without requiring a manual reset.
const GLOBAL_MARKETS_SYMBOL_PATTERN = /^[A-Z0-9]+:[A-Z0-9_!./-]+$/;
const LEGACY_GLOBAL_MARKETS_SYMBOL_PATTERN = /^[A-Z0-9:_!./-]+$/;

export function normalizeGlobalMarketsSymbol(rawSymbol: string | null | undefined): string | null {
  const normalized = String(rawSymbol || '').trim().toUpperCase();
  if (!normalized) return null;
  if (LEGACY_GLOBAL_MARKETS_SYMBOLS.has(normalized)) return null;

  // Strict TradingView shape: must look like EXCHANGE:SYMBOL.
  if (GLOBAL_MARKETS_SYMBOL_PATTERN.test(normalized)) {
    return normalized;
  }
  return null;
}

export function isLegacyGlobalMarketsSymbol(rawSymbol: string | null | undefined): boolean {
  return LEGACY_GLOBAL_MARKETS_SYMBOLS.has(String(rawSymbol || '').trim().toUpperCase());
}

/**
 * Loose pattern used only for back-compat with values written before the
 * Track C migration. Callers should not use this for new writes.
 */
export function isWellFormedGlobalMarketsSymbolLegacy(rawSymbol: string | null | undefined): boolean {
  const normalized = String(rawSymbol || '').trim().toUpperCase();
  return Boolean(normalized) && LEGACY_GLOBAL_MARKETS_SYMBOL_PATTERN.test(normalized);
}

export function readStoredGlobalMarketsSymbol(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_GLOBAL_MARKETS_SYMBOL;
  }

  const stored = window.localStorage.getItem(GLOBAL_MARKETS_SYMBOL_STORAGE_KEY);
  const normalized = normalizeGlobalMarketsSymbol(stored);

  if (normalized) {
    return normalized;
  }

  // Migration: a stored value that does NOT match the strict EXCHANGE:SYMBOL
  // pattern is either a leftover VN ticker (e.g. 'MBB') or stale junk. Reset.
  if (stored && stored.length > 0) {
    try {
      window.localStorage.setItem(GLOBAL_MARKETS_SYMBOL_STORAGE_KEY, DEFAULT_GLOBAL_MARKETS_SYMBOL);
    } catch {
      // ignore storage errors (private mode, etc.)
    }
  }

  return DEFAULT_GLOBAL_MARKETS_SYMBOL;
}

export function writeStoredGlobalMarketsSymbol(symbol: string): string | null {
  const normalized = normalizeGlobalMarketsSymbol(symbol);
  if (!normalized) return null;

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(GLOBAL_MARKETS_SYMBOL_STORAGE_KEY, normalized);
  }

  return normalized;
}
