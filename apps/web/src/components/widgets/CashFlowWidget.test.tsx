import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCashFlow } from '@/lib/queries';
import { WidgetHeaderVisibilityProvider } from '@/components/ui/WidgetContainer';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { getWidgetExportData } from '@/lib/widgetRuntime';
import { provenanceToMarkdown, rowsToCSV } from '@/lib/exportWidget';
import { buildVniAgentWorkspaceContext } from '@/lib/vniagentWorkspace';
import {
  CashFlowWidget,
  RAW_CASHFLOW_ALIASES,
  fieldWithheldReason,
  getRawMetric,
} from './CashFlowWidget';
import { WidgetWrapper } from './WidgetWrapper';
import annualAdmission from './__fixtures__/cashFlowAnnualAdmission.json';

jest.mock('@/lib/queries', () => ({ useCashFlow: jest.fn(), useProfile: () => ({ data: undefined }) }));
jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({ state: { dashboards: [{ id: 'fundamental', isEditable: false, tabs: [] }] } }),
}));
jest.mock('@/contexts/GlobalMarketsSymbolContext', () => ({ useGlobalMarketsSymbol: () => ({}) }));
jest.mock('./TickerCombobox', () => ({ TickerCombobox: () => null }));
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
  useWidgetGroups: () => ({
    globalSymbol: 'HPG', setGlobalSymbol: jest.fn(), groups: [],
    getSymbolForGroup: () => 'HPG', tickerOverrideFor: () => null,
  }),
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

function renderWith(rows: object[], symbol = 'HPG', onDataChange?: (payload: unknown) => void) {
  mockCashFlow(rows);
  return render(<CashFlowWidget id="cash_flow" symbol={symbol} onDataChange={onDataChange} />, { wrapper: ThemeProvider });
}

