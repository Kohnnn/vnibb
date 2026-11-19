import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnitProvider, useUnit } from '@/contexts/UnitContext';
import { buildVniAgentWorkspaceContext } from '@/lib/vniagentWorkspace';
import type { FinancialRatioData, FinancialRatiosResponse } from '@/types/equity';
import { FinancialRatiosWidget } from './FinancialRatiosWidget';
import { WidgetWrapper } from './WidgetWrapper';

const withheldMetadata = { dps: { unavailable_reason: 'No verified dividend amount' } };
// Producer schema order with 19 admitted fields. DPS is the final value that fits.
const densePrefix = {
  period: '2024', pe: 17.25, pb: 3.2, ps: 4.3, ev_ebitda: 10.6, ev_sales: 4.1, roe: 21.5, roa: 9.8, roic: 19.1,
  eps: 45_000, bvps: 90_000, debt_equity: 0.8, debt_assets: 44, equity_multiplier: 1.79, current_ratio: 1.3,
  quick_ratio: 1.1, cash_ratio: 0.4, asset_turnover: 1.7, inventory_turnover: 4.9,
};
const denseValues = { ...densePrefix, dps: 4_500 };
const ratioUnits = { eps: 'VND/share', bvps: 'VND/share', dps: 'VND/share' };
// More than 20 admitted entries even after withholding BVPS and DPS.
const mixedValues = {
  ...densePrefix, period: '2025', pe: 20.5, eps: 0, bvps: 99_999, receivables_turnover: 5.3,
  loan_to_deposit: 52.6, casa_ratio: 8.9, gross_margin: 37.4, net_margin: 13.2,
  dps: 125_000, dividend_yield: 2.75, payout_ratio: 33,
};
type ProducerRatioRow = FinancialRatioData & { readonly unit_metadata?: typeof withheldMetadata };
const producerResponse = {
  symbol: 'FPT', count: 3, data: [
    { symbol: 'FPT', ...denseValues, ratio_units: ratioUnits },
    { symbol: 'FPT', ...mixedValues, unit_metadata: withheldMetadata,
      ratio_units: { ...ratioUnits, bvps: 'unknown', dividend_yield: 'percent', payout_ratio: 'percent' } },
    { symbol: 'FPT', period: 'Q3-2026', pe: 31.75 },
  ],
} satisfies Omit<FinancialRatiosResponse, 'data'> & { readonly data: readonly ProducerRatioRow[] };
let mockRatios: unknown = producerResponse;
const mockStatementPeriods = { data: [
  { period: '2024' }, { period: '2025' }, { period: '2026 YTD' }, { period: 'Q3-2026' },
] };

jest.mock('@/lib/queries', () => ({
  useFinancialRatios: () => ({ data: mockRatios, refetch: jest.fn() }),
  useIncomeStatement: () => ({ data: mockStatementPeriods }),
  useProfile: () => ({}),
}));
jest.mock('@/lib/api', () => ({
  getPublicUnitRuntimeConfig: async () => ({ usd_vnd_default_rate: 25_000, usd_vnd_rates_by_year: {} }),
}));
jest.mock('@/lib/analytics', () => ({ ANALYTICS_EVENTS: {}, captureAnalyticsEvent: jest.fn() }));
jest.mock('@/lib/dashboardIntelligence', () => ({ getWidgetLayoutInsight: () => null }));
jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({ state: { dashboards: [{ id: 'fixture', isEditable: false, tabs: [] }] } }),
}));
jest.mock('@/contexts/WidgetGroupContext', () => ({
  useWidgetGroups: () => ({
    groups: [], getSymbolForGroup: () => 'FPT', tickerOverrideFor: () => null, clearWidgetTickerOverride: jest.fn(),
  }),
}));
jest.mock('@/contexts/GlobalMarketsSymbolContext', () => ({ useGlobalMarketsSymbol: () => ({}) }));
jest.mock('./TickerCombobox', () => ({ TickerCombobox: () => null }));

const cases = [
  { currency: 'VND', unit: 'VND/share', eps: 45_000, bvps: 90_000, dps: 4_500,
    epsText: '45,000.00', bvpsText: '90,000.00', dpsText: '4,500.00' },
  { currency: 'USD', unit: 'USD/share', eps: 2, bvps: 4, dps: 0.2,
    epsText: '2.00', bvpsText: '4.00', dpsText: '0.20' },
] as const;
type CurrencyCase = (typeof cases)[number];

