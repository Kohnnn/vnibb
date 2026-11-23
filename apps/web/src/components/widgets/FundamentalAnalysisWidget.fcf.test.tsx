import { render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { useFundamentalAnalysis } from '@/lib/queries';
import { buildVniAgentWorkspaceContext } from '@/lib/vniagentWorkspace';
import type { CompetitiveAdvantage, RetainedFcf, RetainedQualityLineage } from '@/types/equity';
import { FundamentalAnalysisWidget } from './FundamentalAnalysisWidget';
import { WidgetWrapper } from './WidgetWrapper';

jest.mock('@/lib/queries', () => ({ useFundamentalAnalysis: jest.fn(), useProfile: () => ({}) }));
jest.mock('@/lib/analytics', () => ({ ANALYTICS_EVENTS: {}, captureAnalyticsEvent: jest.fn() }));
jest.mock('@/lib/dashboardIntelligence', () => ({ getWidgetLayoutInsight: () => null }));
jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({ state: { dashboards: [{ id: 'fixture', isEditable: false, tabs: [] }] } }),
}));
jest.mock('@/contexts/GlobalMarketsSymbolContext', () => ({ useGlobalMarketsSymbol: () => ({}) }));
jest.mock('@/contexts/WidgetGroupContext', () => ({
  useWidgetGroups: () => ({ groups: [], getSymbolForGroup: () => mockSymbol, tickerOverrideFor: () => null }),
}));
jest.mock('./TickerCombobox', () => ({ TickerCombobox: () => null }));

let mockSymbol = 'FPT';
const mockAnalysis = useFundamentalAnalysis as jest.Mock;
const snapshotComputedAt = '2026-06-15T09:11:23.456000+00:00';
const lineage: RetainedQualityLineage = {
  snapshot_date: '2026-06-15', snapshot_source: 'vnibb-fundamental-engine', schema_version: 4,
  snapshot_computed_at: snapshotComputedAt,
  moat_factor_years: [2020, 2021, 2022, 2023, 2024], revenue_cagr_window: [2019, 2024], profit_cagr_window: null,
};
const positivityTest: RetainedFcf = {
  status: 'not_positive', reason: 'FCF not positive', unavailable_reason: null,
  evidence: 'positivity_only', amount: null, unit: null, positive: false,
  fiscal_year: 2024, source: 'fixture-financial-statements', source_financial_date: null,
  basis: 'Annual operating cash flow − |capex|', input_coverage: 'complete',
  dcf_base_admitted_years: [2022, 2023, 2024], dcf_base_required_rows: 3,
};
const unavailable: RetainedFcf = {
  status: 'unavailable', reason: 'FCF unavailable', unavailable_reason: 'No retained fundamental snapshot was available.',
  evidence: null, amount: null, unit: null, positive: null, fiscal_year: null, source: null,
  source_financial_date: null, basis: null, input_coverage: null,
  dcf_base_admitted_years: null, dcf_base_required_rows: null,
};

function showSnapshot(advantage: CompetitiveAdvantage, cashflowFailure = 'Section deadline exceeded') {
  mockAnalysis.mockReturnValue({
    data: { error: 'Partial data unavailable', data: {
      symbol: 'FPT', competitive_advantage: advantage,
      section_errors: { 'financials.cashflow': cashflowFailure, valuation: 'Unavailable' },
    } },
    isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
    dataUpdatedAt: Date.parse('2026-06-16T08:00:00Z'),
  });
}

beforeEach(() => { mockSymbol = 'FPT'; });

// These are synthetic, explicitly certified signed records, not live issuer values.
// OCF 100 VND and capex 40, 100 and 150 VND respectively yield these amounts.
const signedCases = [
  [60, 'positive', 'Positive FCF'], [0, 'zero', 'FCF is zero'], [-50, 'negative', 'Negative FCF'],
] as const;

test.each(signedCases)('renders the admitted %d VND amount as %s', (amount, status, reason) => {
  showSnapshot({ lineage, fcf: {
    ...positivityTest, evidence: 'signed_amount', amount, status, reason, unit: 'VND',
    positive: amount > 0, source_financial_date: '2025-03-20',
  } });
  render(<FundamentalAnalysisWidget symbol="FPT" />);
  const retained = screen.getByRole('region', { name: 'Retained quality snapshot' });
  expect(within(retained).getByText(status, { exact: true })).toBeVisible();
  expect(retained).toHaveTextContent(`${reason}: ${amount} VND.`);
  expect(retained).toHaveTextContent('Snapshot date: 2026-06-15');
  expect(retained).toHaveTextContent(`Snapshot computed at: ${snapshotComputedAt}`);
  expect(retained).toHaveTextContent('Source financial date: 2025-03-20');
});

