import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { WidgetHeaderVisibilityProvider } from '@/components/ui/WidgetContainer';
import type { MarketBreadthResponse } from '@/lib/api';
import { MarketBreadthWidget } from './MarketBreadthWidget';

jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }));

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function renderBreadth(snapshots: readonly MarketBreadthResponse[]) {
  const remaining = snapshots[Symbol.iterator]();
  const fixtureFetch = async (request: RequestInfo | URL, init?: RequestInit): Promise<Pick<Response, 'ok' | 'json'>> => {
    const { pathname, search } = new URL(String(request));
    if (pathname !== '/api/v1/market/breadth' || search || (init?.method ?? 'GET') !== 'GET') {
      throw new Error(`Unexpected fixture request: ${String(request)}`);
    }
    const snapshot = remaining.next();
    if (snapshot.done) throw new Error('No breadth fixture remaining');
    return { ok: true, json: async () => snapshot.value };
  };
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fixtureFetch });

  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  render(
    <QueryClientProvider client={client}>
      <WidgetHeaderVisibilityProvider hideHeader>
        <MarketBreadthWidget id="breadth" />
      </WidgetHeaderVisibilityProvider>
    </QueryClientProvider>,
  );
}

const hoseOnly = {
  count: 1,
  data: [{
    exchange: 'HOSE', total: 200, advancers: 0, decliners: 102, unchanged: 98,
    pct_above_sma20: null, pct_above_sma50: null, new_highs_52w: 0, new_lows_52w: 4, ad_ratio: 0,
  }],
  updated_at: '2026-11-06T07:00:00Z',
} satisfies MarketBreadthResponse;

it('keeps admitted HOSE counts and discloses the missing exchanges separately from unknown time', async () => {
  renderBreadth([hoseOnly]);

  expect(await screen.findByText('HOSE')).toBeVisible();
  expect(screen.getByText('▲ 0')).toBeVisible();
  expect(screen.getByText('▼ 102')).toBeVisible();
  expect(screen.getByText('= 98')).toBeVisible();
  expect(screen.getByText('0.00')).toBeVisible();
  expect(screen.getAllByText('n/a')).toHaveLength(2);
  expect(screen.getByText('As-of unknown')).toBeVisible();
  expect(screen.queryByText('HNX')).not.toBeInTheDocument();
  expect(screen.queryByText('UPCOM')).not.toBeInTheDocument();
  const coverage = screen.getByRole('status');
  expect(coverage).toBeVisible();
  expect(coverage).toHaveTextContent(/\bHNX\b/);
  expect(coverage).toHaveTextContent(/\bUPCOM\b/);
});

it('keeps an exchange with zero observations distinct from an omitted exchange', async () => {
  renderBreadth([{
    count: 2,
    data: [
      ...hoseOnly.data,
      { exchange: 'HNX', total: 0, advancers: 0, decliners: 0, unchanged: 0, new_highs_52w: 0, new_lows_52w: 0 },
    ],
  }]);

  expect(await screen.findByText('HNX')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent(/\bUPCOM\b/);
  expect(screen.getByRole('status')).not.toHaveTextContent(/\bHNX\b/);
  expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
  expect(screen.getByText(/no observations/i)).toBeVisible();
});

it('computes bias only from classified changes and discloses the admitted coverage', async () => {
  renderBreadth([{
    count: 1,
    data: [{ exchange: 'HOSE', total: 10, advancers: 2, decliners: 1, unchanged: 1,
      new_highs_52w: 0, new_lows_52w: 0, ad_ratio: 2 }],
  }]);
  expect(await screen.findByText('HOSE')).toBeVisible();
  expect(screen.getByText('+25.0%')).toBeVisible();
  expect(screen.getByText('4 of 10 classified')).toBeVisible();
});

it('does not present unknown price changes as a measured zero breadth bias', async () => {
  renderBreadth([{
    count: 1,
    data: [{
      exchange: 'HOSE', total: 200, advancers: 0, decliners: 0, unchanged: 0,
      new_highs_52w: 0, new_lows_52w: 0, ad_ratio: null, pct_above_sma20: 0,
    }],
  }]);

  expect(await screen.findByText('HOSE')).toBeVisible();
  expect(screen.getByText('200')).toBeVisible();
  expect(screen.queryByText(/no observations/i)).not.toBeInTheDocument();
  // The measured SMA20 is zero. Unknown SMA50 and breadth bias are not.
  expect(screen.getAllByText('0.0%')).toHaveLength(1);
  expect(screen.getAllByText('n/a')).toHaveLength(2);
});

it('clears the coverage warning when the same widget refreshes to all three exchanges', async () => {
  renderBreadth([hoseOnly, {
    count: 3,
    data: [
      { exchange: 'HOSE', total: 200, advancers: 102, decliners: 60, unchanged: 38, new_highs_52w: 9, new_lows_52w: 4, ad_ratio: 1.7 },
      { exchange: 'HNX', total: 180, advancers: 96, decliners: 60, unchanged: 24, new_highs_52w: 7, new_lows_52w: 4, ad_ratio: 1.6 },
      { exchange: 'UPCOM', total: 160, advancers: 90, decliners: 60, unchanged: 10, new_highs_52w: 5, new_lows_52w: 4, ad_ratio: 1.5 },
    ],
    updated_at: '2026-11-18T06:45:00Z',
  }]);

  expect(await screen.findByRole('status')).toHaveTextContent(/\bHNX\b/);

  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

  expect(await screen.findByText('UPCOM')).toBeVisible();
  expect(screen.getByText('HNX')).toBeVisible();
  expect(screen.getByText('HOSE')).toBeVisible();
  expect(screen.getByText('▲ 102')).toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText('As-of unknown')).toBeVisible();
});

it('distinguishes unavailable coverage from an empty successful breadth', async () => {
  renderBreadth([
    { count: 0, data: [], error: 'Verified screener Universe unavailable' },
    { count: 0, data: [], error: null },
  ]);

  expect(await screen.findByText('Market breadth unavailable')).toBeVisible();
  expect(screen.queryByText('Breadth data not available yet')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

  expect(await screen.findByText('Breadth data not available yet')).toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
