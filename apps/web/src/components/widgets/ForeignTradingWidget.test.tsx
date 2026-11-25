import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import * as api from '@/lib/api';
import { useForeignTrading, useInsiderSentiment, useShareholders } from '@/lib/queries';
import type * as QueryHooks from '@/lib/queries';
import type { ForeignTradingMeta, ForeignTradingResponse } from '@/types/equity';
import type * as MarketHours from '@/lib/marketHours';
import { ForeignTradingWidget } from './ForeignTradingWidget';
import { OwnershipRatingSummaryWidget } from './OwnershipRatingSummaryWidget';
import { getWidgetExportData } from '@/lib/widgetRuntime';
import { buildOwnershipSummary } from '@/lib/ownershipAnalytics';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual<typeof api>('@/lib/api'),
  getForeignTrading: jest.fn(),
}));

jest.mock('@/lib/queries', () => ({ useForeignTrading: jest.fn(), useInsiderSentiment: jest.fn(), useShareholders: jest.fn() }));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// Pin the market phase so the freshness-badge regression below is stable on
// any run day (the weekend branch would otherwise replace the stale label).
jest.mock('@/lib/marketHours', () => {
  const actual = jest.requireActual<typeof MarketHours>('@/lib/marketHours');
  return { ...actual, getMarketState: () => actual.getMarketState(new Date('2026-11-12T04:00:00Z')) };
});

const mockUseForeignTrading = jest.mocked(useForeignTrading);

const actualUseForeignTrading = jest.requireActual<typeof QueryHooks>('@/lib/queries').useForeignTrading;

function sessionRows(count: number, symbol = 'FPT'): ForeignTradingResponse['data'] {
  const rows: ForeignTradingResponse['data'] = [];
  const holidays = ['2026-04-27', '2026-04-30', '2026-05-01'];
  for (const day = new Date(Date.UTC(2026, 4, 29)); rows.length < count; day.setUTCDate(day.getUTCDate() - 1)) {
    const date = day.toISOString().slice(0, 10);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6 && !holidays.includes(date)) {
      rows.push({ symbol, date, buy_volume: 0, sell_volume: 0 });
    }
  }
  return rows;
}

function completeMeta(rows: ForeignTradingResponse['data'], sessions: 20 | 60): ForeignTradingMeta {
  const start = sessions === 20 ? '2026-05-04' : '2026-03-04';
  return {
    count: rows.length, window_contract: 'sessions-v2', calendar_verified: true,
    requested_session_count: sessions, requested_start_date: start, requested_end_date: '2026-05-29',
    observed_session_count: rows.length, observed_start_date: start, observed_end_date: '2026-05-29',
    last_validated_session: '2026-05-29', gap_session_count: 0, null_session_count: 0,
    coverage_status: 'complete',
    window_net_volume: rows.reduce((total, row) => total + (row.buy_volume ?? 0) - (row.sell_volume ?? 0), 0),
  };
}

