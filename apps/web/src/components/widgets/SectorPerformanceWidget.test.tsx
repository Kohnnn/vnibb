import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import type { SectorPerformanceResponse } from '@/lib/api';
import { useSectorPerformance } from '@/lib/queries';
import { SectorPerformanceWidget } from './SectorPerformanceWidget';

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

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('+0.00%')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('+0.00%')).not.toBeInTheDocument();
  });

  it('keeps a real zero change as +0.00%', () => {
    mockUseSectorPerformance.mockReturnValue(mockSectorData(0));
    render(<SectorPerformanceWidget />);

    expect(screen.getByText('+0.00%')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });
});
