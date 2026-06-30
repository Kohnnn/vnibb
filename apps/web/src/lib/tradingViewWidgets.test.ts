import { buildTradingViewRuntimeConfig } from '@/lib/tradingViewWidgets';

describe('buildTradingViewRuntimeConfig TradingView theme sync', () => {
  it('uses the app light theme for advanced chart when no widget override exists', () => {
    // Given: an advanced chart with no per-widget theme override.
    const config = { symbol: 'NASDAQ:AAPL' };

    // When: the app theme is light.
    const runtimeConfig = buildTradingViewRuntimeConfig(
      'tradingview_chart',
      config,
      'NASDAQ:AAPL',
      'light',
    );

    // Then: TradingView receives the app theme through its chart theme key.
    expect(runtimeConfig.theme).toBe('light');
  });

  it('keeps an explicit advanced chart theme override ahead of the app light theme', () => {
    // Given: an advanced chart with a saved dark per-widget theme override.
    const config = { symbol: 'NASDAQ:AAPL', theme: 'dark' };

    // When: the app theme is light.
    const runtimeConfig = buildTradingViewRuntimeConfig(
      'tradingview_chart',
      config,
      'NASDAQ:AAPL',
      'light',
    );

    // Then: the explicit widget override wins.
    expect(runtimeConfig.theme).toBe('dark');
  });
});
