import { render, screen, within } from '@testing-library/react';

import { useComparison, usePeers } from '@/hooks/useComparison';
import { PeerComparisonWidget } from './PeerComparisonWidget';

jest.mock('@/hooks/useComparison', () => ({
  useComparison: jest.fn(),
  usePeers: jest.fn(),
}));

jest.mock('@/lib/api', () => ({ exportPeers: jest.fn() }));

jest.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Radar: () => null,
    RadarChart: Stub,
    PolarGrid: () => null,
    PolarAngleAxis: () => null,
    LineChart: Stub,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
    CartesianGrid: () => null,
  };
});

jest.mock('@/components/common/ExportButton', () => ({ ExportButton: () => null }));
jest.mock('@/components/ui/widget-skeleton', () => ({ WidgetSkeleton: () => <div /> }));
jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message }: { message: string }) => <div>{message}</div>,
  WidgetError: ({ error }: { error: Error }) => <div>{error.message}</div>,
}));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));
jest.mock('@/components/ui/ChartSizeBox', () => ({
  ChartSizeBox: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/contexts/UnitContext', () => ({ useUnit: () => ({ config: { unit: 'raw' } }) }));
jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({ updateWidget: jest.fn() }),
}));
jest.mock('@/hooks/useWidgetSymbolLink', () => ({
  useWidgetSymbolLink: () => ({ setLinkedSymbol: jest.fn() }),
}));
jest.mock('@/hooks/useDashboardWidget', () => ({ useDashboardWidget: () => null }));

const mockUseComparison = useComparison as jest.Mock;
const mockUsePeers = usePeers as jest.Mock;

function comparisonData(msrRoe: number, vnmRoe: number) {
  return {
    data: {
      metrics: [
        { id: 'pe_ratio', name: 'P/E Ratio', format: 'number' },
        { id: 'roe', name: 'ROE', format: 'percent' },
      ],
      stocks: [
        { symbol: 'MSR', company_name: 'Masan Resources', metrics: { pe_ratio: 12, roe: msrRoe } },
        { symbol: 'VNM', company_name: 'Vinamilk', metrics: { pe_ratio: 15, roe: vnmRoe } },
      ],
    },
    isLoading:false,
    isFetching:false,
    error: null,
    refetch: jest.fn(),
    dataUpdatedAt: 0,
  };
}

function renderRoeRow() {
  render(<PeerComparisonWidget id="peer-1" symbol="MSR" config={{ comparisonPeers: ['MSR', 'VNM'] }} />);
  return within(screen.getByText('ROE').closest('tr') as HTMLElement);
}

describe('PeerComparisonWidget percent basis (issue #106)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePeers.mockReturnValue({ data: undefined });
  });

  test('shows each peer percent as reported and means the loaded cells', () => {
    // The comparison API declares `format: "percent"` for ROE (models/comparison.py),
    // so a stored 1 is 1.0% (not 100.0%). Distinct cells prove the mean is the
    // arithmetic mean of what is displayed, not of rescaled values.
    mockUseComparison.mockReturnValue(comparisonData(1, 3));

    const roeRow = renderRoeRow();
    const cellTexts = roeRow.getAllByRole('cell').map((cell) => cell.textContent ?? '');

    expect(cellTexts).toContain('1.0%');
    expect(cellTexts).toContain('3.0%');
    // The mean cell also carries its cohort size marker `(n=2)`.
    expect(cellTexts.some((text) => text.startsWith('2.0%'))).toBe(true);
    expect(roeRow.queryByText('100.0%')).not.toBeInTheDocument();
  });

  test('labels the mean as loaded peers and discloses the unverified unit basis', () => {
    mockUseComparison.mockReturnValue(comparisonData(12.5, 17.5));

    render(<PeerComparisonWidget id="peer-1" symbol="MSR" config={{ comparisonPeers: ['MSR', 'VNM'] }} />);

    expect(screen.getByText('Peer Avg')).toBeInTheDocument();
    expect(screen.getByText('Loaded peers only')).toBeInTheDocument();
    expect(screen.queryByText('Sector Avg')).not.toBeInTheDocument();
    expect(screen.getByText(/not a sector\/industry cohort/)).toBeInTheDocument();
    expect(screen.getByText(/provider unit basis is not independently verified/)).toBeInTheDocument();
  });
});
