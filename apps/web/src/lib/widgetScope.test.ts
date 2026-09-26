import { readTickerScope, resolveWidgetSymbol } from './widgetScope';

/**
 * The selector now routes every widget through `resolveWidgetSymbol`. These
 * cases pin the pre-existing behaviour that must not shift when a widget has
 * neither a persisted scope nor an in-memory override.
 */
describe('resolveWidgetSymbol default (no scope, no override)', () => {
  it('falls back to the group ticker for every group id', () => {
    for (const groupSymbol of ['VCI', 'FPT', 'VNM', '']) {
      expect(resolveWidgetSymbol(readTickerScope(undefined), groupSymbol)).toBe(groupSymbol);
      expect(resolveWidgetSymbol(readTickerScope({}), groupSymbol)).toBe(groupSymbol);
    }
  });

  it('ignores a vendored config symbol while the scope is group', () => {
    // TradingView charts keep `config.symbol`; the wrapper feeds displaySymbol
    // to the child only through the TradingView branch (`symbol || scopedSymbol`).
    const scope = readTickerScope({ symbol: 'HPG', useLinkedSymbol: false });
    expect(scope).toEqual({ mode: 'group', symbol: null });
    expect(resolveWidgetSymbol(scope, 'VCI')).toBe('VCI');
  });

  it('degrades an unusable override to the group ticker', () => {
    expect(resolveWidgetSymbol(readTickerScope({ tickerScope: 'override' }), 'VCI')).toBe('VCI');
    expect(resolveWidgetSymbol(readTickerScope({ tickerScope: 'override', symbol: 'X' }), 'VCI')).toBe('VCI');
    expect(resolveWidgetSymbol(readTickerScope({ tickerScope: 'override' }), '')).toBe('');
  });
});
