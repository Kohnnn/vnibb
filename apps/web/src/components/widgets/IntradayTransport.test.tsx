import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { equityQueryKeys } from '@/lib/queries/equity';
import type { IntradayEnvelope, IntradayFeed, IntradayMarketSession } from '@/types/intraday';
import { IntradayTradesWidget } from './IntradayTradesWidget';
import { OrderbookWidget } from './OrderbookWidget';

jest.mock('@/contexts/SymbolLinkContext', () => ({
  useSymbolLink: () => ({ isWidgetLinked: () => false, toggleWidgetLink: jest.fn() }),
}));

const now = '2026-11-23T06:55:00Z';
const marketSession: IntradayMarketSession = {
  state: 'open', basis: 'exchange_status', checked_at: now, valid_until: '2026-11-23T07:00:00Z',
};
const priorSessionDate = '2026-11-20';
const originalFetch = global.fetch;

type Reply = (IntradayEnvelope & { data: unknown }) | 'network';

function envelope(data: unknown, feed: Partial<IntradayFeed> = {}): Reply {
  return {
    data,
    meta: {
      market_session: marketSession,
      feed: {
        status: 'empty', requested_source: 'vnstock:VCI', source: 'vnstock:VCI',
        source_as_of: null, fetched_at: now, snapshot_at: null,
        delivery: 'provider', fallback: false, covered_window: null, ...feed,
      },
    },
  };
}

function book(entries: unknown[]) {
  return { symbol: 'HPG', entries };
}

function zero(basis: 'vietcap_board' | 'completed_tick_session' = 'vietcap_board') {
  return envelope([], {
    source: basis === 'vietcap_board' ? 'vietcap:board' : 'postgres:intraday_trades',
    source_as_of: priorSessionDate,
    delivery: 'retained',
    covered_window: { session_date: priorSessionDate, trade_count: 0, basis },
  });
}

function print(time: string, values: { price?: number; volume?: number } = {}) {
  return { symbol: 'HPG', time, price: 25000, volume: 432, ...values };
}

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

function renderBoth({ depth = [envelope(book([]))], tape = [envelope([])], client = queryClient() }: {
  depth?: Reply[];
  tape?: Reply[];
  client?: QueryClient;
} = {}) {
  const depthReplies = [...depth];
  const tapeReplies = [...tape];
  const fetch = jest.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://offline.test').pathname;
    const reply = path.endsWith('/HPG/orderbook') ? depthReplies.shift()
      : path.endsWith('/HPG/intraday') ? tapeReplies.shift() : undefined;
    if (!reply) throw new Error(`Unexpected request: ${path}`);
    if (reply === 'network') throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, json: async () => reply } as Response;
  });
  global.fetch = fetch;
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

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse(now) + 5000);
  // Give the real virtualized tape a viewport in jsdom so row cells are rendered.
  jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

it.each(['network', 'envelope'] as const)('shows %s failure as unavailable, never as closed or zero trades', async (mode) => {
  const failure = mode === 'network' ? 'network' : { data: [], error: 'Request timed out' };
  const { depth, tape, fetch } = renderBoth({ depth: [failure], tape: [failure] });
  expect(await tape.findByText('Intraday trade data unavailable')).toBeVisible();
  expect(await depth.findByText('Order book data unavailable')).toBeVisible();
  expect(fetch.mock.calls.map(([url]) => new URL(String(url), 'http://offline.test').pathname)).toEqual(
    expect.arrayContaining([expect.stringMatching(/\/HPG\/orderbook$/), expect.stringMatching(/\/HPG\/intraday$/)]),
  );
  expect(screen.queryByText(/Market closed|No trades (for|in)|No trade ticks returned|No priced depth returned/i)).not.toBeInTheDocument();
});

it('distinguishes genuine successful emptiness from failure and from verified zero', async () => {
  const { depth, tape } = renderBoth();
  expect(await tape.findByText('No trade ticks returned')).toBeVisible();
  expect(await depth.findByText('No priced depth returned')).toBeVisible();
  expect(screen.queryByText(/unavailable|market closed|no trades in the covered/i)).not.toBeInTheDocument();
});

