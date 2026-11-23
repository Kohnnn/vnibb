import * as React from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { useHistoricalPrices, useMicrostructureAnalysis } from '@/lib/queries';
import type { MicrostructureResponse } from '@/lib/api';
import { getWidgetExportData, type WidgetDataPayload } from '@/lib/widgetRuntime';
import type { EquityHistoricalResponse } from '@/types/equity';
import { widgetRegistry } from './WidgetRegistry';

jest.mock('@/lib/queries', () => ({
  useHistoricalPrices: jest.fn(),
  useMicrostructureAnalysis: jest.fn(),
}));

const historicalQuery = jest.mocked(useHistoricalPrices);
const microQuery = jest.mocked(useMicrostructureAnalysis);
const VolumeDelta = widgetRegistry.get('volume_delta')!.component;
const refetch = jest.fn();

function mockHistory(candles: object[]) {
  const certifiedCandles = candles.map((row) => ({ symbol: 'FPT', price_unit: 'VND', ...row }));
  historicalQuery.mockReturnValue({
    data: { data: certifiedCandles, meta: { count: certifiedCandles.length, unit_status: 'confirmed_vnd' } },
    isLoading: false, isFetching: false, error: null,
    refetch, dataUpdatedAt: 1750000000000,
  } as unknown as UseQueryResult<EquityHistoricalResponse, Error>);
}

function renderVolumeDelta() {
  const onDataChange = jest.fn<void, [WidgetDataPayload]>();
  const view = () => (
    <React.Suspense fallback={<span>Loading widget</span>}>
      <VolumeDelta id="volume-saved" symbol="FPT" onDataChange={onDataChange} />
    </React.Suspense>
  );
  const { rerender } = render(view());
  return { onDataChange, refresh: () => rerender(view()) };
}

function showVolumeDelta(candles: object[], microError: Error | null) {
  mockHistory(candles);
  microQuery.mockReturnValue({
    data: undefined, isLoading: false, isFetching: false,
    error: microError, refetch, dataUpdatedAt: 0,
  } as unknown as UseQueryResult<MicrostructureResponse, Error>);
  return renderVolumeDelta();
}

function mockIntraday(bars: object[]) {
  microQuery.mockReturnValue({
    data: { data: { deep_trades: { bars } } }, isLoading: false, isFetching: false,
    error: null, refetch, dataUpdatedAt: 1750000000000,
  } as unknown as UseQueryResult<MicrostructureResponse, Error>);
}

function showIntradayVolumeDelta(bars: object[]) {
  mockHistory([]);
  mockIntraday(bars);
  return renderVolumeDelta().onDataChange;
}

function dailyCandles(volumeAt: (index: number) => unknown) {
  return Array.from({ length: 32 }, (_, index) => ({
    time: new Date(Date.UTC(2025, 5, index + 1)).toISOString().slice(0, 10),
    open: 100, high: 120, low: 80, close: 110, volume: volumeAt(index),
  }));
}

