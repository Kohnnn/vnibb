import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import { getWidgetExportData, type WidgetDataPayload } from '@/lib/widgetRuntime';
import { provenanceToMarkdown } from '@/lib/widgetProvenance';
import type { IntradayFeed, IntradayMarketSession } from '@/types/intraday';
import { BlockTradeWidget } from './BlockTradeWidget';
import { FootprintProxyWidget } from './FootprintProxyWidget';
import { IntradayTradesWidget } from './IntradayTradesWidget';
import { OrderbookWidget } from './OrderbookWidget';
import { VWAPBandsWidget } from './VWAPBandsWidget';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  getBlockTrades: jest.fn(),
  getIntraday: jest.fn(),
  getMicrostructureAnalysis: jest.fn(),
  getPriceDepth: jest.fn(),
}));
jest.mock('@/contexts/SymbolLinkContext', () => ({
  useSymbolLink: () => ({ isWidgetLinked: () => false, toggleWidgetLink: jest.fn() }),
}));

const getIntraday = jest.mocked(api.getIntraday);
const getMicrostructureAnalysis = jest.mocked(api.getMicrostructureAnalysis);
const getPriceDepth = jest.mocked(api.getPriceDepth);
const responseTime = '2026-11-23T06:55:00Z';
const observationTime = '2026-11-20T07:30:00Z';
const open: IntradayMarketSession = {
  state: 'open', basis: 'exchange_status', checked_at: responseTime, valid_until: '2026-11-23T07:00:00Z',
};
function feed(overrides?: Partial<IntradayFeed>): IntradayFeed {
  return {
    status: 'empty', source: 'vnstock:VCI', requested_source: 'vnstock:VCI', source_as_of: null,
    fetched_at: responseTime, snapshot_at: null, delivery: 'provider', fallback: false,
    covered_window: null, ...overrides,
  };
}
const emptyAnalysis: api.MicrostructureResponse['data'] = {
  symbol: 'HPG', source: 'mongodb:frb', data_quality: {}, unsupported_reasons: [],
  deep_trades: { quality: 'not_requested', bars: [], latest_cvd: 0, total_aggressive_buy_volume: 0, total_aggressive_sell_volume: 0 },
  volume_profile: { quality: 'not_requested', bins: [], poc_price: null, vah_price: null, val_price: null, total_volume: 0 },
  price_action: { quality: 'not_requested', trend: 'neutral', candles: [], swings: [] },
  vwap: { quality: 'unavailable', points: [] }, footprint: { quality: 'unavailable', bars: [] },
};
const print = { symbol: 'HPG', price: 25000, volume: 400, time: observationTime };

function renderQuery(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse(responseTime) + 5_000);
});
afterEach(() => jest.restoreAllMocks());

it('renders the four HPG consumers with a common session and independent feed outcomes', async () => {
  getPriceDepth.mockResolvedValue({
    data: { symbol: 'HPG', entries: [] },
    meta: { market_session: open, feed: feed({ status: 'unsupported' }) },
  });
  getIntraday.mockResolvedValue({ data: [], error: 'Request timed out', meta: { market_session: open } });
  getMicrostructureAnalysis.mockImplementation(async (_symbol, options) => ({
    data: emptyAnalysis,
    meta: { market_session: open, feed: feed({
      status: options?.features?.includes('footprint') ? 'timeout' : 'empty',
      delivery: 'retained', source: 'mongodb:market_intraday_trades',
    }) },
  }));

  renderQuery(<>
    <section aria-label="Order Book"><OrderbookWidget symbol="HPG" /></section>
    <section aria-label="Intraday Trades"><IntradayTradesWidget id="tape" symbol="HPG" /></section>
    <section aria-label="VWAP"><VWAPBandsWidget symbol="HPG" /></section>
    <section aria-label="Footprint"><FootprintProxyWidget symbol="HPG" /></section>
  </>);

  const book = within(screen.getByRole('region', { name: 'Order Book' }));
  const tape = within(screen.getByRole('region', { name: 'Intraday Trades' }));
  const vwap = within(screen.getByRole('region', { name: 'VWAP' }));
  const footprint = within(screen.getByRole('region', { name: 'Footprint' }));
  expect(await book.findByText('Order book data unavailable')).toBeVisible();
  expect(book.getByText(/configured provider does not support/)).toBeVisible();
  expect(await tape.findByText('Intraday trade data unavailable')).toBeVisible();
  expect(tape.getByText(/request took too long/i)).toBeVisible();
  expect(await vwap.findByText('No trade ticks returned for VWAP')).toBeVisible();
  expect(vwap.getByText(/coverage is unverified/)).toBeVisible();
  expect(await footprint.findByText('Footprint trade ticks unavailable')).toBeVisible();
  expect(screen.getAllByText('Market open')).toHaveLength(4);
  expect(screen.queryByText(/market closed|no trades (for|in)|next batch/)).not.toBeInTheDocument();
});

