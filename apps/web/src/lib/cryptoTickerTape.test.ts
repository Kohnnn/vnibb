import { buildTradingViewRuntimeConfig } from '@/lib/tradingViewWidgets';
import { TAB_WIDGET_TEMPLATES } from '@/contexts/DashboardContext/templates';

const CRYPTO = ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT', 'BINANCE:BNBUSDT', 'BINANCE:XRPUSDT'];

describe('crypto ticker tape config reaches the runtime', () => {
  it('passes an explicit symbols list through unchanged', () => {
    const out = buildTradingViewRuntimeConfig('tradingview_ticker_tape', { symbols: CRYPTO }, undefined);
    expect(out.symbols).toEqual(CRYPTO);
  });

  it('falls back to the widget default list when no symbols are configured', () => {
    const out = buildTradingViewRuntimeConfig('tradingview_ticker_tape', {}, undefined);
    expect(Array.isArray(out.symbols)).toBe(true);
    expect((out.symbols as string[]).length).toBeGreaterThan(0);
    expect(out.symbols as string[]).not.toEqual(CRYPTO);
  });

  // Regression: the template used to pass `symbolsPreset: 'crypto_majors'`,
  // which no renderer reads — the tape silently fell back to the cross-asset
  // default list. Pin the config to a key that is actually consumed.
  it('the shipped crypto template carries symbols the renderer reads', () => {
    const tape = TAB_WIDGET_TEMPLATES.global_markets_crypto.find(
      (widget) => widget.type === 'tradingview_ticker_tape',
    );
    expect(tape).toBeDefined();
    expect(tape?.config?.symbols).toEqual(CRYPTO);
    expect(tape?.config).not.toHaveProperty('symbolsPreset');

    const runtime = buildTradingViewRuntimeConfig('tradingview_ticker_tape', tape?.config, undefined);
    expect(runtime.symbols).toEqual(CRYPTO);
  });
});
