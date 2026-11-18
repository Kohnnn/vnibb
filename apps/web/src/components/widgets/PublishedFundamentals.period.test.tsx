import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { BalanceSheetWidget } from '@/components/widgets/BalanceSheetWidget';
import { CashFlowWidget } from '@/components/widgets/CashFlowWidget';
import { FinancialRatiosWidget } from '@/components/widgets/FinancialRatiosWidget';
import { IncomeStatementWidget } from '@/components/widgets/IncomeStatementWidget';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { usePeriodState } from '@/hooks/usePeriodState';
import { useBalanceSheet, useCashFlow, useFinancialRatios, useIncomeStatement } from '@/lib/queries';
import { getWidgetExportData } from '@/lib/widgetRuntime';

jest.mock('@/lib/queries', () => ({
  useBalanceSheet: jest.fn(), useCashFlow: jest.fn(), useFinancialRatios: jest.fn(), useIncomeStatement: jest.fn(),
}));
jest.mock('@/lib/analytics', () => ({ ANALYTICS_EVENTS: {}, captureAnalyticsEvent: jest.fn() }));
jest.mock('@/contexts/UnitContext', () => {
  const config = { display: 'B', decimalPlaces: 2, currency: 'VND', locale: 'en-US' };
  return { useUnit: () => ({ config }) };
});
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children, headerActions, exportData }: { children: ReactNode; headerActions?: ReactNode; exportData?: unknown }) => (
    <>{headerActions}{children}<output data-testid="container-export">{JSON.stringify(exportData)}</output></>
  ),
}));

const symbol = 'FPT';
const published = { periodSyncGroup: 'fundamental-core', hidePeriodToggle: true };
const response = <T,>(data: T[]) => ({
  data: { symbol, count: data.length, data }, error: null, isLoading: false, isFetching: false,
  isError: false, refetch: jest.fn(), dataUpdatedAt: 1780000000000,
});
const basis = { symbol, source: 'synthetic-controlled', currency: 'VND', value_unit: 'VND', consolidation_basis: 'consolidated' };
const vnd = { source_unit: 'VND', value_unit: 'VND' };
const rejection = { unavailable_reason: 'unverified_monetary_unit' };
const fyIncome = { ...basis, period: '2025', flow_basis: 'annual', revenue: 98_496_000_000_000,
  depreciation: 7123456, unit_metadata: { revenue: vnd, depreciation: rejection } };
const qIncome = { ...basis, period: 'Q3-2026', flow_basis: 'single_quarter', revenue: 26_002_944_000_000,
  unit_metadata: { revenue: vnd } };

function PublishedPeriodControl() {
  const { period, setPeriod } = usePeriodState({ widgetId: 'published-fundamental-period', sharedKey: 'fundamental-core:FPT' });
  return <PeriodToggle label="Published period" value={period} onChange={setPeriod} options={['FY', 'Q', 'TTM']} />;
}

function choosePublishedPeriod(period: 'FY' | 'Q' | 'TTM') {
  const button = within(screen.getByRole('group', { name: 'Published period' })).getByRole('button', { name: period });
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-pressed', 'true');
}

function readTile(name: string, publish: jest.Mock) {
  const tile = within(screen.getByRole('region', { name }));
  const [payload] = publish.mock.lastCall ?? [];
  return {
    tile, payload,
    headings: tile.queryAllByRole('columnheader').slice(1).map((node) => node.textContent?.trim()),
    containerRows: JSON.parse(tile.getByTestId('container-export').textContent || 'null'),
    exportRows: getWidgetExportData(payload),
  };
}

function renderIncome(config: Record<string, unknown> = published) {
  const publish = jest.fn();
  render(<><PublishedPeriodControl /><section aria-label="Income statement">
    <IncomeStatementWidget id="default-fundamental-tab-1-income_statement-2" symbol={symbol} config={config} onDataChange={publish} />
  </section></>);
  return () => readTile('Income statement', publish);
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
});

