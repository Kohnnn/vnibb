import { render, screen, within } from '@testing-library/react';

import { useComparison, usePeers } from '@/hooks/useComparison';
import { PeerComparisonWidget } from './PeerComparisonWidget';

jest.mock('@/hooks/useComparison', () => ({
  useComparison: jest.fn(),
  usePeers: jest.fn(),
}));

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

describe('PeerComparisonWidget market cap provenance', () => {
  beforeEach(() => {
    mockUsePeers.mockReturnValue({ data: undefined });
  });

  test('excludes captured unverified and conflicting caps from the loaded peer average', () => {
    const provenance = { status: 'available', value: 100, source: 'certified', currency: 'VND', unit: 'VND', as_of: '2026-10-26', share_basis: 'outstanding', observations: [{ value: 100, source: 'certified' }] };
    const onDataChange = jest.fn();
    mockUseComparison.mockReturnValue({
      data: {
        metrics: [{ id: 'market_cap', name: 'Market Cap', format: 'currency' }],
        stocks: [
          { symbol: 'VCI', metrics: { market_cap: 22410910941.25 } },
          { symbol: 'FPT', metrics: { market_cap: 100 }, market_cap_provenance: provenance },
          { symbol: 'VNM', metrics: { market_cap: 200 }, market_cap_provenance: { ...provenance, status: 'conflict', value: null, reason: 'Sources disagree' } },
        ],
      }, isLoading: false, refetch: jest.fn(), dataUpdatedAt: 0,
    });
    render(<PeerComparisonWidget id="peer-1" symbol="VCI" config={{ comparisonPeers: ['VCI', 'FPT', 'VNM'] }} onDataChange={onDataChange} />);
    const row = within(screen.getByText('Market Cap').closest('tr') as HTMLElement);
    expect(row.getByText('Unavailable')).toBeInTheDocument();
    expect(row.getByText('Conflict')).toBeInTheDocument();
    expect(row.getByText(/Sources disagree/)).toBeInTheDocument();
    expect(row.getByText(/22410910941.25/)).toBeInTheDocument();
    expect(row.queryByText('22.4B')).not.toBeInTheDocument();
    expect(row.getByText('(n=1)')).toBeInTheDocument();
    expect(JSON.stringify(onDataChange.mock.calls)).toContain('22410910941.25');
  });
});

it('keeps legacy and partial multiple cells neutral, including in heatmap mode', () => {
  mockUsePeers.mockReturnValue({ data: undefined });
  mockUseComparison.mockReturnValue({ data: {
    metrics: [{ id: 'ps_ratio', name: 'P/S Ratio', format: 'number' }],
    stocks: [
      { symbol: 'MSR', metrics: { ps_ratio: 3.82 }, valuation_basis: { ps_ratio: { source: 'quarter-feed', fiscal_period: 'Q2-2025' } } },
      { symbol: 'VNM', metrics: { ps_ratio: 2.14 } },
    ],
  }, refetch: jest.fn() });
  render(<PeerComparisonWidget id="peer" symbol="MSR" config={{ comparisonPeers: ['MSR', 'VNM'], comparisonHeatmapEnabled: true }} />);
  const [, known, legacy, mean] = screen.getAllByRole('row')[1].querySelectorAll('td');
  expect(known).toHaveTextContent('Q2-2025');
  expect(known).toHaveTextContent('quarter-feed');
  expect(legacy).toHaveTextContent(/source: unknown/i);
  expect(known.style.backgroundColor).toBe('');
  expect(mean).toHaveTextContent('2.98');
  expect(mean).toHaveTextContent(/descriptive only/i);
});

it.each([
  ['equivalent quarters', 'Q2-2025', '2025-Q2', '2025-Q2', false],
  ['equivalent years', '2025', 'FY 2025', 'FY 2025', false],
  ['different quarters', 'Q2-2025', '2025-Q3', '2025-Q3', true],
  ['quarter and same fiscal year', 'Q2-2025', 'FY 2025', 'FY 2025', true],
  ['missing period', 'Q2-2025', null, 'unknown', false],
  ['explicit unknown', 'Q2-2025', 'UNKNOWN', 'unknown', false],
  ['malformed quarter', 'Q2-2025', 'Q5-2025', 'unknown', false],
  ['conflicting quarter label', 'Q2-2025', 'Q3-Q4 2025', 'unknown', false],
  ['undated rolling window', 'Q2-2025', 'TTM', 'unknown', false],
] as const)('compares valuation fiscal periods by identity: %s', (_case, first, second, label, mixed) => {
  mockUsePeers.mockReturnValue({ data: undefined });
  mockUseComparison.mockReturnValue({ data: {
    metrics: [{ id: 'ps_ratio', name: 'P/S Ratio', format: 'number' }],
    stocks: [
      { symbol: 'HPG', metrics: { ps_ratio: 3.82 }, valuation_basis: { ps_ratio: { origin: 'persisted_ratio', fiscal_period: first } } },
      { symbol: 'NKG', metrics: { ps_ratio: 2.45 }, valuation_basis: { ps_ratio: { origin: 'provider_ratio', fiscal_period: second } } },
    ],
  }, refetch: jest.fn() });

  render(<PeerComparisonWidget id="peer" symbol="HPG" config={{ comparisonPeers: ['HPG', 'NKG'] }} />);
  const caption = screen.getByText(/EV\/EBITDA and P\/S are reported multiples/);
  expect(caption.textContent?.includes('Mixed fiscal periods.')).toBe(mixed);
  expect(screen.getByLabelText(`Basis for HPG P/S, fiscal period: ${first}`)).toBeInTheDocument();
  expect(screen.getByLabelText(`Basis for NKG P/S, fiscal period: ${label}`)).toBeInTheDocument();
});
