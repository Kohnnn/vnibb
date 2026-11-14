import { render, screen } from '@testing-library/react';
import { useCashFlow } from '@/lib/queries';
import {
  CashFlowWidget,
  RAW_CASHFLOW_ALIASES,
  fieldWithheldReason,
  getRawMetric,
  isRawMetricAdmitted,
} from './CashFlowWidget';

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
  it('refuses a raw alias the API never admitted, even with no rejection recorded', () => {
    // #245: absence of a rejection is not admission. The row declares a VND
    // basis but carries no unit evidence for depreciation, so the raw provider
    // number stays raw instead of being formatted as admitted VND.
    const entry = {
      ...admittedRow,
      unit_metadata: { operating_cash_flow: { source_unit: 'VND', value_unit: 'VND' } },
      raw_data: { depreciation: 8_470_680_000_000 },
    };
    expect(isRawMetricAdmitted(entry as never, 'depreciation')).toBe(false);
    expect(getRawMetric(entry as never, 'depreciation')).toBeNull();
    // The admitted sibling still reads its own evidence.
    expect(isRawMetricAdmitted(admittedRow as never, 'operating_cash_flow')).toBe(true);
  });

  it('refuses every alias of a metric rejected under one spelling', () => {
    const entry = {
      ...admittedRow,
      unit_metadata: {
        ...admittedRow.unit_metadata,
        increase_decrease_in_receivables: { unavailable_reason: 'unverified_monetary_unit' },
      },
    };
    expect(isRawMetricAdmitted(entry as never, 'change_in_receivables')).toBe(false);
    expect(getRawMetric({ ...entry, raw_data: { change_in_receivables: 5 } } as never, 'change_in_receivables')).toBeNull();
  });

  it.each([
    ['USD', 'USD'],
    ['VND', 'USD'],
    ['VND/share', 'VND/share'],
  ])('does not promote a %s/%s declaration as VND', (valueUnit, sourceUnit) => {
    // #245: a different currency is not evidence for a VND figure.
    const entry = {
      ...admittedRow,
      unit_metadata: { taxes_paid: { source_unit: sourceUnit, value_unit: valueUnit } },
      raw_data: { taxes_paid: 4_775_780_000_000 },
    };
    expect(isRawMetricAdmitted(entry as never, 'taxes_paid')).toBe(false);
    expect(getRawMetric(entry as never, 'taxes_paid')).toBeNull();
  });

  it.each(['million_VND', 'Bn. VND', 'billion VND'])(
    'promotes a certified converted source declared in %s',
    (sourceUnit) => {
      // The API accepts a source_unit naming the provider's original scale while
      // the value is already normalized to VND; only the currency must match.
      const entry = {
        ...admittedRow,
        unit_metadata: { taxes_paid: { source_unit: sourceUnit, value_unit: 'VND' } },
        raw_data: { taxes_paid: 4_775_780_000_000 },
      };
      expect(isRawMetricAdmitted(entry as never, 'taxes_paid')).toBe(true);
      expect(getRawMetric(entry as never, 'taxes_paid')).toBe(4_775_780_000_000);
    },
  );

  it('refuses a metadata unit that contradicts the admitted target', () => {
    // `{value_unit: VND, source_unit: VND, unit: USD}` is self-contradictory;
    // the API rejects it and so must the table.
    const entry = {
      ...admittedRow,
      unit_metadata: { taxes_paid: { value_unit: 'VND', source_unit: 'VND', unit: 'USD' } },
      raw_data: { taxes_paid: 4_775_780_000_000 },
    };
    expect(isRawMetricAdmitted(entry as never, 'taxes_paid')).toBe(false);
    expect(getRawMetric(entry as never, 'taxes_paid')).toBeNull();
  });

  it('admits a component-evidenced metric only when every component is VND', () => {
    const admitted = {
      ...admittedRow,
      unit_metadata: {
        taxes_paid: {
          components: [
            { value_unit: 'VND', source_unit: 'million_VND' },
            { value_unit: 'VND', source_unit: 'Bn. VND' },
          ],
        },
      },
      raw_data: { taxes_paid: 12 },
    };
    expect(isRawMetricAdmitted(admitted as never, 'taxes_paid')).toBe(true);
    const mixed = {
      ...admitted,
      unit_metadata: {
        taxes_paid: {
          components: [
            { value_unit: 'VND', source_unit: 'VND' },
            { value_unit: 'USD', source_unit: 'USD' },
          ],
        },
      },
    };
    expect(isRawMetricAdmitted(mixed as never, 'taxes_paid')).toBe(false);
  });

  it('refuses raw values on a row with no admitted VND basis', () => {
    const entry = { ...admittedRow, currency: null, value_unit: null, unit_metadata: {}, raw_data: { taxes_paid: 12 } };
    expect(isRawMetricAdmitted(entry as never, 'taxes_paid')).toBe(false);
    expect(getRawMetric(entry as never, 'taxes_paid')).toBeNull();
    expect(getRawMetric({ ...entry, raw_data: { taxes_paid: 'NaN' } } as never, 'taxes_paid')).toBeNull();
    expect(getRawMetric({ ...entry, raw_data: { taxes_paid: Number.POSITIVE_INFINITY } } as never, 'taxes_paid')).toBeNull();
  });

  it('refuses a raw alias whose canonical field was withheld', () => {
    // Issue #245: the admission warning says depreciation is withheld, so the
    // table must not read the raw provider value and format it as billions VND.
    expect(getRawMetric(admittedRow as never, 'depreciation')).toBeNull();
    expect(fieldWithheldReason(admittedRow as never, 'depreciation'))
      .toBe('unverified_statement_currency_or_unit');
  });

  it('reads a raw alias the API affirmatively admitted', () => {
    const entry = {
      ...admittedRow,
      unit_metadata: { taxes_paid: { source_unit: 'VND', value_unit: 'VND' } },
      raw_data: { taxes_paid: 1_234_000_000 },
    };
    expect(getRawMetric(entry as never, 'taxes_paid')).toBe(1_234_000_000);
  });

  it('keeps blank raw values missing instead of coercing them to zero', () => {
    const entry = {
      ...admittedRow,
      unit_metadata: { taxes_paid: { source_unit: 'VND', value_unit: 'VND' } },
      raw_data: { taxes_paid: '' },
    };
    expect(getRawMetric(entry as never, 'taxes_paid')).toBeNull();
  });

  it('keeps a reported raw zero distinct from a missing value', () => {
    const unit = { taxes_paid: { source_unit: 'VND', value_unit: 'VND' } };
    const entry = { ...admittedRow, unit_metadata: unit, raw_data: { taxes_paid: 0 } };
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

describe('cash flow raw alias coverage', () => {
  // Every aliased metric, not just the audit's depreciation sample: a rejection
  // recorded under any spelling keeps that raw number out of the table (#245).
  it.each(Object.keys(RAW_CASHFLOW_ALIASES))('withholds %s when its field is rejected', (metric) => {
    const entry = {
      ...admittedRow,
      raw_data: { [RAW_CASHFLOW_ALIASES[metric][0]]: 4_775_780_000_000 },
      unit_metadata: { [metric]: { unavailable_reason: 'unverified_statement_currency_or_unit' } },
    };
    expect(getRawMetric(entry as never, metric)).toBeNull();
  });

  it.each(Object.keys(RAW_CASHFLOW_ALIASES))('withholds %s when its evidence is absent', (metric) => {
    const entry = {
      ...admittedRow,
      unit_metadata: { operating_cash_flow: { source_unit: 'VND', value_unit: 'VND' } },
      raw_data: { [RAW_CASHFLOW_ALIASES[metric][0]]: 4_775_780_000_000 },
    };
    expect(getRawMetric(entry as never, metric)).toBeNull();
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
