import {
  DEFAULT_GLOBAL_MARKETS_SYMBOL,
  GLOBAL_MARKETS_SYMBOL_STORAGE_KEY,
  isLegacyGlobalMarketsSymbol,
  normalizeGlobalMarketsSymbol,
  readStoredGlobalMarketsSymbol,
} from './globalMarketsSymbol';

describe('globalMarketsSymbol', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('rejects legacy default symbols that should not seed Global Markets', () => {
    expect(normalizeGlobalMarketsSymbol('NASDAQ:VFS')).toBeNull();
    expect(normalizeGlobalMarketsSymbol('SP:SPX')).toBeNull();
    expect(isLegacyGlobalMarketsSymbol('nasdaq:vfs')).toBe(true);
  });

  it('resets a stored legacy Global Markets symbol to SPY', () => {
    window.localStorage.setItem(GLOBAL_MARKETS_SYMBOL_STORAGE_KEY, 'NASDAQ:VFS');

    expect(readStoredGlobalMarketsSymbol()).toBe(DEFAULT_GLOBAL_MARKETS_SYMBOL);
    expect(window.localStorage.getItem(GLOBAL_MARKETS_SYMBOL_STORAGE_KEY)).toBe(DEFAULT_GLOBAL_MARKETS_SYMBOL);
  });
});
