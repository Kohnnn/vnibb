import { act, render, screen, waitFor } from '@testing-library/react';
import { getCompanyEvents, getHistoricalPrices, getQuote } from '@/lib/api';
import { buildPriceHistoryRuntime, type PriceHistoryStatus } from '@/lib/priceChartScope';
import { getWidgetExportData } from '@/lib/widgetRuntime';
import { TradingViewAdvancedChart } from './TradingViewAdvancedChart';

const mockCandleSetData = jest.fn();
const mockLineSetData = jest.fn();
const mockAreaSetData = jest.fn();
const mockVolumeSetData = jest.fn();
const mockApplyOptions = jest.fn();
const mockTakeScreenshot = jest.fn(() => document.createElement('canvas'));
const mockSetMarkers = jest.fn();
const seriesMock = (setData: jest.Mock) => ({ setData, setMarkers: mockSetMarkers, applyOptions: jest.fn() });
const mockCreateChart = jest.fn(() => ({
  addCandlestickSeries: () => seriesMock(mockCandleSetData),
  addLineSeries: () => seriesMock(mockLineSetData),
  addAreaSeries: () => seriesMock(mockAreaSetData),
  addHistogramSeries: () => ({
    setData: mockVolumeSetData,
    applyOptions: jest.fn(),
    data: () => mockVolumeSetData.mock.calls.at(-1)?.[0] ?? [],
  }),
  priceScale: () => ({ applyOptions: jest.fn() }),
  timeScale: () => ({ setVisibleLogicalRange: jest.fn(), fitContent: jest.fn() }),
  applyOptions: mockApplyOptions,
  takeScreenshot: mockTakeScreenshot,
  subscribeCrosshairMove: jest.fn(),
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
  return {
    symbol: 'FPT', price: 57300, price_unit: 'VND',
    as_of: '2026-10-02T12:00:00+07:00', updated_at: '2026-10-02T12:00:00', ...overrides,
  };
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

  test('qualifies a failed VNM comparison while FPT candles remain available', async () => {
    mockHistory.mockImplementation(async (symbol: string) => {
      if (symbol === 'VNM') throw new Error('Comparison request rejected');
      return { data: [historyRow()] };
    });
    const onHistoryStatusChange = jest.fn<void, [PriceHistoryStatus]>();
    render(<TradingViewAdvancedChart symbol="FPT" compareSymbol="VNM" timeframe="1M" onHistoryStatusChange={onHistoryStatusChange} />);

    await waitFor(() => expect(mockCandleSetData).toHaveBeenCalledWith([
      { time: '2026-10-02', open: 57000, high: 57500, low: 56000, close: 57300 },
    ]));
    expect(mockHistory.mock.calls.map(([symbol]) => symbol)).toEqual(['FPT', 'VNM']);
    expect(mockHistory.mock.calls[1][1]).toEqual(mockHistory.mock.calls[0][1]);
    expect(mockLineSetData).not.toHaveBeenCalled();

    const status = onHistoryStatusChange.mock.lastCall![0];
    expect(status.request).toMatchObject({ symbol: 'FPT', compareSymbol: 'VNM', timeframe: '1M' });
    expect(status).toMatchObject({ observationStatus: 'available', coverage: 'partial' });
    expect(screen.getByRole('status', { name: 'Comparison history' })).toHaveTextContent('VNM comparison history could not be loaded.');

    const runtime = buildPriceHistoryRuntime(status.request, 'candles', status);
    expect(runtime.__widgetRuntime?.provenance).toMatchObject({
      observationStatus: 'available', coverage: 'partial', warnings: ['VNM comparison history could not be loaded.'],
    });
    expect(getWidgetExportData(runtime)).toMatchObject({ compareSymbol: 'VNM', comparisonStatus: 'unavailable' });

    const replacement = { ...status.request };
    const pending = buildPriceHistoryRuntime(replacement, 'candles', status);
    expect(pending.__widgetRuntime?.requestScope).toBe(replacement);
    expect(pending.__widgetRuntime?.provenance?.observationStatus).toBe('loading');
    expect(pending.__widgetRuntime?.provenance?.coverage).toBeUndefined();
    expect(pending.__widgetRuntime?.provenance?.warnings).toBeUndefined();
    expect(getWidgetExportData(pending)).not.toHaveProperty('comparisonStatus');
  });

  test.each([
    { kind: 'an endpoint error', body: { data: [], error: 'Synthetic response error' }, status: 'unavailable', notice: 'VNM comparison history could not be loaded.' },
    { kind: 'no observations', body: { data: [] }, status: 'empty', notice: 'No VNM comparison history is available for this range.' },
    { kind: 'uncertified observations', body: { data: [historyRow({ price_unit: 'unknown' })] }, status: 'unavailable', notice: 'VNM comparison history could not be plotted.' },
    { kind: 'a zero starting close', body: { data: [historyRow({ close: 0 })] }, status: 'unavailable', notice: 'VNM comparison history could not be plotted.' },
  ])('qualifies VNM history with $kind', async ({ body, status, notice }) => {
    mockHistory.mockImplementation(async (symbol: string) => symbol === 'VNM' ? body : { data: [historyRow()] });
    const onHistoryStatusChange = jest.fn<void, [PriceHistoryStatus]>();
    render(<TradingViewAdvancedChart symbol="FPT" compareSymbol="VNM" timeframe="1M" onHistoryStatusChange={onHistoryStatusChange} />);

    expect(await screen.findByRole('status', { name: 'Comparison history' })).toHaveTextContent(notice);
    expect(onHistoryStatusChange.mock.lastCall?.[0]).toMatchObject({
      observationStatus: 'available', coverage: 'partial', comparison: { observationStatus: status },
    });
    await waitFor(() => expect(mockCandleSetData).toHaveBeenCalled());
    expect(mockLineSetData).not.toHaveBeenCalled();
  });

  test('plots the replacement comparison and ignores an obsolete VNM failure', async () => {
    const obsolete = Promise.withResolvers<unknown>();
    mockHistory.mockImplementation(async (symbol: string) => {
      if (symbol === 'VNM') return obsolete.promise;
      if (symbol === 'VCB') {
        return { data: [historyRow({ close: 95000 }), historyRow({ time: '2026-10-05', close: 104500 })] };
      }
      return { data: [historyRow()] };
    });
    const onHistoryStatusChange = jest.fn<void, [PriceHistoryStatus]>();
    const chart = (compareSymbol: string) => (
      <TradingViewAdvancedChart symbol="FPT" compareSymbol={compareSymbol} timeframe="1M" onHistoryStatusChange={onHistoryStatusChange} />
    );
    const { rerender } = render(chart('VNM'));
    const signal = mockHistory.mock.calls.find(([symbol]) => symbol === 'VNM')?.[1].signal;
    expect(signal?.aborted).toBe(false);
    rerender(chart('VCB'));
    expect(signal?.aborted).toBe(true);

    expect(await screen.findByText('Compare VCB')).toBeInTheDocument();
    await waitFor(() => expect(mockLineSetData).toHaveBeenCalledWith([
      { time: '2026-10-02', value: 57300 },
      { time: '2026-10-05', value: expect.closeTo(63030) },
    ]));
    const status = onHistoryStatusChange.mock.lastCall![0];
    expect(status.request.compareSymbol).toBe('VCB');
    expect(status.observationStatus).toBe('available');
    expect(status.coverage).toBeUndefined();
    expect(getWidgetExportData(buildPriceHistoryRuntime(status.request, 'candles', status)))
      .toMatchObject({ compareSymbol: 'VCB', comparisonStatus: 'available' });

    await act(async () => { obsolete.reject(new Error('Obsolete comparison failed')); });
    expect(onHistoryStatusChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status', { name: 'Comparison history' })).not.toBeInTheDocument();
    expect(screen.getByText('Compare VCB')).toBeInTheDocument();
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

  test('ignores a quote observed before the latest history session', async () => {
    mockHistory.mockResolvedValue({ data: [historyRow({ close: 23220 })] });
    mockQuote.mockResolvedValue({ data: quote({ price: 31560, as_of: '2026-10-01T12:00:00+07:00' }) });
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

  test.each([
    ['2026-10-02T12:00:00+07:00', 57000],
    ['2026-10-02', 57000],
    ['2026-10-02T14:01:00+07:00', 57300],
  ])('orders the same-session observation %s against timestamped history', async (as_of, expectedClose) => {
    mockHistory.mockResolvedValue({ data: [historyRow({ time: '2026-10-02T14:00:00' })] });
    mockQuote.mockResolvedValue({ data: quote({ as_of }) });
    expect(await renderCandles()).toEqual([
      { time: '2026-10-02', open: 57000, high: 57500, low: 56000, close: expectedClose },
    ]);
  });

  test.each(['not-a-date', '2026-11-31T12:00:00+07:00'])('ignores invalid quote observation %s even with a valid update time', async (as_of) => {
    mockQuote.mockResolvedValue({ data: quote({ as_of }) });
    expect(await renderCandles()).toEqual([
      { time: '2026-10-02', open: 57000, high: 57500, low: 56000, close: 57000 },
    ]);
  });

  test.each([
    [null, 57000],
    ['2026-09-15T00:00:00+07:00', 57300],
  ])('uses the stored quote observation %s, not its November write date', async (as_of, expectedClose) => {
    mockHistory.mockResolvedValue({ data: [historyRow({ time: '2026-09-15' })] });
    mockQuote.mockResolvedValue({
      data: quote({ as_of, updated_at: '2026-11-18T18:00:00+07:00' }),
      meta: { source: 'postgres:stored_quote', as_of, stale: as_of === null ? null : true },
    });
    expect(await renderCandles()).toEqual([
      { time: '2026-09-15', open: 57000, high: 57500, low: 56000, close: expectedClose },
    ]);
  });

  test.each([
    '2026-10-05',
    '2026-10-05T00:00:00',
    '2026-10-04T17:00:00Z', // midnight October 5 on the exchange, still October 4 in UTC
    '2026-10-05T09:15:00+07:00',
  ])('appends the certified quote observation %s on the exchange session', async (as_of) => {
    mockHistory.mockResolvedValue({ data: [historyRow({ adjustment_applied: true, close: 23220 })] });
    mockQuote.mockResolvedValue({ data: quote({ as_of, updated_at: null }) });
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

// The PNG exporter cannot lighten a canvas: it asks the chart for a light
// rendering of the same content and keeps the live theme untouched.
describe('TradingViewAdvancedChart light capture', () => {
  const LIGHT_TOKENS = {
    '--bg-primary': '#ffffff',
    '--bg-secondary': '#ffffff',
    '--text-muted': '#5b6573',
    '--border-color': '#d9dde3',
    '--border-subtle': '#e8ecf1',
    '--color-positive': '#1e7b4f',
    '--color-negative': '#b3261e',
    '--chart-blue': '#0b3d91',
    '--chart-event-dividend': '#b45309',
    '--chart-event-split': '#6d28d9',
    '--chart-event-rights': '#0e7490',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockApplyOptions.mockClear();
    mockTakeScreenshot.mockClear();
    mockSetMarkers.mockClear();
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
    mockQuote.mockResolvedValue({ data: null });
    mockEvents.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.ResizeObserver = originalResizeObserver;
  });

  test('answers a capture request with a light bitmap and restores the live chart', async () => {
    const { container } = render(<TradingViewAdvancedChart symbol="FPT" timeframe="1M" />);
    await waitFor(() => expect(container.querySelector('[data-light-chart-capture]')).not.toBeNull());

    const host = container.querySelector<HTMLElement>('[data-light-chart-capture]');

    const detail: { token: (name: string) => string; canvas?: HTMLCanvasElement } = {
      token: (name) => LIGHT_TOKENS[name as keyof typeof LIGHT_TOKENS] ?? '',
    };
    host!.dispatchEvent(new CustomEvent('vnibb:capture-light-chart', { detail }));

    // The bitmap is the chart's own screenshot taken after the light repaint.
    expect(detail.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(mockTakeScreenshot).toHaveBeenCalled();
    const lightCall = mockApplyOptions.mock.calls.find(([options]) => options?.layout?.background?.color === '#ffffff');
    expect(lightCall?.[0]).toMatchObject({
      layout: { background: { color: '#ffffff' }, textColor: '#5b6573' },
    });

    // The live chart is dark again, so the export cannot leave the widget light.
    const lastCall = mockApplyOptions.mock.calls.at(-1)?.[0];
    // jsdom defines no --bg-primary, so the chart's own dark fallback comes back.
    expect(lastCall?.layout?.background?.color).toBe('#0b1220');
  });

  test('reports a refused snapshot and still restores the live chart', async () => {
    // An empty bitmap must not be reported as a successful capture.
    mockTakeScreenshot.mockImplementationOnce(() => {
      const blank = document.createElement('canvas');
      blank.width = 0;
      blank.height = 0;
      return blank;
    });
    const { container } = render(<TradingViewAdvancedChart symbol="FPT" timeframe="1M" />);
    await waitFor(() => expect(container.querySelector('[data-light-chart-capture]')).not.toBeNull());

    const host = container.querySelector<HTMLElement>('[data-light-chart-capture]');
    const detail: { token: (name: string) => string; canvas?: HTMLCanvasElement; error?: unknown } = {
      token: (name) => LIGHT_TOKENS[name as keyof typeof LIGHT_TOKENS] ?? '',
    };
    host!.dispatchEvent(new CustomEvent('vnibb:capture-light-chart', { detail }));

    // The exporter needs the failure signal; a missing canvas alone is ambiguous.
    expect(detail.canvas).toBeUndefined();
    expect(detail.error).toBeInstanceOf(Error);
    // The live chart is dark again despite the throw.
    const lastCall = mockApplyOptions.mock.calls.at(-1)?.[0];
    expect(lastCall?.layout?.background?.color).toBe('#0b1220');
  });

  test('snapshots the light repaint, then restores candles, volume and colours', async () => {
    const { container } = render(<TradingViewAdvancedChart symbol="FPT" timeframe="1M" />);
    await waitFor(() => expect(mockCandleSetData).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[data-light-chart-capture]')).not.toBeNull());

    const darkVolume = mockVolumeSetData.mock.calls.at(-1)?.[0];
    const detail: { token: (name: string) => string; canvas?: HTMLCanvasElement } = {
      token: (name) => LIGHT_TOKENS[name as keyof typeof LIGHT_TOKENS] ?? '',
    };
    container.querySelector<HTMLElement>('[data-light-chart-capture]')!
      .dispatchEvent(new CustomEvent('vnibb:capture-light-chart', { detail }));

    // The bitmap is taken after the light repaint, not before it.
    const lightIndex = mockApplyOptions.mock.calls
      .findIndex(([options]) => options?.layout?.background?.color === '#ffffff');
    expect(lightIndex).toBeGreaterThanOrEqual(0);
    expect(mockTakeScreenshot.mock.invocationCallOrder[0])
      .toBeGreaterThan(mockApplyOptions.mock.invocationCallOrder[lightIndex]);
    // Volume bars were recoloured for the snapshot, then put back with the same
    // bars (same times and values) so the live chart keeps its content.
    const volumeCalls = mockVolumeSetData.mock.calls.map(([data]) => data);
    const lightVolume = volumeCalls.find((data) => JSON.stringify(data).includes('rgba(30, 123, 79'));
    expect(lightVolume).toBeDefined();
    expect(volumeCalls.at(-1)).toEqual(darkVolume);
    // Candles kept their data throughout: only colours were touched.
    const candleCalls = mockCandleSetData.mock.calls.map(([data]) => data);
    expect(candleCalls.at(-1)).toEqual(candleCalls[0]);
  });

  // Marker hues are per-theme tokens and labels are 10 px text: the dark pastels
  // measure 1.8-2.7:1 on the white export, so the capture must re-apply the light
  // values and the widget must come back to the live ones.
  test('re-applies marker colours from the light cascade, then restores the live ones', async () => {
    mockEvents.mockResolvedValue({
      data: [{ symbol: 'FPT', action_category: 'dividend', effective_date: '2026-10-02' }],
    });
    const { container } = render(<TradingViewAdvancedChart symbol="FPT" timeframe="1M" />);
    await waitFor(() => expect(container.querySelector('[data-light-chart-capture]')).not.toBeNull());
    await waitFor(() => expect(mockSetMarkers).toHaveBeenCalled());

    const lastMarkers = () => mockSetMarkers.mock.calls.at(-1)?.[0] as Array<{ color: string }>;
    // jsdom resolves no theme tokens, so the live path falls back to the dark hues.
    expect(lastMarkers().some((marker) => marker.color === '#f59e0b')).toBe(true);

    const detail: { token: (name: string) => string; canvas?: HTMLCanvasElement } = {
      token: (name) => LIGHT_TOKENS[name as keyof typeof LIGHT_TOKENS] ?? '',
    };
    container.querySelector<HTMLElement>('[data-light-chart-capture]')!
      .dispatchEvent(new CustomEvent('vnibb:capture-light-chart', { detail }));

    expect(detail.canvas).toBeInstanceOf(HTMLCanvasElement);
    // Restored to the live value, never left on the light one.
    expect(lastMarkers()).toEqual([{ time: '2026-10-02', position: 'belowBar', color: '#f59e0b', shape: 'arrowDown', text: 'D' }]);
    const applied = mockSetMarkers.mock.calls.map(([markers]) => (markers as Array<{ color: string }>)[0]?.color);
    expect(applied).toContain('#b45309');
    // A canvas silently drops `var(...)`, so no call may carry one.
    for (const colour of applied) expect(colour).not.toContain('var(');
  });

  test('refuses the capture when the light palette is missing', async () => {
    const { container } = render(<TradingViewAdvancedChart symbol="FPT" timeframe="1M" />);
    await waitFor(() => expect(container.querySelector('[data-light-chart-capture]')).not.toBeNull());

    const detail: { token: (name: string) => string; canvas?: HTMLCanvasElement; error?: unknown } = {
      // An empty token means the light cascade never resolved; substituting the
      // dark value here would hand the exporter a dark bitmap.
      token: () => '',
    };
    container.querySelector<HTMLElement>('[data-light-chart-capture]')!
      .dispatchEvent(new CustomEvent('vnibb:capture-light-chart', { detail }));

    expect(detail.canvas).toBeUndefined();
    expect(detail.error).toBeInstanceOf(Error);
    expect(mockTakeScreenshot).not.toHaveBeenCalled();
    // The live chart is dark again despite the refusal.
    expect(mockApplyOptions.mock.calls.at(-1)?.[0]?.layout?.background?.color).toBe('#0b1220');
  });


});
