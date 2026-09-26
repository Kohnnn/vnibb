import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { useFinancialRatios, useProfile, useScreenerData } from '@/lib/queries';
import { PriceChartWidget } from '@/components/widgets/PriceChartWidget';

jest.mock('@/lib/queries', () => ({
  useFinancialRatios: jest.fn(),
  useProfile: jest.fn(),
  useScreenerData: jest.fn(),
}));

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: any }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/WidgetMeta', () => ({
  WidgetMeta: () => null,
}));

jest.mock('@/components/ui/widget-skeleton', () => ({
  WidgetSkeleton: () => <div data-testid="widget-skeleton" />,
}));

jest.mock('@/components/chart/TradingViewAdvancedChart', () => ({
  TradingViewAdvancedChart: () => <div data-testid="tradingview-chart" />,
}));

const mockUseScreenerData = useScreenerData as jest.MockedFunction<typeof useScreenerData>;
const mockUseProfile = useProfile as jest.MockedFunction<typeof useProfile>;
const mockUseFinancialRatios = useFinancialRatios as jest.MockedFunction<typeof useFinancialRatios>;

const mockQueryDefaults = () => ({
  data: undefined,
  isLoading: false,
  isFetching: false,
  isError: false,
  error: null,
  refetch: jest.fn(),
  dataUpdatedAt: 0,
});

describe('PriceChartWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseScreenerData.mockReturnValue(mockQueryDefaults() as any);
    mockUseProfile.mockReturnValue(mockQueryDefaults() as any);
    mockUseFinancialRatios.mockReturnValue(mockQueryDefaults() as any);
  });

  test('renders empty state when no symbol is provided', () => {
    render(<PriceChartWidget id="chart-1" symbol="" />);
    expect(screen.getByText(/select a symbol/i)).toBeInTheDocument();
  });

  test('renders chart and fundamentals snapshot when data is loaded', () => {
    mockUseScreenerData.mockReturnValue({
      ...mockQueryDefaults(),
      data: {
        data: [{ symbol: 'FPT', pe: 18.5, pb: 3.2, roe: 0.18, dividend_yield: 0.03 }],
      },
    } as any);
    mockUseProfile.mockReturnValue({
      ...mockQueryDefaults(),
      data: { data: { exchange: 'HOSE' } },
    } as any);
    mockUseFinancialRatios.mockReturnValue({
      ...mockQueryDefaults(),
      data: [{ period: 'FY2024', pe: 18.5, pb: 3.2, roe: 0.18, dividend_yield: 0.03 }],
    } as any);

    render(<PriceChartWidget id="chart-1" symbol="FPT" />);

    expect(screen.getByTestId('tradingview-chart')).toBeInTheDocument();
    expect(screen.getByText('Fundamentals Snapshot')).toBeInTheDocument();
  });

  test('renders loading skeleton while metrics are loading', () => {
    mockUseScreenerData.mockReturnValue({
      ...mockQueryDefaults(),
      isLoading: true,
    } as any);

    render(<PriceChartWidget id="chart-1" symbol="FPT" />);
    expect(screen.getByTestId('widget-skeleton')).toBeInTheDocument();
  });

  test('renders fundamentals not available when metrics fail and no cached data', () => {
    mockUseScreenerData.mockReturnValue({
      ...mockQueryDefaults(),
      isError: true,
      error: new Error('Network error'),
    } as any);
    mockUseProfile.mockReturnValue(mockQueryDefaults() as any);
    mockUseFinancialRatios.mockReturnValue(mockQueryDefaults() as any);

    render(<PriceChartWidget id="chart-1" symbol="FPT" />);

    expect(screen.getByTestId('tradingview-chart')).toBeInTheDocument();
    expect(screen.getAllByText(/not available/i).length).toBeGreaterThan(0);
  });

  test('restores persisted controls and updates them when workspace config changes', () => {
    const { rerender } = render(
      <PriceChartWidget id="chart-1" symbol="FPT" config={{ timeframe: '3m', chartType: 'area', compareSymbol: 'vnm' }} />,
    );
    expect(screen.getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Area' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: 'Compare ticker' })).toHaveValue('VNM');

    rerender(<PriceChartWidget id="chart-1" symbol="FPT" config={{ timeframe: '5Y', chartType: 'line', compareSymbol: 'hpg' }} />);
    expect(screen.getByRole('button', { name: '5Y' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Line' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: 'Compare ticker' })).toHaveValue('HPG');
  });

  test('keeps body control choices in workspace config across widget remounts', () => {
    function Workspace() {
      const [config, setConfig] = useState<Record<string, unknown>>({ timeframe: '1Y', chartType: 'candles' });
      const [version, setVersion] = useState(0);
      return <>
        <button type="button" onClick={() => setVersion(current => current + 1)}>Reopen widget</button>
        <PriceChartWidget key={version} id="chart-1" symbol="FPT" config={config}
          onConfigChange={updates => setConfig(current => ({ ...current, ...updates }))} />
      </>;
    }
    render(<Workspace />);
    fireEvent.click(screen.getByRole('button', { name: '6M' }));
    fireEvent.click(screen.getByRole('button', { name: 'Area' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Compare ticker' }), { target: { value: 'hpg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reopen widget' }));
    expect(screen.getByRole('button', { name: '6M' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Area' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: 'Compare ticker' })).toHaveValue('HPG');
    fireEvent.click(screen.getByRole('button', { name: 'Clear compare ticker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen widget' }));
    expect(screen.getByRole('textbox', { name: 'Compare ticker' })).toHaveValue('');
  });

  test('normalizes old chart settings and exposes only supported chart modes', () => {
    render(<PriceChartWidget id="chart-1" symbol="FPT" config={{ timeframe: 'all', chartType: 'candle' }} />);
    expect(screen.getByRole('button', { name: 'MAX' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Candles' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /ohlc/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Line' }));
    expect(screen.getByRole('button', { name: 'Line' })).toHaveAttribute('aria-pressed', 'true');
  });
});