describe('published FPT Income Statement period admission', () => {
  it('keeps the retained annual revenue, not the quarter, in initial FY and after returning from Q', () => {
    jest.mocked(useIncomeStatement).mockReturnValue(response([fyIncome, qIncome]) as never);
    const readIncome = renderIncome();
    const assertFiscalRows = (fiscal: { period: 'FY' | 'Q'; heading: string; value: string; reported: typeof fyIncome | typeof qIncome }) => {
      const { period, heading, value, reported } = fiscal;
      const { tile, headings, containerRows, exportRows, payload } = readIncome();
      expect(headings).toEqual([heading]);
      const revenue = tile.getByText('Revenue').closest('tr');
      expect(revenue).toHaveTextContent(value);
      expect(containerRows).toEqual([expect.objectContaining({ period: reported.period, revenue: reported.revenue, depreciation: null })]);
      expect(exportRows).toEqual(containerRows);
      expect(payload).toMatchObject({ data: containerRows, __widgetRuntime: { provenance: { period, periodScope: 'shared' } } });
    };
    expect(within(screen.getByRole('group', { name: 'Published period' })).getByRole('button', { name: 'FY' })).toHaveAttribute('aria-pressed', 'true');
    expect(useIncomeStatement).toHaveBeenLastCalledWith(symbol, { period: 'year', limit: 20 });
    const annual = { period: 'FY', heading: '2025', value: '98,496.00', reported: fyIncome } as const;
    assertFiscalRows(annual);
    choosePublishedPeriod('Q');
    expect(useIncomeStatement).toHaveBeenLastCalledWith(symbol, { period: 'quarter', limit: 40 });
    assertFiscalRows({ period: 'Q', heading: 'Q3 2026', value: '26,002.94', reported: qIncome });
    choosePublishedPeriod('FY');
    expect(useIncomeStatement).toHaveBeenLastCalledWith(symbol, { period: 'year', limit: 20 });
    assertFiscalRows(annual);
  });

  it('does not substitute a reported quarter when the FY observation is missing', () => {
    jest.mocked(useIncomeStatement).mockReturnValue(response([qIncome]) as never);
    const { tile, headings, containerRows, exportRows } = renderIncome()();
    expect(headings).toEqual([]);
    expect(tile.queryByText('Revenue')).not.toBeInTheDocument();
    expect(containerRows).toEqual([]);
    expect(exportRows).toEqual([]);
  });

  it('keeps an explicit local quarter independent of the published switch and admits labeled annual YTD separately', () => {
    const ytd = { ...fyIncome, period: '2026 YTD', flow_basis: 'cumulative_ytd', revenue: 73_000_000_000_000 };
    jest.mocked(useIncomeStatement).mockReturnValue(response([fyIncome, qIncome, ytd]) as never);
    const readIncome = renderIncome({ periodSyncGroup: null, defaultPeriod: 'Q' });
    expect(readIncome().headings).toEqual(['Q3 2026']);
    choosePublishedPeriod('FY');
    expect(readIncome().payload.__widgetRuntime.provenance).toMatchObject({ period: 'Q', periodScope: 'local' });
    fireEvent.click(within(readIncome().tile.getByRole('group', { name: 'Financial period' })).getByRole('button', { name: 'FY' }));
    choosePublishedPeriod('Q');
    const { headings, exportRows, payload } = readIncome();
    expect(headings).toEqual(['2025', '2026 (YTD)']);
    expect(exportRows).toEqual([fyIncome, ytd].map(({ period, revenue }) => expect.objectContaining({ period, revenue })));
    expect(payload.__widgetRuntime.provenance).toMatchObject({ period: 'FY', periodScope: 'local' });
  });
});

const tiles = [
  { name: 'Financial ratios', key: 'financial_ratios', Widget: FinancialRatiosWidget, metric: 'P/E', field: 'pe', fy: [17.25, '17.25'], q: [31.75, '31.75'] },
  { name: 'Income statement', key: 'income_statement', Widget: IncomeStatementWidget, metric: 'Revenue', field: 'revenue', fy: [fyIncome.revenue, '98,496.00'], q: [qIncome.revenue, '26,002.94'] },
  { name: 'Balance sheet', key: 'balance_sheet', Widget: BalanceSheetWidget, metric: 'Total Assets', field: 'total_assets', fy: [50_000_000_000_000, '50,000.00'], q: [55_000_000_000_000, '55,000.00'] },
  { name: 'Cash flow', key: 'cash_flow', Widget: CashFlowWidget, metric: 'Operating CF', field: 'operating_cash_flow', fy: [-3_000_000_000_000, '-3,000.00'], q: [0, '0.00'] },
] as const;

const withheldRawCash = 8_765_432_100_123;
const noAnnualRow = { ...basis, period: '2024', unavailable_reason: 'unverified_monetary_unit' };