function CurrencyControls() {
  const { setUnit } = useUnit();
  return <>
    <button type="button" onClick={() => setUnit('raw')}>VND</button>
    <button type="button" onClick={() => setUnit('USD')}>USD</button>
  </>;
}

async function selectCurrency(currency: CurrencyCase['currency']) {
  const user = userEvent.setup();
  const onCopilotClick = jest.fn<void, [Record<string, unknown> | undefined]>();
  render(<UnitProvider>
    <CurrencyControls />
    <WidgetWrapper id="ratios" title="Financial Ratios" widgetType="financial_ratios" dashboardId="fixture"
      tabId="tab" showGroupLabels={false} onCopilotClick={onCopilotClick}>
      <FinancialRatiosWidget id="ratios" symbol="FPT" />
    </WidgetWrapper>
  </UnitProvider>);
  await user.click(screen.getByRole('button', { name: currency }));
  return { user, onCopilotClick };
}

function expectedObservationRows({ eps, bvps, dps, unit }: CurrencyCase) {
  return [
    expect.objectContaining({ ...denseValues, eps, bvps, dps, eps_unit: unit, bvps_unit: unit, dps_unit: unit }),
    expect.objectContaining({ ...mixedValues, eps: 0, bvps: null, dps: null, eps_unit: unit, bvps_unit: null, dps_unit: null }),
  ];
}

