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
jest.mock('@/contexts/SymbolLinkContext', () => ({
    useSymbolLink: () => ({
        globalSymbol: 'FPT',
        setGlobalSymbol: jest.fn(),
        linkedWidgets: new Set<string>(),
        toggleWidgetLink: jest.fn(),
        isWidgetLinked: () => false,
    }),
}));
jest.mock('@/contexts/WidgetGroupContext', () => ({
    useWidgetGroups: () => ({ globalSymbol: 'FPT', setGlobalSymbol: jest.fn() }),
}));
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
const cashFlow = jest.mocked(useCashFlow);
const quality = jest.mocked(useEarningsQuality);

/** An admitted statement row: a comparison needs a declared shared basis. */
const row = (period: string, values: Record<string, number | null>) => ({
  period,
  currency: 'VND',
  value_unit: 'VND',
  consolidation_basis: 'consolidated',
  flow_basis: 'single_quarter',
  source: 'vietcap',
  ...values,
});

function show(incomeRows: object[], cashRows: object[] = [], qualityData?: object, qualityError?: string, onDataChange?: (data: unknown) => void) {
  income.mockReturnValue({ data: { data: incomeRows }, error: null, isLoading: false, isFetching: false, refetch: jest.fn(), dataUpdatedAt: 1750000000000 } as never);
  cashFlow.mockReturnValue({ data: { data: cashRows }, error: null, isLoading: false, isFetching: false, refetch: jest.fn(), dataUpdatedAt: 1750000000000 } as never);
  quality.mockReturnValue(qualityData
    ? { data: { data: qualityData, error: qualityError ?? null }, error: null, isLoading: false, isFetching: false, refetch: jest.fn(), dataUpdatedAt: 1750000000000 } as never
    : idle());
  jest.mocked(useCompanyNews).mockReturnValue(idle());
  jest.mocked(useCompanyEvents).mockReturnValue(idle());
  return render(<EarningsReleaseRecapWidget id="recap" symbol="FPT" onDataChange={onDataChange} />);
}

/** The value tile beside a label, e.g. "Net Income YoY". */
function tile(label: string): HTMLElement {
  return screen.getByText(label).nextElementSibling as HTMLElement;
}

function bridgeRow(label: string): HTMLElement {
  return screen.getByText(label, { selector: 'td' }).closest('tr') as HTMLElement;
}

describe('earnings recap highlight tones', () => {
  it('colours each signed delta by its sign, not by a fixed tone', () => {
    // Net income halves and the gross margin shrinks: both are adverse moves.
    show([
      row('2026-Q1', { revenue: 100, net_income: 50, eps: 1, gross_profit: 10 }),
      row('2025-Q1', { revenue: 100, net_income: 100, eps: 2, gross_profit: 40 }),
    ]);

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
    show([
      row('2026-Q1', { revenue: 100, net_income: 150, eps: 3, gross_profit: 50 }),
      row('2025-Q1', { revenue: 100, net_income: 100, eps: 2, gross_profit: 40 }),
    ]);

    expect(tile('Net Income YoY').className).toContain('--color-positive');
    expect(tile('Gross Margin Delta').className).toContain('--color-positive');
  });

  it('reads a zero gross profit as a 0% margin in both the tile and the bridge', () => {
    // The highlight tiles and the Quarter bridge used to disagree: the tiles
    // computed a real 0% margin, the bridge gated on truthiness and printed
    // n/a for the same admitted revenue and gross profit.
    show([
      row('2026-Q1', { revenue: 100, net_income: 10, eps: 1, gross_profit: 0 }),
      row('2025-Q1', { revenue: 100, net_income: 10, eps: 1, gross_profit: 20 }),
    ]);

    expect(tile('Gross Margin Delta').textContent).toContain('-20.0 pp');
    expect(bridgeRow('Gross Margin').textContent).toContain('0.0 pp');
    expect(bridgeRow('Gross Margin').textContent).not.toContain('n/a');
  });

  it('does not paint an n/m margin with a direction', () => {
    // A margin past +-200% is rendered `n/m` by the clamp. Toning the raw value
    // painted that refusal green, so the tile claimed a direction for a figure
    // it would not state.
    show([
      row('2026-Q1', { revenue: 100, net_income: 10, eps: 1, gross_profit: 500 }),
      row('2025-Q1', { revenue: 100, net_income: 10, eps: 1, gross_profit: -100 }),
    ]);

    const delta = tile('Gross Margin Delta');
    expect(delta.textContent).toContain('n/m');
    expect(delta.className).not.toContain('--color-positive');
    expect(delta.className).not.toContain('--color-negative');
  });
});