function renderPublishedGroup(responseMode: 'mixed' | 'quarter-only' = 'mixed') {
  const [ratios, , balance, cash] = tiles;
  const selectRows = <Annual, Quarter>(annual: readonly Annual[], quarter: Quarter): Array<Annual | Quarter> =>
    responseMode === 'mixed' ? [...annual, quarter] : [quarter];
  jest.mocked(useFinancialRatios).mockReturnValue(response(selectRows(
    [{ period: '2025', pe: ratios.fy[0] }], { period: 'Q3-2026', pe: ratios.q[0] },
  )) as never);
  jest.mocked(useIncomeStatement).mockReturnValue(response(selectRows([fyIncome], qIncome)) as never);
  jest.mocked(useBalanceSheet).mockReturnValue(response(selectRows([
    { ...basis, period: '2025', total_assets: balance.fy[0], unit_metadata: { total_assets: vnd, cash: rejection }, raw_data: { cash: withheldRawCash } },
    noAnnualRow,
  ], { ...basis, period: 'Q3-2026', total_assets: balance.q[0], unit_metadata: { total_assets: vnd } })) as never);
  jest.mocked(useCashFlow).mockReturnValue(response(selectRows([
    { ...basis, period: '2025', flow_basis: 'annual', operating_cash_flow: cash.fy[0], unit_metadata: { operating_cash_flow: vnd, depreciation: rejection }, raw_data: { depreciation: 7_123_456 } },
    noAnnualRow,
  ], { ...basis, period: 'Q3-2026', flow_basis: 'single_quarter', operating_cash_flow: cash.q[0], unit_metadata: { operating_cash_flow: vnd } })) as never);

  const instances = tiles.map((tile, index) => ({
    ...tile, id: `default-fundamental-tab-1-${tile.key}-${index + 1}`, publish: jest.fn(),
  }));
  instances.forEach(({ id }) => window.localStorage.setItem(`vnibb_period_v3_${id}`, 'Q'));
  render(<ThemeProvider><PublishedPeriodControl />{instances.map(({ name, id, Widget, publish }) => (
    <section key={id} aria-label={name}><Widget id={id} symbol={symbol} config={published} onDataChange={publish} /></section>
  ))}</ThemeProvider>);
  return () => instances.map(({ name, publish, metric, field, fy, q }) => ({
    name, metric, field, fy, q, ...readTile(name, publish),
  }));
}

function assertPublishedRows(readGroup: ReturnType<typeof renderPublishedGroup>, period: 'FY' | 'Q') {
  const rendered = readGroup();
  const heading = period === 'FY' ? '2025' : 'Q3 2026';
  const reportedPeriod = period === 'FY' ? '2025' : 'Q3-2026';
  expect(rendered.map(({ name, headings }) => [name, headings])).toEqual(tiles.map(({ name }) => [name, [heading]]));
  for (const row of rendered) {
    const [value, formatted] = period === 'FY' ? row.fy : row.q;
    expect(row.tile.getByText(row.metric).closest('tr')).toHaveTextContent(formatted);
    expect(row.tile.queryByRole('group', { name: 'Financial period' })).not.toBeInTheDocument();
    expect(row.containerRows).toEqual([expect.objectContaining({ period: reportedPeriod, [row.field]: value })]);
    expect(row.exportRows).toEqual(row.containerRows);
    expect(row.payload).toMatchObject({ data: row.containerRows, __widgetRuntime: { provenance: { period, periodScope: 'shared' } } });
    expect(JSON.stringify(row.containerRows)).not.toContain(String(withheldRawCash));
  }
}

describe('published FPT Fundamentals with mixed inputs', () => {
  it('starts every linked widget on FY despite stale private quarter settings', () => {
    const readGroup = renderPublishedGroup();
    expect(within(screen.getByRole('group', { name: 'Published period' })).getByRole('button', { name: 'FY' })).toHaveAttribute('aria-pressed', 'true');
    assertPublishedRows(readGroup, 'FY');
  });

  it('switches the four tables and their export inputs to Q and back to FY', () => {
    const readGroup = renderPublishedGroup();
    choosePublishedPeriod('Q');
    assertPublishedRows(readGroup, 'Q');
    choosePublishedPeriod('FY');
    assertPublishedRows(readGroup, 'FY');
  });

  it('leaves the four FY tables and exports empty when only quarters exist', () => {
    const rendered = renderPublishedGroup('quarter-only')();
    expect(rendered.map(({ name, headings }) => [name, headings])).toEqual(tiles.map(({ name }) => [name, []]));
    for (const row of rendered) {
      expect(row.containerRows).toEqual([]);
      expect(row.exportRows).toEqual([]);
    }
  });
});