it('reports only the dated Vietcap board zero, not an exchange-wide zero', async () => {
  const { tape } = renderBoth({ tape: [zero()] });
  expect(await tape.findByText(`No trades on the Vietcap board for ${priorSessionDate}`)).toBeVisible();
  expect(tape.getByText(/does not establish odd-lot or put-through activity/i)).toBeVisible();
  expect(tape.queryByText('No trade ticks returned')).not.toBeInTheDocument();
});

it('keeps the completed tick session zero wording', async () => {
  const { tape } = renderBoth({ tape: [zero('completed_tick_session')] });
  expect(await tape.findByText(`No trades in the covered ${priorSessionDate} session`)).toBeVisible();
});

it('renders only positive finite depth levels, including a numeric legacy price alias', async () => {
  const { depth } = renderBoth({ depth: [envelope(book([
    { price: 0, bid_price: '27', bid_vol: 100 },
    { price: -2, bid_vol: 111 },
    { price: true, bid_vol: 222 },
    { price: [38], bid_vol: 333 },
    { price: 'Infinity', bid_vol: 444 },
    { price: 0, bid_vol: 555 },
  ]), { status: 'available' })] });
  expect(await depth.findByText('27')).toBeVisible();
  expect(depth.getByText('1 levels')).toBeVisible();
  for (const unpricedVolume of ['111', '222', '333', '444', '555']) {
    expect(depth.queryByText(unpricedVolume)).not.toBeInTheDocument();
  }
});

const failedDepth = { status: 'unusable' } as const;
const referenceDepth = { ...failedDepth, delivery: 'reference', fallback: true, source: 'retained_close' } as const;
const legacyReferenceDepth = {
  data: { ...book([{ price: 42, price_status: 'reference', bid_vol: 900 }]), price_source: 'latest_price' },
};

it.each([
  ['unpriced levels', envelope(book([{ price: 0, bid_vol: 900 }]), failedDepth)],
  ['reference delivery', envelope(book([{ price: 42, bid_vol: 900 }]), referenceDepth)],
  ['legacy reference levels without feed metadata or error', legacyReferenceDepth],
] as const)('keeps genuine depth and its as-of on an HTTP 200 failure with %s', async (_kind, failure) => {
  const { depth } = renderBoth({ depth: [envelope(book([{ price: 0, bidPrice: '27', bid_vol: 123 }]), {
    status: 'available', source_as_of: priorSessionDate,
  }), failure] });

  expect(await depth.findByText('27')).toBeVisible();
  fireEvent.click(depth.getByTitle('Refresh'));

  expect(await depth.findByText(/Refresh failed.*Showing retained observations/)).toBeVisible();
  expect(depth.getByText('Retained observations')).toBeVisible();
  expect(depth.getByText(`As of ${priorSessionDate}`)).toBeVisible();
  expect(depth.getByText('27')).toBeVisible();
  expect(depth.getByText('123')).toBeVisible();
  expect(depth.queryByText('42')).not.toBeInTheDocument();
  expect(depth.queryByText('900')).not.toBeInTheDocument();
  expect(depth.queryByText('Ref Price')).not.toBeInTheDocument();
});

it.each([
  ['explicit', envelope(book([{ price: 42, bid_vol: 900 }]), referenceDepth)],
  ['legacy', legacyReferenceDepth],
] as const)('renders %s reference prices as reference only without genuine retained depth', async (_kind, reply) => {
  const { depth } = renderBoth({ depth: [reply] });
  expect(await depth.findByText('Ref Price')).toBeVisible();
  expect(depth.getByText('42')).toBeVisible();
  expect(depth.getByText(/Reference pricing only/)).toBeVisible();
  expect(depth.getByText(/not live bid\/ask depth/i)).toBeVisible();
  expect(depth.queryByText(/^(Live.*|Cumulative Depth|Price|Order book data unavailable)$/i)).not.toBeInTheDocument();
});

it.each([
  ['empty', { data: book([]) }, 'No priced depth returned'],
  ['priced', { data: book([{ price: 31, bid_vol: 650 }]) }, '31'],
] as const)('replaces old depth with a successful %s refresh', async (_kind, reply, expected) => {
  const { depth } = renderBoth({ depth: [envelope(book([{ price: 27, bid_vol: 123 }]), {
    status: 'available', source_as_of: priorSessionDate,
  }), reply] });
  expect(await depth.findByText('27')).toBeVisible();
  fireEvent.click(depth.getByTitle('Refresh'));

  expect(await depth.findByText(expected)).toBeVisible();
  expect(depth.queryByText('27')).not.toBeInTheDocument();
  expect(depth.queryByText(/Refresh failed|Retained observations/)).not.toBeInTheDocument();
});

