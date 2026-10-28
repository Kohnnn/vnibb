import { useCallback, useState, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';

import { useRatioHistory } from '@/lib/queries';
import type { WidgetDataPayload } from '@/lib/widgetRuntime';
import type { RatioHistoryResponse } from '@/types/equity';
import { ValuationMultiplesChartWidget } from './ValuationMultiplesChartWidget';
import { ValuationBandWidget } from './ValuationBandWidget';

jest.mock('@/lib/queries', () => ({ useRatioHistory: jest.fn() }));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));
jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message }: { message: string }) => <div>{message}</div>,
  WidgetError: ({ error, onRetry }: { error: Error; onRetry: () => void }) => (
    <div role="alert">{error.message}<button type="button" onClick={onRetry}>Retry</button></div>
  ),
}));
jest.mock('@/components/ui/ChartSizeBox', () => ({ ChartSizeBox: () => <div data-testid="ratio-chart" /> }));
jest.mock('@/components/ui/ChartMountGuard', () => ({ ChartMountGuard: () => <div data-testid="ratio-chart" /> }));

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

describe.each([
  ['multiples', ValuationMultiplesChartWidget, 'No valuation history for VCB'],
  ['bands', ValuationBandWidget, 'Not enough ratio history to build valuation bands'],
] as const)('%s ratio history delivery', (_name, Widget, emptyMessage) => {
  it('shows the provider reason and retry, distinguishes empty success, and recovers', () => {
    const reason = 'Financial ratio history provider deadline exceeded';
    const refetch = jest.fn();
    const onDataChange = jest.fn();
    const query = {
      data: undefined,
      dataUpdatedAt: 0,
      error: new Error(reason),
      isLoading: false,
      isFetching: false,
      refetch,
    } as unknown as UseQueryResult<RatioHistoryResponse, Error>;
    jest.mocked(useRatioHistory).mockReturnValue(query);
    const view = render(<Widget id="valuation" symbol="VCB" onDataChange={onDataChange} />);

    expect(screen.getByRole('alert')).toHaveTextContent(reason);
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
    expect(onDataChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    jest.mocked(useRatioHistory).mockReturnValue({ ...query, data: { data: [] }, error: null } as typeof query);
    view.rerender(<Widget id="valuation" symbol="VCB" onDataChange={onDataChange} />);
    expect(screen.getByText(emptyMessage)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({ periods: 0 }));

    const history: RatioHistoryResponse = {
      data: [{ period: '2023', pe: 10 }, { period: '2024', pe: 12 }, { period: '2025', pe: 14 }],
    };
    jest.mocked(useRatioHistory).mockReturnValue({ ...query, data: history, error: null, dataUpdatedAt: 1 } as typeof query);
    view.rerender(<Widget id="valuation" symbol="VCB" onDataChange={onDataChange} />);
    expect(screen.getByTestId('ratio-chart')).toBeInTheDocument();
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
    expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({ periods: 3 }));

    onDataChange.mockClear();
    jest.mocked(useRatioHistory).mockReturnValue({ ...query, data: history, dataUpdatedAt: 1 } as typeof query);
    view.rerender(<Widget id="valuation" symbol="VCB" onDataChange={onDataChange} />);
    expect(screen.getByTestId('ratio-chart')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(reason);
    expect(screen.getByRole('alert')).toHaveTextContent('Showing previously received ratio history');
    expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({
      periods: 3,
      __widgetRuntime: expect.objectContaining({ provenance: expect.objectContaining({ stale: true }) }),
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(2);

    jest.mocked(useRatioHistory).mockReturnValue({ ...query, data: history, error: null, dataUpdatedAt: 2 } as typeof query);
    view.rerender(<Widget id="valuation" symbol="VCB" onDataChange={onDataChange} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('ratio-chart')).toBeInTheDocument();
    expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({ periods: 3 }));
  });
});
