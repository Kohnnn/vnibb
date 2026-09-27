import { useCallback, useState, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';

import { useRatioHistory } from '@/lib/queries';
import type { WidgetDataPayload } from '@/lib/widgetRuntime';
import type { RatioHistoryResponse } from '@/types/equity';
import { ValuationMultiplesChartWidget } from './ValuationMultiplesChartWidget';

jest.mock('@/lib/queries', () => ({ useRatioHistory: jest.fn() }));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));
jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message }: { message: string }) => <div>{message}</div>,
  WidgetError: () => null,
}));

describe('ValuationMultiplesChartWidget', () => {
  it('reports empty data once even when the callback updates parent state', () => {
    jest.mocked(useRatioHistory).mockReturnValue({
      data: undefined,
      dataUpdatedAt: 0,
      error: null,
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    } as unknown as UseQueryResult<RatioHistoryResponse, Error>);

    const onDataChange = jest.fn();
    function Parent() {
      const [, setRuntime] = useState<WidgetDataPayload | null>(null);
      const updateRuntime = useCallback((runtime: WidgetDataPayload) => {
        onDataChange(runtime);
        if (onDataChange.mock.calls.length > 5) throw new Error('Runtime callback looped');
        setRuntime(runtime);
      }, []);
      return <ValuationMultiplesChartWidget id="valuation" symbol="VCB" onDataChange={updateRuntime} />;
    }

    render(<Parent />);

    expect(screen.getByText('No valuation history for VCB')).toBeInTheDocument();
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledWith(expect.objectContaining({
      periods: 0,
      __widgetRuntime: expect.objectContaining({ layoutHint: expect.objectContaining({ empty: true }) }),
    }));
  });
});
