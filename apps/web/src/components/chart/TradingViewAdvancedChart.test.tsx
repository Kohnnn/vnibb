import { render, waitFor } from '@testing-library/react';
import { getCompanyEvents, getHistoricalPrices, getQuote } from '@/lib/api';
import { TradingViewAdvancedChart } from './TradingViewAdvancedChart';

const mockCandleSetData = jest.fn();
const mockLineSetData = jest.fn();
const mockAreaSetData = jest.fn();

jest.mock('@/lib/api', () => ({
  getCompanyEvents: jest.fn(),
  getHistoricalPrices: jest.fn(),
  getQuote: jest.fn(),
}));
jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}));
jest.mock('lightweight-charts', () => ({
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  createChart: jest.fn(() => ({
    addCandlestickSeries: () => ({ setData: mockCandleSetData, setMarkers: jest.fn() }),
    addLineSeries: () => ({ setData: mockLineSetData, setMarkers: jest.fn() }),
    addAreaSeries: () => ({ setData: mockAreaSetData, setMarkers: jest.fn() }),
    addHistogramSeries: () => ({ setData: jest.fn() }),
    priceScale: () => ({ applyOptions: jest.fn() }),
    timeScale: () => ({ setVisibleLogicalRange: jest.fn(), fitContent: jest.fn() }),
    applyOptions: jest.fn(),
    remove: jest.fn(),
  })),
}));

const mockHistory = getHistoricalPrices as jest.Mock;
const mockQuote = getQuote as jest.Mock;
const mockEvents = getCompanyEvents as jest.Mock;
const originalResizeObserver = global.ResizeObserver;

function historyRow(overrides: Record<string, unknown> = {}) {
  return {
    time: '2026-10-02', open: 57000, high: 57500, low: 56000, close: 57000,
    volume: 100, price_unit: 'VND', adjustment_applied: false, ...overrides,
  };
}

function quote(overrides: Record<string, unknown> = {}) {
  return { symbol: 'FPT', price: 57300, price_unit: 'VND', updated_at: '2026-10-02T12:00:00', ...overrides };
}

async function renderCandles() {
  render(<TradingViewAdvancedChart symbol="FPT" timeframe="1M" />);
  await waitFor(() => expect(mockCandleSetData).toHaveBeenCalled());
  return mockCandleSetData.mock.calls.at(-1)?.[0];
}

