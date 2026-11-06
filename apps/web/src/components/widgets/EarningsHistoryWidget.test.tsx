import { render, screen } from '@testing-library/react';
import { useIncomeStatement } from '@/lib/queries';
import { EarningsHistoryWidget } from './EarningsHistoryWidget';

jest.mock('@/lib/queries', () => ({ useIncomeStatement: jest.fn() }));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));
jest.mock('@/contexts/UnitContext', () => ({
  useUnit: () => ({
    config: {
      display: 'raw',
      decimals: 0,
      usdVndRate: 25000,
      usdVndRatesByYear: {},
    },
    globalUsdVndDefaultRate: 25000,
    adminUsdVndRatesByYear: {},
    localUsdVndRatesByYear: {},
    setUnit: jest.fn(),
    setDecimalPlaces: jest.fn(),
    setUsdVndRate: jest.fn(),
    clearUsdVndRates: jest.fn(),
  }),
}));

const incomeQuery = jest.mocked(useIncomeStatement);

function showQuarter(revenue: number, netIncome: number) {
  incomeQuery.mockReturnValue({
    data: { data: [{ period: '2026-Q1', revenue, net_income: netIncome }] },
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
    dataUpdatedAt: 1750000000000,
  } as never);
  render(<EarningsHistoryWidget symbol="FPT" />);
}

/** The margin cell is the last column of the only data row. */
function marginCell(): HTMLElement {
  const row = screen.getByText('Q1 2026').closest('tr')!;
  return row.querySelectorAll('td')[5] as HTMLElement;
}

describe('earnings history margin tone', () => {
  it('does not paint a loss-making quarter as a gain', () => {
    // Revenue 100, net loss 20 => margin -20%. Green here would claim a gain.
    showQuarter(100, -20);
    expect(marginCell().textContent).toContain('-20.00%');
    expect(marginCell().className).not.toContain('--color-positive');
    expect(marginCell().className).toContain('--color-negative');
  });

  it('paints a profitable quarter as a gain', () => {
    showQuarter(100, 20);
    expect(marginCell().textContent).toContain('20.00%');
    expect(marginCell().className).toContain('--color-positive');
  });

  it('treats a measured zero margin as ink rather than a gain', () => {
    showQuarter(100, 0);
    expect(marginCell().textContent).toContain('0.00%');
    expect(marginCell().className).not.toContain('--color-positive');
    expect(marginCell().className).not.toContain('--color-negative');
  });
});
