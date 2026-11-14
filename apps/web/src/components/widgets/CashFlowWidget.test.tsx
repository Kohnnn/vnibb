import { render, screen } from '@testing-library/react';
import { useCashFlow } from '@/lib/queries';
import { CashFlowWidget, fieldWithheldReason, getRawMetric } from './CashFlowWidget';

jest.mock('@/lib/queries', () => ({ useCashFlow: jest.fn() }));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));
jest.mock('@/contexts/SymbolLinkContext', () => ({
  useSymbolLink: () => ({
    globalSymbol: 'HPG',
    setGlobalSymbol: jest.fn(),
    linkedWidgets: new Set<string>(),
    toggleWidgetLink: jest.fn(),
    isWidgetLinked: () => false,
  }),
}));
jest.mock('@/contexts/WidgetGroupContext', () => ({
  useWidgetGroups: () => ({ globalSymbol: 'HPG', setGlobalSymbol: jest.fn() }),
}));
jest.mock('@/components/ui/ChartMountGuard', () => ({ ChartMountGuard: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
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

const cashFlow = jest.mocked(useCashFlow);

/** An admitted cash-flow row: unit evidence exists for operating cash flow. */
const admittedRow = {
  symbol: 'HPG',
  period: '2025',
  currency: 'VND',
  value_unit: 'VND',
  consolidation_basis: 'consolidated',
  flow_basis: 'annual',
  source: 'vietcap',
  operating_cash_flow: 12_000_000_000_000,
  unit_metadata: {
    operating_cash_flow: { source_unit: 'VND', value_unit: 'VND' },
    depreciation: { unavailable_reason: 'unverified_statement_currency_or_unit' },
  },
  raw_data: { depreciation: 8_470_680_000_000 },
};

function renderWith(rows: object[]) {
  cashFlow.mockReturnValue({
    data: { data: rows },
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
    dataUpdatedAt: 1750000000000,
  } as never);
  return render(<CashFlowWidget id="cash_flow" symbol="HPG" />);
}

describe('cash flow raw alias admission', () => {
  it('refuses a raw alias whose canonical field was withheld', () => {
    // Issue #245: the admission warning says depreciation is withheld, so the
    // table must not read the raw provider value and format it as billions VND.
    expect(getRawMetric(admittedRow as never, 'depreciation')).toBeNull();
    expect(fieldWithheldReason(admittedRow as never, 'depreciation'))
      .toBe('unverified_statement_currency_or_unit');
  });

  it('reads a raw alias that carries no rejection', () => {
    const entry = {
      ...admittedRow,
      unit_metadata: { operating_cash_flow: { source_unit: 'VND', value_unit: 'VND' } },
      raw_data: { taxes_paid: 1_234_000_000 },
    };
    expect(getRawMetric(entry as never, 'taxes_paid')).toBe(1_234_000_000);
  });

  it('keeps blank raw values missing instead of coercing them to zero', () => {
    const entry = { ...admittedRow, unit_metadata: {}, raw_data: { taxes_paid: '' } };
    expect(getRawMetric(entry as never, 'taxes_paid')).toBeNull();
  });

  it('keeps a reported raw zero distinct from a missing value', () => {
    const entry = { ...admittedRow, unit_metadata: {}, raw_data: { taxes_paid: 0 } };
    expect(getRawMetric(entry as never, 'taxes_paid')).toBe(0);
    expect(getRawMetric({ ...entry, raw_data: {} } as never, 'taxes_paid')).toBeNull();
  });

  it('honours a rejection recorded in the persisted canonical copy', () => {
    const entry = {
      ...admittedRow,
      unit_metadata: {},
      raw_data: {
        depreciation: 8_470_680_000_000,
        _financial_lineage: { canonical_data: { unit_metadata: { depreciation: { unavailable_reason: 'unverified_monetary_unit' } } } },
      },
    };
    expect(fieldWithheldReason(entry as never, 'depreciation')).toBe('unverified_monetary_unit');
    expect(getRawMetric(entry as never, 'depreciation')).toBeNull();
  });
});

describe('cash flow table rendering', () => {
  it('leaves a rejected aliased metric out of the table while keeping the row', () => {
    renderWith([admittedRow]);

    // The admitted row still renders and the warning names the withheld field.
    expect(screen.getByText('Operating CF')).toBeInTheDocument();
    expect(screen.getByText(/unverified_statement_currency_or_unit/)).toBeInTheDocument();
    expect(screen.getByText(/depreciation/)).toBeInTheDocument();
    // A withheld field earns no table row at all, so its raw value can never be
    // formatted under the statement's currency scale.
    expect(screen.queryByText('Depreciation')).toBeNull();
    expect(screen.queryByText(/8,470\.68/)).toBeNull();
  });
});
