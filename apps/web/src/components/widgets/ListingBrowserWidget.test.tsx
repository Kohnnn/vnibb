import { fireEvent, render, screen } from '@testing-library/react';

import { useSymbols, useSymbolsByGroup } from '@/lib/queries';
import { ListingBrowserWidget } from './ListingBrowserWidget';

jest.mock('@/lib/queries', () => ({
  useSymbols: jest.fn(),
  useSymbolsByGroup: jest.fn(),
}));

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/widget-skeleton', () => ({
  WidgetSkeleton: () => <div />,
}));

jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message }: { message: string }) => <div>{message}</div>,
  WidgetError: ({ error }: { error: Error }) => <div>{error.message}</div>,
}));

jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));

const mockUseSymbols = useSymbols as jest.Mock;
const mockUseSymbolsByGroup = useSymbolsByGroup as jest.Mock;

const LISTING = [
  { symbol: 'VCB', organ_name: 'Vietcombank', exchange: 'HOSE', industry: 'Banks' },
  { symbol: 'MSR', organ_name: 'Masan Resources', exchange: 'HOSE', industry: null },
];

describe('ListingBrowserWidget industry classification (issue #107)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSymbolsByGroup.mockReturnValue({
      data: undefined, isLoading:false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    });
    mockUseSymbols.mockReturnValue({
      data: { count: LISTING.length, data: LISTING },
      isLoading:false, isFetching:false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    });
  });

  test('offers an explicit unclassified bucket instead of labelling a missing industry', () => {
    render(<ListingBrowserWidget id="listing-1" />);

    const select = screen.getByLabelText('Industry filter') as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => option.value);

    expect(options).toEqual(['ALL', 'Banks', 'Unclassified']);
    expect(options).not.toContain('Unknown');
  });

  test('filters a null-industry row through the unclassified bucket, not a guessed sector', () => {
    render(<ListingBrowserWidget id="listing-1" />);

    fireEvent.change(screen.getByLabelText('Industry filter'), { target: { value: 'Unclassified' } });

    expect(screen.getByText('MSR')).toBeInTheDocument();
    expect(screen.queryByText('VCB')).not.toBeInTheDocument();
    // The row keeps saying the industry is unavailable rather than naming one.
    expect(screen.getByText('Industry unavailable')).toBeInTheDocument();
  });
});