function mockCashFlow(rows: object[], responseError?: string) {
  cashFlow.mockReturnValue({
    data: { data: rows, error: responseError },
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
    dataUpdatedAt: 1750000000000,
  } as never);
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
    expect(getRawMetric(entry as never, 'depreciation')).toBeNull();
  });

  it('refuses every alias of a metric rejected under one spelling', () => {
    const entry = {
      ...admittedRow,
      unit_metadata: {
        ...admittedRow.unit_metadata,
        increase_decrease_in_receivables: { unavailable_reason: 'unverified_monetary_unit' },
      },
    };
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
    expect(getRawMetric(entry as never, 'taxes_paid')).toBeNull();
  });

  it.each(['million_VND', 'Bn. VND', 'billion VND'])(
    'does not treat an unconverted raw %s amount as VND',
    (sourceUnit) => {
      const entry = {
        ...admittedRow,
        unit_metadata: { taxes_paid: { source_unit: sourceUnit, value_unit: 'VND' } },
        raw_data: { taxes_paid: -2 },
      };
      expect(getRawMetric(entry, 'taxes_paid')).toBeNull();
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
    expect(getRawMetric(entry as never, 'taxes_paid')).toBeNull();
  });

  it('requires VND on the raw field as well as on every component', () => {
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
    expect(getRawMetric(admitted, 'taxes_paid')).toBeNull();
    const evidence = { ...admitted.unit_metadata.taxes_paid, source_unit: 'VND', value_unit: 'VND' };
    expect(getRawMetric({ ...admitted, unit_metadata: { taxes_paid: evidence } }, 'taxes_paid')).toBe(12);
    const mixed = {
      ...admitted,
      unit_metadata: {
        taxes_paid: {
          ...evidence,
          components: [
            { value_unit: 'VND', source_unit: 'VND' },
            { value_unit: 'USD', source_unit: 'USD' },
          ],
        },
      },
    };
    expect(getRawMetric(mixed, 'taxes_paid')).toBeNull();
  });

  it('refuses raw values on a row with no admitted VND basis', () => {
    const entry = {
      ...admittedRow, currency: null, value_unit: null,
      unit_metadata: { taxes_paid: { source_unit: 'VND', value_unit: 'VND' } }, raw_data: { taxes_paid: 12 },
    };
    expect(getRawMetric(entry, 'taxes_paid')).toBeNull();
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

  it('reads the signed raw alias that owns the evidence, not an earlier spelling', () => {
    const entry = {
      ...admittedRow,
      unit_metadata: { income_tax_paid: { source_unit: 'VND', value_unit: 'VND' } },
      raw_data: { taxes_paid: -2, income_tax_paid: -1_234_000_000 },
    };
    expect(getRawMetric(entry, 'taxes_paid')).toBe(-1_234_000_000);
  });

  it.each([
    { label: 'cash_paid_for_taxes' },
    { label: 'taxes_paid', provider_value: null },
    { label: 'taxes_paid', provider_value: 1_234_000_000 },
    { label: 'taxes_paid', normalization_multiplier: 1_000_000 },
  ])('refuses evidence that does not certify the raw amount (%j)', (evidence) => {
    const entry = {
      ...admittedRow,
      unit_metadata: { taxes_paid: { source_unit: 'VND', value_unit: 'VND', ...evidence } },
      raw_data: { taxes_paid: -2 },
    };
    expect(getRawMetric(entry, 'taxes_paid')).toBeNull();
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

describe('cash flow admitted data', () => {
  it.each(['HPG', 'FPT'])('keeps withheld values out of %s table, charts, exports and agent context', (symbol) => {
    const publish = jest.fn();
    const fixture = {
      ...admittedRow, symbol, operating_cash_flow: 1000, investing_cash_flow: -620,
      financing_cash_flow: 120, net_cash_flow: 250, depreciation: 847068,
      free_cash_flow: 194181, capital_expenditure: -555333, interest_paid: 334707,
      unit_metadata: {
        ...admittedRow.unit_metadata,
        free_cash_flow: { unavailable_reason: 'unverified_monetary_unit' },
        capital_expenditure: { unavailable_reason: 'unverified_monetary_unit' },
        taxes_paid: { source_unit: 'VND', value_unit: 'VND' },
      },
      raw_data: { depreciation: 847068, taxes_paid: 0, withheld_raw_sentinel: 8675309 },
    };
    renderWith([fixture], symbol, publish);

    expect(screen.getByText('Operating CF').closest('tr')).toHaveTextContent('1,000');
    expect(screen.getByText('Taxes Paid').closest('tr')).toHaveTextContent(/0$/);
    expect(screen.queryByText('Depreciation')).not.toBeInTheDocument();
    expect(screen.queryByText('Free Cash Flow')).not.toBeInTheDocument();
    expect(screen.queryByText('CapEx')).not.toBeInTheDocument();
    expect(screen.queryByText('Interest Paid')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chart View' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Cash flow chart mode' }), { target: { value: 'waterfall' } });
    expect(screen.getByText('Reported Free Cash Flow').parentElement).toHaveTextContent('n/a');
    expect(screen.getByText('CapEx').parentElement).toHaveTextContent('n/a');
    expect(screen.getByText('Net Change', { selector: 'div' }).parentElement).toHaveTextContent('250');

    const [payload] = publish.mock.lastCall ?? [];
    const rows = getWidgetExportData(payload);
    if (!Array.isArray(rows)) throw new TypeError('Cash Flow must publish export rows');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol, period: '2025', currency: 'VND', value_unit: 'VND',
      operating_cash_flow: 1000, investing_cash_flow: -620, financing_cash_flow: 120,
      net_change_in_cash: 250, net_cash_flow: 250, taxes_paid: 0, depreciation: null, free_cash_flow: null,
      capex: null, capital_expenditure: null, interest_paid: null, consolidation_basis: 'consolidated', flow_basis: 'annual' });
    expect(payload).toMatchObject({ data: rows, __widgetRuntime: { provenance: {
      period: 'FY', periodScope: 'shared', units: 'VND', basis: 'consolidated / annual',
      updatedAt: null, fetchedAt: 1750000000000, observationStatus: 'available', refreshStatus: 'succeeded',
    } } });
    const csv = rowsToCSV(rows);
    expect(csv).not.toMatch(/raw_data|847068|194181|555333|8675309|334707/);
    expect(provenanceToMarkdown(payload.__widgetRuntime?.provenance)).toContain('unverified_monetary_unit');
    const request = buildVniAgentWorkspaceContext({ widgetTypeKey: 'cash_flow', symbol,
      widgetPayload: { symbol, dataSample: rows.slice(0, 5) } });
    expect(request.widgetPayload.dataSample).toEqual(rows);
    expect(JSON.stringify(request)).not.toMatch(/raw_data|847068|194181|555333|8675309|334707/);
  });
});

