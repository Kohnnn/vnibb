import type { UseQueryResult } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { useHistoricalPrices } from '@/lib/queries';
import { getWidgetExportData, type WidgetDataPayload } from '@/lib/widgetRuntime';
import type { EquityHistoricalResponse } from '@/types/equity';
import { OBVDivergenceWidget } from './OBVDivergenceWidget';

jest.mock('@/lib/queries', () => ({ useHistoricalPrices: jest.fn() }));

const bearishVolumes = [1000, ...Array<number>(18).fill(0), 1000];

function mockHistory(volumes: Array<number | null>, uncertifiedIndex = -1) {
  const start = volumes.length - 20;
  jest.mocked(useHistoricalPrices).mockReturnValue({
    data: {
      data: volumes.map((volume, i) => {
        const close = i <= start ? 100 : i === volumes.length - 1 ? 105 : 110;
        return {
          symbol: 'FPT', time: new Date(Date.UTC(2025, 5, i + 1)).toISOString().slice(0, 10),
          open: close, high: close + 1, low: close - 1, close, volume,
          price_unit: i === uncertifiedIndex ? undefined : 'VND',
        };
      }),
      meta: { count: volumes.length, unit_status: 'confirmed_vnd' },
    },
    isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 1750000000000,
  } as unknown as UseQueryResult<EquityHistoricalResponse, Error>);
}

it.each<[string, Array<number | null>]>([
  ['exactly 20 returned bars', []],
  ['older unknown volume outside the lookback', [null, ...Array<number>(11).fill(1000)]],
])('computes the signal with %s', (_reason, older) => {
  mockHistory([...older, ...bearishVolumes]);
  const publish = jest.fn<void, [WidgetDataPayload]>();
  render(<OBVDivergenceWidget symbol="FPT" onDataChange={publish} />);

  expect(screen.getByText('Bearish Divergence')).toBeVisible();
  expect(screen.getByText('Confidence: 57%')).toBeVisible();
  const payload = publish.mock.lastCall?.[0];
  expect(payload?.__widgetRuntime?.layoutHint?.empty).toBe(false);
  expect(getWidgetExportData(payload)).toMatchObject({ signal: 'bearish', confidence: 57 });
});

it.each([0, 10, 19])('withholds OBV if bar %i of the 20-bar lookback has unknown volume', (gap) => {
  mockHistory([...Array<number>(12).fill(1000), ...bearishVolumes.map((volume, i) => i === gap ? null : volume)]);
  const publish = jest.fn<void, [WidgetDataPayload]>();
  render(<OBVDivergenceWidget symbol="FPT" onDataChange={publish} />);

  expect(screen.getByText('OBV divergence unavailable: incomplete observations in the 20-bar lookback.')).toBeVisible();
  expect(screen.queryByText(/Confidence:|No Divergence|Bearish Divergence/)).not.toBeInTheDocument();
  const payload = publish.mock.lastCall?.[0];
  expect(payload?.__widgetRuntime?.layoutHint?.empty).toBe(true);
  expect(getWidgetExportData(payload)).not.toHaveProperty('signal');
  expect(getWidgetExportData(payload)).not.toHaveProperty('confidence');
});

it('keeps no divergence for a fully measured zero window, then removes the signal for all-unknown volume', () => {
  mockHistory(Array<number>(20).fill(0));
  const publish = jest.fn<void, [WidgetDataPayload]>();
  const { rerender } = render(<OBVDivergenceWidget symbol="FPT" onDataChange={publish} />);

  expect(screen.getByText('No Divergence')).toBeVisible();
  expect(screen.getByText('OBV %').nextElementSibling).toHaveTextContent(/^0\.00%$/);
  expect(getWidgetExportData(publish.mock.lastCall?.[0])).toMatchObject({ signal: 'none' });

  mockHistory(Array<null>(20).fill(null));
  rerender(<OBVDivergenceWidget symbol="FPT" onDataChange={publish} />);
  expect(screen.queryByText('No Divergence')).not.toBeInTheDocument();
  expect(publish.mock.lastCall?.[0].__widgetRuntime?.layoutHint?.empty).toBe(true);
  expect(getWidgetExportData(publish.mock.lastCall?.[0])).not.toHaveProperty('signal');
});

it('does not compute OBV on fewer than 20 bars', () => {
  mockHistory(bearishVolumes.slice(1));
  const publish = jest.fn<void, [WidgetDataPayload]>();
  render(<OBVDivergenceWidget symbol="FPT" onDataChange={publish} />);

  expect(screen.getByText('Not enough historical candles')).toBeVisible();
  expect(getWidgetExportData(publish.mock.lastCall?.[0])).not.toHaveProperty('signal');
});

it('requires individual price-unit certification even for older historical rows', () => {
  mockHistory([0, ...bearishVolumes], 0);
  const publish = jest.fn<void, [WidgetDataPayload]>();
  render(<OBVDivergenceWidget symbol="FPT" onDataChange={publish} />);

  expect(screen.getByText(/historical price units were not certified/)).toBeVisible();
  expect(getWidgetExportData(publish.mock.lastCall?.[0])).not.toHaveProperty('signal');
});
