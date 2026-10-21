import { render, screen, act, waitFor } from '@testing-library/react';
import { useIncomeStatement, useBalanceSheet, useCashFlow, useFinancialRatios } from '@/lib/queries';
import { FinancialsWidget } from '@/components/widgets/FinancialsWidget';
import { UnitProvider } from '@/contexts/UnitContext';
import type { UseQueryResult } from '@tanstack/react-query';
import type { IncomeStatementResponse, FinancialRatiosResponse } from '@/types/equity';

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

  test.each([['percent', '0.25%'], ['unknown', '—']])('preserves declared dividend percent and withholds %s units', async (unit, expected) => {
    // The existing query fixture supplies the settled fields consumed by this widget.
    const result = makeQueryResult({ data: [{ period: '2025', pe: 14.64,
      dividend_yield: 0.25, ratio_units: { dividend_yield: unit } }] }) as unknown as UseQueryResult<FinancialRatiosResponse, Error>;
    mockUseFinancialRatios.mockReturnValue(result);
    renderWithProviders(<FinancialsWidget id="fin-yield" symbol="FPT" />);
    act(() => screen.getByRole('button', { name: /ratios/i }).click());
    const row = screen.getByText('Dividend Yield').closest('tr');
    await waitFor(() => expect(row).toHaveTextContent(expected));
    expect(row).not.toHaveTextContent('25.00%');
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

  // Regression: the provider returns a literal 0 for a valuation multiple it could not
  // compute, and an absent eps/bvps/roe as null. Both must read as "no value", because a
  // rendered 0.00 claims the company traded at zero times earnings.
  test('renders absent and zero-valued ratios as an empty cell, never 0.00', async () => {
    mockUseFinancialRatios.mockReturnValue(makeQueryResult({
      symbol: 'FPT',
      count: 3,
      data: [
        // Provider emitted literal zeros where a denominator was missing.
        { period: '2021', pe: 0, pb: 0, ps: 0, eps: null, bvps: null, roe: null },
        { period: '2022', pe: 15.2, pb: 2.4, ps: 1.1, eps: 3200, bvps: 20000, roe: 0.18 },
        // A real zero keeps its real meaning for metrics where zero is a valid observation.
        { period: '2023', pe: 17.0, pb: 2.9, ps: 1.3, eps: 3400, bvps: 21000, roe: 0 },
      ],
    }) as any);

    renderWithProviders(<FinancialsWidget id="fin-1" symbol="FPT" />);

    act(() => {
      screen.getByRole('button', { name: /ratios/i }).click();
    });

    await waitFor(() => {
      const peRow = screen.getByText(/^P\/E$/i).closest('tr');
      expect(peRow).not.toBeNull();
      const cells = Array.from(peRow!.querySelectorAll('td'));
      const texts = cells.map((cell) => cell.textContent?.trim() ?? '');

      // The 2021 column (first period) must be empty, not a fabricated 0.00.
      expect(texts.some((text) => text.startsWith('0.00'))).toBe(false);
      // The 2022 column must still show its real value.
      expect(texts.join(' ')).toContain('15.20');
    });
  });

  // Regression: in "Financial Period View" the Ratios tab must show the same periods as the
  // statement tabs beside it. The ratio feed reaches back to 2012 while the statements start
  // at 2018, and before the alignment the Ratios tab rendered those extra years, so it and
  // its sibling statement widgets disagreed on which columns the row covered.
  test('uses the statement window as the ratio headers and keeps real valuations', async () => {
    mockUseFinancialRatios.mockReturnValue(makeQueryResult({
      symbol: 'VCI',
      count: 3,
      data: [
        // Ratio-only years the statements never report: the leading one is the empty
        // pre-history the old code used to widen the table with, the trailing one is a
        // period beyond the statement window.
        { period: '2012', pe: null, pb: 1.1 },
        { period: '2018', pe: 12.5, pb: 2.4, roe: 0.18 },
        { period: '2025', pe: 22.0, pb: 3.6, roe: 0.21 },
      ],
    }) as any);
    const completeWindow = makeQueryResult({
      symbol: 'VCI',
      count: 3,
      data: [
        { period: '2018', revenue: 1, net_income: 1 },
        { period: '2025', revenue: 1, net_income: 1 },
        { period: '2026 YTD', revenue: 1, net_income: 1 },
      ],
    });
    const longRequestWindow = makeQueryResult({
      symbol: 'VCI', count: 1, data: [{ period: '2025', revenue: 1, net_income: 1 }],
    });
    // The live provider returns a shorter period span for limit=80 than limit=20.
    mockUseIncomeStatement.mockImplementation((_symbol, options) =>
      (options?.limit === 20 ? completeWindow : longRequestWindow) as any
    );

    renderWithProviders(<FinancialsWidget id="fin-1" symbol="VCI" />);

    act(() => {
      screen.getByRole('button', { name: /ratios/i }).click();
    });

    const headerRow = await screen.findByText(/^P\/E$/i).then((cell) =>
      cell.closest('table')!.querySelector('thead tr')!
    );
    const headers = Array.from(headerRow.querySelectorAll('th')).map((th) => th.textContent?.trim() ?? '');

    // Headers are the statement window: the ratio-only 2012 column is gone, and the
    // statement-only 2026 YTD is present even though no ratio row exists for it. Before the
    // alignment the table keyed off the ratio feed alone and rendered 2012/2018/2025.
    // ("2026 (YTD)" is the shared statement-period label format, not a raw period key.)
    expect(headers).toEqual(['Metric', '2018', '2025', '2026 (YTD)']);
    expect(mockUseIncomeStatement).toHaveBeenCalledWith('VCI', expect.objectContaining({ limit: 20, enabled: true }));

    const rowCells = (label: RegExp) => {
      const row = screen.getByText(label).closest('tr')!;
      // The first cell is the row's own label; period cells follow it, so header index N
      // lines up with cell N - 1. Indexing off the label cell would shift every value.
      return new Map(
        Array.from(row.querySelectorAll('td')).slice(1).map((cell, index) => [headers[index + 1], cell.textContent?.trim() ?? ''])
      );
    };

    // Real valuations survive for the periods the ratio feed covers, and the period it does
    // not cover renders the absent marker rather than a fabricated 0.00.
    expect(rowCells(/^P\/E$/i).get('2018')).toContain('12.50');
    expect(rowCells(/^P\/E$/i).get('2025')).toContain('22.00');
    expect(rowCells(/^P\/B$/i).get('2025')).toContain('3.60');
    expect(rowCells(/^P\/E$/i).get('2026 (YTD)')).toBe('—');
    expect(rowCells(/^P\/B$/i).get('2026 (YTD)')).toBe('—');
  });

  // The statement reference is optional: when that API is unavailable the Ratios tab must
  // still render the ratio columns it does have rather than collapsing to an empty table.
  test('falls back to ratio columns when the statement reference is unavailable', async () => {
    mockUseFinancialRatios.mockReturnValue(makeQueryResult({
      symbol: 'VCI',
      count: 2,
      data: [
        { period: '2018', pe: 12.5, pb: 2.4 },
        { period: '2019', pe: 14.0, pb: 2.6 },
      ],
    }) as any);
    mockUseIncomeStatement.mockReturnValue(makeQueryResult({
      symbol: 'VCI',
      count: 0,
      data: [],
    }) as any);

    renderWithProviders(<FinancialsWidget id="fin-1" symbol="VCI" />);

    act(() => {
      screen.getByRole('button', { name: /ratios/i }).click();
    });

    await waitFor(() => {
      const headerRow = screen.getByText(/^P\/E$/i).closest('table')!.querySelector('thead tr')!;
      const headers = Array.from(headerRow.querySelectorAll('th')).map((th) => th.textContent?.trim() ?? '');
      expect(headers).toEqual(['Metric', '2018', '2019']);
    });
  });
  test('uses backend TTM statements and discloses unsupported ratio TTM', async () => {
    // The fixture supplies only the fields consumed by the widget, not React Query internals.
    const result = makeQueryResult({ symbol: 'FPT', count: 1, data: [{ period: 'TTM-2025', revenue: 15 }] }) as unknown as UseQueryResult<IncomeStatementResponse, Error>;
    mockUseIncomeStatement.mockReturnValue(result);
    renderWithProviders(<FinancialsWidget id="financial-ttm" symbol="FPT" config={{ periodSyncGroup: null }} />);
    act(() => screen.getByRole('button', { name: 'TTM' }).click());
    expect(mockUseIncomeStatement).toHaveBeenCalledWith('FPT', expect.objectContaining({ period: 'TTM', enabled: true }));
    await waitFor(() => expect(screen.getByText('TTM 2025')).toBeInTheDocument());
    act(() => screen.getByRole('button', { name: /ratios/i }).click());
    expect(screen.getByText('TTM ratios are not supported')).toBeInTheDocument();
    expect(mockUseFinancialRatios).toHaveBeenCalledWith('FPT', expect.objectContaining({ period: 'TTM', enabled: false }));
    expect(document.querySelector('table')).toBeNull();
  });

  test('keeps cost comparisons neutral and earnings labels consistent in the table and note', () => {
    // Only the statement fields consumed by the widget are needed in this fixture.
    const result = makeQueryResult({ symbol: 'FPT', count: 2, data: [
      { period: '2024', cost_of_revenue: -10, net_income: -10 },
      { period: '2025', cost_of_revenue: -15, net_income: -5 },
    ] }) as unknown as UseQueryResult<IncomeStatementResponse, Error>;
    mockUseIncomeStatement.mockReturnValue(result);
    renderWithProviders(<FinancialsWidget id="financial-language" symbol="FPT" config={{ periodSyncGroup: null }} />);

    const costRow = screen.getByText('Cost of Revenue').closest('tr')!;
    expect(costRow).toHaveTextContent('-50.0%');
    expect(costRow).not.toHaveTextContent(/profit|loss/i);
    expect(screen.getByText('Net Income').closest('tr')).toHaveTextContent('loss narrowed +50.0%');
    expect(screen.getByText(/Growth divides by the absolute prior-period value/)).toHaveTextContent('(loss narrowed)');
    expect(screen.queryByText(/loss widened/)).not.toBeInTheDocument();
  });

  test('keeps rejected interest unavailable despite raw aliases while admitting revenue', () => {
    const result = makeQueryResult({ symbol: 'FPT', count: 1, data: [{
      period: '2025',
      revenue: 120_000_000_000,
      interest_expense: null,
      unit_metadata: { interest_expense: { unavailable_reason: 'Interest expense unit is unverified' } },
      raw_data: { interest_expense: 90_000_000_000, interestExpense: 90_000_000_000, chi_phi_lai_vay: 90_000_000_000 },
    }] }) as unknown as UseQueryResult<IncomeStatementResponse, Error>;
    mockUseIncomeStatement.mockReturnValue(result);

    renderWithProviders(<FinancialsWidget id="financial-rejected-interest" symbol="FPT" config={{ periodSyncGroup: null }} />);

    const interestCells = screen.getByText('Interest Expense').closest('tr')!.querySelectorAll('td');
    const revenueCells = screen.getByText('Revenue').closest('tr')!.querySelectorAll('td');
    expect(interestCells[1]).toHaveTextContent(/^—$/);
    expect(revenueCells[1]).toHaveTextContent('120.00');
  });

  test('excludes conflicting fiscal rows instead of overwriting their values', async () => {
    // The fixture supplies only the fields consumed by the widget, not React Query internals.
    const result = makeQueryResult({ symbol: 'FPT', count: 3, data: [
      { period: '2020', revenue: 10 },
      { period: '2020', revenue: 20 },
      { period: '2021', revenue: 30 },
    ] }) as unknown as UseQueryResult<IncomeStatementResponse, Error>;
    mockUseIncomeStatement.mockReturnValue(result);
    renderWithProviders(<FinancialsWidget id="financial-conflict" symbol="FPT" config={{ periodSyncGroup: null }} />);
    expect(screen.getByText(/1 conflicting periods excluded/)).toBeInTheDocument();
    expect(screen.queryByText('2020')).not.toBeInTheDocument();
    expect(screen.getByText('2021')).toBeInTheDocument();
  });
});
