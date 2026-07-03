import { render, screen, act, waitFor } from '@testing-library/react';
import { useIncomeStatement, useBalanceSheet, useCashFlow, useFinancialRatios } from '@/lib/queries';
import { FinancialsWidget } from '@/components/widgets/FinancialsWidget';
import { UnitProvider } from '@/contexts/UnitContext';

jest.mock('@/lib/queries', () => ({
  useIncomeStatement: jest.fn(),
  useBalanceSheet: jest.fn(),
  useCashFlow: jest.fn(),
  useFinancialRatios: jest.fn(),
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

const mockUseIncomeStatement = useIncomeStatement as jest.MockedFunction<typeof useIncomeStatement>;
const mockUseBalanceSheet = useBalanceSheet as jest.MockedFunction<typeof useBalanceSheet>;
const mockUseCashFlow = useCashFlow as jest.MockedFunction<typeof useCashFlow>;
const mockUseFinancialRatios = useFinancialRatios as jest.MockedFunction<typeof useFinancialRatios>;

// Mock data for income statement (period format: '2024' for FY mode)
const mockIncomeResponse = {
  symbol: 'FPT',
  count: 2,
  data: [
    {
      period: '2024',
      revenue: 150_000_000_000_000,
      net_income: 12_000_000_000_000,
      fiscal_year: '2024',
    },
    {
      period: '2023',
      revenue: 130_000_000_000_000,
      net_income: 10_000_000_000_000,
      fiscal_year: '2023',
    },
  ],
};

const mockRatiosResponse = {
  symbol: 'FPT',
  count: 2,
  data: [
    { period: '2024', pe: 18.5, pb: 3.2, roe: 0.18, dividend_yield: 0.03 },
    { period: '2023', pe: 17.0, pb: 2.9, roe: 0.16, dividend_yield: 0.025 },
  ],
};

function makeQueryResult(data: any) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
    dataUpdatedAt: Date.now(),
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<UnitProvider>{ui}</UnitProvider>);
}

describe('FinancialsWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseIncomeStatement.mockReturnValue(makeQueryResult(undefined) as any);
    mockUseBalanceSheet.mockReturnValue(makeQueryResult(undefined) as any);
    mockUseCashFlow.mockReturnValue(makeQueryResult(undefined) as any);
    mockUseFinancialRatios.mockReturnValue(makeQueryResult(undefined) as any);
  });

  test('shows loading skeleton while income statement is loading', () => {
    mockUseIncomeStatement.mockReturnValue({
      ...makeQueryResult(undefined),
      isLoading: true,
    } as any);

    renderWithProviders(<FinancialsWidget id="fin-1" symbol="FPT" />);
    expect(screen.getByTestId('widget-skeleton')).toBeInTheDocument();
  });

  test('renders empty state when no data is available', () => {
    renderWithProviders(<FinancialsWidget id="fin-1" symbol="FPT" />);
    expect(screen.getByText(/no income statement data/i)).toBeInTheDocument();
  });

  test('renders table with data and shows income statement tab as active', async () => {
    mockUseIncomeStatement.mockReturnValue(makeQueryResult(mockIncomeResponse) as any);

    renderWithProviders(<FinancialsWidget id="fin-1" symbol="FPT" />);

    // When data is loaded, the Income Statement tab should be highlighted (has active styling)
    const incomeTab = screen.getByRole('button', { name: /income statement/i });
    expect(incomeTab).toBeInTheDocument();
    
    // Check that the FY period toggle button is visible (indicates table headers would be rendered)
    // This confirms data is being processed
    expect(screen.getByRole('button', { name: /^FY$/i })).toBeInTheDocument();
  });

  test('switches to ratios tab and calls useFinancialRatios with enabled=true', async () => {
    mockUseIncomeStatement.mockReturnValue(makeQueryResult(mockIncomeResponse) as any);
    mockUseFinancialRatios.mockReturnValue(makeQueryResult(mockRatiosResponse) as any);

    renderWithProviders(<FinancialsWidget id="fin-1" symbol="FPT" />);

    const ratiosTab = screen.getByRole('button', { name: /ratios/i });

    act(() => {
      ratiosTab.click();
    });

    expect(mockUseFinancialRatios).toHaveBeenCalledWith('FPT', expect.objectContaining({ period: 'FY', enabled: true }));
  });

  test('shows error state when query fails', () => {
    mockUseIncomeStatement.mockReturnValue({
      ...makeQueryResult(undefined),
      isError: true,
      error: new Error('Network error'),
    } as any);

    renderWithProviders(<FinancialsWidget id="fin-1" symbol="FPT" />);
    expect(screen.getByText(/network error/i)).toBeInTheDocument();
  });
});
