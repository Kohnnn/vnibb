import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { useTopMovers } from '@/lib/queries';
import { widgetRegistry } from './WidgetRegistry';

jest.mock('@/lib/queries', () => ({ useTopMovers: jest.fn() }));
jest.mock('@/hooks/useWidgetSymbolLink', () => ({
  useWidgetSymbolLink: () => ({ setLinkedSymbol: jest.fn() }),
}));
const moversQuery = jest.mocked(useTopMovers);
const TopMovers = widgetRegistry.get('top_movers')!.component;

function showMovers(data: object | undefined, error: Error | null) {
  moversQuery.mockReturnValue({
    data, error, isLoading:false, isFetching:false, refetch: jest.fn(),
    dataUpdatedAt: 1750000000000,
  } as never);
  render(<React.Suspense fallback={<span>Loading widget</span>}><TopMovers id="market-movers" /></React.Suspense>);
}

describe('top movers provenance', () => {
  it('keeps provider-success rows identified as the requested movers', async () => {
    showMovers({ data: [{ symbol: 'FPT', last_price: 100, price_change_pct: 2.5 }] }, null);
    expect(await screen.findByText('FPT')).toBeInTheDocument();
    expect(screen.getByText('Top gainers')).toBeInTheDocument();
    expect(screen.queryByText(/showing fallback movers/i)).not.toBeInTheDocument();
  });

  it('explains fallback rows instead of presenting them as requested gainers', async () => {
    showMovers({
      data: [{ symbol: 'FPT', last_price: 100, price_change_pct: 2.5 }],
      error: "Requested 'gainer' movers unavailable, returned snapshot-derived fallback",
      is_last_session:true,
      session_label: '2026-09-28',
    }, null);
    expect(await screen.findByText('FPT')).toBeInTheDocument();
    expect(screen.getByText(/Requested gainers unavailable; showing last-session fallback \(2026-09-28\)/i)).toBeInTheDocument();
  });

  it('does not present an unverified snapshot date as source freshness', async () => {
    showMovers({
      updated_at: '2026-10-08T12:00:00Z',
      data: [{ symbol: 'FPT', last_price: 100, price_change_pct: 2.5, updated_at: '2026-10-08T12:00:00Z' }],
    }, null);
    await screen.findByText('FPT');
    expect(screen.getByText('As-of unknown')).toBeInTheDocument();
  });

  it('treats an unsuccessful empty API response as unavailable, not an empty market', async () => {
    showMovers({ data: [], error: 'Provider secret/internal details' }, null);
    expect(await screen.findByText('Market mover provider unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    expect(screen.queryByText('Market mover data will appear when available.')).not.toBeInTheDocument();
    expect(screen.queryByText('Provider secret/internal details')).not.toBeInTheDocument();
  });
});
