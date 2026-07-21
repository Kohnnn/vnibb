import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { EarningsSeasonResponse } from '@/lib/api';
import { useEarningsSeason } from '@/lib/queries';
import { EarningsSeasonMonitorWidget } from './EarningsSeasonMonitorWidget';

jest.mock('@/lib/queries', () => ({
  useEarningsSeason: jest.fn(),
}));

const setLinkedSymbol = jest.fn();

jest.mock('@/hooks/useWidgetSymbolLink', () => ({
  useWidgetSymbolLink: () => ({ setLinkedSymbol }),
}));

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children, title }: { children: ReactNode; title: string }) => <section><h2>{title}</h2>{children}</section>,
}));

jest.mock('@/components/ui/widget-skeleton', () => ({
  WidgetSkeleton: () => <div>Loading</div>,
}));

jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message, detail }: { message: string; detail?: string }) => <div>{message}{detail ? <span>{detail}</span> : null}</div>,
  WidgetError: ({ error }: { error: Error }) => <div>{error.message}</div>,
}));

jest.mock('@/components/ui/WidgetMeta', () => ({
  WidgetMeta: () => null,
}));

const mockUseEarningsSeason = jest.mocked(useEarningsSeason);

function queryResult(data: EarningsSeasonResponse | undefined) {
  return {
    data,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isFetching: false,
    dataUpdatedAt: 0,
  } as unknown as ReturnType<typeof useEarningsSeason>;
}

describe('EarningsSeasonMonitorWidget', () => {
  beforeEach(() => {
    setLinkedSymbol.mockReset();
    mockUseEarningsSeason.mockReturnValue(queryResult({
      count: 2,
      season: 'Q1 2026',
      updated_at: '2026-05-01T00:00:00Z',
      data: [
        {
          symbol: 'BBB',
          name: 'Beta',
          exchange: 'HOSE',
          period: 'Q1 2026',
          updated_at: '2026-05-01T00:00:00Z',
          revenue_yoy: 12,
          earnings_yoy: null,
          signal: 'Watch',
        },
        {
          symbol: 'AAA',
          name: 'Alpha',
          exchange: 'HOSE',
          period: 'Q1 2026',
          updated_at: '2026-05-01T00:00:00Z',
          revenue_yoy: 12,
          earnings_yoy: 5,
          signal: 'Watch',
        },
      ],
    }));
  });

  it('sorts ties stably by symbol, links the selected VN symbol, and emits source metadata', async () => {
    const onDataChange = jest.fn();
    render(<EarningsSeasonMonitorWidget id="earnings-season" widgetGroup="A" onDataChange={onDataChange} />);

    const symbols = screen.getAllByRole('button', { name: /^(AAA|BBB) HOSE/ });
    expect(symbols.map((symbol) => symbol.textContent?.startsWith('AAA') ? 'AAA' : 'BBB')).toEqual(['AAA', 'BBB']);

    fireEvent.click(screen.getByRole('button', { name: /^AAA HOSE/ }));
    expect(setLinkedSymbol).toHaveBeenCalledWith('AAA');

    await waitFor(() => {
      expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({
        resultCount: 2,
        latestDate: '2026-05-01T00:00:00Z',
        source: 'VNIBB stored income statements',
        yoyCoverage: { available: 2, total: 2 },
      }));
    });
  });

  it('requests the selected exchange through the existing query', async () => {
    render(<EarningsSeasonMonitorWidget id="earnings-season" />);

    fireEvent.click(screen.getByRole('button', { name: 'HNX' }));

    await waitFor(() => {
      expect(mockUseEarningsSeason).toHaveBeenLastCalledWith({ exchange: 'HNX', limit: 24 });
    });
  });

  it('states that an empty response is source coverage, not a reporting claim', () => {
    mockUseEarningsSeason.mockReturnValue(queryResult({ count: 0, data: [] }));

    render(<EarningsSeasonMonitorWidget id="earnings-season" />);

    expect(screen.getByText('No stored quarterly statements are available')).toBeInTheDocument();
    expect(screen.getByText(/reflects stored source coverage/i)).toBeInTheDocument();
  });
});