test('renders boolean-only false independently of the failed current statement', () => {
  showSnapshot({ lineage, fcf: positivityTest, quality_metrics: { roe: 20, fcf_positive: false }, reasons: ['FCF negative', 'ROE 20.0%'] });
  render(<FundamentalAnalysisWidget symbol="FPT" />);
  expect(screen.getByRole('alert')).toHaveTextContent('financials cashflow: Section deadline exceeded');
  const retained = screen.getByRole('region', { name: 'Retained quality snapshot' });
  expect(within(retained).getByText('not positive', { exact: true })).toBeVisible();
  expect(retained).toHaveTextContent('FCF not positive — only the FCF > 0 test was retained');
  expect(retained).toHaveTextContent('Independent of this request’s statement sections and the shared FY/Q/TTM selector');
  expect(retained).toHaveTextContent('Snapshot date: 2026-06-15 · Snapshot source: vnibb-fundamental-engine · Schema: 4');
  expect(retained).toHaveTextContent('FCF fiscal period: FY2024 · Financial source: fixture-financial-statements · Source financial date: not recorded');
  expect(retained).toHaveTextContent('Basis: Annual operating cash flow − |capex|');
  expect(retained).toHaveTextContent('operating cash flow and capex admitted');
  expect(retained).toHaveTextContent('3/3 required annual rows admitted (FY2022, FY2023, FY2024)');
  expect(retained).toHaveTextContent('Revenue CAGR window: FY2019–FY2024');
  expect(screen.getByText('20.0%', { exact: true })).toBeVisible();
  expect(screen.queryByText(/FCF negative|negative FCF|0 VND\b/i)).not.toBeInTheDocument();
});

test.each([
  ['missing snapshot', null, unavailable.unavailable_reason],
  ['no admitted amount or test', lineage, 'No admitted FCF amount or positivity test was recorded.'],
  ['rejected capex', lineage, 'latest_year_incomplete:capex=rejected:legacy_unit_basis_unconfirmed'],
  ['old schema', { ...lineage, schema_version: 3 }, 'Retained FCF schema 3 is unsupported (expected 4); recompute before publishing.'],
] as const)('explains unavailable FCF with %s and a cashflow timeout', (state, retainedLineage, reason) => {
  const fcf = state === 'rejected capex' ? {
    ...unavailable, fiscal_year: 2024, input_coverage: 'incomplete' as const, dcf_base_admitted_years: [2022, 2023], dcf_base_required_rows: 3,
  } : unavailable;
  showSnapshot({ lineage: retainedLineage, fcf: { ...fcf, unavailable_reason: reason },
    quality_metrics: retainedLineage ? { roe: 20 } : undefined });
  render(<FundamentalAnalysisWidget symbol="FPT" />);
  expect(screen.getByRole('alert')).toHaveTextContent('financials cashflow: Section deadline exceeded');
  const retained = screen.getByRole('region', { name: 'Retained quality snapshot' });
  expect(within(retained).getByText('unavailable', { exact: true })).toBeVisible();
  expect(retained).toHaveTextContent(`FCF unavailable: ${reason}`);
  expect(retained).not.toHaveTextContent(/(?:negative|not positive|0 VND)/i);
  if (retainedLineage) {
    expect(retained).toHaveTextContent(`Schema: ${retainedLineage.schema_version}`);
    expect(screen.getByText('20.0%')).toBeVisible();
  } else {
    expect(retained).toHaveTextContent('No retained quality snapshot available.');
    expect(screen.queryByText('ROE')).not.toBeInTheDocument();
  }
  if (state === 'rejected capex') {
    expect(retained).toHaveTextContent('FCF fiscal period (attempted): FY2024');
    expect(retained).toHaveTextContent('Latest-year input coverage: incomplete');
  }
});

test('withholds an old API flag without a retained admission record', () => {
  showSnapshot({ as_of: '2026-06-15', quality_metrics: { roe: 20, fcf_positive: false }, reasons: ['FCF negative'] });
  render(<FundamentalAnalysisWidget symbol="FPT" />);
  const retained = screen.getByRole('region', { name: 'Retained quality snapshot' });
  expect(retained).toHaveTextContent('This response did not include a retained FCF admission record.');
  expect(retained).toHaveTextContent('The API did not report retained quality lineage.');
  expect(retained).not.toHaveTextContent(/negative|2026-06-15/);
});

