import { buildTickerPaletteSections, rankCommandPaletteItems, saveRecentSearch } from '@/lib/commandPalette';

describe('commandPalette helpers', () => {
  test('rankCommandPaletteItems prioritizes symbol prefix matches', () => {
    const items = rankCommandPaletteItems('vc', [
      { id: '1', type: 'vn_stock', label: 'VNM', symbol: 'VNM', description: 'Vinamilk' },
      { id: '2', type: 'vn_stock', label: 'VCI', symbol: 'VCI', description: 'Vietcap Securities' },
    ]);

    expect(items[0].symbol).toBe('VCI');
  });

  test('buildTickerPaletteSections groups recents, stocks, crypto, and commands', () => {
    const sections = buildTickerPaletteSections(
      '',
      [{ symbol: 'VCI', label: 'Vietcap Securities', type: 'vn_stock' }],
      [{ symbol: 'BTC', name: 'Bitcoin', type: 'crypto', exchange: 'CRYPTO', tv_symbol: 'BINANCE:BTCUSDT' }],
      [{ id: 'command:settings', type: 'command', label: 'Open Settings', description: 'Navigate to app settings' }],
    );

    expect(sections.some((section) => section.key === 'crypto')).toBe(true);
    expect(sections.some((section) => section.key === 'commands')).toBe(true);
  });

  test('global assets advertise TradingView routing and VN sections stay explicit', () => {
    const sections = buildTickerPaletteSections(
      'spx',
      [],
      [
        { symbol: 'SPX', name: 'S&P 500 Index', type: 'index', exchange: 'INDEX', tv_symbol: 'SP:SPX' },
        { symbol: 'VCI', name: 'Vietcap Securities', type: 'vn_stock', exchange: 'HOSE', tv_symbol: 'HOSE:VCI' },
      ],
      [],
    );

    expect(sections.find((section) => section.key === 'global')?.label).toBe('Global & Macro');
    expect(sections.find((section) => section.key === 'global')?.items[0]?.description).toContain('TradingView');
  });

  test('saveRecentSearch keeps newest item first without duplicates', () => {
    const recents = saveRecentSearch(
      [{ symbol: 'VCI', label: 'Vietcap Securities', type: 'vn_stock' }],
      { symbol: 'BTC', label: 'Bitcoin', type: 'crypto' },
    );

    const deduped = saveRecentSearch(recents, { symbol: 'VCI', label: 'Vietcap Securities', type: 'vn_stock' });
    expect(deduped[0].symbol).toBe('VCI');
    expect(deduped).toHaveLength(2);
  });
});
