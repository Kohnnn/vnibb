import { render, screen, waitFor } from '@testing-library/react';
import { useFinancialRatios, useIncomeStatement } from '@/lib/queries';
import { FinancialRatiosWidget } from '@/components/widgets/FinancialRatiosWidget';
import { UnitProvider } from '@/contexts/UnitContext';

jest.mock('@/lib/queries', () => ({
  useFinancialRatios: jest.fn(),
  useIncomeStatement: jest.fn(),
}));

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/WidgetMeta', () => ({
  WidgetMeta: () => null,
}));

jest.mock('@/components/ui/widget-skeleton', () => ({
  WidgetSkeleton: () => <div data-testid="widget-skeleton" />,
}));

const mockUseFinancialRatios = useFinancialRatios as jest.MockedFunction<typeof useFinancialRatios>;
const mockUseIncomeStatement = useIncomeStatement as jest.MockedFunction<typeof useIncomeStatement>;

// The widget reads only these fields off each query, so the stubs are typed to that surface
// and cast once at the mock boundary rather than faking the whole React Query result.
interface MockQueryResult {
  data: unknown;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: jest.Mock;
  dataUpdatedAt: number;
}

const queryResult = (data: unknown, error: Error | null = null) => ({
  data,
  error,
  isLoading: false,
  isFetching: false,
  isError: Boolean(error),
  refetch: jest.fn(),
  dataUpdatedAt: Date.now(),
}) satisfies MockQueryResult as unknown as ReturnType<typeof useFinancialRatios>;

// Provider shape: the ratio feed covers 2012..2025 while the statement feed only reaches
// back to 2018 and carries the current-year roll-up as 2026 YTD. The ratio feed also holds
// a 2026 fiscal-year row, which must not be attributed to the YTD period.
const ratioYears = [...Array.from({ length: 14 }, (_, index) => 2012 + index), 2026];
const ratiosResponse = {
  symbol: 'FPT',
  count: ratioYears.length,
  data: ratioYears.map((year) => ({
    period: String(year),
    pe: year === 2025 ? 18.4 : 10 + (year - 2012),
    pb: 2.1,
    ps: 1.2,
  })),
};
const statementResponse = {
  symbol: 'FPT',
  count: 9,
  data: [
    ...Array.from({ length: 8 }, (_, index) => ({
      period: String(2018 + index),
      revenue: 1,
      net_income: 1,
    })),
    { period: '2026 YTD', revenue: 1, net_income: 1 },
  ],
};

function renderWidget() {
  return render(
    <UnitProvider>
      <FinancialRatiosWidget id="ratios-1" symbol="FPT" />
    </UnitProvider>,
  );
}

function headerLabels(): string[] {
  return Array.from(document.querySelectorAll('thead th')).map((cell) => cell.textContent?.trim() ?? '');
}

// A cell renders the value alongside a signed growth badge; drop the badge suffix so the
// assertion is about the ratio, not the change chip.
const stripGrowthBadge = (cell: Element) =>
  (cell.textContent ?? '').replace(/[+-]\d+(?:\.\d+)?%$/, '').trim();

function rowValues(labelNode: HTMLElement): string[] {
  const row = labelNode.closest('tr');
  if (!row) throw new Error('ratio row not found');
  return Array.from(row.querySelectorAll('td')).map(stripGrowthBadge);
}

describe('FinancialRatiosWidget period columns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFinancialRatios.mockReturnValue(queryResult(ratiosResponse));
    mockUseIncomeStatement.mockReturnValue(queryResult(statementResponse));
  });

  // The columns are the statement panels' window verbatim — same headings, same newest-only
  // edge — so the ratio feed cannot widen the table back to 2012 or drop 2018/2019.
  test('shows the statement reference window, with the current-year roll-up last', async () => {
    renderWidget();

    await waitFor(() => {
      const labels = headerLabels();
      expect(labels).toContain('2018');
      expect(labels).toContain('2019');
      expect(labels).toContain('2025');
      expect(labels).toContain('2026 (YTD)');
    });

    expect(headerLabels()).toEqual([
      'Metric',
      '2018',
      '2019',
      '2020',
      '2021',
      '2022',
      '2023',
      '2024',
      '2025',
      '2026 (YTD)',
    ]);
  });

  // Regression: aligning to the statement window used to drop the ratio years the statement
  // feed does not reach, so a populated 2018/2019 P/E disappeared from the table.
  test('keeps the real ratio values of the periods inside the window', async () => {
    renderWidget();

    await waitFor(() => expect(headerLabels()).toContain('2018'));

    const values = rowValues(screen.getByText(/^P\/E$/i));
    const cellByHeader = Object.fromEntries(headerLabels().map((label, index) => [label, values[index]]));

    expect(cellByHeader['2018']).toBe('16.00');
    expect(cellByHeader['2019']).toBe('17.00');
    expect(cellByHeader['2025']).toBe('18.40');
    // The YTD roll-up is its own period: the ratio feed's 2026 fiscal-year row belongs to
    // FY 2026, not to it, so the cell stays empty rather than claiming a value.
    expect(cellByHeader['2026 (YTD)']).toBe('—');
  });

  // The ratio query is the widget's own source; the statement query only names the periods,
  // so an unavailable statement feed must not blank the table.
  test('falls back to the ratio periods when the statement reference is unavailable', async () => {
    mockUseIncomeStatement.mockReturnValue(queryResult(undefined, new Error('statement feed unavailable')));

    renderWidget();

    await waitFor(() => expect(headerLabels()).toContain('2025'));

    const labels = headerLabels();
    expect(labels).toContain('2012');
    expect(labels).toContain('2020');
    expect(labels).toContain('2025');
    expect(mockUseIncomeStatement).toHaveBeenCalledWith('FPT', expect.objectContaining({ period: 'year', enabled: true }));
  });
});
