import { render, screen, within } from '@testing-library/react';
import { useTopMovers } from '@/lib/queries';
import { TopMoversWidget } from './TopMoversWidget';

jest.mock('@/lib/queries', () => ({ useTopMovers: jest.fn() }));
jest.mock('@/hooks/useWidgetSymbolLink', () => ({
  useWidgetSymbolLink: () => ({ setLinkedSymbol: jest.fn() }),
}));
const moversQuery = jest.mocked(useTopMovers);

function showMovers(data: object | undefined, error: Error | null) {
  moversQuery.mockReturnValue({
    data, error, isLoading:false, isFetching:false, refetch: jest.fn(),
    dataUpdatedAt: 1750000000000,
  } as never);
  render(<TopMoversWidget />);
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

  it('does not sign or colour a flat mover as a gain', async () => {
    showMovers({ data: [{ symbol: 'FPT', last_price: 100, price_change_pct: 0 }] }, null);
    const label = await screen.findByText('0.00%');
    expect(label.textContent).toBe('0.00%');
    expect(label.className).toContain('text-[var(--text-primary)]');
    expect(label.className).not.toContain('--color-positive');
  });

  it('prints a missing change and price as n/a, with no direction on the row', async () => {
    showMovers({ data: [{ symbol: 'FPT' }] }, null);
    const row = (await screen.findByText('FPT')).closest('button')!;
    expect(within(row).getAllByText('n/a')).toHaveLength(2);
    expect(within(row).queryByText('--')).not.toBeInTheDocument();
    // The rank badge is only a direction cue for a measured move; a missing
    // reading must not paint it loss-red.
    const badge = within(row).getByText('1');
    expect(badge.className).not.toContain('--color-positive');
    expect(badge.className).not.toContain('--color-negative');
  });
});
