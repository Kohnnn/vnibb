import { fireEvent, render, screen } from '@testing-library/react';
import { usePeriodState } from '@/hooks/usePeriodState';
import { FinancialRatiosWidget } from '@/components/widgets/FinancialRatiosWidget';
import { UnitProvider } from '@/contexts/UnitContext';
import { useFinancialRatios, useIncomeStatement } from '@/lib/queries';

jest.mock('@/lib/queries', () => ({ useFinancialRatios: jest.fn(), useIncomeStatement: jest.fn() }));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children, headerActions, exportData }: { children: React.ReactNode; headerActions?: React.ReactNode; exportData?: unknown }) => <>{headerActions}{children}<output data-testid="export">{JSON.stringify(exportData)}</output></>,
}));

type PeriodRow = { period: string; pe: number };
const annual = { period: '2025', pe: 17.25 };
const quarter = { period: 'Q3-2026', pe: 31.75 };
const ytd = { period: '2026 YTD', pe: 12.5 };
const published = { periodSyncGroup: 'fundamental-core', hidePeriodToggle: true };
const result = (data: PeriodRow[]) => ({ data: { symbol: 'FPT', count: data.length, data }, error: null,
  isLoading: false, isFetching: false, isError: false, refetch: jest.fn(), dataUpdatedAt: 0 });

function SharedPeriod() {
  const { setPeriod } = usePeriodState({ widgetId: 'banner', sharedKey: 'fundamental-core:FPT' });
  return <>
    <button onClick={() => setPeriod('FY')}>Shared FY</button>
    <button onClick={() => setPeriod('Q')}>Shared Q</button>
    <button onClick={() => setPeriod('TTM')}>Shared TTM</button>
  </>;
}

function renderRatios(config: Record<string, unknown> = published) {
  const publish = jest.fn();
  const view = render(<UnitProvider><SharedPeriod /><FinancialRatiosWidget
    id="fixture-ratios" symbol="FPT" config={config} onDataChange={publish} />
  </UnitProvider>);
  return { publish, readPeriods: () => ({
    headings: Array.from(view.container.querySelectorAll('thead th')).map(node => node.textContent?.trim()).slice(1),
    exportPeriods: JSON.parse(view.getByTestId('export').textContent!).map((r: PeriodRow) => r.period),
    publishedPeriods: (publish.mock.lastCall![0].data ?? []).map((r: PeriodRow) => r.period),
  }) };
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
  (useFinancialRatios as jest.Mock).mockReturnValue(result([annual, quarter]));
});

it.each(['mixed-reference', 'no-reference'] as const)('keeps initial FY on FPT in the table and conferred data (%s)', (reference) => {
  // Saved before this widget joined the published group; not the banner's control.
  window.localStorage.setItem('vnibb_period_v3_fixture-ratios', 'Q');
  (useIncomeStatement as jest.Mock).mockReturnValue(result(reference === 'mixed-reference' ? [annual, quarter] : []));
  const { readPeriods } = renderRatios();
  expect(useFinancialRatios).toHaveBeenCalledWith('FPT', expect.objectContaining({ period: 'FY' }));
  expect(useIncomeStatement).toHaveBeenCalledWith('FPT', expect.objectContaining({ period: 'year' }));
  expect(readPeriods()).toEqual({ headings: ['2025'], exportPeriods: ['2025'], publishedPeriods: ['2025'] });
});

it.each(['mixed-reference', 'wrong-period-reference'] as const)('switches FY to Q and back without carrying the other period (%s)', (reference) => {
  (useIncomeStatement as jest.Mock).mockReturnValue(result(reference === 'mixed-reference' ? [annual, quarter] : [annual]));
  const { readPeriods, publish } = renderRatios();
  fireEvent.click(screen.getByRole('button', { name: 'Shared Q' }));
  expect(useFinancialRatios).toHaveBeenLastCalledWith('FPT', expect.objectContaining({ period: 'Q' }));
  expect(useIncomeStatement).toHaveBeenLastCalledWith('FPT', expect.objectContaining({ period: 'quarter' }));
  expect(readPeriods()).toEqual({ headings: ['Q3 2026'], exportPeriods: ['Q3-2026'], publishedPeriods: ['Q3-2026'] });
  expect(publish.mock.lastCall![0].__widgetRuntime.provenance).toMatchObject({ period: 'Q', periodScope: 'shared' });
  fireEvent.click(screen.getByRole('button', { name: 'Shared FY' }));
  expect(readPeriods()).toEqual({ headings: ['2025'], exportPeriods: ['2025'], publishedPeriods: ['2025'] });
  fireEvent.click(screen.getByRole('button', { name: 'Shared TTM' }));
  expect(readPeriods()).toEqual({ headings: [], exportPeriods: [], publishedPeriods: [] });
  expect(publish.mock.lastCall![0].__widgetRuntime.provenance).toMatchObject({ period: 'TTM', observationStatus: 'unsupported' });
});

it('keeps an explicit per-widget override independent and admits real annual YTD separately', () => {
  (useFinancialRatios as jest.Mock).mockReturnValue(result([annual, quarter, ytd]));
  (useIncomeStatement as jest.Mock).mockReturnValue(result([annual, quarter, ytd]));
  window.localStorage.setItem('vnibb_period_v3_shared_fundamental-core:FPT', 'FY');
  const { readPeriods, publish } = renderRatios({ periodSyncGroup: null, defaultPeriod: 'Q' });
  expect(readPeriods()).toEqual({ headings: ['Q3 2026'], exportPeriods: ['Q3-2026'], publishedPeriods: ['Q3-2026'] });
  expect(publish.mock.lastCall![0].__widgetRuntime.provenance).toMatchObject({ period: 'Q', periodScope: 'local' });
  fireEvent.click(screen.getByRole('button', { name: 'FY' }));
  fireEvent.click(screen.getByRole('button', { name: 'Shared Q' }));
  expect(readPeriods()).toEqual({ headings: ['2025', '2026 (YTD)'], exportPeriods: ['2025', '2026 YTD'], publishedPeriods: ['2025', '2026 YTD'] });
  expect(publish.mock.lastCall![0].data[1]).toMatchObject(ytd);
  expect(publish.mock.lastCall![0].__widgetRuntime.provenance).toMatchObject({ period: 'FY', periodScope: 'local' });
});
