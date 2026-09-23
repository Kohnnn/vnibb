import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { useMarketBreadth } from '@/lib/queries';
import { MarketBreadthWidget } from './MarketBreadthWidget';

jest.mock('@/lib/queries', () => ({ useMarketBreadth: jest.fn() }));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));

const useBreadth = useMarketBreadth as jest.Mock;

it('distinguishes unavailable coverage from an empty successful breadth', () => {
  useBreadth.mockReturnValue({
    data: { count: 0, data: [], error: 'Verified screener Universe unavailable' },
    isLoading: false, isFetching: false, error: null, dataUpdatedAt: 0, refetch: jest.fn(),
  });
  const { rerender } = render(<MarketBreadthWidget id="breadth" />);
  expect(screen.getByText('Market breadth unavailable')).toBeInTheDocument();
  expect(screen.queryByText('Breadth data not available yet')).not.toBeInTheDocument();

  useBreadth.mockReturnValue({
    data: { count: 0, data: [], error: null },
    isLoading: false, isFetching: false, error: null, dataUpdatedAt: 0, refetch: jest.fn(),
  });
  rerender(<MarketBreadthWidget id="breadth" />);
  expect(screen.getByText('Breadth data not available yet')).toBeInTheDocument();
});