describe('ForeignTradingWidget volumes', () => {
  beforeEach(() => {
    jest.mocked(api.getForeignTrading).mockReset();
    mockUseForeignTrading.mockReset();
    (useShareholders as jest.Mock).mockReset();
    (useInsiderSentiment as jest.Mock).mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders canonical Monday without local-time conversion west of UTC', async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
      const rows = [{ symbol: 'HPG', date: '2026-05-25', buy_volume: 1, sell_volume: 0 }];
      mockUseForeignTrading.mockReturnValue({
        data: { symbol: 'HPG', count: 1, data: rows },
        isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
      } as unknown as UseQueryResult<ForeignTradingResponse, Error>);
      render(<ForeignTradingWidget id="foreign-tz" symbol="HPG" />);
      expect(await screen.findByText('2026-05-25')).toBeInTheDocument();
      expect(screen.queryByText('2026-05-24')).not.toBeInTheDocument();
    } finally {
      if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz;
    }
  });

  it('renders reported zero Buy and Sell volumes while retaining compact and missing values', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    mockUseForeignTrading.mockReturnValue({
      data: {
        symbol: 'FPT', count: 3,
        data: [
          { symbol: 'FPT', date: '2026-05-28', buy_volume: 0, sell_volume: 0 },
          { symbol: 'FPT', date: '2026-05-27', buy_volume: 1000, sell_volume: 0 },
          { symbol: 'FPT', date: '2026-05-26' },
        ],
      },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    } as unknown as UseQueryResult<ForeignTradingResponse, Error>);

    render(<ForeignTradingWidget id="foreign-1" symbol="FPT" />);
    await screen.findByText('2026-05-28');

    expect(screen.getByText('Buy')).toBeInTheDocument();
    expect(screen.getByText('Sell')).toBeInTheDocument();
    for (const [date, volumes] of [
      ['2026-05-28', ['0', '0']],
      ['2026-05-27', ['1.0K', '0']],
      ['2026-05-26', ['n/a', 'n/a']],
    ] as const) {
      const row = screen.getByText(date).parentElement!.parentElement!;
      const volumeCells = Array.from(row.children).slice(1, 3);
      expect(volumeCells.map(cell => cell.textContent)).toEqual(volumes);
    }
  });

  it('keeps missing row nets and the mixed-window Net Position unavailable without inventing direction', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    const trades: ForeignTradingResponse['data'] = [
      { symbol: 'FPT', date: '2026-05-28', buy_volume: 0, sell_volume: 0 },
      { symbol: 'FPT', date: '2026-05-27', buy_volume: undefined, sell_volume: undefined },
      { symbol: 'FPT', date: '2026-05-26', buy_volume: 1000, sell_volume: undefined },
      { symbol: 'FPT', date: '2026-05-25', buy_volume: undefined, sell_volume: 200 },
      { symbol: 'FPT', date: '2026-05-24', buy_volume: null, sell_volume: 500 } as unknown as ForeignTradingResponse['data'][number],
    ];
    mockUseForeignTrading.mockReturnValue({
      data: { symbol: 'FPT', count: trades.length, data: trades },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    } as unknown as UseQueryResult<ForeignTradingResponse, Error>);

    render(<ForeignTradingWidget id="foreign-missing-net" symbol="FPT" />);
    await screen.findByText('2026-05-28');

    const completeRow = screen.getByText('2026-05-28').parentElement!.parentElement!;
    expect(completeRow.lastElementChild).toHaveTextContent(/^Flat 0$/);
    for (const date of ['2026-05-27', '2026-05-26', '2026-05-25', '2026-05-24']) {
      const row = screen.getByText(date).parentElement!.parentElement!;
      const netCell = row.lastElementChild!;
      expect(netCell).toHaveTextContent(/^Unavailable$/);
      expect(netCell.querySelector('svg')).toBeNull();
    }
    const netPosition = screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild!;
    expect(netPosition).toHaveTextContent(/^Unavailable$/);
    expect(netPosition.querySelector('svg')).toBeNull();
  });

  it.each([
    { name: 'positive', volumes: [[1500, 500], [0, 0]], position: 'Net buy +1.0K', rowNets: ['Net buy 1.0K', 'Flat 0'] },
    { name: 'negative', volumes: [[500, 1500], [0, 0]], position: 'Net sell -1.0K', rowNets: ['Net sell 1.0K', 'Flat 0'] },
    { name: 'balanced', volumes: [[1500, 500], [500, 1500]], position: 'Flat 0', rowNets: ['Net buy 1.0K', 'Net sell 1.0K'] },
    { name: 'empty', volumes: [], position: 'Unavailable', rowNets: [] },
  ])('renders the $name window Net Position without losing known row directions', async ({ volumes, position, rowNets }) => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    const trades = volumes.length ? sessionRows(60) : [];
    volumes.forEach(([buy_volume, sell_volume], index) => {
      trades[index] = { ...trades[index], buy_volume, sell_volume };
    });
    mockUseForeignTrading.mockReturnValue({
      data: { symbol: 'FPT', count: trades.length, data: trades, ...(trades.length ? { meta: completeMeta(trades, 60) } : {}) },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    } as unknown as UseQueryResult<ForeignTradingResponse, Error>);

    render(<ForeignTradingWidget id="foreign-net-boundary" symbol="FPT" />);

    const netPosition = screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild!;
    expect(netPosition.textContent).toBe(position);
    for (const [index, expectedNet] of rowNets.entries()) {
      const dateCell = await screen.findByText(trades[index].date!);
      const netCell = dateCell.parentElement!.parentElement!.lastElementChild!;
      expect(netCell.textContent).toBe(expectedNet);
    }
    if (trades.length === 0) {
      expect(screen.getByText('No data for FPT')).toBeInTheDocument();
      expect(netPosition.querySelector('svg')).toBeNull();
    }
  });

  it('retries an empty provider failure and keeps window controls, normal coverage gaps, and fallback rows usable', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    mockUseForeignTrading.mockImplementation(actualUseForeignTrading);
    const getForeignTrading = jest.mocked(api.getForeignTrading)
      .mockResolvedValueOnce({
        symbol: 'FPT', count: 0, data: [],
        meta: { count: 0, symbol: 'FPT', last_data_date: null },
        error: 'Request timed out',
      })
      .mockResolvedValueOnce({
        symbol: 'FPT', count: 1,
        data: [{ symbol: 'FPT', date: '2026-05-28', buy_volume: 1500, sell_volume: 500 }],
        error: null,
      })
      .mockResolvedValueOnce({ symbol: 'FPT', count: 0, data: [], error: null })
      .mockResolvedValueOnce({
        symbol: 'FPT', count: 1,
        data: [{ symbol: 'FPT', date: '2026-05-27', buy_volume: 500, sell_volume: 1500 }],
        error: 'Live foreign trading request timed out; using cached database fallback.',
      });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ForeignTradingWidget id="foreign-retry" symbol="FPT" />
      </QueryClientProvider>,
    );

    const retry = await screen.findByRole('button', { name: /Retry|Try Again/ });
    expect(screen.queryByText('Coverage gap')).not.toBeInTheDocument();
    expect(screen.queryByText('No data for FPT')).not.toBeInTheDocument();
    fireEvent.click(retry);

    expect(await screen.findByText('2026-05-28')).toBeInTheDocument();
    expect(screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild).toHaveTextContent(/^Unavailable$/);
    expect(screen.getByText(/retained history \(unverified window\)/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry|Try Again/ })).not.toBeInTheDocument();
    expect(getForeignTrading).toHaveBeenNthCalledWith(2, 'FPT', { limit: undefined, sessions: 60, window_contract: 'sessions-v2' });

    fireEvent.click(screen.getByRole('button', { name: '1M' }));
    expect(await screen.findByText('No data for FPT')).toBeInTheDocument();
    expect(screen.getByText('Coverage gap')).toBeInTheDocument();
    expect(screen.queryByText('2026-05-28')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry|Try Again/ })).not.toBeInTheDocument();
    expect(getForeignTrading).toHaveBeenNthCalledWith(3, 'FPT', { limit: undefined, sessions: 20, window_contract: 'sessions-v2' });

    fireEvent.click(screen.getByRole('button', { name: '6M' }));
    expect(await screen.findByText('2026-05-27')).toBeInTheDocument();
    expect(screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild).toHaveTextContent(/^Unavailable$/);
    expect(screen.getByText('Cached snapshot')).toBeInTheDocument();
    expect(screen.queryByText('Coverage gap')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry|Try Again/ })).not.toBeInTheDocument();
    expect(getForeignTrading).toHaveBeenNthCalledWith(4, 'FPT', { limit: undefined, sessions: 120, window_contract: 'sessions-v2' });
    client.clear();
  });
  it('does not render a warm legacy response as a qualified 1M session window', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    mockUseForeignTrading.mockImplementation(actualUseForeignTrading);
    const rows = [
      { symbol: 'HPG', date: '2026-10-27', buy_volume: 1500, sell_volume: 500 },
      { symbol: 'HPG', date: '2026-08-23', buy_volume: 1500, sell_volume: 500 },
      { symbol: 'HPG', date: '2026-01-30', buy_volume: null, sell_volume: null },
    ];
    const response = { symbol: 'HPG', count: rows.length, data: rows, error: 'using cached database fallback' } as ForeignTradingResponse;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['foreignTrading', 'HPG', undefined, 60, 'sessions-v2'], response);
    client.setQueryData(['foreignTrading', 'HPG', undefined, 20, 'sessions-v2'], response);
    render(<QueryClientProvider client={client}><ForeignTradingWidget id="foreign-switch" symbol="HPG" /></QueryClientProvider>);

    fireEvent.click(screen.getByRole('button', { name: '1M' }));
    expect(screen.getByText(/retained history/i)).toBeInTheDocument();
    expect(screen.getByText(/retained history/i)).toHaveTextContent('2026-01-30 – 2026-10-27');
    expect(screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild).toHaveTextContent('Unavailable');
    client.clear();
  });

  it('rejects a complete base-contract 20D response under the correct warm key in both widgets', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    mockUseForeignTrading.mockImplementation(actualUseForeignTrading);
    (useShareholders as jest.Mock).mockReturnValue({ data: { data: [{ symbol: 'HPG', ownership_pct: 40, ownership_unit: 'percent', ownership_unit_status: 'explicit' }] }, error: null, isLoading: false, isFetching: false, dataUpdatedAt: 1, refetch: jest.fn() });
    (useInsiderSentiment as jest.Mock).mockReturnValue({ data: { symbol: 'HPG', net_value: 0, value_unit: 'VND' }, error: null, isLoading: false, isFetching: false, dataUpdatedAt: 1, refetch: jest.fn() });
    const rows = sessionRows(20, 'HPG').map(row => ({ ...row, buy_volume: 1500, sell_volume: 500 }));
    const oldMeta: ForeignTradingMeta = { ...completeMeta(rows, 20), window_contract: 'sessions', last_data_date: '2026-05-29' };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['foreignTrading', 'HPG', undefined, 20], { symbol: 'HPG', count: 20, data: rows, meta: oldMeta });
    client.setQueryData(['foreignTrading', 'HPG', undefined, 20, 'sessions-v2'], { symbol: 'HPG', count: 20, data: rows, meta: oldMeta });
    const flowChange = jest.fn();
    const ownershipChange = jest.fn();
    const view = render(<QueryClientProvider client={client}><ForeignTradingWidget id="foreign-old-20" symbol="HPG" onDataChange={flowChange} /><OwnershipRatingSummaryWidget id="ownership-old-20" symbol="HPG" onDataChange={ownershipChange} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: '1M' }));
    expect(await screen.findByText(/retained history \(unverified window\)/i)).toBeInTheDocument();
    expect(screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild).toHaveTextContent(/^Unavailable$/);
    expect(ownershipChange.mock.calls.at(-1)?.[0].foreignNetVolume).toBeNull();
    expect(ownershipChange.mock.calls.at(-1)?.[0].__widgetRuntime.provenance.updatedAt).toBeNull();
    expect(flowChange.mock.calls.at(-1)?.[0].__widgetRuntime.provenance).toMatchObject({ coverage: 'partial', updatedAt: null, coverageDetail: { requestedSessions: 20, observedSessions: null, calendarVerified: null } });
    expect(jest.mocked(api.getForeignTrading)).not.toHaveBeenCalledWith('HPG', { limit: undefined, sessions: 20, window_contract: 'sessions-v2' });
    view.unmount();
    client.clear();
  });

  it('does not consume an old-key 20D packet when requesting the v2 contract', async () => {
    mockUseForeignTrading.mockImplementation(actualUseForeignTrading);
    (useShareholders as jest.Mock).mockReturnValue({ data: { data: [{ symbol: 'HPG', ownership_pct: 40, ownership_unit: 'percent', ownership_unit_status: 'explicit' }] }, error: null, isLoading: false, isFetching: false, dataUpdatedAt: 1, refetch: jest.fn() });
    (useInsiderSentiment as jest.Mock).mockReturnValue({ data: { symbol: 'HPG', net_value: 0, value_unit: 'VND' }, error: null, isLoading: false, isFetching: false, dataUpdatedAt: 1, refetch: jest.fn() });
    const rows = sessionRows(20, 'HPG');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['foreignTrading', 'HPG', undefined, 20], { symbol: 'HPG', count: 20, data: rows, meta: { ...completeMeta(rows, 20), window_contract: 'sessions' } });
    jest.mocked(api.getForeignTrading).mockResolvedValue({ symbol: 'HPG', count: 0, data: [], meta: { ...completeMeta(rows, 20), count: 0, observed_session_count: 0, gap_session_count: 20, coverage_status: 'unavailable' } });
    const onDataChange = jest.fn();
    const view = render(<QueryClientProvider client={client}><OwnershipRatingSummaryWidget id="ownership-cache-version" symbol="HPG" onDataChange={onDataChange} /></QueryClientProvider>);
    expect(await screen.findByText(/0\/20 qualifying sessions/)).toBeInTheDocument();
    expect(api.getForeignTrading).toHaveBeenCalledWith('HPG', { limit: undefined, sessions: 20, window_contract: 'sessions-v2' });
    expect(onDataChange.mock.calls.at(-1)?.[0].foreignNetVolume).toBeNull();
    view.unmount();
    client.clear();
  });

  it('switches from a warm verified 3M cache to the distinct verified 1M cache', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    mockUseForeignTrading.mockImplementation(actualUseForeignTrading);
    const longRows = sessionRows(60, 'HPG').map((row, index) => ({
      ...row, buy_volume: index < 20 ? 1500 : 3000, sell_volume: index < 20 ? 500 : 0,
    }));
    const shortRows = longRows.slice(0, 20);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['foreignTrading', 'HPG', undefined, 60, 'sessions-v2'], {
      symbol: 'HPG', count: 60, data: longRows, meta: completeMeta(longRows, 60),
    });
    client.setQueryData(['foreignTrading', 'HPG', undefined, 20, 'sessions-v2'], {
      symbol: 'HPG', count: 20, data: shortRows, meta: completeMeta(shortRows, 20),
    });
    const previousCalls = jest.mocked(api.getForeignTrading).mock.calls.length;
    const onDataChange = jest.fn();
    render(<QueryClientProvider client={client}><ForeignTradingWidget id="foreign-warm-switch" symbol="HPG" onDataChange={onDataChange} /></QueryClientProvider>);

    expect(await screen.findByText(/60\/60 qualifying sessions/)).toHaveTextContent('requested 2026-03-04 – 2026-05-29');
    expect(screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild).toHaveTextContent('Net buy +140.0K');
    expect(getWidgetExportData(onDataChange.mock.calls.at(-1)?.[0])).toEqual(longRows);

    fireEvent.click(screen.getByRole('button', { name: '1M' }));
    expect(await screen.findByText(/20\/20 qualifying sessions/)).toHaveTextContent('requested 2026-05-04 – 2026-05-29');
    expect(screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild).toHaveTextContent('Net buy +20.0K');
    expect(getWidgetExportData(onDataChange.mock.calls.at(-1)?.[0])).toEqual(shortRows);
    expect(jest.mocked(api.getForeignTrading).mock.calls.length).toBe(previousCalls);
    client.clear();
  });

  it('refuses a warm 3M response mistakenly cached for 1M', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    mockUseForeignTrading.mockImplementation(actualUseForeignTrading);
    const rows = sessionRows(60, 'HPG').map(row => ({ ...row, buy_volume: 1500, sell_volume: 500 }));
    const response = { symbol: 'HPG', count: 60, data: rows, meta: completeMeta(rows, 60) };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['foreignTrading', 'HPG', undefined, 60, 'sessions-v2'], response);
    client.setQueryData(['foreignTrading', 'HPG', undefined, 20, 'sessions-v2'], response);
    const onDataChange = jest.fn();
    render(<QueryClientProvider client={client}><ForeignTradingWidget id="foreign-wrong-cache" symbol="HPG" onDataChange={onDataChange} /></QueryClientProvider>);

    expect(await screen.findByText(/60\/60 qualifying sessions/)).toBeInTheDocument();
    expect(screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild).toHaveTextContent('Net buy +60.0K');
    fireEvent.click(screen.getByRole('button', { name: '1M' }));
    expect(await screen.findByText(/retained history \(unverified window\)/i)).toHaveTextContent('2026-03-04 – 2026-05-29');
    expect(screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild).toHaveTextContent(/^Unavailable$/);
    expect(getWidgetExportData(onDataChange.mock.calls.at(-1)?.[0])).toEqual(rows);
    expect(onDataChange.mock.calls.at(-1)?.[0].__widgetRuntime.provenance).toMatchObject({
      endpoint: '/equity/HPG/foreign-trading?sessions=20&window_contract=sessions-v2', coverage: 'partial', updatedAt: null,
      coverageDetail: { requestedSessions: 20, requestedStart: null, requestedEnd: null, observedSessions: null, calendarVerified: null, gapSessions: null, nullSessions: null, returnedStart: '2026-03-04', returnedEnd: '2026-05-29' },
    });
    client.clear();
  });

  it('attributes a sparse wrong-key packet warning to retained data in UI and export', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    mockUseForeignTrading.mockImplementation(actualUseForeignTrading);
    const rows = sessionRows(60, 'HPG').slice(0, 4);
    const warning = '4 of 60 requested sessions observed';
    const fallback = 'Live foreign trading feed returned no rows; using cached database fallback.';
    const response = { symbol: 'HPG', count: 4, data: rows, error: `${fallback}; ${warning}`, meta: { ...completeMeta(sessionRows(60, 'HPG'), 60), count: 4, observed_session_count: 4, gap_session_count: 56, coverage_status: 'partial' as const, warnings: [fallback, warning] } };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['foreignTrading', 'HPG', undefined, 60, 'sessions-v2'], response);
    client.setQueryData(['foreignTrading', 'HPG', undefined, 20, 'sessions-v2'], response);
    const onDataChange = jest.fn();
    const view = render(<QueryClientProvider client={client}><ForeignTradingWidget id="foreign-wrong-sparse" symbol="HPG" onDataChange={onDataChange} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: '1M' }));
    expect(await screen.findByText(/Retained packet: 4 of 60 requested sessions observed/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(`Retained packet: ${fallback}`);
    expect(onDataChange.mock.calls.at(-1)?.[0].__widgetRuntime.provenance).toMatchObject({
      cached: true, coverageDetail: { requestedSessions: 20, observedSessions: null },
      warnings: [`Retained packet: ${fallback}`, `Retained packet: ${warning}`],
    });
    view.unmount();
    client.clear();
  });


  it('discloses the admitted session window instead of a row count', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    mockUseForeignTrading.mockReturnValue({
      data: {
        symbol: 'HPG',
        count: 2,
        data: [
          { symbol: 'HPG', date: '2026-10-27', buy_volume: 1500, sell_volume: 500 },
          { symbol: 'HPG', date: '2026-10-26', buy_volume: 500, sell_volume: 1500 },
        ],
        meta: {
          count: 2,
          symbol: 'HPG',
          last_data_date: '2026-10-27',
          window_contract: 'sessions-v2',
          requested_start_date: '2026-09-30', requested_end_date: '2026-10-27',
          requested_session_count: 20,
          observed_session_count: 2,
          observed_start_date: '2026-10-26',
          observed_end_date: '2026-10-27',
          gap_session_count: 18,
          window_net_volume: null,
          coverage_status: 'partial',
          provider_row_cap_applied: false,
          non_session_dates: ['2026-10-25'],
          calendar_verified: true,
        },
      },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    } as unknown as UseQueryResult<ForeignTradingResponse, Error>);

    render(<ForeignTradingWidget id="foreign-coverage" symbol="HPG" />);
    fireEvent.click(screen.getByRole('button', { name: '1M' }));
    // The window note states observed/requested sessions and the real range.
    expect(await screen.findByText(/2\/20 qualifying sessions/)).toHaveTextContent('requested 2026-09-30 – 2026-10-27');
    // An unqualified partial window must not present a net position.
    const netPosition = screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild!;
    expect(netPosition).toHaveTextContent(/^Unavailable$/);
    // Rejected weekend rows are disclosed rather than silently summed.
    expect(screen.getByRole('status')).toHaveTextContent('non-session');
  });

  it('labels rows as candidates when the session calendar is not verified', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    const rows = sessionRows(20);
    mockUseForeignTrading.mockReturnValue({
      data: { symbol: 'FPT', count: 20, data: rows, meta: { ...completeMeta(rows, 20), calendar_verified: false } },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    } as unknown as UseQueryResult<ForeignTradingResponse, Error>);
    render(<ForeignTradingWidget id="foreign-unverified-calendar" symbol="FPT" />);
    fireEvent.click(screen.getByRole('button', { name: '1M' }));

    expect(await screen.findByText(/20\/20 candidate sessions/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Exchange calendar unverified');
    expect(screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild).toHaveTextContent(/^Unavailable$/);
  });

  it('shows null-volume rows separately from missing sessions and withholds the total', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    const completeRows = sessionRows(20);
    const rows = completeRows.slice(0, 19);
    rows[2] = { ...rows[2], buy_volume: null, sell_volume: 500 };
    const meta: ForeignTradingMeta = {
      ...completeMeta(completeRows, 20), count: 19, observed_session_count: 18,
      observed_start_date: rows[18].date, gap_session_count: 1, null_session_count: 1,
      coverage_status: 'partial', window_net_volume: null,
      warnings: ['1 session row(s) have missing buy/sell volumes', '18 of 20 requested sessions observed'],
    };
    mockUseForeignTrading.mockReturnValue({
      data: { symbol: 'FPT', count: rows.length, data: rows, meta },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    } as unknown as UseQueryResult<ForeignTradingResponse, Error>);
    const onDataChange = jest.fn();
    render(<ForeignTradingWidget id="foreign-null" symbol="FPT" onDataChange={onDataChange} />);
    fireEvent.click(screen.getByRole('button', { name: '1M' }));

    expect(await screen.findByText(/18\/20 qualifying sessions/)).toHaveTextContent('1 missing · 1 null');
    expect(screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild).toHaveTextContent(/^Unavailable$/);
    const nullRow = screen.getByText('2026-05-27').parentElement!.parentElement!;
    expect(nullRow.lastElementChild).toHaveTextContent(/^Unavailable$/);
    expect(screen.getByRole('status')).toHaveTextContent('1 session row(s) have missing buy/sell volumes');
    expect(getWidgetExportData(onDataChange.mock.calls.at(-1)?.[0])).toEqual(rows);
    expect(onDataChange.mock.calls.at(-1)?.[0].__widgetRuntime.provenance.coverageDetail).toMatchObject({
      requestedSessions: 20, returnedStart: rows[18].date, returnedEnd: rows[0].date, gapSessions: 1, nullSessions: 1,
    });
  });

  it('discloses a capped provider window while withholding its partial total', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    mockUseForeignTrading.mockReturnValue({
      data: {
        symbol: 'HPG', count: 1,
        data: [{ symbol: 'HPG', date: '2026-10-27', buy_volume: 1500, sell_volume: 500 }],
        meta: {
          count: 1,
          window_contract: 'sessions-v2', calendar_verified: true,
          requested_start_date: '2026-05-08', requested_end_date: '2026-10-27',
          requested_session_count: 120,
          observed_session_count: 1,
          gap_session_count: 119,
          window_net_volume: null,
          coverage_status: 'partial',
          provider_row_cap: 100,
          provider_row_cap_applied: true,
        },
      },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    } as unknown as UseQueryResult<ForeignTradingResponse, Error>);

    render(<ForeignTradingWidget id="foreign-cap" symbol="HPG" />);
    fireEvent.click(screen.getByRole('button', { name: '6M' }));

    expect(await screen.findByText(/1\/120 qualifying sessions/)).toBeInTheDocument();
    expect(screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild).toHaveTextContent(/^Unavailable$/);
    expect(screen.getByRole('status')).toHaveTextContent('caps 100 rows');
  });

  it('shows the retained-fallback envelope warning instead of a live window', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    const message = 'Live foreign trading feed returned no rows; using cached database fallback.';
    mockUseForeignTrading.mockReturnValue({
      data: {
        symbol: 'VNM', count: 2,
        data: [
          { symbol: 'VNM', date: '2026-10-27', buy_volume: 1500, sell_volume: 500 },
          { symbol: 'VNM', date: '2026-10-26', buy_volume: 500, sell_volume: 1500 },
        ],
        meta: {
          count: 2,
          window_contract: 'sessions-v2', calendar_verified: true,
          requested_start_date: '2026-09-30', requested_end_date: '2026-10-27',
          requested_session_count: 20,
          observed_session_count: 2,
          observed_start_date: '2026-10-26',
          observed_end_date: '2026-10-27',
          gap_session_count: 18,
          window_net_volume: null,
          coverage_status: 'partial',
          warnings: [message],
        },
        error: message,
      },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    } as unknown as UseQueryResult<ForeignTradingResponse, Error>);

    render(<ForeignTradingWidget id="foreign-fallback" symbol="VNM" />);
    fireEvent.click(screen.getByRole('button', { name: '1M' }));

    expect(await screen.findByRole('status')).toHaveTextContent(message);
    // The retained sample keeps its own coverage range, not a live label.
    expect(screen.getByText(/2\/20 qualifying sessions/)).toHaveTextContent('returned 2026-10-26 – 2026-10-27');
    expect(screen.getByText('Cached snapshot')).toBeInTheDocument();
    expect(screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild).toHaveTextContent(/^Unavailable$/);
  });
  it('agrees with the ownership summary on the same admitted 20-session window', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    // One intentionally aligned window (#249): the server admits weekday
    // sessions only and declares the weekend, duplicate and out-of-window rows
    // it rejected, so both consumers must sum exactly the admitted rows.
    const rows = sessionRows(20).map(row => ({ ...row, buy_volume: 1500, sell_volume: 500 }));
    const admittedSum = 20 * (1500 - 500);
    const warning = 'Live foreign trading feed returned no rows; using cached database fallback.';
    const meta = {
      count: rows.length,
      window_contract: 'sessions-v2' as const,
      calendar_verified: true,
      requested_start_date: '2026-05-04',
      requested_end_date: '2026-05-29',
      last_validated_session: '2026-05-29',
      null_session_count: 0,
      requested_session_count: 20,
      observed_session_count: 20,
      observed_start_date: '2026-05-04',
      observed_end_date: '2026-05-29',
      gap_session_count: 0,
      window_net_volume: admittedSum,
      coverage_status: 'complete' as const,
      non_session_dates: ['2026-05-30'],
      duplicate_session_dates: ['2026-05-28'],
      out_of_window_row_count: 1,
      warnings: [warning],
    };
    mockUseForeignTrading.mockReturnValue({
      data: { symbol: 'FPT', count: rows.length, data: rows, meta, error: warning },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    } as unknown as UseQueryResult<ForeignTradingResponse, Error>);
    (useShareholders as jest.Mock).mockReturnValue({
      data: { data: [{ symbol: 'FPT', shareholder_name: 'Anchor', ownership_pct: 40, ownership_unit: 'percent', ownership_unit_status: 'explicit' }] },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    });
    (useInsiderSentiment as jest.Mock).mockReturnValue({
      data: { symbol: 'FPT', period_days: 90, net_value: 0, value_unit: 'VND' },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    });

    const onDataChange = jest.fn();
    const ownershipData = jest.fn();
    render(<>
      <section aria-label="Foreign flow"><ForeignTradingWidget id="foreign-agree" symbol="FPT" onDataChange={onDataChange} /></section>
      <section aria-label="Ownership summary"><OwnershipRatingSummaryWidget id="ownership-agree" symbol="FPT" onDataChange={ownershipData} /></section>
    </>);
    const flow = within(screen.getByRole('region', { name: 'Foreign flow' }));
    const ownership = within(screen.getByRole('region', { name: 'Ownership summary' }));
    fireEvent.click(flow.getByRole('button', { name: '1M' }));

    const netPosition = flow.getByText('Net Position').parentElement!.parentElement!.lastElementChild!;
    expect(netPosition.textContent).toBe('Net buy +20.0K');
    expect(flow.getByText(/20\/20 qualifying sessions/)).toHaveTextContent('requested 2026-05-04 – 2026-05-29');
    expect(getWidgetExportData(onDataChange.mock.calls.at(-1)?.[0])).toEqual(rows);
    expect(flow.getByRole('status')).toHaveTextContent('non-session');
    expect(flow.getByRole('status')).toHaveTextContent(warning);
    expect(ownership.getByText('Foreign Net 20D').nextElementSibling).toHaveTextContent('20.0K');
    expect(ownership.getByRole('status')).toHaveTextContent(warning);
    const ownershipPayload = ownershipData.mock.calls.at(-1)?.[0];
    expect(ownershipPayload.foreignNetVolume).toBe(admittedSum);
    expect(getWidgetExportData(ownershipPayload)).toEqual(expect.objectContaining({
      foreignNetVolume: admittedSum,
      foreignFlowCoverage: expect.objectContaining({ startDate: '2026-05-04', endDate: '2026-05-29', requestedSessions: 20, observedSessions: 20 }),
    }));
    expect(jest.mocked(useForeignTrading)).toHaveBeenCalledWith('FPT', { sessions: 20, enabled: true });

    const summary = buildOwnershipSummary(null, rows, null, meta);
    expect(summary.foreignNetVolume).toBe(admittedSum);
    expect(summary.foreignFlowCoverage).toEqual(expect.objectContaining({
      status: 'complete', observedSessions: 20, requestedSessions: 20,
      startDate: '2026-05-04', endDate: '2026-05-29',
    }));
  });

  it('keeps a stale retained cache labelled with its metadata and admitted rows', async () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-28T06:00:00Z'));
    mockUseForeignTrading.mockReturnValue({
      data: {
        symbol: 'FPT', count: 2,
        data: [
          { symbol: 'FPT', date: '2026-10-27', buy_volume: 1500, sell_volume: 500 },
          { symbol: 'FPT', date: '2026-10-26', buy_volume: 500, sell_volume: 1500 },
        ],
        meta: {
          count: 2, window_contract: 'sessions-v2', calendar_verified: true,
          requested_session_count: 20, requested_start_date: '2026-09-30', requested_end_date: '2026-10-27',
          observed_session_count: 2, observed_start_date: '2026-10-26', observed_end_date: '2026-10-27',
          gap_session_count: 18, null_session_count: 0,
          last_data_date: '2026-10-27', last_validated_session: '2026-10-27',
          window_net_volume: null, coverage_status: 'partial',
        },
      },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 1,
    } as unknown as UseQueryResult<ForeignTradingResponse, Error>);

    render(<ForeignTradingWidget id="foreign-stale" symbol="FPT" />);
    fireEvent.click(screen.getByRole('button', { name: '1M' }));

    expect(await screen.findByText(/^Stale · source as of/)).toBeInTheDocument();
    // Sparse retained sample: the range is disclosed but not the window total.
    expect(screen.getByText(/2\/20 qualifying sessions/)).toHaveTextContent('18 missing · 0 null');
    expect(screen.getByText('2026-10-27')).toBeInTheDocument();
    const netPosition = screen.getByText('Net Position').parentElement!.parentElement!.lastElementChild!;
    expect(netPosition).toHaveTextContent(/^Unavailable$/);
  });
});