describe('producer-admitted annual cash flow', () => {
  it.each([[-120, -900], [-900, -120]])('withholds conflicting FYs with admitted taxes of %i and %i', (first, second) => {
    const publish = jest.fn();
    const row = {
      ...admittedRow,
      unit_metadata: { ...admittedRow.unit_metadata, taxes_paid: { source_unit: 'VND', value_unit: 'VND' } },
    };
    renderWith([
      { ...row, raw_data: { taxes_paid: first } },
      { ...row, raw_data: { taxes_paid: second } },
      annualAdmission.admittedZero,
    ], 'HPG', publish);

    expect(screen.queryByRole('columnheader', { name: '2025' })).not.toBeInTheDocument();
    expect(screen.getByText(/2025 returned conflicting rows/)).toBeVisible();
    expect(getWidgetExportData(publish.mock.lastCall?.[0])).toEqual([expect.objectContaining({ period: '2022', taxes_paid: null })]);
  });

  it('collapses equivalent FY spellings and ignores receipt times and unused raw fields', () => {
    const publish = jest.fn();
    const row = {
      ...admittedRow,
      unit_metadata: { ...admittedRow.unit_metadata, taxes_paid: { source_unit: 'VND', value_unit: 'VND' } },
      raw_data: { taxes_paid: -120, unrelated: 1 },
    };
    renderWith([row, { ...row, period: '2025FY', updated_at: '2026-06-20', raw_data: { taxes_paid: -120, unrelated: 2 } }], 'HPG', publish);

    expect(screen.getAllByRole('columnheader', { name: '2025' })).toHaveLength(1);
    expect(getWidgetExportData(publish.mock.lastCall?.[0])).toEqual([expect.objectContaining({ period: '2025', taxes_paid: -120 })]);
  });

  it('does not lend a blank repurchase field’s unit to a different raw alias', () => {
    const publish = jest.fn();
    renderWith([annualAdmission.unadmittedAlias], 'HPG', publish);

    expect(cashFlow).toHaveBeenCalledWith('HPG', { period: 'year', limit: 20 });
    expect(screen.getByText('Operating CF').closest('tr')).toHaveTextContent('1,000');
    expect(screen.queryByText('Stock Repurchased')).not.toBeInTheDocument();
    const rows = getWidgetExportData(publish.mock.lastCall?.[0]);
    if (!Array.isArray(rows)) throw new TypeError('Cash Flow must publish export rows');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: '2024', operating_cash_flow: 1000, stock_repurchased: null });
    expect(rowsToCSV(rows)).not.toMatch(/raw_data|repurchase_of_shares|(?:^|,)-2(?=,|$)/m);
  });

  it('keeps a field-withheld FY’s diagnostics without publishing an observation', () => {
    const publish = jest.fn();
    renderWith([annualAdmission.fullyWithheld], 'HPG', publish);

    expect(publish.mock.lastCall?.[0]).toMatchObject({
      periods: 0,
      data: [],
      __widgetRuntime: {
        layoutHint: { empty: true },
        provenance: { period: 'FY', observationStatus: 'unavailable', refreshStatus: 'succeeded',
          warnings: [expect.stringMatching(/2025.*unverified_statement_basis/)] },
      },
    });
    expect(getWidgetExportData(publish.mock.lastCall?.[0])).toEqual([]);
    expect(screen.queryByRole('columnheader', { name: '2025' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chart View' }));
    expect(screen.queryByRole('combobox', { name: 'Cash flow chart mode' })).not.toBeInTheDocument();
    expect(screen.getAllByText(/2025.*unverified_statement_basis/).length).toBeGreaterThan(0);
  });

  it('charts the latest admitted period and exports signed amounts and a zero-only year', () => {
    const publish = jest.fn();
    renderWith(Object.values(annualAdmission), 'HPG', publish);

    expect(screen.getByRole('columnheader', { name: '2022' })).toBeVisible();
    expect(screen.queryByRole('columnheader', { name: '2025' })).not.toBeInTheDocument();
    expect(screen.getByText('Stock Repurchased').closest('tr')).toHaveTextContent(/[-−]2,000,000/);
    fireEvent.click(screen.getByRole('button', { name: 'Chart View' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Cash flow chart mode' }), { target: { value: 'waterfall' } });
    expect(screen.getByText('Net Change', { selector: 'div' }).parentElement).toHaveTextContent('970');
    expect(screen.getByText(/2025.*unverified_statement_basis/)).toBeVisible();

    const payload = publish.mock.lastCall?.[0];
    const rows = getWidgetExportData(payload);
    if (!Array.isArray(rows)) throw new TypeError('Cash Flow must publish export rows');
    expect(rows.map((row) => [row.period, row.operating_cash_flow, row.stock_repurchased])).toEqual([
      ['2022', 0, null], ['2023', null, -2_000_000], ['2024', 1000, null],
    ]);
    expect(payload).toMatchObject({ data: rows, __widgetRuntime: { provenance: { observationStatus: 'available' } } });
    expect(rowsToCSV(rows)).toMatch(/(?:^|,)-2000000(?:,|$)/m);
  });

  it.each([true, false])('exports the same admitted rows sent to VniAgent (populated: %s)', async (populated) => {
    const rows = populated ? Object.values(annualAdmission) : [annualAdmission.fullyWithheld];
    mockCashFlow(rows);
    const openAgent = jest.fn<void, [context?: Record<string, unknown>]>();
    const captureDownload = jest.fn<string, [Blob]>(() => 'blob:cash-flow');
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = captureDownload;
    URL.revokeObjectURL = jest.fn();
    const clickDownload = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();

    try {
      render(
        <WidgetWrapper id="cash_flow" title="Cash Flow" widgetType="cash_flow" dashboardId="fundamental" tabId="fundamentals"
          showGroupLabels={false} onCopilotClick={openAgent}>
          <CashFlowWidget id="cash_flow" symbol="HPG" />
        </WidgetWrapper>,
        { wrapper: ThemeProvider },
      );

      expect((await screen.findAllByText(/2025.*unverified_statement_basis/))[0]).toBeVisible();
      expect(screen.queryByRole('columnheader', { name: '2025' })).not.toBeInTheDocument();
      if (populated) expect(screen.getByRole('columnheader', { name: '2022' })).toBeVisible();

      await user.click(screen.getByRole('button', { name: 'Open VniAgent' }));
      const widgetPayload = openAgent.mock.lastCall?.[0];
      expect(widgetPayload).toMatchObject({ symbol: 'HPG', widgetTypeKey: 'cash_flow' });
      const agent = buildVniAgentWorkspaceContext({ widgetTypeKey: 'cash_flow', symbol: 'HPG', widgetPayload });

      await user.click(screen.getByRole('button', { name: 'Widget actions for Cash Flow' }));
      await user.click(screen.getByRole('menuitem', { name: 'Export' }));
      await user.click(screen.getByRole('menuitem', { name: 'Export as JSON' }));
      const blob = captureDownload.mock.lastCall?.[0];
      if (!blob) throw new Error('Cash Flow JSON download was not created');
      const json = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });
      expect(clickDownload).toHaveBeenCalledTimes(1);
      const exported = JSON.parse(json);
      expect(exported._provenance).toMatchObject({
        period: 'FY', observationStatus: populated ? 'available' : 'unavailable',
        warnings: [expect.stringMatching(/2025.*unverified_statement_basis/)],
      });
      expect(exported.data.map((row: Record<string, unknown>) => [row.period, row.operating_cash_flow, row.stock_repurchased]))
        .toEqual(populated ? [['2022', 0, null], ['2023', null, -2_000_000], ['2024', 1000, null]] : []);
      expect(agent.widgetPayload.dataSample ?? []).toEqual(exported.data);
      expect(JSON.stringify({ exported, agent })).not.toMatch(/raw_data|repurchase_of_shares|"stock_repurchased":-2[,}]/);
    } finally {
      clickDownload.mockRestore();
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    }
  });

  it('distinguishes an API failure envelope from a successful empty reading', () => {
    mockCashFlow([], 'controlled backend failure');
    const publish = jest.fn();
    render(<CashFlowWidget id="cash_flow" symbol="HPG" onDataChange={publish} />, { wrapper: ThemeProvider });
    expect(publish.mock.lastCall?.[0]).toMatchObject({
      data: [], __widgetRuntime: { provenance: { observationStatus: 'unavailable', refreshStatus: 'failed' } },
    });
    expect(screen.getByText('Cash flow refresh failed.')).toBeVisible();
    expect(screen.queryByText('controlled backend failure')).not.toBeInTheDocument();
  });
});

describe('cash flow refresh on a header-suppressed dashboard', () => {
  it('refetches through the shell’s compact controls and renders the new payload', () => {
    // `refetch` is what actually swaps the provider payload, exactly as the real
    // hook's refetch would: if the button loses its callback, the click changes
    // nothing and the assertion below fails.
    const withheld: object = {
      ...admittedRow,
      period: '2025',
      unit_metadata: { ...admittedRow.unit_metadata, depreciation: { unavailable_reason: 'unverified_statement_currency_or_unit' } },
    };
    const admittedZero: object = {
      ...admittedRow,
      period: '2026',
      unit_metadata: {
        operating_cash_flow: { source_unit: 'VND', value_unit: 'VND' },
        depreciation: { source_unit: 'VND', value_unit: 'VND' },
      },
      raw_data: { depreciation: 0 },
    };
    cashFlow.mockImplementation(() => {
      const [row, setRow] = useState(withheld);
      return {
        data: { data: [row] },
        error: null,
        isLoading: false,
        isFetching: false,
        refetch: jest.fn(() => setRow(admittedZero)),
        dataUpdatedAt: 1750000000000,
      } as never;
    });

    render(
      <WidgetHeaderVisibilityProvider hideHeader>
        <CashFlowWidget id="cash_flow" symbol="HPG" />
      </WidgetHeaderVisibilityProvider>,
    );
    expect(screen.getByText('2025')).toBeInTheDocument();
    expect(screen.queryByText('Depreciation')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    // The click alone moved the widget onto the admitted 2026 row: the period
    // column changed and the previously withheld metric is now admitted.
    expect(screen.getByText('2026')).toBeInTheDocument();
    expect(screen.queryByText('2025')).toBeNull();
    expect(screen.getByText('Depreciation')).toBeInTheDocument();
  });
});
