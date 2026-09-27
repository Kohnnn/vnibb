import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useHistoricalPrices, useMicrostructureAnalysis } from '@/lib/queries';
import { widgetRegistry } from './WidgetRegistry';

jest.mock('@/lib/queries', () => ({
  useHistoricalPrices: jest.fn(),
  useMicrostructureAnalysis: jest.fn(),
}));

const historicalQuery = jest.mocked(useHistoricalPrices);
const microQuery = jest.mocked(useMicrostructureAnalysis);
const VolumeDelta = widgetRegistry.get('volume_delta')!.component;
const refetch = jest.fn();

function showVolumeDelta(candles: object[], microError: Error | null) {
  historicalQuery.mockReturnValue({
    data: { data: candles }, isLoading: false, isFetching: false,
    error: null, refetch, dataUpdatedAt: 1750000000000,
  } as never);
  microQuery.mockReturnValue({
    data: undefined, isLoading: false, isFetching: false,
    error: microError, refetch, dataUpdatedAt: 0,
  } as never);
  const onDataChange = jest.fn();
  render(<React.Suspense fallback={<span>Loading widget</span>}><VolumeDelta id="volume-saved" symbol="FPT" onDataChange={onDataChange} /></React.Suspense>);
  return onDataChange;
}

describe('volume_delta saved dashboard widget', () => {
  it('keeps derived historical volume available and marks it stale when microstructure fails', async () => {
    const candles = Array.from({ length: 32 }, (_, day) => ({
      time: new Date(Date.UTC(2025, 5, day + 1)).toISOString().slice(0, 10),
      open: 100, high: 120, low: 80, close: 110, volume: 1000,
    }));
    const onDataChange = showVolumeDelta(candles, new Error('Microstructure unavailable'));
    expect(await screen.findByText('Volume Delta (20D)')).toBeInTheDocument();
    expect(screen.getByText('OHLC proxy')).toBeInTheDocument();
    expect(screen.getByText('Cached')).toBeInTheDocument();
    await waitFor(() => expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({
      __widgetRuntime: expect.objectContaining({
        layoutHint: expect.objectContaining({ empty: false }),
        provenance: expect.objectContaining({ localOnly: true, stale: true }),
      }),
    })));
  });

  it('does not pretend sparse historical data is a computed volume delta', async () => {
    const onDataChange = showVolumeDelta([{
      time: '2025-06-01', open: 100, high: 120, low: 80, close: 110, volume: 1000,
    }], null);
    expect(await screen.findByText('Not enough historical candles')).toBeInTheDocument();
    expect(screen.queryByText('20D Cum')).not.toBeInTheDocument();
    await waitFor(() => expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({
      __widgetRuntime: expect.objectContaining({ layoutHint: expect.objectContaining({ empty: true }) }),
    })));
  });
});