it.each(['2026-11-19T22:15:07Z', '2026-11-21T00:02:03+10:00'])(
  'keeps a same-session tape print with timestamp %s instead of accepting a successful board zero', async (time) => {
    const { tape } = renderBoth({ tape: [envelope([print(time)], {
      status: 'available', source_as_of: time,
    }), zero()] });
    expect(await tape.findByText('432')).toBeVisible();
    const previousAsOf = tape.getByText(/^As of /).textContent!;
    expect(previousAsOf).not.toBe(`As of ${priorSessionDate}`);

    fireEvent.click(tape.getByTitle('Refresh'));

    expect(await tape.findByText(/Showing retained observations/)).toBeVisible();
    expect(tape.getByText('432')).toBeVisible();
    expect(tape.getByText(previousAsOf)).toBeVisible();
    expect(tape.queryByText(/Refresh failed|No trades|Covered session/i)).not.toBeInTheDocument();
  },
);

it.each([
  ['another market date', print('2026-11-20T23:15:00Z')],
  ['a naive clock on the date', print('2026-11-20T13:32:44')],
  ['a zero-volume row', print('2026-11-20T02:15:00Z', { volume: 0 })],
  ['an invalid price', print('2026-11-20T02:15:00Z', { price: -1 })],
] as const)('does not veto a board zero with %s', async (_kind, invalidEvidence) => {
  const { tape } = renderBoth({ tape: [{ data: [invalidEvidence] }, zero()] });
  expect(await tape.findByText('1 ticks shown')).toBeVisible();

  fireEvent.click(tape.getByTitle('Refresh'));

  expect(await tape.findByText(`No trades on the Vietcap board for ${priorSessionDate}`)).toBeVisible();
  expect(tape.queryByText('1 ticks shown')).not.toBeInTheDocument();
});

it('does not use a cached trade from another query limit or symbol to veto a board zero', async () => {
  const client = queryClient();
  const time = '2026-11-20T02:15:00Z';
  client.setQueryData(equityQueryKeys.intraday('HPG', 200), { data: [print(time)] });
  client.setQueryData(equityQueryKeys.intraday('VNM', 1000), { data: [{ ...print(time), symbol: 'VNM' }] });
  const { tape } = renderBoth({ client, tape: [zero()] });

  expect(await tape.findByText(`No trades on the Vietcap board for ${priorSessionDate}`)).toBeVisible();
  expect(tape.queryByText('1 ticks shown')).not.toBeInTheDocument();
});

it('shows the calendar date of a legacy dated print and keeps it after an HTTP 200 timeout', async () => {
  const { tape } = renderBoth({ tape: [
    { data: [print('2026-11-20 13:32:44')] },
    envelope([], { status: 'timeout', source_as_of: now }),
  ] });

  expect(await tape.findByText('432')).toBeVisible();
  expect(tape.getByText(`As of ${priorSessionDate}`)).toBeVisible();
  fireEvent.click(tape.getByTitle('Refresh'));

  expect(await tape.findByText(/Refresh failed: Request timed out/)).toBeVisible();
  expect(tape.getByText('432')).toBeVisible();
  expect(tape.getByText(`As of ${priorSessionDate}`)).toBeVisible();
});

it('uses an explicit legacy source date but never a clock-only print or fetch time as an as-of', async () => {
  const rows = [print('13:32:44')];
  const { tape } = renderBoth({ tape: [
    { data: rows },
    { data: rows, meta: { last_data_date: priorSessionDate } },
  ] });
  expect(await tape.findByText('13:32:44')).toBeVisible();
  expect(tape.getByText('As-of unknown')).toBeVisible();
  expect(tape.getByTitle('Retrieval time does not establish source freshness')).toHaveTextContent(/^Fetched /);
  fireEvent.click(tape.getByTitle('Refresh'));

  expect(await tape.findByText(`As of ${priorSessionDate}`)).toBeVisible();
});