it('keeps dated tape rows and the failure in export after an HTTP-success timeout', async () => {
  getIntraday.mockResolvedValueOnce({
    data: [print], meta: { market_session: open, feed: feed({ status: 'available', source_as_of: observationTime }) },
  }).mockResolvedValueOnce({
    data: [], error: 'Request timed out', meta: { market_session: open, feed: feed({ status: 'timeout' }) },
  });
  const onDataChange = jest.fn<void, [WidgetDataPayload]>();
  renderQuery(<IntradayTradesWidget id="tape" symbol="HPG" onDataChange={onDataChange} />);
  expect(await screen.findByText('1 ticks shown')).toBeVisible();

  fireEvent.click(screen.getByTitle('Refresh'));

  expect(await screen.findByRole('status')).toHaveTextContent('Refresh failed: Request timed out');
  expect(screen.getByText('1 ticks shown')).toBeVisible();
  expect(screen.getByText(/As of 2026-11-20/)).toBeVisible();
  const payload = onDataChange.mock.lastCall?.[0];
  expect(getWidgetExportData(payload)).toEqual([print]);
  const markdown = provenanceToMarkdown(payload?.__widgetRuntime?.provenance);
  expect(markdown).toContain('Market session: open');
  expect(markdown).toContain('Feed result: timeout');
  expect(markdown).toContain('Retained fallback: true');
  expect(markdown).toContain('Source as of: 2026-11-20T07:30:00.000Z');
  expect(markdown).toContain('Fetched at: 2026-11-23T06:55:00.000Z');
});

it.each([
  { session: open, status: 'timeout', expected: 'Market open' },
  { session: { ...open, state: 'closed', basis: 'verified_calendar_interval' }, status: 'available', expected: 'Market closed' },
] satisfies { session: IntradayMarketSession; status: IntradayFeed['status']; expected: string }[])(
  'keeps priced retained depth with $expected and feed result $status', async ({ session, status, expected }) => {
    getPriceDepth.mockResolvedValue({
      data: { symbol: 'HPG', entries: [{ level: 1, price: 25, bid_vol: 100, ask_vol: 200 }] },
      meta: {
        market_session: session,
        feed: feed({ status, source_as_of: observationTime, delivery: 'retained', fallback: status === 'timeout' }),
      },
      error: status === 'timeout' ? 'Request timed out' : null,
    });
    renderQuery(<OrderbookWidget symbol="HPG" />);
    expect(await screen.findByText('Retained observations')).toBeVisible();
    expect(screen.getByText(expected)).toBeVisible();
    expect(screen.getByText(/As of 2026-11-20/)).toBeVisible();
    expect(screen.getByText('Cumulative Depth')).toBeVisible();
    expect(screen.queryByText('No priced depth returned')).not.toBeInTheDocument();
    if (status === 'timeout') {
      expect(screen.getByRole('status')).toHaveTextContent('Refresh failed: Request timed out');
      expect(screen.queryByText('Market closed')).not.toBeInTheDocument();
    }
  },
);

it('requires positive coverage evidence to call a window zero trades', async () => {
  getIntraday.mockResolvedValueOnce({ data: [], meta: { market_session: open, feed: feed() } })
    .mockResolvedValueOnce({
      data: [], meta: {
        market_session: { ...open, state: 'holiday', basis: 'market_calendar' },
        feed: feed({ delivery: 'retained', source_as_of: '2026-11-20', covered_window: {
          session_date: '2026-11-20', trade_count: 0, basis: 'vietcap_board',
        } }),
      },
    });
  renderQuery(<IntradayTradesWidget id="tape" symbol="HPG" />);
  expect(await screen.findByText('No trade ticks returned')).toBeVisible();
  expect(screen.getByText(/does not establish trade coverage/)).toBeVisible();
  fireEvent.click(screen.getByTitle('Refresh'));
  expect(await screen.findByText('No trades on the Vietcap board for 2026-11-20')).toBeVisible();
  expect(screen.getByText('Market holiday')).toBeVisible();
});

it('ignores legacy closure guesses and does not renew expired evidence on a refresh failure', async () => {
  getPriceDepth.mockResolvedValue({
    data: { symbol: 'HPG', entries: [], market_status: 'closed' },
    error: 'Request timed out',
    meta: { market_session: { ...open, valid_until: responseTime } },
  });
  renderQuery(<OrderbookWidget symbol="HPG" />);
  await waitFor(() => expect(screen.getByText('Order book data unavailable')).toBeVisible());
  expect(screen.getByText('Market session unverified')).toBeVisible();
  expect(screen.queryByText('Market closed')).not.toBeInTheDocument();
});

it('describes an empty block-trade response using the actual retained query range', async () => {
  const getBlockTrades = jest.mocked(api.getBlockTrades).mockResolvedValue([]);
  renderQuery(<BlockTradeWidget symbol="HPG" />);
  expect(await screen.findByText('No retained block-trade detections returned')).toBeVisible();
  expect(getBlockTrades).toHaveBeenCalledWith({ limit: 50, symbol: 'HPG' });
  expect(screen.getByText(/up to 50 latest detections for HPG, without a date filter\. Exchange coverage is unknown\./)).toBeVisible();
  expect(screen.queryByText(/today|T\+1|published/i)).not.toBeInTheDocument();
});

it.each([
  ['2026-11-20T14:30:00+07:00', /As of 2026-11-20/],
  ['2026-11-20T14:30:00', /As-of unknown/],
])('does not use the browser zone for the retained block-trade clock %s', async (clock, asOf) => {
  jest.mocked(api.getBlockTrades).mockResolvedValue([{
    id: 1, symbol: 'HPG', side: null, quantity: 500_000, price: 25_000, value: 12_500_000_000,
    trade_time: clock, volume_ratio: null, is_foreign: false, is_proprietary: false,
  }]);
  renderQuery(<BlockTradeWidget symbol="HPG" />);

  expect(await screen.findByText('1 of 1 detections shown')).toBeVisible();
  expect(screen.getByText(asOf)).toBeVisible();
  if (!clock.endsWith('+07:00')) expect(screen.getByText('Trade time unverified')).toBeVisible();
});
