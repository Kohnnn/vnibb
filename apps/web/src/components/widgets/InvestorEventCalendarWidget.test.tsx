import { render, screen, waitFor } from '@testing-library/react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { getCompanyEvents } from '@/lib/api';
import { equityQueryKeys } from '@/lib/queries/equity';
import { queryKeys } from '@/lib/queries/legacy';
import { InvestorEventCalendarWidget } from './InvestorEventCalendarWidget';

jest.mock('@tanstack/react-query', () => ({
  useQueries: jest.fn(),
  useQuery: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
  getCompanyEvents: jest.fn(),
}));

jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({ state: { dashboards: [] }, updateWidget: jest.fn() }),
}));

jest.mock('@/hooks/useDashboardWidget', () => ({
  useDashboardWidget: () => undefined,
}));

jest.mock('@/lib/hooks/usePortfolio', () => ({
  usePortfolio: () => ({ symbols: ['FPT'] }),
}));

jest.mock('@/hooks/useWidgetSymbolLink', () => ({
  useWidgetSymbolLink: () => ({ setLinkedSymbol: jest.fn() }),
}));

jest.mock('./WatchlistWidget', () => ({
  parseWatchlistSymbols: () => [],
}));

jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message, detail }: { message: string; detail?: string }) => <div>{message}{detail}</div>,
  WidgetError: ({ error }: { error: Error }) => <div>{error.message}</div>,
  WidgetLoading: ({ message }: { message: string }) => <div>{message}</div>,
}));

const mockUseQueries = jest.mocked(useQueries);
const mockUseQuery = jest.mocked(useQuery);
const mockGetCompanyEvents = jest.mocked(getCompanyEvents);

describe.each([
  ['modular', equityQueryKeys],
  ['legacy', queryKeys],
])('%s limited equity query keys', (_name, keys) => {
  it('includes request limits in cache identities', () => {
    expect(keys.companyNews('FPT', 5)).toEqual(['companyNews', 'FPT', 5]);
    expect(keys.companyEvents('FPT', 30)).toEqual(['companyEvents', 'FPT', 30]);
    expect(keys.intraday('FPT', 1_000)).toEqual(['intraday', 'FPT', 1_000]);
    expect(keys.ratioHistory('FPT', 'year', ['pe'], 60)).toEqual([
      'ratioHistory', 'FPT', 'year', ['pe'], 60,
    ]);
    expect(keys.financials('FPT', 'income', 'FY', 8)).toEqual([
      'financials', 'FPT', 'income', 'FY', 8,
    ]);
  });
});

describe('InvestorEventCalendarWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseQueries.mockReturnValue([
      {
        data: {
          data: [{
            symbol: 'FPT',
            event_name: 'Annual general meeting',
            event_date: '2099-01-01',
          }],
        },
        isLoading: false,
        isError: false,
        error: null,
      },
    ] as never);
  });

  it('shows genuine company events without querying stored income statements as earnings releases', async () => {
    const onDataChange = jest.fn();
    render(<InvestorEventCalendarWidget id="investor-events" onDataChange={onDataChange} />);

    expect(screen.getByText('Annual general meeting')).toBeInTheDocument();
    expect(screen.getByText('FPT · MEETING')).toBeInTheDocument();
    expect(mockUseQueries).toHaveBeenCalledWith(expect.objectContaining({
      queries: [expect.objectContaining({ queryKey: ['companyEvents', 'FPT', 30] })],
    }));
    expect(mockUseQuery).not.toHaveBeenCalled();
    expect(mockGetCompanyEvents).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(onDataChange).toHaveBeenLastCalledWith({
        __widgetRuntime: {
          data: {
            eventCount: 1,
            symbolCount: 1,
            unavailableSymbols: [],
          },
        },
      });
    });
  });
});
