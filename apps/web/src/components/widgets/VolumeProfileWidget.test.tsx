import type { UseQueryResult } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { MicrostructureResponse } from '@/lib/api';
import { useHistoricalPrices, useMicrostructureAnalysis } from '@/lib/queries';
import { getWidgetExportData, type WidgetDataPayload } from '@/lib/widgetRuntime';
import type { EquityHistoricalResponse } from '@/types/equity';
import { VolumeProfileWidget } from './VolumeProfileWidget';

jest.mock('@/lib/queries', () => ({
  useHistoricalPrices: jest.fn(),
  useMicrostructureAnalysis: jest.fn(),
}));

const settled = { isLoading: false, isFetching: false, error: null, dataUpdatedAt: 1750000000000, refetch: jest.fn() };

function mockHistory(volumes: unknown[], meta: EquityHistoricalResponse['meta'] = { count: volumes.length }, certified = true) {
  jest.mocked(useHistoricalPrices).mockReturnValue({
    ...settled,
    data: {
      data: volumes.map((volume, i) => ({
        symbol: 'FPT', time: `2025-06-${String(i + 1).padStart(2, '0')}`,
        open: 104, high: 128, low: i === 0 ? 80 : 112, close: i === 0 ? 104 : 120,
        volume, price_unit: certified ? 'VND' : undefined,
      })),
      meta: { unit_status: 'confirmed_vnd', ...meta },
    },
  } as unknown as UseQueryResult<EquityHistoricalResponse, Error>);
}

beforeEach(() => {
  jest.mocked(useMicrostructureAnalysis).mockReturnValue(settled as unknown as UseQueryResult<MicrostructureResponse, Error>);
});

it.each([
  [null, null],
  [2_000_000, null],
  [2_000_000, -1],
])('withholds the historical bins for volumes %s and %s', (first, second) => {
  mockHistory([first, second]);
  const publish = jest.fn<void, [WidgetDataPayload]>();
  render(<VolumeProfileWidget symbol="FPT" onDataChange={publish} />);

  expect(screen.getByText('Volume profile unavailable: incomplete historical observations.')).toBeVisible();
  expect(screen.queryByText('POC')).not.toBeInTheDocument();
  const payload = publish.mock.lastCall?.[0];
  expect(payload?.__widgetRuntime?.layoutHint?.empty).toBe(true);
  expect(getWidgetExportData(payload)).toBeUndefined();
});

it('withholds the profile when history reports a partial requested period even with observed volume on every returned bar', () => {
  mockHistory([2_000_000, 0], { count: 2, completeness_status: 'partial' });
  const publish = jest.fn<void, [WidgetDataPayload]>();
  render(<VolumeProfileWidget symbol="FPT" onDataChange={publish} />);

  expect(screen.getByText('Volume profile unavailable: incomplete historical observations.')).toBeVisible();
  expect(screen.queryByText('POC')).not.toBeInTheDocument();
  expect(getWidgetExportData(publish.mock.lastCall?.[0])).toBeUndefined();
});

it('admits a measured zero bar alongside nonzero volume, then clears the POC when a bar is unknown', () => {
  mockHistory([2_000_000, 0]);
  const publish = jest.fn<void, [WidgetDataPayload]>();
  const view = <VolumeProfileWidget symbol="FPT" onDataChange={publish} />;
  const { rerender } = render(view);

  expect(screen.getByText('POC').nextElementSibling).toHaveTextContent('105.00');
  expect(getWidgetExportData(publish.mock.lastCall?.[0])).toEqual({ bins: 24, pocPrice: 105 });

  mockHistory([2_000_000, null]);
  rerender(<VolumeProfileWidget symbol="FPT" onDataChange={publish} />);
  expect(screen.queryByText('POC')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '6M' })).toBeVisible();
  expect(publish.mock.lastCall?.[0].__widgetRuntime?.layoutHint?.empty).toBe(true);
  expect(getWidgetExportData(publish.mock.lastCall?.[0])).toBeUndefined();
});

it('does not select a price level when all returned volume was measured at zero', () => {
  mockHistory([0, 0]);
  const publish = jest.fn<void, [WidgetDataPayload]>();
  render(<VolumeProfileWidget symbol="FPT" onDataChange={publish} />);

  expect(screen.getByText('No traded volume in the returned bars.')).toBeVisible();
  expect(screen.queryByText('POC')).not.toBeInTheDocument();
  expect(getWidgetExportData(publish.mock.lastCall?.[0])).toBeUndefined();
});

it('retains the profile based on trade ticks when the historical data is incomplete', () => {
  mockHistory([null, null]);
  jest.mocked(useMicrostructureAnalysis).mockReturnValue({
    ...settled,
    data: {
      data: {
        volume_profile: {
          quality: 'observed', bins: [{ price: 120, volume: 1000 }, { price: 130, volume: 10 }],
          poc_price: null, vah_price: null, val_price: null,
        },
      },
    },
  } as unknown as UseQueryResult<MicrostructureResponse, Error>);
  const publish = jest.fn<void, [WidgetDataPayload]>();
  render(<VolumeProfileWidget symbol="FPT" onDataChange={publish} />);

  expect(screen.getByText('POC').nextElementSibling).toHaveTextContent('120.00');
  expect(publish.mock.lastCall?.[0].__widgetRuntime?.provenance?.sourceLabel).toBe('Volume profile · trade ticks');
  expect(getWidgetExportData(publish.mock.lastCall?.[0])).toEqual({ bins: 2, pocPrice: 120 });
});

it('still requires price-unit markers on the individual historical bars', () => {
  mockHistory([2_000_000, 0], { count: 2 }, false);
  const publish = jest.fn<void, [WidgetDataPayload]>();
  render(<VolumeProfileWidget symbol="FPT" onDataChange={publish} />);

  expect(screen.getByText(/historical price units were not certified/)).toBeVisible();
  expect(getWidgetExportData(publish.mock.lastCall?.[0])).toBeUndefined();
});