async function download(user: UserEvent, format: 'JSON' | 'CSV') {
  const { createObjectURL, revokeObjectURL } = URL;
  const blobs: Blob[] = [];
  URL.createObjectURL = value => {
    if (value instanceof Blob) blobs.push(value);
    return 'blob:retained-quality';
  };
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    await user.click(screen.getByRole('button', { name: 'Widget actions for Fundamental Analysis' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
    await user.click(screen.getByRole('menuitem', { name: `Export as ${format}` }));
    expect(blobs).toHaveLength(1);
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blobs[0]);
    return await promise;
  } finally {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    click.mockRestore();
  }
}

test.each<{ fcf: RetainedFcf; cashflowFailure: string }>([
  { fcf: positivityTest, cashflowFailure: 'Section deadline exceeded' },
  { fcf: { ...positivityTest, status: 'zero', reason: 'FCF is zero', amount: 0, unit: 'VND',
    evidence: 'signed_amount', source_financial_date: '2025-03-20' }, cashflowFailure: 'Dependency timed out' },
  { fcf: { ...positivityTest, status: 'unavailable', reason: 'FCF unavailable',
    unavailable_reason: 'latest_year_incomplete:capex=rejected:legacy_unit_basis_unconfirmed',
    positive: null, evidence: null, input_coverage: 'incomplete', dcf_base_admitted_years: [2022, 2023] },
    cashflowFailure: 'Section deadline exceeded' },
])('downloads and attaches $fcf.status FCF without borrowing retrieval time or another issuer', async ({ fcf, cashflowFailure }) => {
  const user = userEvent.setup();
  const onCopilotClick = jest.fn<void, [Record<string, unknown> | undefined]>();
  const view = () => (
    <WidgetWrapper id="analysis" title="Fundamental Analysis" widgetType="fundamental_analysis"
      dashboardId="fixture" tabId="tab" showGroupLabels={false} onCopilotClick={onCopilotClick}>
      <FundamentalAnalysisWidget symbol="FPT" />
    </WidgetWrapper>
  );
  showSnapshot({ lineage, fcf, quality_metrics: { roe: 20, fcf_positive: fcf.positive } }, cashflowFailure);
  const { rerender } = render(view());
  await screen.findByRole('region', { name: 'Retained quality snapshot' });
  expect(screen.getByRole('alert')).toHaveTextContent(`financials cashflow: ${cashflowFailure}`);

  const exported = JSON.parse(await download(user, 'JSON'));
  expect(exported._provenance).toMatchObject({ symbol: 'FPT', updatedAt: null, fetchedAt: '2026-06-16T08:00:00.000Z' });
  expect(exported.data).toMatchObject({
    symbol: 'FPT',
    fcf: { ...fcf, dcf_base_admitted_years: fcf.dcf_base_admitted_years?.map(year => `FY${year}`).join(', ') },
    retained_quality_snapshot: {
      snapshot_date: '2026-06-15', snapshot_computed_at: snapshotComputedAt,
      schema_version: 4, revenue_cagr_window: 'FY2019–FY2024',
    },
    cashflow_section_error: cashflowFailure,
  });
  const csv = await download(user, 'CSV');
  expect(csv).toContain(`"status"":""${fcf.status}""`);
  expect(csv).toContain(`"amount"":${fcf.amount}`);
  expect(csv).toContain('"snapshot_date"":""2026-06-15""');
  expect(csv).toContain(`"snapshot_computed_at"":""${snapshotComputedAt}""`);
  expect(csv).toContain(cashflowFailure);
  expect(csv).toContain(fcf.source_financial_date
    ? `"source_financial_date"":""${fcf.source_financial_date}""`
    : '"source_financial_date"":null');
  if (fcf.unavailable_reason) expect(csv).toContain(fcf.unavailable_reason);

  await user.click(screen.getByRole('button', { name: 'Open VniAgent' }));
  const request = buildVniAgentWorkspaceContext({
    widgetTypeKey: 'fundamental_analysis', symbol: 'FPT', widgetPayload: onCopilotClick.mock.lastCall?.[0],
  });
  expect(request.widgetTypeKey).toBe('fundamental_analysis');
  expect(request.widgetPayload.dataSample).toEqual(exported.data);
  expect(request.widgetPayload.dataProvenance).toMatchObject({ updatedAt: null });

  mockSymbol = 'HPG';
  // Keep the previous issuer's response to exercise the transition guard.
  rerender(view());
  expect(mockAnalysis).toHaveBeenLastCalledWith('HPG', true);
  expect(screen.queryByRole('region', { name: 'Retained quality snapshot' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Open VniAgent' }));
  expect(onCopilotClick.mock.lastCall?.[0]).toMatchObject({ symbol: 'HPG', dataSample: null });
});
