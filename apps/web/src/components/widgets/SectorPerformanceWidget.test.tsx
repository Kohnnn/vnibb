import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import type { SectorPerformanceResponse } from '@/lib/api';
import { useSectorPerformance } from '@/lib/queries';
import { SectorPerformanceWidget, getHeatmapStyle } from './SectorPerformanceWidget';

jest.mock('@/lib/queries', () => ({
  useSectorPerformance: jest.fn(),
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

const mockUseSectorPerformance = jest.mocked(useSectorPerformance);

function mockSectorData(changePct: number | null | undefined): UseQueryResult<SectorPerformanceResponse, Error> {
  const data: SectorPerformanceResponse = {
    count: 1,
    data: [
      {
        sectorId: 'banking',
        sectorName: 'Ngân hàng',
        sectorNameEn: 'Banking',
        changePct,
        topGainer: { symbol: 'VCB', price: 90_000, changePct: 1.1 },
        topLoser: { symbol: 'STB', price: 30_000, changePct: -0.8 },
        totalStocks: 27,
        stocks: [],
      },
    ],
  };
  let result: UseQueryResult<SectorPerformanceResponse, Error>;
  const refetch: UseQueryResult<SectorPerformanceResponse, Error>['refetch'] = async () => result;
  result = {
    data,
    dataUpdatedAt: 0,
    error: null,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    errorUpdateCount: 0,
    isError:false,
    isFetched:true,
    isFetchedAfterMount:true,
    isFetching:false,
    isLoading:false,
    isPending:false,
    isLoadingError:false,
    isInitialLoading:false,
    isPaused:false,
    isPlaceholderData:false,
    isRefetchError:false,
    isRefetching:false,
    isStale:false,
    isSuccess:true,
    isEnabled:true,
    refetch,
    status: 'success',
    fetchStatus: 'idle',
    promise: Promise.resolve(data),
  } satisfies UseQueryResult<SectorPerformanceResponse, Error>;
  return result;
}

describe('SectorPerformanceWidget', () => {
  it('reports a missing sector change as unavailable instead of a flat 0% session', () => {
    mockUseSectorPerformance.mockReturnValue(mockSectorData(null));
    render(<SectorPerformanceWidget />);

    expect(screen.getAllByText('n/a').length).toBeGreaterThan(0);
    expect(screen.queryByText('+0.00%')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getAllByText('n/a').length).toBeGreaterThan(0);
    expect(screen.queryByText('+0.00%')).not.toBeInTheDocument();
  });

  it('keeps a real zero change as an unsigned 0.00%', () => {
    mockUseSectorPerformance.mockReturnValue(mockSectorData(0));
    render(<SectorPerformanceWidget />);

    expect(screen.getByText('0.00%')).toBeInTheDocument();
    expect(screen.queryByText('+0.00%')).not.toBeInTheDocument();
    expect(screen.queryByText('n/a')).not.toBeInTheDocument();
  });
});

describe('getHeatmapStyle', () => {
  const alpha = (style: { background: string }) => {
    const match = style.background.match(/(\d+)%, transparent/);
    expect(match).not.toBeNull();
    return Number(match![1]);
  };
  const token = (style: { background: string }) => {
    const match = style.background.match(/var\((--color-[a-z]+)\)/);
    expect(match).not.toBeNull();
    return match![1];
  };

  it('rises monotonically with magnitude in both directions', () => {
    // Regression: a global `.bg-*-500/70` remap flattened only the +-1-2% band,
    // so it rendered weaker than the +-0.5% band.
    const positive = [0, 0.5, 1, 2].map((pct) => alpha(getHeatmapStyle(pct)));
    const negative = [0, -0.5, -1, -2].map((pct) => alpha(getHeatmapStyle(pct)));
    expect(positive).toEqual([...positive].sort((a, b) => a - b));
    expect(negative).toEqual([...negative].sort((a, b) => a - b));
    expect(new Set(positive).size).toBe(4);
  });

  it('uses the direction token per sign and neutral only for unknown', () => {
    expect(token(getHeatmapStyle(3))).toBe('--color-positive');
    expect(token(getHeatmapStyle(-3))).toBe('--color-negative');
    expect(token(getHeatmapStyle(null))).toBe('--color-neutral');
  });

  it('keeps a measured zero in the neutral family, not the gain tint', () => {
    // Brand §13 financialSemantics: zero is ink. A zero tile used to paint the
    // positive token at 10%, which read as a small gain.
    expect(token(getHeatmapStyle(0))).toBe('--color-neutral');
    expect(alpha(getHeatmapStyle(0))).toBeLessThan(alpha(getHeatmapStyle(null)));
  });


  it('fully saturates at the outer bands so labels need a contrast flip', () => {
    // The tile flips its label to the page surface colour at |change| >= 2; that
    // is only correct while those bands are solid.
    expect(alpha(getHeatmapStyle(2))).toBe(100);
    expect(alpha(getHeatmapStyle(-2))).toBe(100);
  });

  it('keeps non-solid bands pale enough for ink on top of them', () => {
    // Regression: 70/50/28% tints put direction-coloured text at 1.8:1–3.6:1
    // against its own fill. Non-solid bands must stay <= 30%, where primary ink
    // measures >= 9:1 in both themes.
    for (const pct of [0, 0.4, 0.5, 1, 1.999, -0.5, -1, -1.999]) {
      expect(alpha(getHeatmapStyle(pct))).toBeLessThanOrEqual(30);
    }
  });
});