describe('earnings recap comparison period', () => {
  it('withholds YoY when only the sequential quarter exists', () => {
    // Issue #258: the second-newest row is 2025-Q1, not 2024-Q2. It must not be
    // substituted and then labelled year-over-year.
    show([
      row('2025-Q2', { revenue: 200, net_income: 40, eps: 4 }),
      row('2025-Q1', { revenue: 100, net_income: 20, eps: 2 }),
    ]);

    expect(tile('Revenue YoY').textContent).toContain('n/a');
    expect(tile('Net Income YoY').textContent).toContain('n/a');
    expect(tile('EPS YoY').textContent).toContain('n/a');
    // No 100% quarter-over-quarter figure may leak into the YoY tile.
    expect(tile('Revenue YoY').textContent).not.toContain('100.0%');
    expect(screen.getByTestId('recap-comparison-note').textContent).toContain('2024-Q2 not reported');
  });

  it('compares the exact prior-year quarter and labels both periods', () => {
    show([
      row('2025-Q2', { revenue: 200, net_income: 40, eps: 4 }),
      row('2025-Q1', { revenue: 999, net_income: 999, eps: 99 }),
      row('2024-Q2', { revenue: 100, net_income: 20, eps: 2 }),
    ]);

    expect(tile('Revenue YoY').textContent).toContain('100.0%');
    expect(tile('Net Income YoY').textContent).toContain('100.0%');
    expect(screen.getByTestId('recap-comparison-note').textContent).toContain('Q2 2024');
  });

  it('keeps a loss base and a zero base distinguishable', () => {
    show([
      row('2026-Q1', { revenue: 100, net_income: 50, eps: 1 }),
      row('2025-Q1', { revenue: 0, net_income: -100, eps: -1 }),
    ]);

    // Division by the absolute loss base is a real rate; a zero revenue base is
    // not a rate at all.
    expect(tile('Net Income YoY').textContent).toContain('150.0%');
    expect(tile('Revenue YoY').textContent).toContain('n/a');
  });

  it('withholds the rate when the two periods declare different bases', () => {
    show([
      row('2026-Q1', { revenue: 200, net_income: 40, eps: 4 }),
      { ...row('2025-Q1', { revenue: 100, net_income: 20, eps: 2 }), consolidation_basis: 'separate' },
    ]);

    expect(tile('Revenue YoY').textContent).toContain('n/a');
    expect(screen.getByTestId('recap-comparison-note').textContent).toContain('reporting basis differs (consolidation basis)');
  });
});

describe('earnings recap cash flow period', () => {
  it('shows the cash figures with their own period', () => {
    show(
      [row('2025-Q2', { revenue: 200, net_income: 40, eps: 4 })],
      [row('2025-Q2', { operating_cash_flow: 80, free_cash_flow: 50 })],
    );

    expect(screen.getByText('Operating CF').nextElementSibling?.textContent).toBe('80');
    expect(screen.getByText(/Cash flow period:/).textContent).toContain('Q2 2025');
  });

  it('names the mismatched cash period instead of showing it as this quarter', () => {
    // Issue #258: a 2024-Q4 row used to supply the cash section of a 2025-Q2
    // recap with no disclosure.
    show(
      [row('2025-Q2', { revenue: 200, net_income: 40, eps: 4 })],
      [row('2024-Q4', { operating_cash_flow: 80, free_cash_flow: 50 })],
    );

    expect(screen.getByText('Operating CF').nextElementSibling?.textContent).toBe('n/a');
    const note = screen.getByRole('status').textContent ?? '';
    expect(note).toContain('no cash flow statement for Q2 2025');
    expect(note).toContain('Q4 2024');
    expect(note).toContain('not shown here');
  });
});

describe('earnings recap quality section', () => {
  it('renders without a grade when quality coverage is unavailable', () => {
    show(
      [row('2025-Q2', { revenue: 200, net_income: 40, eps: 4 })],
      [],
      { grade: null, trend: null, checks: [], coverage: { status: 'unavailable', unavailable_reason: 'no admitted periods' } },
      'Insufficient admitted quarterly statement coverage for earnings quality.',
    );

    // The recap keeps the statement sections it does have and states the
    // quality gap rather than throwing or claiming a Stable trend (#257).
    expect(bridgeRow('Revenue')).toBeInTheDocument();
    expect(screen.getByText(/Earnings quality unavailable/).textContent).toContain('Insufficient admitted quarterly statement coverage');
    expect(screen.queryByText(/Stable trend/)).toBeNull();
  });
});

