import { render, screen, waitFor } from '@testing-library/react';
import { getCompanyEvents, getHistoricalPrices, getQuote } from '@/lib/api';
import { TradingViewAdvancedChart } from './TradingViewAdvancedChart';

const mockCandleSetData = jest.fn();
const mockLineSetData = jest.fn();
const mockAreaSetData = jest.fn();
const mockCreateChart = jest.fn(() => ({
  addCandlestickSeries: () => ({ setData: mockCandleSetData, setMarkers: jest.fn() }),
  addLineSeries: () => ({ setData: mockLineSetData, setMarkers: jest.fn() }),
  addAreaSeries: () => ({ setData: mockAreaSetData, setMarkers: jest.fn() }),
  addHistogramSeries: () => ({ setData: jest.fn() }),
  priceScale: () => ({ applyOptions: jest.fn() }),
  timeScale: () => ({ setVisibleLogicalRange: jest.fn(), fitContent: jest.fn() }),
  applyOptions: jest.fn(),
  remove: jest.fn(),
}));

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
  createChart: mockCreateChart,
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

async function renderRefusal() {
  render(<TradingViewAdvancedChart symbol="FPT" timeframe="1M" />);
  await waitFor(() => expect(screen.getByText(/No certified price series/)).toBeTruthy());
  return screen.getByText(/No certified price series/).textContent;
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

  test('refuses history whose rows carry no unit marker even when metadata claims confirmed_vnd', async () => {
    mockHistory.mockResolvedValue({ data: [historyRow({ price_unit: undefined })], meta: { unit_status: 'confirmed_vnd' } });
    expect(await renderRefusal()).toContain('no session carries a price-unit marker');
    // No bar may reach the renderer: plotting an unmarked magnitude as VND would
    // certify a unit the API never declared.
    expect(mockCandleSetData).not.toHaveBeenCalled();
  });

  test.each(['unknown', undefined])('refuses history with %s units when metadata is unconfirmed', async (price_unit) => {
    mockHistory.mockResolvedValue({ data: [historyRow({ price_unit })], meta: { unit_status: 'unconfirmed' } });
    await renderRefusal();
    expect(mockCandleSetData).not.toHaveBeenCalled();
  });

  test('does not let confirmed_vnd metadata certify an explicit unknown row marker', async () => {
    mockHistory.mockResolvedValue({ data: [historyRow({ price_unit: 'unknown' })], meta: { unit_status: 'confirmed_vnd' } });
    await renderRefusal();
    expect(mockCandleSetData).not.toHaveBeenCalled();
  });

  test('refuses a series whose marked sessions mix VND and index points', async () => {
    mockHistory.mockResolvedValue({
      data: [
        historyRow({ time: '2026-10-01', price_unit: 'VND' }),
        historyRow({ time: '2026-10-02', price_unit: 'index_points', close: 1210 }),
      ],
    });
    mockQuote.mockResolvedValue({ data: null });
    expect(await renderRefusal()).toContain('cannot share one price axis');
    expect(mockCandleSetData).not.toHaveBeenCalled();
  });

  test('keeps an unmarked session as a gap instead of joining it to the certified bars', async () => {
    mockHistory.mockResolvedValue({ data: [historyRow({ time: '2026-10-01', price_unit: 'unknown' }), historyRow()] });
    const data = await renderCandles();
    // The unmarked session keeps its slot as whitespace so the renderer breaks the
    // line there; dropping it would draw one continuous line across it.
    expect(data[0]).toEqual({ time: '2026-10-01' });
    expect(data[1].close).toBe(57000);
    // The VND quote must not be merged while an unmarked session is in the series.
    expect(data).toHaveLength(2);
    expect(screen.getByText('1 of 2 sessions excluded: price unit unconfirmed.')).toBeTruthy();
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

// A widget host can mount the chart while still detached (the wrapper defers the
// DOM attach), so the container reports 0x0 and the bounded frame retries are
// spent before the chart is ever created. The real size event is the progress
// signal; it must restart the render, otherwise the chart stays blank forever.
describe('TradingViewAdvancedChart detached mount', () => {
  // Mirrors MAX_CHART_SIZE_RETRIES in the component.
  const DETACHED_FRAME_BUDGET = 90;
  let frameQueue: FrameRequestCallback[];
  let resizeCallback: ResizeObserverCallback | null;
  let width = 0;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  beforeEach(() => {
    jest.clearAllMocks();
    frameQueue = [];
    resizeCallback = null;
    width = 0;
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      width, height: width > 0 ? 300 : 0, x: 0, y: 0, top: 0, left: 0,
      right: width, bottom: width > 0 ? 300 : 0, toJSON: () => ({}),
    }) as DOMRect);
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frameQueue.push(callback);
      return frameQueue.length;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
    global.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    mockHistory.mockResolvedValue({ data: [historyRow()] });
    mockQuote.mockResolvedValue({ data: quote() });
    mockEvents.mockResolvedValue({ data:[] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    global.ResizeObserver = originalResizeObserver;
  });

  test('renders the chart when the host gains size after the detached retries are spent', async () => {
    render(<TradingViewAdvancedChart symbol="FPT" timeframe="1M" />);
    await waitFor(() => expect(resizeCallback).not.toBeNull());

    // Burn the whole bounded frame budget while the container is detached.
    let frames = 0;
    while (frameQueue.length > 0) {
      const [callback] = frameQueue;
      frameQueue = [];
      callback(0);
      frames += 1;
      expect(frames).toBeLessThanOrEqual(DETACHED_FRAME_BUDGET);
    }
    expect(frames).toBe(DETACHED_FRAME_BUDGET);
    expect(mockCreateChart).not.toHaveBeenCalled();

    // The host is attached: a real positive-size observation arrives.
    width = 800;
    const observer = jest.fn() as unknown as ResizeObserver;
    resizeCallback?.(
      [{ target: document.createElement('div') } as unknown as ResizeObserverEntry],
      observer,
    );
    expect(frameQueue).toHaveLength(1);
    const [retry] = frameQueue;
    frameQueue = [];
    retry(0);

    await waitFor(() => expect(mockCreateChart).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockCandleSetData).toHaveBeenCalledWith([
      { time: '2026-10-02', open: 57000, high: 57500, low: 56000, close: 57300 },
    ]));
  });
});
