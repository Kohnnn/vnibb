import { fireEvent, render, screen, within } from '@testing-library/react';
import { useFlowCoverage, useTransactionFlow } from '@/lib/queries';
import type { TransactionFlowPoint } from '@/types/equity';
import { TransactionFlowWidget } from './TransactionFlowWidget';

jest.mock('@/lib/queries', () => ({
  useFlowCoverage: jest.fn(),
  useTransactionFlow: jest.fn(),
}));
jest.mock('@/contexts/UnitContext', () => ({
  useUnit: () => ({ config: { display: 'auto', decimalPlaces: 2, currency: 'VND', locale: 'en-US' } }),
}));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));
jest.mock('@/components/ui/ChartMountGuard', () => ({
  ChartMountGuard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ data, children }: { data: unknown; children: React.ReactNode }) => (
    <div><pre data-testid="flow-chart-data">{JSON.stringify(data)}</pre>{children}</div>
  ),
  Bar: ({ name }: { name: string }) => <span data-testid="flow-series">{name}</span>,
  Line: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const sample: TransactionFlowPoint = {
  date: '2026-10-13',
  price: 57300,
  flow_scope: 'sampled',
  coverage: {
    scope: 'sampled', status: 'sampled', completed_session: false,
    observed_trade_count: 500,
    observed_window_start: '2026-10-13T13:55:00+07:00',
    observed_window_end: '2026-10-13T14:45:00+07:00',
    session_date: '2026-10-13', requested_session_date: '2026-10-13',
    denominator_trade_count: null, session_fraction: null, provider: 'vnstock:VCI',
    sql_flows: { status: 'persisted', rows: 1 },
    sql_ticks: { status: 'persisted', rows: 500 },
    mongo_ticks: { status: 'failed', rows: 0, error: 'write unavailable' },
  },
  observed_buy_value: 70_000_000, observed_sell_value: 35_000_000,
  observed_gross_value: 105_000_000, observed_net_value: 35_000_000,
  observed_buy_volume: 7000, observed_sell_volume: 3500,
  observed_volume: 10500, observed_net_volume: 3500,
  total_gross_value: null, total_net_value: null, domestic_net_value: null,
  total_net_volume: null, domestic_net_volume: null,
  foreign_net_value: 90_000_000, proprietary_net_value: null,
  big_order_count: 0, block_trade_count: null,
};

function setRows(rows: TransactionFlowPoint[]) {
  (useTransactionFlow as jest.Mock).mockReturnValue({
    data: { data: { symbol: 'FPT', days: 30, scopes: [], modes: [], data: rows } },
    isLoading: false, error: null, isFetching: false, refetch: jest.fn(), dataUpdatedAt: 0,
  });
}

function chartRows() {
  return JSON.parse(screen.getByTestId('flow-chart-data').textContent || '[]');
}

function metric(label: string) {
  const element = screen.getAllByText(label, { exact: true }).find((item) =>
    item.tagName === 'DT' || item.tagName === 'DIV'
  );
  if (!element) throw new Error(`Missing flow metric: ${label}`);
  return within(element.parentElement!);
}

beforeEach(() => {
  jest.clearAllMocks();
  (useFlowCoverage as jest.Mock).mockReturnValue({ data: { data: [] } });
  setRows([sample]);
});

test('renders the incoming 500-trade tail as an observed sample, not a complete session', () => {
  render(<TransactionFlowWidget id="flow" symbol="FPT" />);
  expect(metric('Observed trades').getByText('500')).toBeInTheDocument();
  expect(screen.getByText('Observed sample · Sampled / partial')).toBeInTheDocument();
  expect(screen.getByText('2026-10-13T13:55:00+07:00 – 2026-10-13T14:45:00+07:00')).toBeInTheDocument();
  expect(screen.getByText('vnstock:VCI / sampled')).toBeInTheDocument();
  expect(screen.getByText('persisted / persisted / failed')).toBeInTheDocument();
  expect(metric('Session trade count / coverage').getByText('N/A / Unknown')).toBeInTheDocument();
  expect(screen.queryByText(/100(?:\.0)?%/)).not.toBeInTheDocument();
  expect(metric('Observed gross').getByText('105.0M')).toBeInTheDocument();
  expect(metric('Observed buy value').getByText('70.0M')).toBeInTheDocument();
  expect(metric('Observed sell value').getByText('35.0M')).toBeInTheDocument();
  expect(metric('Observed net value').getByText('35.0M')).toBeInTheDocument();
  expect(metric('Observed buy volume').getByText('7.0K')).toBeInTheDocument();
  expect(metric('Observed sell volume').getByText('3.5K')).toBeInTheDocument();
  expect(metric('Observed volume').getByText('10.5K')).toBeInTheDocument();
  expect(metric('Observed net volume').getByText('3.5K')).toBeInTheDocument();
  expect(metric('Domestic').getByText('N/A')).toBeInTheDocument();
  expect(metric('Observed Big Orders').getByText('0')).toBeInTheDocument();
  expect(metric('Observed Block Trades').getByText('N/A')).toBeInTheDocument();
  expect(chartRows()[0]).toMatchObject({ observed: 35_000_000, selected: 35_000_000, sessionTotal: null, domestic: null });
  expect(screen.getAllByTestId('flow-series').map((element) => element.textContent)).toEqual(['Observed sample', 'Certified session total']);
  fireEvent.click(screen.getByRole('button', { name: 'Volume' }));
  expect(chartRows()[0]).toMatchObject({ observed: 3500, selected: 3500, sessionTotal: null, domestic: null });
});

test('preserves an incoming observed count above the provider tail size without deriving a denominator', () => {
  setRows([{ ...sample, coverage: { ...sample.coverage, observed_trade_count: 1201, denominator_trade_count: 1201, session_fraction: 1 } }]);
  render(<TransactionFlowWidget id="flow" symbol="FPT" />);
  expect(metric('Observed trades').getByText('1201')).toBeInTheDocument();
  expect(metric('Session trade count / coverage').getByText('N/A / Unknown')).toBeInTheDocument();
  expect(screen.queryByText(/100(?:\.0)?%/)).not.toBeInTheDocument();
  expect(chartRows()[0]).toMatchObject({ observed: 35_000_000, sessionTotal: null });
});

test.each([
  undefined,
  { scope: 'unknown' as const, completed_session: false },
  { scope: 'full_session' as const, completed_session: false },
])('does not trust daily totals without full-session certification: %j', (coverage) => {
  setRows([{ ...sample, coverage, flow_scope: 'full_session', total_net_value: 999_000_000, total_gross_value: 999_000_000, domestic_net_value: 999_000_000 }]);
  render(<TransactionFlowWidget id="flow" symbol="FPT" />);
  expect(screen.getByText('Observed sample · Unknown')).toBeInTheDocument();
  expect(metric('Domestic').getByText('N/A')).toBeInTheDocument();
  expect(metric('Observed gross').getByText('105.0M')).toBeInTheDocument();
  expect(metric('Observed Big Orders').getByText('N/A')).toBeInTheDocument();
  expect(metric('Observed Block Trades').getByText('N/A')).toBeInTheDocument();
  expect(chartRows()[0]).toMatchObject({ observed: 35_000_000, sessionTotal: null, domestic: null });
  expect(screen.queryByText('999.0M')).not.toBeInTheDocument();
});

test('absent coverage and absent measured values stay unavailable instead of reviving legacy totals', () => {
  setRows([{ date: '2026-10-13', total_net_value: 999_000_000, domestic_net_value: 999_000_000 }]);
  render(<TransactionFlowWidget id="flow" symbol="FPT" />);
  expect(screen.getByText('Observed sample · Unknown')).toBeInTheDocument();
  expect(metric('Observed trades').getByText('N/A')).toBeInTheDocument();
  expect(screen.queryByTestId('flow-chart-data')).not.toBeInTheDocument();
  expect(screen.queryByText('999.0M')).not.toBeInTheDocument();
});

test('certified full-session legacy totals retain normal session rendering', () => {
  setRows([{
    ...sample, flow_scope: 'full_session',
    coverage: { ...sample.coverage, scope: 'full_session', completed_session: true, status: 'complete_session', observed_trade_count: 1201, denominator_trade_count: 1201, session_fraction: 1 },
    total_net_value: 120_000_000, total_gross_value: 210_000_000, domestic_net_value: 30_000_000,
  }]);
  render(<TransactionFlowWidget id="flow" symbol="FPT" />);
  expect(screen.getByText('Session coverage · Complete session')).toBeInTheDocument();
  expect(screen.getByText('Latest Session Snapshot')).toBeInTheDocument();
  expect(metric('Total').getByText('120.0M')).toBeInTheDocument();
  expect(metric('Gross').getByText('210.0M')).toBeInTheDocument();
  expect(metric('Domestic').getByText('30.0M')).toBeInTheDocument();
  expect(metric('Session trade count / coverage').getByText('1201 / 100.0%')).toBeInTheDocument();
  expect(chartRows()[0]).toMatchObject({ observed: null, selected: 120_000_000, sessionTotal: 120_000_000, domestic: 30_000_000 });
});

test('an older certified domestic residual is not displayed as the latest sample residual', () => {
  setRows([
    { ...sample, date: '2026-10-12', coverage: { scope: 'full_session', completed_session: true }, domestic_net_value: 30_000_000, total_net_value: 120_000_000 },
    sample,
  ]);
  render(<TransactionFlowWidget id="flow" symbol="FPT" />);
  expect(metric('Domestic').getByText('N/A')).toBeInTheDocument();
  expect(chartRows().map((row: { observed: number | null; sessionTotal: number | null }) => [row.observed, row.sessionTotal])).toEqual([[null, 120_000_000], [35_000_000, null]]);
});

test('a one-sided measured zero remains zero without fabricating aggregate values', () => {
  setRows([{ ...sample, observed_buy_value: null, observed_sell_value: 0, observed_net_value: null, observed_gross_value: null, observed_buy_volume: null, observed_sell_volume: 0, observed_volume: null, observed_net_volume: null, foreign_net_value: null }]);
  render(<TransactionFlowWidget id="flow" symbol="FPT" />);
  expect(metric('Observed sell value').getByText('0')).toBeInTheDocument();
  expect(metric('Observed buy value').getByText('N/A')).toBeInTheDocument();
  expect(metric('Observed net value').getByText('N/A')).toBeInTheDocument();
  expect(metric('Observed gross').getByText('N/A')).toBeInTheDocument();
  expect(chartRows()[0]).toMatchObject({ observed: null, selected: null, sessionTotal: null, domestic: null });
});