// Keep the real chart component and assert the data sent to the renderer boundary.
// Only the external canvas library is mocked; widget-level chart mocks cannot cover merging.
describe('TradingViewAdvancedChart price data consumed by the renderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800, height: 300, x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 300,
      toJSON: () => ({}),
    });
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
    mockHistory.mockResolvedValue({ data: [historyRow()] });
    mockQuote.mockResolvedValue({ data: quote() });
    mockEvents.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.ResizeObserver = originalResizeObserver;
  });

  test.each(['unknown', undefined])('rejects a 57.3 quote with %s unit without changing VND history', async (price_unit) => {
    mockQuote.mockResolvedValue({ data: quote({ price: 57.3, price_unit }) });
    expect(await renderCandles()).toEqual([
      { time: '2026-10-02', open: 57000, high: 57500, low: 56000, close: 57000 },
    ]);
  });

  test('merges an explicitly confirmed 57300 VND quote without conversion', async () => {
    expect(await renderCandles()).toEqual([
      { time: '2026-10-02', open: 57000, high: 57500, low: 56000, close: 57300 },
    ]);
  });

  test('preserves explicitly low VND prices in both history and quote', async () => {
    mockHistory.mockResolvedValue({ data: [historyRow({ open: 50, high: 60, low: 40, close: 50 })] });
    mockQuote.mockResolvedValue({ data: quote({ price: 57.3 }) });
    expect(await renderCandles()).toEqual([
      { time: '2026-10-02', open: 50, high: 60, low: 40, close: 57.3 },
    ]);
  });

  test.each([[31560, 23220], [23220, 31560]])('retains the first API duplicate (%s before %s), not the smallest close', async (first, second) => {
    mockHistory.mockResolvedValue({ data: [historyRow({ close: first }), historyRow({ close: second })] });
    mockQuote.mockResolvedValue({ data: null });
    expect(await renderCandles()).toEqual([
      { time: '2026-10-02', open: 57000, high: 57500, low: 56000, close: first },
    ]);
  });

  test('ignores an older quote rather than replacing adjusted historical observations', async () => {
    mockHistory.mockResolvedValue({ data: [historyRow({ adjustment_applied: true, close: 23220 })] });
    mockQuote.mockResolvedValue({ data: quote({ price: 31560, updated_at: '2026-10-01T12:00:00' }) });
    expect(await renderCandles()).toEqual([
      { time: '2026-10-02', open: 57000, high: 57500, low: 56000, close: 23220 },
    ]);
  });

  test('does not overwrite a same-day adjusted bar with a raw quote', async () => {
    mockHistory.mockResolvedValue({ data: [historyRow({ adjustment_applied: true, close: 23220 })] });
    mockQuote.mockResolvedValue({ data: quote({ price: 31560 }) });
    expect(await renderCandles()).toEqual([
      { time: '2026-10-02', open: 57000, high: 57500, low: 56000, close: 23220 },
    ]);
  });

  test('ignores a same-day quote older than the latest timestamped history row', async () => {
    mockHistory.mockResolvedValue({ data: [historyRow({ time: '2026-10-02T14:00:00' })] });
    expect(await renderCandles()).toEqual([
      { time: '2026-10-02', open: 57000, high: 57500, low: 56000, close: 57000 },
    ]);
  });

  test('ignores invalid quote timestamps', async () => {
    mockQuote.mockResolvedValue({ data: quote({ updated_at: 'not-a-date' }) });
    expect(await renderCandles()).toEqual([
      { time: '2026-10-02', open: 57000, high: 57500, low: 56000, close: 57000 },
    ]);
  });

  test('appends a newer confirmed quote without copying older adjusted OHLC into the new day', async () => {
    mockHistory.mockResolvedValue({ data: [historyRow({ adjustment_applied: true, close: 23220 })] });
    mockQuote.mockResolvedValue({ data: quote({ updated_at: '2026-10-05T12:00:00' }) });
    expect(await renderCandles()).toEqual([
      { time: '2026-10-02', open: 57000, high: 57500, low: 56000, close: 23220 },
      { time: '2026-10-05', open: 57300, high: 57300, low: 57300, close: 57300 },
    ]);
  });

  test('uses confirmed_vnd history metadata only when the row marker is missing', async () => {
    mockHistory.mockResolvedValue({ data: [historyRow({ price_unit: undefined })], meta: { unit_status: 'confirmed_vnd' } });
    expect((await renderCandles())[0].close).toBe(57300);
  });

  test.each(['unknown', undefined])('does not merge history with %s units when metadata is unconfirmed', async (price_unit) => {
    mockHistory.mockResolvedValue({ data: [historyRow({ price_unit })], meta: { unit_status: 'unconfirmed' } });
    expect((await renderCandles())[0].close).toBe(57000);
  });

  test('does not let confirmed_vnd metadata override an explicit unknown row marker', async () => {
    mockHistory.mockResolvedValue({ data: [historyRow({ price_unit: 'unknown' })], meta: { unit_status: 'confirmed_vnd' } });
    expect((await renderCandles())[0].close).toBe(57000);
  });

  test('rejects a quote when history contains mixed explicit units', async () => {
    mockHistory.mockResolvedValue({ data: [historyRow({ time: '2026-10-01', price_unit: 'unknown' }), historyRow()] });
    expect((await renderCandles())[1].close).toBe(57000);
  });

  test('merges confirmed index points without treating them as VND', async () => {
    mockHistory.mockResolvedValue({ data: [historyRow({ price_unit: 'index_points', open: 1200, high: 1250, low: 1190, close: 1210 })] });
    mockQuote.mockResolvedValue({ data: quote({ price_unit: 'index_points', price: 1220 }) });
    expect((await renderCandles())[0].close).toBe(1220);
  });

  test('rejects incompatible index quote and VND history', async () => {
    mockQuote.mockResolvedValue({ data: quote({ price_unit: 'index_points', price: 1220 }) });
    expect((await renderCandles())[0].close).toBe(57000);
  });

  test.each(['line', 'area'] as const)('passes unchanged canonical prices to the %s renderer', async (mode) => {
    mockQuote.mockResolvedValue({ data: quote({ price: 57.3, price_unit: 'unknown' }) });
    render(<TradingViewAdvancedChart symbol="FPT" timeframe="1M" mode={mode} />);
    const setData = mode === 'line' ? mockLineSetData : mockAreaSetData;
    await waitFor(() => expect(setData).toHaveBeenCalledWith([{ time: '2026-10-02', value: 57000 }]));
  });
});
