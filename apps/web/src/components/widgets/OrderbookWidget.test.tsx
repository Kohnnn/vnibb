import { render, screen } from '@testing-library/react';
import { OrderbookWidget } from './OrderbookWidget';
import { usePriceDepth } from '@/lib/queries';

jest.mock('@/lib/queries', () => ({
  usePriceDepth: jest.fn(),
}));

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children, title }: { children: any; title: string }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

jest.mock('@/components/ui/ChartMountGuard', () => ({
  ChartMountGuard: ({ children }: { children: any }) => <div>{children}</div>,
}));

jest.mock('recharts', () => ({
  Area: () => null,
  AreaChart: ({ children }: { children: any }) => <svg>{children}</svg>,
  CartesianGrid: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children: any }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const mockUsePriceDepth = usePriceDepth as jest.MockedFunction<typeof usePriceDepth>;

describe('OrderbookWidget', () => {
  beforeEach(() => {
    mockUsePriceDepth.mockReturnValue({
      data: {
        data: {
          symbol: 'VCI',
          entries: [
            { level: 1, price: 25, bid_vol: 1000, ask_vol: 1100, price_status: 'reference' },
            { level: 2, price: 25, bid_vol: 900, ask_vol: 800, price_status: 'reference' },
          ],
          last_price: 25,
          reference_price: 25,
          snapshot_time: '2026-05-29T00:26:19',
          is_stale: true,
          market_status: 'closed',
          price_source: 'latest_price',
        },
        meta: { count: 2 },
        error: null,
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      isFetching: false,
      dataUpdatedAt: Date.UTC(2026, 4, 29, 0, 26, 19),
    } as any);
  });

  it('labels latest-close reference pricing as non-live depth', () => {
    render(<OrderbookWidget symbol="VCI" />);

    expect(screen.getByText('Reference close')).toBeInTheDocument();
    expect(screen.getByText('Reference pricing only')).toBeInTheDocument();
    expect(screen.getByText(/not live bid\/ask depth/i)).toBeInTheDocument();
    expect(screen.getByText('Ref Price')).toBeInTheDocument();
  });
});