async function download(user: ReturnType<typeof userEvent.setup>, format: 'JSON' | 'CSV') {
  const { createObjectURL, revokeObjectURL } = URL;
  const blobs: Blob[] = [];
  URL.createObjectURL = value => {
    if (value instanceof Blob) blobs.push(value);
    return 'blob:financial-ratios';
  };
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    await user.click(screen.getByRole('button', { name: 'Widget actions for Financial Ratios' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
    await user.click(screen.getByRole('menuitem', { name: `Export as ${format}` }));
    const [blob] = blobs;
    if (!blob) throw new Error(`No ${format} download`);
    expect(blobs).toHaveLength(1);
    expect(click.mock.contexts).toEqual([expect.objectContaining({ download: expect.stringMatching(new RegExp(`\\.${format.toLowerCase()}$`)) })]);
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
  } finally {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    click.mockRestore();
  }
}

// Execute the API's sanitizer and its constants, without importing service/DB/provider code.
const sanitizeSource = `
import ast, json, re, sys
from pathlib import Path
from typing import Any

path = Path(sys.argv[1])
source = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
functions = {'sanitize_context_value', '_truncate_text'}
constants = {'MAX_CONTEXT_DEPTH', 'MAX_DICT_ITEMS', 'MAX_LIST_ITEMS', 'MAX_STRING_LENGTH', 'SENSITIVE_KEYS'}
source.body = [node for node in source.body if (
    isinstance(node, ast.FunctionDef) and node.name in functions
    or isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in constants for target in node.targets)
)]
exec(compile(source, str(path), 'exec'))
print(json.dumps(sanitize_context_value(json.load(sys.stdin))))
`;

type RuntimeRatioPayload = {
  readonly dataSample: readonly Readonly<Record<string, number | string | boolean | null>>[];
  readonly dataProvenance?: { readonly units?: string };
  readonly dataSampleOmissions?: Readonly<Record<string, { readonly count: number; readonly fields: string }>>;
};

async function openRuntimeContext({ user, onCopilotClick }: Awaited<ReturnType<typeof selectCurrency>>): Promise<RuntimeRatioPayload> {
  return (await openAgentContext({ user, onCopilotClick })).widget_payload;
}

async function openAgentContext({ user, onCopilotClick }: Awaited<ReturnType<typeof selectCurrency>>,
  dataSnapshot?: Record<string, unknown>) {
  await user.click(screen.getByRole('button', { name: 'Open VniAgent' }));
  const widgetPayload = onCopilotClick.mock.lastCall?.[0];
  if (!widgetPayload) throw new Error('No context handed off by the wrapper');
  const request = buildVniAgentWorkspaceContext({
    widgetTypeKey: 'financial_ratios', symbol: 'FPT', dataSnapshot,
    widgetPayload: { ...widgetPayload, documentContexts: [] },
  });
  // This is the route's client_context envelope; its nesting is part of the cap contract.
  const context = {
    widgetType: request.widgetType, widgetTypeKey: request.widgetTypeKey, symbol: request.symbol,
    activeTab: request.activeTab, data: request.dataSnapshot, widget_payload: request.widgetPayload,
  };
  const interpreter = process.platform === 'win32' ? 'python' : 'python3';
  const source = resolve(__dirname, '../../../../api/vnibb/services/ai_context_service.py');
  return JSON.parse(execFileSync(
    interpreter, ['-I', '-S', '-c', sanitizeSource, source], { input: JSON.stringify(context), encoding: 'utf8', timeout: 5_000 },
  )) as { widget_payload: RuntimeRatioPayload };
}

const serializeSource = `
import ast, json, sys
from pathlib import Path
from typing import Any, Sequence

path = Path(sys.argv[1])
source = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
functions = {'_derive_prompt_focus', '_document_context_note'}
constants = {'MAX_CONTEXT_CHARS', 'MAX_HISTORY_MESSAGES'}
nodes = [node for node in source.body if (
    isinstance(node, ast.FunctionDef) and node.name in functions
    or isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in constants for target in node.targets)
)]
nodes.extend(method for node in source.body if isinstance(node, ast.ClassDef)
             for method in node.body if isinstance(method, ast.FunctionDef) and method.name == '_build_messages')
source.body = nodes
def curated_workflow_instructions(context):
    return None
exec(compile(source, str(path), 'exec'))
context = json.load(sys.stdin)
payload = context['client_context']['widget_payload']
prompt = _build_messages(None, [], context)[2]['content']
other_context = {**context, 'client_context': {**context['client_context'], 'widgetTypeKey': 'cash_flow'}}
marker = chr(96) * 3
other_prompt = _build_messages(None, [], other_context)[2]['content'].split(marker + 'json' + chr(10))[1].removesuffix(chr(10) + marker)
print(json.dumps({
    'clipped': len(json.dumps(context, ensure_ascii=True, default=str)) > MAX_CONTEXT_CHARS,
    'otherWidgetPreserved': other_prompt == json.dumps(other_context, ensure_ascii=True, default=str)[:MAX_CONTEXT_CHARS] + '...',
    'units': json.dumps(payload['dataProvenance']['units']) in prompt,
    'rows': json.dumps(payload['dataSample']) in prompt,
    'periodsWithOmissions': [period for period, note in payload['dataSampleOmissions'].items()
                            if json.dumps({period: note})[1:-1] in prompt],
}))
`;

beforeEach(() => {
  mockRatios = producerResponse;
  window.localStorage.setItem('vnibb_unit_config', JSON.stringify({ display: 'raw', usdVndRatesByYear: { 2024: 22_500 } }));
});
afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

test.each(cases)('renders admitted $unit values without converting P/E or inventing missing values', async fixture => {
  await selectCurrency(fixture.currency);
  const table = within(screen.getByRole('table'));
  const { unit, epsText, bvpsText, dpsText } = fixture;
  for (const [metric, value] of [['EPS', epsText], ['BVPS', bvpsText], ['DPS', dpsText]]) {
    const row = table.getByText(`${metric} (${unit})`).closest('tr');
    if (!row) throw new Error(`No table row for ${metric}`);
    expect(within(row).getByText(value, { exact: true })).toBeVisible();
    expect(within(row).getAllByText('n/a')).toHaveLength(metric === 'EPS' ? 1 : 2);
    if (metric === 'EPS') expect(within(row).getByText('0.00', { exact: true })).toBeVisible();
  }
  expect(table.getByText('P/E', { exact: true })).toBeVisible();
  expect(table.getByRole('cell', { name: '17.25' })).toBeVisible();
});

test.each(cases)('downloads numeric $unit observations and scoped units in JSON and CSV', async fixture => {
  const { user } = await selectCurrency(fixture.currency);
  const json: unknown = JSON.parse(await download(user, 'JSON'));
  const csv = await download(user, 'CSV');
  const units = `EPS/BVPS/DPS: ${fixture.unit}; P/E: dimensionless`;

  expect(json).toEqual({ _provenance: expect.objectContaining({ period: 'FY', units }), data: expectedObservationRows(fixture) });
  expect(csv.split('\n')).toContain(`# units,${units}`);
  const [header = '', ...records] = csv.split('\n').filter(line => !line.startsWith('# '));
  const columns = header.split(',');
  const rows = records.map(record => Object.fromEntries(record.split(',').map((value, index) => [columns[index], value])));
  expect(rows).toEqual([
    expect.objectContaining({ period: '2024', pe: '17.25', eps: String(fixture.eps), bvps: String(fixture.bvps),
      dps: String(fixture.dps), eps_unit: fixture.unit, bvps_unit: fixture.unit, dps_unit: fixture.unit }),
    expect.objectContaining({ period: '2025', pe: '20.5', eps: '0', bvps: '', dps: '', eps_unit: fixture.unit, bvps_unit: '',
      dps_unit: '', net_margin: '13.2', dividend_yield: '2.75', payout_ratio: '33' }),
  ]);
  expect(columns).not.toContain('pe_unit');
});

test.each(cases)('hands the wrapper’s numeric $unit observations and provenance to VniAgent', async fixture => {
  const { user, onCopilotClick } = await selectCurrency(fixture.currency);
  await user.click(screen.getByRole('button', { name: 'Open VniAgent' }));
  expect(onCopilotClick).toHaveBeenLastCalledWith(expect.objectContaining({
    widgetTypeKey: 'financial_ratios',
    dataSample: [
      expect.objectContaining({ period: '2024', pe: 17.25, eps: fixture.eps, bvps: fixture.bvps, dps: fixture.dps }),
      expect.objectContaining({ period: '2025', pe: 20.5, eps: 0 }),
    ],
    dataProvenance: expect.objectContaining({ period: 'FY', units: `EPS/BVPS/DPS: ${fixture.unit}; P/E: dimensionless` }),
  }));
});

const denseCases = cases.flatMap(fixture => (['producer', 'reversed'] as const).map(order => ({ ...fixture, order })));

test.each(denseCases)('runtime sanitizer preserves $unit ratios for $order keys and accounts for overflow', async fixture => {
  if (fixture.order === 'reversed') {
    mockRatios = { ...producerResponse, data: producerResponse.data.map(row => Object.fromEntries(Object.entries(row).reverse())) };
  }
  const payload = await openRuntimeContext(await selectCurrency(fixture.currency));
  const [dense, mixed] = payload.dataSample;
  expect(dense).toMatchObject({ period: '2024', pe: 17.25, eps: fixture.eps, bvps: fixture.bvps, dps: fixture.dps });
  expect(dense).toEqual({ ...denseValues, eps: fixture.eps, bvps: fixture.bvps, dps: fixture.dps });
  expect(payload.dataSample).toHaveLength(2);
  expect(payload.dataProvenance?.units).toBe(`EPS/BVPS/DPS: ${fixture.unit}; P/E: dimensionless`);
  expect(mixed).toMatchObject({ period: '2025', pe: 20.5, eps: 0 });
  expect(mixed?.bvps ?? null).toBeNull();
  expect(mixed?.dps ?? null).toBeNull();

  const admitted = Object.entries(mixedValues).filter(([field]) => field !== 'bvps' && field !== 'dps');
  const omitted = fixture.order === 'producer'
    ? ['casa_ratio', 'gross_margin', 'net_margin', 'dividend_yield', 'payout_ratio']
    : ['roe', 'ev_sales', 'ev_ebitda', 'ps', 'pb'];
  expect(payload.dataSampleOmissions).toEqual({ '2025': { count: omitted.length, fields: omitted.join(', ') } });
  expect(mixed).toEqual(Object.fromEntries(admitted.filter(([field]) => !omitted.includes(field))));
});

test.each(cases)('sanitizer retains the producer-order keep set when the priority ratios already fit in $currency', async fixture => {
  mockRatios = { symbol: 'FPT', count: 1, data: [{ symbol: 'FPT', ...denseValues,
    dividend_yield: 2.75, payout_ratio: 33, ratio_units: { ...ratioUnits, dividend_yield: 'percent', payout_ratio: 'percent' },
  }] };
  const payload = await openRuntimeContext(await selectCurrency(fixture.currency));
  expect(payload.dataSample).toEqual([{ ...denseValues, eps: fixture.eps, bvps: fixture.bvps, dps: fixture.dps }]);
  expect(payload.dataSampleOmissions).toEqual({ '2024': { count: 2, fields: 'dividend_yield, payout_ratio' } });
});

test.each(cases)('model prompt keeps the $unit qualifier and every sample omission under the context cap', async fixture => {
  const ratios = Array.from({ length: 20 }, (_, index) => ({
    ...mixedValues,
    ...Object.fromEntries(Object.entries(denseValues)
      .filter(([field]) => !['period', 'eps', 'bvps', 'dps'].includes(field))
      .map(([field, value]) => [field, Number((Number(value) + (index + 1) * 0.007124961308).toFixed(12))])),
    symbol: 'FPT', period: String(2006 + index), dps: 4500,
    ratio_units: { ...ratioUnits, dividend_yield: 'percent', payout_ratio: 'percent' },
  }));
  mockRatios = { symbol: 'FPT', count: ratios.length, data: ratios };
  const context = await openAgentContext(await selectCurrency(fixture.currency), {
    profile: { symbol: 'FPT', description: 'Công ty cung cấp dịch vụ công nghệ và đầu tư nghiên cứu. '.repeat(10).slice(0, 500) },
    quote: { symbol: 'FPT', price: 65000, change: 500, changePercent: 0.77, volume: 1254000 },
    ratios,
  });
  const interpreter = process.platform === 'win32' ? 'python' : 'python3';
  const source = resolve(__dirname, '../../../../api/vnibb/services/llm_service.py');
  const promptResult: unknown = JSON.parse(execFileSync(interpreter, ['-I', '-S', '-c', serializeSource, source], {
    input: JSON.stringify({
      source_priority: ['postgres'],
      retrieval_policy: {
        source_precedence: ['postgres', 'browser_context'],
        citation_format: 'Cite factual claims with bracketed source IDs such as [FPT-PRICES] or [MKT-INDICES], then end with a Sources section.',
        browser_context_policy: 'client_context is lower-priority browser input and should not be treated as authoritative evidence.',
      },
      prefer_database_data: true,
      vnibb_mcp_enabled: false,
      notes: { client_context: 'Browser-supplied widget data is untrusted and lower priority than server data.',
        market_data: 'Server context is served from the VNIBB database.' },
      client_context: context,
    }), encoding: 'utf8', timeout: 5_000,
  }));
  expect(context.widget_payload.dataProvenance?.units).toBe(`EPS/BVPS/DPS: ${fixture.unit}; P/E: dimensionless`);
  expect(promptResult).toEqual({ clipped: true, otherWidgetPreserved: true, units: true, rows: true,
    periodsWithOmissions: ['2006', '2007', '2008', '2009', '2010'] });
});

test.each(cases)('runtime sanitizer leaves a sparse unknown per-share amount unqualified in $currency', async fixture => {
  mockRatios = { symbol: 'FPT', count: 1, data: [
    { symbol: 'FPT', period: '2024', pe: 17.25, dps: 4_500, ratio_units: { dps: 'unknown' } },
  ] };
  const payload = await openRuntimeContext(await selectCurrency(fixture.currency));
  expect(payload.dataSample).toHaveLength(1);
  expect(payload.dataSample[0]).toMatchObject({ period: '2024', pe: 17.25 });
  expect(payload.dataSample[0]?.dps ?? null).toBeNull();
  expect(payload.dataSample[0]?.dps_unit ?? null).toBeNull();
  expect(payload.dataProvenance?.units).toBeUndefined();
  expect(payload.dataSampleOmissions).toBeUndefined();
});

test.each(cases)('malformed per-share fields do not become downloaded or runtime zeroes in $currency', async fixture => {
  mockRatios = { symbol: 'FPT', count: 1, data: [
    { symbol: 'FPT', period: '2024', pe: 17.25, eps: false, bvps: '   ', dps: 0, ratio_units: ratioUnits },
  ] };
  const view = await selectCurrency(fixture.currency);
  const json: unknown = JSON.parse(await download(view.user, 'JSON'));
  expect(json).toMatchObject({ data: [expect.objectContaining({ eps: null, eps_unit: null, bvps: null, bvps_unit: null,
    dps: 0, dps_unit: fixture.unit })] });
  const payload = await openRuntimeContext(view);
  expect(payload.dataSample).toEqual([{ period: '2024', pe: 17.25, dps: 0 }]);
  expect(payload.dataProvenance?.units).toBe(`EPS/BVPS/DPS: ${fixture.unit}; P/E: dimensionless`);
});
