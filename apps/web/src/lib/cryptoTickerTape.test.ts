import { buildTradingViewRuntimeConfig } from '@/lib/tradingViewWidgets';
import { TAB_WIDGET_TEMPLATES } from '@/contexts/DashboardContext/templates';

const CRYPTO = ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT', 'BINANCE:BNBUSDT', 'BINANCE:XRPUSDT'];

describe('crypto ticker tape config reaches the runtime', () => {
  it('passes explicit crypto symbols to the TradingView iframe', () => {
    const out = buildTradingViewRuntimeConfig('tradingview_ticker_tape', { symbols: CRYPTO }, undefined);
    expect(out.symbols).toEqual(CRYPTO.map((proName) => ({ description: '', proName })));
  });

  it('uses supported cross-asset symbols when none are configured', () => {
    const out = buildTradingViewRuntimeConfig('tradingview_ticker_tape', {}, undefined);
    expect(out.symbols).toContainEqual({ description: '', proName: 'AMEX:SPY' });
    expect(out.symbols).not.toContainEqual({ description: '', proName: 'FX:USDVND' });
    expect(out.symbols).not.toContainEqual({ description: '', proName: 'TVC:DXY' });
  });

  it('removes blocked symbols and obsolete web-component options from saved settings', () => {
    const out = buildTradingViewRuntimeConfig('tradingview_ticker_tape', {
      symbols: ['BINANCE:BTCUSDT', 'FX:USDVND'],
      direction: 'vertical',
      showSymbolLogo: true,
    }, undefined);
    expect(out.symbols).toEqual([{ description: '', proName: 'BINANCE:BTCUSDT' }]);
    expect(out).not.toHaveProperty('direction');
    expect(out).not.toHaveProperty('showSymbolLogo');
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
    expect(runtime.symbols).toEqual(CRYPTO.map((proName) => ({ description: '', proName })));
  });
});