describe('earnings recap admission changes on refetch', () => {
  it('recomputes the narrative when only the comparison metadata is withheld', () => {
    // F6: the amounts do not move, but the prior row stops being comparable.
    const latest = row('2025-Q2', { revenue: 200, net_income: 40, eps: 4 });
    const comparable = row('2024-Q2', { revenue: 100, net_income: 20, eps: 2 });
    const { rerender } = show([latest, comparable]);
    expect(tile('Revenue YoY').textContent).toContain('100.0%');
    expect(screen.getByText(/revenue grew/)).toBeInTheDocument();

    income.mockReturnValue({
      data: { data: [latest, { ...comparable, consolidation_basis: 'separate' }] },
      error: null, isLoading: false, isFetching: false, refetch: jest.fn(), dataUpdatedAt: 1750000000001,
    } as never);
    rerender(<EarningsReleaseRecapWidget id="recap" symbol="FPT" />);

    expect(tile('Revenue YoY').textContent).toContain('n/a');
    expect(screen.queryByText(/revenue grew/)).toBeNull();
    expect(screen.getByText(/revenue YoY is unavailable/)).toBeInTheDocument();
  });
});

describe('earnings recap export context', () => {
  it('forwards per-metric and quality admission reasons', () => {
    // F7: a zero base or a rejected field must reach exports/copilot, not only
    // the row-pair reason which is null for an admitted comparison.
    const onDataChange = jest.fn();
    show([
      row('2025-Q2', { revenue: 200, net_income: 40, eps: 4 }),
      row('2024-Q2', { revenue: 0, net_income: 20, eps: 2 }),
    ], [], { grade: null, trend: null, checks: [], coverage: { status: 'unavailable', unavailable_reason: 'no admitted periods' } },
      undefined, onDataChange);

    const runtime = onDataChange.mock.calls.at(-1)?.[0];
    expect(runtime.comparison_unavailable_reason ?? null).toBeNull();
    expect(runtime.metric_unavailable_reasons.revenue.unavailable_reason).toContain('zero prior-period base');
    expect(runtime.quality_unavailable_reason).toBe('no admitted periods');
  });

  it('forwards a withheld bridge metric beyond the headline three', () => {
    // #258: the bridge rows are gross profit, operating income and pre-tax
    // profit; a suppressed one must stay explicit rather than vanish from the
    // runtime context.
    const onDataChange = jest.fn();
    const latest = row('2025-Q2', { revenue: 200, net_income: 40, eps: 4 });
    const comparable = row('2024-Q2', { revenue: 100, net_income: 20, eps: 2 });
    income.mockReturnValue({ data: { data: [latest, comparable] }, error: null, isLoading: false, isFetching: false, refetch: jest.fn(), dataUpdatedAt: 1750000000000 } as never);
    cashFlow.mockReturnValue({ data: { data: [] }, error: null, isLoading: false, isFetching: false, refetch: jest.fn(), dataUpdatedAt: 1750000000000 } as never);
    quality.mockReturnValue(idle());
    jest.mocked(useCompanyNews).mockReturnValue(idle());
    jest.mocked(useCompanyEvents).mockReturnValue(idle());
    render(<EarningsReleaseRecapWidget id="recap" symbol="FPT" onDataChange={onDataChange} />);

    const runtime = onDataChange.mock.calls.at(-1)?.[0];
    // A row without an operating-income figure is withheld with its reason.
    expect(runtime.metric_unavailable_reasons.operating_income.unavailable_reason).toBeTruthy();
    expect(runtime.metric_unavailable_reasons.gross_profit.unavailable_reason).toBeTruthy();
    expect(runtime.metric_unavailable_reasons.pre_tax_profit.unavailable_reason).toBeTruthy();
    expect(runtime.metric_unavailable_reasons.gross_margin.unavailable_reason).toBeTruthy();
    // The admitted revenue rate carries no reason, so both states are distinct.
    expect(runtime.metric_unavailable_reasons.revenue.value).not.toBeNull();
    expect(runtime.metric_unavailable_reasons.revenue.unavailable_reason).toBeNull();
  });
});
