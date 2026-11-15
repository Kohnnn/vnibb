import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';

import { useRatioHistory } from '@/lib/queries';
import type { RatioHistoryResponse } from '@/types/equity';
import { ValuationBandWidget } from './ValuationBandWidget';

jest.mock('@/lib/queries', () => ({ useRatioHistory: jest.fn() }));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ui/WidgetMeta', () => ({
  WidgetMeta: ({ note }: { note?: string }) => <div data-testid="widget-meta">{note}</div>,
}));
jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message }: { message: string }) => <div>{message}</div>,
  WidgetError: ({ error }: { error: Error }) => <div role="alert">{error.message}</div>,
}));
jest.mock('@/components/ui/ChartMountGuard', () => ({ ChartMountGuard: () => <div data-testid="ratio-chart" /> }));

function query(overrides: Partial<UseQueryResult<RatioHistoryResponse, Error>>) {
  return {
    data: undefined,
    dataUpdatedAt: 0,
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
    ...overrides,
  } as unknown as UseQueryResult<RatioHistoryResponse, Error>;
}

describe('ValuationBandWidget observation metadata', () => {
  const reason = 'Financial ratio history provider deadline exceeded';
  const usable: RatioHistoryResponse = {
    data: [{ period: '2023', pe: 10 }, { period: '2024', pe: 12 }, { period: '2025', pe: 14 }],
    meta: { count: 3 },
  };

  it('withholds the observation count until ratio history is usable', () => {
    jest.mocked(useRatioHistory).mockReturnValue(query({ error: new Error(reason) }));
    const view = render(<ValuationBandWidget id="valuation" symbol="VCB" />);

    expect(screen.getByTestId('widget-meta')).not.toHaveTextContent('observations');
    expect(screen.getByRole('alert')).toHaveTextContent(reason);

    jest.mocked(useRatioHistory).mockReturnValue(query({ isLoading: true }));
    view.rerender(<ValuationBandWidget id="valuation" symbol="VCB" />);
    expect(screen.getByTestId('widget-meta')).not.toHaveTextContent('observations');

    jest.mocked(useRatioHistory).mockReturnValue(
      query({ data: { data: [], meta: { count: 0 } } }),
    );
    view.rerender(<ValuationBandWidget id="valuation" symbol="VCB" />);
    expect(screen.getByTestId('widget-meta')).not.toHaveTextContent('observations');

    jest.mocked(useRatioHistory).mockReturnValue(query({
      data: { data: [{ period: '2023', pe: 0 }, { period: '2024', pe: -1 }], meta: { count: 2 } },
      dataUpdatedAt: 1,
    }));
    view.rerender(<ValuationBandWidget id="valuation" symbol="VCB" />);
    expect(screen.getByTestId('widget-meta')).toHaveTextContent('0 positive observations');

    jest.mocked(useRatioHistory).mockReturnValue(query({ data: usable, dataUpdatedAt: 2 }));
    view.rerender(<ValuationBandWidget id="valuation" symbol="VCB" />);
    expect(screen.getByTestId('widget-meta')).toHaveTextContent('3 positive observations');

    jest.mocked(useRatioHistory).mockReturnValue(query({ data: usable, dataUpdatedAt: 2, error: new Error(reason) }));
    view.rerender(<ValuationBandWidget id="valuation" symbol="VCB" />);
    expect(screen.getByTestId('widget-meta')).toHaveTextContent('3 positive observations');
    expect(screen.getByRole('alert')).toHaveTextContent('Showing previously received ratio history');
  });
});
