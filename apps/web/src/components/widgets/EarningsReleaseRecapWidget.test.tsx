import { render, screen } from '@testing-library/react';
import { useCashFlow, useCompanyEvents, useCompanyNews, useEarningsQuality, useIncomeStatement } from '@/lib/queries';
import { EarningsReleaseRecapWidget } from './EarningsReleaseRecapWidget';

jest.mock('@/lib/queries', () => ({
  useIncomeStatement: jest.fn(),
  useCashFlow: jest.fn(),
  useEarningsQuality: jest.fn(),
  useCompanyNews: jest.fn(),
  useCompanyEvents: jest.fn(),
}));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));
jest.mock('@/contexts/UnitContext', () => ({
  useUnit: () => ({
    config: { display: 'raw', decimals: 0, usdVndRate: 25000, usdVndRatesByYear: {} },
    globalUsdVndDefaultRate: 25000,
    adminUsdVndRatesByYear: {},
    localUsdVndRatesByYear: {},
    setUnit: jest.fn(),
    setDecimalPlaces: jest.fn(),
    setUsdVndRate: jest.fn(),
    clearUsdVndRates: jest.fn(),
  }),
}));

const idle = () => ({ data: undefined, error: null, isLoading: false, isFetching: false, refetch: jest.fn(), dataUpdatedAt: 1750000000000 }) as never;
const income = jest.mocked(useIncomeStatement);

function showYears(latest: object, prior: object) {
  income.mockReturnValue({ data: { data: [latest, prior] }, error: null, isLoading: false, isFetching: false, refetch: jest.fn(), dataUpdatedAt: 1750000000000 } as never);
  jest.mocked(useCashFlow).mockReturnValue(idle());
  jest.mocked(useEarningsQuality).mockReturnValue(idle());
  jest.mocked(useCompanyNews).mockReturnValue(idle());
  jest.mocked(useCompanyEvents).mockReturnValue(idle());
  render(<EarningsReleaseRecapWidget id="recap" symbol="FPT" />);
}

/** The value tile beside a label, e.g. "Net Income YoY". */
function tile(label: string): HTMLElement {
  return screen.getByText(label).nextElementSibling as HTMLElement;
}

describe('earnings recap highlight tones', () => {
  it('colours each signed delta by its sign, not by a fixed tone', () => {
    // Net income halves and the gross margin shrinks: both are adverse moves.
    showYears(
      { period: '2026-Q1', revenue: 100, net_income: 50, eps: 1, gross_profit: 10 },
      { period: '2025-Q1', revenue: 100, net_income: 100, eps: 2, gross_profit: 40 },
    );

    const netIncome = tile('Net Income YoY');
    expect(netIncome.textContent).toContain('-50.0%');
    expect(netIncome.className).toContain('--color-negative');
    expect(netIncome.className).not.toContain('--color-positive');

    const margin = tile('Gross Margin Delta');
    expect(margin.textContent).toContain('-30.0 pp');
    expect(margin.className).toContain('--color-negative');
    expect(margin.className).not.toContain('--color-warning');
  });

  it('keeps a rising net income in the gain tone', () => {
    showYears(
      { period: '2026-Q1', revenue: 100, net_income: 150, eps: 3, gross_profit: 50 },
      { period: '2025-Q1', revenue: 100, net_income: 100, eps: 2, gross_profit: 40 },
    );

    expect(tile('Net Income YoY').className).toContain('--color-positive');
    expect(tile('Gross Margin Delta').className).toContain('--color-positive');
  });


  it('reads a zero gross profit as a 0% margin in both the tile and the bridge', () => {
    // The highlight tiles and the Quarter bridge used to disagree: the tiles
    // computed a real 0% margin, the bridge gated on truthiness and printed
    // n/a for the same admitted revenue and gross profit.
    showYears(
      { period: '2026-Q1', revenue: 100, net_income: 10, eps: 1, gross_profit: 0 },
      { period: '2025-Q1', revenue: 100, net_income: 10, eps: 1, gross_profit: 20 },
    );

    expect(tile('Gross Margin Delta').textContent).toContain('-20.0 pp');
    // The bridge row for the same admitted values must publish 0.0%, not n/a.
    // Reading the row's own cells keeps the assertion off the highlight tile.
    const bridgeLabel = screen.getByText('Gross Margin', { selector: 'td' });
    const bridgeRow = bridgeLabel.closest('tr') as HTMLElement;
    expect(bridgeRow.textContent).toContain('0.0 pp');
    expect(bridgeRow.textContent).not.toContain('n/a');
  });

  it('does not paint an n/m margin with a direction', () => {
    // A margin past +-200% is rendered `n/m` by the clamp. Toning the raw value
    // painted that refusal green, so the tile claimed a direction for a figure
    // it would not state.
    showYears(
      { period: '2026-Q1', revenue: 100, net_income: 10, eps: 1, gross_profit: 500 },
      { period: '2025-Q1', revenue: 100, net_income: 10, eps: 1, gross_profit: -100 },
    );

    const delta = tile('Gross Margin Delta');
    expect(delta.textContent).toContain('n/m');
    expect(delta.className).not.toContain('--color-positive');
    expect(delta.className).not.toContain('--color-negative');
  });
});
