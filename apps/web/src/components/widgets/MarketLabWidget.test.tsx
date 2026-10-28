import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { useHistoricalPrices } from '@/lib/queries';
import { widgetRegistry } from './WidgetRegistry';

jest.mock('@/lib/queries', () => ({ useHistoricalPrices: jest.fn() }));
const historyQuery = jest.mocked(useHistoricalPrices);
const MarketLab = widgetRegistry.get('market_lab')!.component;

function showMarketLab(rows: object[], error: Error | null) {
  // Canonical fixture: the widget certifies each row by its own `price_unit`
  // marker, so the fixture states VND per row plus the matching response-level
  // status (QA #98).
  const certifiedRows = rows.map((row) => ({ price_unit: 'VND', ...row }));
  historyQuery.mockReturnValue({
    data: {
      data: certifiedRows,
      meta: { count: certifiedRows.length, unit_status: 'confirmed_vnd' },
    },
    isLoading:false, isFetching:false,
    error, dataUpdatedAt: 1750000000000, refetch: jest.fn(),
  } as never);
  const onDataChange = jest.fn();
  render(<React.Suspense fallback={<span>Loading widget</span>}><MarketLab id="saved-market-lab" symbol="FPT" onDataChange={onDataChange} /></React.Suspense>);
  return onDataChange;
}

describe('market_lab saved dashboard widget', () => {
  it('preserves calculated history and signals stale data when a refresh fails', async () => {
    const rows = Array.from({ length: 90 }, (_, day) => ({
      time: new Date(Date.UTC(2025, 0, day + 1)).toISOString().slice(0, 10),
      close: 100 + day + Math.sin(day) * 5, volume: 1000 + day,
    }));
    const onDataChange = showMarketLab(rows, new Error('Offline'));
    expect(await screen.findByText('Market Lab')).toBeInTheDocument();
    expect(screen.getByText('Sharpe')).toBeInTheDocument();
    expect(screen.getByText('Cached')).toBeInTheDocument();
    expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({
      __widgetRuntime: expect.objectContaining({ provenance: expect.objectContaining({ stale: true }) }),
    }));
  });

  it('reports insufficient historical bars without displaying fabricated statistics', async () => {
    showMarketLab([], null);
    expect(await screen.findByText('Not enough history for FPT')).toBeInTheDocument();
    expect(screen.queryByText('Sharpe')).not.toBeInTheDocument();
  });
});
