import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntradayTradesWidget } from './IntradayTradesWidget';
import { OrderbookWidget } from './OrderbookWidget';

jest.mock('@/contexts/SymbolLinkContext', () => ({
  useSymbolLink: () => ({ isWidgetLinked: () => false, toggleWidgetLink: jest.fn() }),
}));

const now = '2026-11-23T06:55:00Z';
const marketSession = {
  state: 'open', basis: 'exchange_status', checked_at: now, valid_until: '2026-11-23T07:00:00Z',
};
const priorSessionDate = '2026-11-20';
const originalFetch = global.fetch;

function renderBoth(outcome: 'network' | 'envelope' | 'empty' | 'covered') {
  const fetch = jest.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://offline.test').pathname;
    const isDepth = path.endsWith('/HPG/orderbook');
    if (!isDepth && !path.endsWith('/HPG/intraday')) throw new Error(`Unexpected request: ${path}`);
    if (outcome === 'network') throw new TypeError('Failed to fetch');
    const covered = outcome === 'covered' && !isDepth;
    const error = outcome === 'envelope' ? 'Request timed out' : null;
    return {
      ok: true, status: 200,
      json: async () => ({
        data: isDepth ? { symbol: 'HPG', entries: [] } : [],
        error,
        meta: error ? undefined : {
          market_session: marketSession,
          feed: {
            status: 'empty', requested_source: 'vnstock:VCI', source: covered ? 'vietcap:board' : 'vnstock:VCI',
            source_as_of: covered ? priorSessionDate : null, fetched_at: now, snapshot_at: null,
            delivery: covered ? 'retained' : 'provider', fallback: false,
            covered_window: covered ? { session_date: priorSessionDate, trade_count: 0, basis: 'vietcap_board' } : null,
          },
        },
      }),
    } as Response;
  });
  global.fetch = fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  render(<QueryClientProvider client={client}>
    <section aria-label="Depth"><OrderbookWidget symbol="HPG" /></section>
    <section aria-label="Tape"><IntradayTradesWidget id="tape" symbol="HPG" /></section>
  </QueryClientProvider>);
  return {
    fetch,
    depth: within(screen.getByRole('region', { name: 'Depth' })),
    tape: within(screen.getByRole('region', { name: 'Tape' })),
  };
}

beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(Date.parse(now) + 5000));
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

it.each(['network', 'envelope'] as const)('shows %s failure as unavailable, never as closed or zero trades', async (mode) => {
  const { depth, tape, fetch } = renderBoth(mode);
  expect(await tape.findByText('Intraday trade data unavailable')).toBeVisible();
  expect(await depth.findByText('Order book data unavailable')).toBeVisible();
  expect(fetch.mock.calls.map(([url]) => new URL(String(url), 'http://offline.test').pathname)).toEqual(
    expect.arrayContaining([expect.stringMatching(/\/HPG\/orderbook$/), expect.stringMatching(/\/HPG\/intraday$/)]),
  );
  expect(screen.queryByText(/Market closed|No trades (for|in)|No trade ticks returned|No priced depth returned/i)).not.toBeInTheDocument();
});

it('distinguishes genuine successful emptiness from failure and from verified zero', async () => {
  const { depth, tape } = renderBoth('empty');
  expect(await tape.findByText('No trade ticks returned')).toBeVisible();
  expect(await depth.findByText('No priced depth returned')).toBeVisible();
  expect(screen.queryByText(/unavailable|market closed|no trades in the covered/i)).not.toBeInTheDocument();
});

it('reserves zero-trade wording for the covered date', async () => {
  const { tape } = renderBoth('covered');
  expect(await tape.findByText(`No trades in the covered ${priorSessionDate} session`)).toBeVisible();
  expect(tape.queryByText('No trade ticks returned')).not.toBeInTheDocument();
});
