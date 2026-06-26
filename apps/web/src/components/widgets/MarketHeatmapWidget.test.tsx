import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { HeatmapResponse } from '@/lib/api';
import { useMarketHeatmap } from '@/lib/queries';
import { MarketHeatmapWidget } from './MarketHeatmapWidget';

jest.mock('@/lib/queries', () => ({
  useMarketHeatmap: jest.fn(),
}));

jest.mock('d3-hierarchy', () => {
  type HeatmapDatum = {
    readonly children?: readonly HeatmapDatum[];
  };

  type LayoutNode = {
    readonly x0: number;
    readonly x1: number;
    readonly y0: number;
    readonly y1: number;
    readonly data: HeatmapDatum;
  };

  type HierarchyRoot = {
    readonly data: HeatmapDatum;
    readonly sum: jest.MockedFunction<() => HierarchyRoot>;
    readonly sort: jest.MockedFunction<() => HierarchyRoot>;
  };

  type TreemapRoot = {
    readonly data: HeatmapDatum;
  };

  type TreemapResult = TreemapRoot & {
    readonly leaves: () => readonly LayoutNode[];
  };

  type TreemapLayout = {
    (root: TreemapRoot): TreemapResult;
    readonly paddingInner: jest.MockedFunction<() => TreemapLayout>;
    readonly paddingOuter: jest.MockedFunction<() => TreemapLayout>;
    readonly paddingTop: jest.MockedFunction<() => TreemapLayout>;
    readonly round: jest.MockedFunction<() => TreemapLayout>;
    readonly size: jest.MockedFunction<() => TreemapLayout>;
  };

  const leavesFor = (data: HeatmapDatum): readonly LayoutNode[] =>
    (data.children ?? []).map((child, index) => ({
      x0: index * 160,
      x1: index * 160 + 150,
      y0: 0,
      y1: 120,
      data: child,
    }));

  return {
    hierarchy: jest.fn((data: HeatmapDatum): HierarchyRoot => {
      const root: HierarchyRoot = {
        data,
        sum: jest.fn((): HierarchyRoot => root),
        sort: jest.fn((): HierarchyRoot => root),
      };
      return root;
    }),
    treemap: jest.fn((): TreemapLayout => {
      const renderLayout = (root: TreemapRoot): TreemapResult => ({
        ...root,
        leaves: () => leavesFor(root.data),
      });
      const layout: TreemapLayout = Object.assign(renderLayout, {
        paddingInner: jest.fn((): TreemapLayout => layout),
        paddingOuter: jest.fn((): TreemapLayout => layout),
        paddingTop: jest.fn((): TreemapLayout => layout),
        round: jest.fn((): TreemapLayout => layout),
        size: jest.fn((): TreemapLayout => layout),
      });
      return layout;
    }),
  };
});

jest.mock('@/contexts/UnitContext', () => ({
  useUnit: () => ({ config: { unit: 'raw' } }),
}));

jest.mock('@/hooks/useWidgetSymbolLink', () => ({
  useWidgetSymbolLink: () => ({ setLinkedSymbol: jest.fn() }),
}));

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children, headerActions, title }: { readonly children: ReactNode; readonly headerActions?: ReactNode; readonly title: string }) => (
    <section>
      <h2>{title}</h2>
      {headerActions}
      {children}
    </section>
  ),
}));

jest.mock('@/components/ui/widget-skeleton', () => ({
  WidgetSkeleton: () => <div data-testid="widget-skeleton" />,
}));

jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message }: { readonly message: string }) => <div>{message}</div>,
  WidgetError: ({ error }: { readonly error: Error }) => <div>{error.message}</div>,
}));

jest.mock('@/components/ui/WidgetMeta', () => ({
  WidgetMeta: () => null,
}));

jest.mock('@/components/ui/ChartSizeBox', () => ({
  ChartSizeBox: ({ children }: { readonly children: (size: { readonly width: number; readonly height: number }) => ReactNode }) => (
    <div>{children({ width: 640, height: 360 })}</div>
  ),
}));

jest.mock('html2canvas', () => jest.fn());

const mockUseMarketHeatmap = jest.mocked(useMarketHeatmap);
type HeatmapQueryResult = UseQueryResult<HeatmapResponse, Error>;

function mockHeatmapData(): HeatmapQueryResult {
  const data: HeatmapResponse = {
    count: 1,
    group_by: 'sector',
    color_metric: 'change_pct',
    size_metric: 'market_cap',
    sectors: [
      {
        sector: 'Banking',
        stocks: [
          {
            symbol: 'VCB',
            name: 'VCB Corp',
            sector: 'Banking',
            industry: 'Ngân hàng',
            market_cap: 1_000_000,
            price: 100,
            change: 1.2,
            change_pct: 1.2,
            volume: 10_000,
          },
        ],
        total_market_cap: 1_000_000,
        avg_change_pct: 1.2,
        stock_count: 1,
      },
    ],
    cached: false,
    updated_at: '2026-06-24T00:00:00Z',
  };
  let result: HeatmapQueryResult;
  const refetch: HeatmapQueryResult['refetch'] = async () => result;
  result = {
    data,
    dataUpdatedAt: 0,
    error: null,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    errorUpdateCount: 0,
    isError: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isLoading: false,
    isPending: false,
    isLoadingError: false,
    isInitialLoading: false,
    isPaused: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: false,
    isSuccess: true,
    isEnabled: true,
    refetch,
    status: 'success',
    fetchStatus: 'idle',
    promise: Promise.resolve(data),
  } satisfies HeatmapQueryResult;
  return result;
}

describe('MarketHeatmapWidget', () => {
  beforeEach(() => {
    mockUseMarketHeatmap.mockReturnValue(mockHeatmapData());
  });

  it('renders VN30 and HNX30 filter controls', () => {
    render(<MarketHeatmapWidget id="market-heatmap" />);

    expect(screen.getByRole('button', { name: 'VN30' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'HNX30' })).toBeInTheDocument();
  });

  it('requests VN30 heatmap data through group_by when VN30 is selected', async () => {
    const onDataChange = jest.fn();
    render(<MarketHeatmapWidget id="market-heatmap" onDataChange={onDataChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'VN30' }));

    await waitFor(() => {
      expect(mockUseMarketHeatmap).toHaveBeenLastCalledWith(
        expect.objectContaining({ group_by: 'vn30', exchange: 'ALL' }),
      );
      expect(onDataChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          endpoint: expect.stringContaining('group_by=vn30'),
        }),
      );
    });
  });

  it('requests HNX30 heatmap data through group_by when HNX30 is selected', async () => {
    render(<MarketHeatmapWidget id="market-heatmap" />);

    fireEvent.click(screen.getByRole('button', { name: 'HNX30' }));

    await waitFor(() => {
      expect(mockUseMarketHeatmap).toHaveBeenLastCalledWith(
        expect.objectContaining({ group_by: 'hnx30', exchange: 'ALL' }),
      );
    });
  });
});
