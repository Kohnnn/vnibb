import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import * as api from '@/lib/api';
import { useForeignTrading } from '@/lib/queries';
import type * as QueryHooks from '@/lib/queries';
import type { ForeignTradingResponse } from '@/types/equity';
import { ForeignTradingWidget } from './ForeignTradingWidget';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual<typeof api>('@/lib/api'),
  getForeignTrading: jest.fn(),
}));

jest.mock('@/lib/queries', () => ({ useForeignTrading: jest.fn() }));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const mockUseForeignTrading = jest.mocked(useForeignTrading);

const actualUseForeignTrading = jest.requireActual<typeof QueryHooks>('@/lib/queries').useForeignTrading;

describe('ForeignTradingWidget volumes', () => {
  afterEach(() => {
    jest.restoreAllMocks();
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
      ['2026-05-26', ['-', '-']],
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
    const trades: ForeignTradingResponse['data'] = volumes.map(([buy_volume, sell_volume], index) => ({
      symbol: 'FPT', date: `2026-05-${28 - index}`, buy_volume, sell_volume,
    }));
    mockUseForeignTrading.mockReturnValue({
      data: { symbol: 'FPT', count: trades.length, data: trades },
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
    expect(screen.getByText('Net buy +1.0K')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry|Try Again/ })).not.toBeInTheDocument();
    expect(getForeignTrading).toHaveBeenNthCalledWith(2, 'FPT', { limit: 66 });

    fireEvent.click(screen.getByRole('button', { name: '1M' }));
    expect(await screen.findByText('No data for FPT')).toBeInTheDocument();
    expect(screen.getByText('Coverage gap')).toBeInTheDocument();
    expect(screen.queryByText('2026-05-28')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry|Try Again/ })).not.toBeInTheDocument();
    expect(getForeignTrading).toHaveBeenNthCalledWith(3, 'FPT', { limit: 22 });

    fireEvent.click(screen.getByRole('button', { name: '6M' }));
    expect(await screen.findByText('2026-05-27')).toBeInTheDocument();
    expect(screen.getByText('Net sell -1.0K')).toBeInTheDocument();
    expect(screen.getByText('Cached snapshot')).toBeInTheDocument();
    expect(screen.queryByText('Coverage gap')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry|Try Again/ })).not.toBeInTheDocument();
    expect(getForeignTrading).toHaveBeenNthCalledWith(4, 'FPT', { limit: 132 });
    client.clear();
  });
});