describe('volume_delta saved dashboard widget', () => {
  it('reports intraday bars as observed daily flow without claiming 20 days of coverage', async () => {
    const bars = Array.from({ length: 40 }, (_, index) => ({
      time: `2025-06-16T${String(Math.floor(index / 12) + 9).padStart(2, '0')}:${String((index % 12) * 5).padStart(2, '0')}:00Z`,
      delta: 100, cumulative_delta: (index + 1) * 100,
    }));
    showIntradayVolumeDelta(bars);

    expect(await screen.findByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Today').parentElement).toHaveTextContent('+4.0K');
    expect(screen.queryByText('20D Cum')).not.toBeInTheDocument();
    expect(screen.getByText('Loaded Cum').parentElement).toHaveTextContent('+4.0K');
  });

  it('switches Today to the latest observed trading day while retaining loaded cumulative flow', async () => {
    showIntradayVolumeDelta([
      { time: '2025-06-16T14:55:00Z', delta: 200, cumulative_delta: 200 },
      { time: '2025-06-17T09:00:00Z', delta: -50, cumulative_delta: 150 },
      { time: '2025-06-17T09:05:00Z', delta: -25, cumulative_delta: 125 },
    ]);

    expect(await screen.findByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Today').parentElement).toHaveTextContent('-75');
    expect(screen.getByText('Loaded Cum').parentElement).toHaveTextContent('+125');
  });

  it('keeps a successful historical proxy and reports microstructure failure separately', async () => {
    const { onDataChange } = showVolumeDelta(dailyCandles(() => 1000), new Error('Microstructure unavailable'));
    expect(await screen.findByText('Volume Delta (20D)')).toBeInTheDocument();
    expect(screen.getByText('OHLC proxy')).toBeInTheDocument();
    expect(screen.getByText('Today').parentElement).toHaveTextContent('+500');
    expect(screen.getByText('20D Cum').parentElement).toHaveTextContent('+10.0K');
    expect(screen.getByRole('status')).toHaveTextContent('Microstructure unavailable');
    expect(screen.queryByText(/^(Cached|Refresh failed)$/)).not.toBeInTheDocument();
    await waitFor(() => expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({
      __widgetRuntime: expect.objectContaining({
        layoutHint: expect.objectContaining({ empty: false }),
        provenance: expect.objectContaining({
          localOnly: true, cached: false, refreshStatus: 'succeeded', observationStatus: 'available',
          warnings: ['Microstructure unavailable'],
        }),
      }),
    })));
    expect(getWidgetExportData(onDataChange.mock.lastCall?.[0])).toEqual({ cumulativeDelta: 16_000 });
  });

  it('does not pretend sparse historical data is a computed volume delta', async () => {
    const { onDataChange } = showVolumeDelta([{
      time: '2025-06-01', open: 100, high: 120, low: 80, close: 110, volume: 1000,
    }], null);
    expect(await screen.findByText('Not enough historical candles')).toBeInTheDocument();
    expect(screen.queryByText('20D Cum')).not.toBeInTheDocument();
    await waitFor(() => expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({
      __widgetRuntime: expect.objectContaining({ layoutHint: expect.objectContaining({ empty: true }) }),
    })));
  });

  it.each<[string, (index: number) => unknown]>([
    ['all volumes are unknown', () => null],
    ['an older bar needed for the cumulative result is unknown', (i) => i === 0 ? null : 1000],
    ['a recent volume is invalid', (i) => i === 26 ? -1 : 1000],
  ])('withholds the OHLC proxy when %s', async (_reason, volumeAt) => {
    const { onDataChange } = showVolumeDelta(dailyCandles(volumeAt), new Error('Microstructure unavailable'));

    expect(await screen.findByText('Volume delta unavailable: incomplete historical observations.')).toBeVisible();
    expect(screen.queryByText('Aligned flow')).not.toBeInTheDocument();
    expect(screen.queryByText('20D Cum')).not.toBeInTheDocument();
    const payload = onDataChange.mock.lastCall?.[0];
    expect(payload?.__widgetRuntime?.layoutHint?.empty).toBe(true);
    expect(getWidgetExportData(payload)).toBeUndefined();
  });

  it('keeps measured zero, then clears the previous flow when the latest volume becomes unknown', async () => {
    const { onDataChange, refresh } = showVolumeDelta(dailyCandles(() => 0), null);

    expect(await screen.findByText('Aligned flow')).toBeVisible();
    expect(screen.getByText('20D Cum').nextElementSibling).toHaveTextContent(/^0$/);
    expect(getWidgetExportData(onDataChange.mock.lastCall?.[0])).toEqual({ cumulativeDelta: 0 });

    mockHistory(dailyCandles((i) => i === 31 ? null : 0));
    refresh();
    expect(screen.queryByText('Aligned flow')).not.toBeInTheDocument();
    expect(onDataChange.mock.lastCall?.[0].__widgetRuntime?.layoutHint?.empty).toBe(true);
    expect(getWidgetExportData(onDataChange.mock.lastCall?.[0])).toBeUndefined();
  });

  it('uses real microstructure flow even when historical volume is incomplete', async () => {
    mockHistory(dailyCandles(() => null));
    mockIntraday([{ time: '2025-06-16T14:55:00Z', delta: -75, cumulative_delta: -75 }]);
    const { onDataChange } = renderVolumeDelta();

    expect(await screen.findByText('Mongo match-type flow')).toBeVisible();
    expect(screen.getByText('Today').parentElement).toHaveTextContent('-75');
    expect(getWidgetExportData(onDataChange.mock.lastCall?.[0])).toEqual({ cumulativeDelta: -75 });
  });

  it('still requires price-unit markers on the individual OHLC bars', async () => {
    const candles = dailyCandles(() => 1000).map((bar) => ({ ...bar, price_unit: undefined }));
    const { onDataChange } = showVolumeDelta(candles, null);

    expect(await screen.findByText(/historical price units were not certified/)).toBeVisible();
    expect(getWidgetExportData(onDataChange.mock.lastCall?.[0])).toBeUndefined();
  });
});
