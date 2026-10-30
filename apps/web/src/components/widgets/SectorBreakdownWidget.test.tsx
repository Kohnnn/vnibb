import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { HeatmapResponse } from '@/lib/api';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useMarketHeatmap } from '@/lib/queries';
import { SectorBreakdownWidget } from './SectorBreakdownWidget';

jest.mock('@/lib/queries', () => ({ useMarketHeatmap: jest.fn() }));
jest.mock('@/components/ui/WidgetContainer', () => ({ WidgetContainer: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: ({ note }: { note: string }) => <div>{note}</div> }));
jest.mock('@/components/ui/ChartMountGuard', () => ({ ChartMountGuard: () => null }));

const mockUseMarketHeatmap = jest.mocked(useMarketHeatmap);

function setSectors(sectors: unknown[], sizeMetric = 'volume') {
  mockUseMarketHeatmap.mockReturnValue({
    data: { sectors, size_metric: sizeMetric, price_updated_at: null },
    isLoading: false, isFetching: false, error: null, dataUpdatedAt: 0, refetch: jest.fn(),
  } as unknown as UseQueryResult<HeatmapResponse, Error>);
}

describe('SectorBreakdownWidget', () => {
  it('reports admitted cap shares and partial coverage, not volume weights', () => {
    setSectors([
      { sector: 'Banking', stocks: [], stock_count: 2, cap_count: 1, total_market_cap: 100, total_size_value: 5000, avg_change_pct: 1 },
      { sector: 'Retail', stocks: [], stock_count: 1, cap_count: 1, total_market_cap: 300, total_size_value: 20, avg_change_pct: 2 },
      { sector: 'Unknown', stocks: [], stock_count: 1, cap_count: 0, total_market_cap: null, total_size_value: 9000, avg_change_pct: null },
    ]);
    const onDataChange = jest.fn();
    render(<SectorBreakdownWidget id="sectors" onDataChange={onDataChange} />);
    expect(screen.getByText('Admitted market cap: 2 of 4 returned stocks (partial coverage)')).toBeInTheDocument();
    expect(within(screen.getByText('Banking').closest('.rounded-md')!).getByText('25.0%')).toBeInTheDocument();
    expect(within(screen.getByText('Retail').closest('.rounded-md')!).getByText('75.0%')).toBeInTheDocument();
    expect(within(screen.getByText('Unknown').closest('.rounded-md')!).getByText('—')).toBeInTheDocument();
    expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({ totalMarketCap: 400, capCount: 2 }));
  });

  it('keeps unknown and legacy caps unavailable instead of displaying zero or raw values', () => {
    setSectors([{ sector: 'Legacy', stocks: [], stock_count: 1, total_market_cap: 123, avg_change_pct: null }]);
    const onDataChange = jest.fn();
    render(<SectorBreakdownWidget id="sectors" onDataChange={onDataChange} />);
    expect(within(screen.getByText('Legacy').closest('.rounded-md')!).getByText('—')).toBeInTheDocument();
    expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({ totalMarketCap: null, capCount: 0 }));
    fireEvent.click(screen.getByRole('button', { name: 'Stock Count' }));
    expect(within(screen.getByText('Legacy').closest('.rounded-md')!).getByText('1')).toBeInTheDocument();
  });
});
