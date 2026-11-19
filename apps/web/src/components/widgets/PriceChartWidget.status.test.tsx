import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { WidgetHealthChip } from '@/components/ui/WidgetHealthChip';
import { deriveWidgetHealth } from '@/lib/widgetHealth';
import type { WidgetDataPayload } from '@/lib/widgetRuntime';
import { PriceChartWidget } from './PriceChartWidget';

jest.mock('@/lib/env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { readonly children: ReactNode }) => (
    <section aria-label="Price Chart widget">{children}</section>
  ),
}));
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }));

const originalFetch = globalThis.fetch;
const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
const screener = jest.fn<Promise<Response>, []>();
const ratios = jest.fn<Promise<Response>, []>();
const history = jest.fn<Promise<Response>, []>();
const receiptTitle = 'Retrieval time does not establish source freshness';
const rawFailure = 'offline synthetic upstream diagnostic';
const septemberBar = {
  symbol: 'FPT', time: '2026-09-15', open: 57000, high: 57500, low: 56000, close: 57000,
  volume: 100, price_unit: 'VND',
};

function httpJson(body: unknown, status = 200): Response {
  return { ok: status === 200, status, json: async () => body } as Response;
}

function widgetView() {
  return within(screen.getByRole('region', { name: 'Price Chart widget' }));
}

async function findSnapshotStatus(name: string) {
  const status = await widgetView().findByRole('status', { name });
  expect(screen.getByRole('region', { name: 'Fundamentals Snapshot' })).toContainElement(status);
  return status;
}

function ChartWithDashboardStatus() {
  const [data, setData] = useState<WidgetDataPayload>();
  const provenance = data?.__widgetRuntime?.provenance;
  return (
    <>
      <div role="group" aria-label="Dashboard chart status">
        {provenance && <WidgetHealthChip health={deriveWidgetHealth(provenance)} details={provenance} />}
      </div>
      <PriceChartWidget id="chart-1" symbol="FPT" onDataChange={setData} />
    </>
  );
}

function renderChart() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <ChartWithDashboardStatus />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  // Pin the date and receipt, but let Query schedule notifications and retries normally.
  jest.useFakeTimers({
    now: new Date('2026-11-18T10:30:00Z'),
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
  });
  screener.mockResolvedValue(httpJson({ data: [{ ticker: 'FPT', pe: 18.5 }] }));
  ratios.mockResolvedValue(httpJson({ data: [], meta: { count: 0 } }));
  history.mockResolvedValue(httpJson({
    data: [septemberBar], meta: { count: 1, freshness_as_of: septemberBar.time, last_data_date: septemberBar.time },
  }));
  fetchMock.mockImplementation(async (input) => {
    switch (new URL(String(input)).pathname) {
      case '/api/v1/screener/': return screener();
      case '/api/v1/equity/FPT/ratios': return ratios();
      case '/api/v1/equity/historical': return history();
      case '/api/v1/equity/FPT/profile': return httpJson({ data: { exchange: 'HOSE' } });
      case '/api/v1/equity/FPT/quote': return httpJson({ data: null });
      case '/api/v1/equity/FPT/events': return httpJson({ data: [] });
      default: throw new Error(`Unexpected fixture request: ${String(input)}`);
    }
  });
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.resetAllMocks();
  jest.useRealTimers();
});

test('retains successful screener values and their receipt after a failed refetch', async () => {
  const client = renderChart();
  const view = widgetView();
  expect(await view.findByText('18.50')).toBeInTheDocument();
  expect(await view.findByLabelText('Chart units and session basis')).toHaveTextContent('VND');
  const chartHealth = await chartStatus().findByRole('button', { name: 'Data status: As-of unknown' });
  const receipt = view.getByTitle(receiptTitle).textContent ?? '';

  jest.setSystemTime(new Date('2026-11-18T11:30:00Z'));
  screener.mockResolvedValue(httpJson({ detail: rawFailure }, 503));
  await act(async () => {
    await client.refetchQueries({ queryKey: ['screener'] });
  });
  expect(screener).toHaveBeenCalledTimes(4); // Initial success, failed refresh, two retries.
  expect(view.getByText('18.50')).toBeInTheDocument();
  expect(view.getByTitle(receiptTitle).textContent).toBe(receipt);
  expect(await findSnapshotStatus('Screener delivery')).toHaveTextContent(/previously fetched/i);
  expect(chartStatus().getByRole('button', { name: 'Data status: As-of unknown' })).toBe(chartHealth);
});

test.each([
  { source: 'stale_cache', stale: true, fallback: false, qualification: /stale/i },
  { source: 'fallback_cache', stale: false, fallback: true, qualification: /fallback/i },
])('qualifies HTTP 200 $source screener values alongside financial ratios', async ({ source, stale, fallback, qualification }) => {
  screener.mockResolvedValue(httpJson({
    data: [{ ticker: 'FPT', pe: 18.5 }], meta: { source, cached: true, stale, fallback, availability: 'available' },
  }));
  ratios.mockResolvedValue(httpJson({ data: [{ symbol: 'FPT', period: '2025', pb: 2.4 }] }));
  renderChart();

  expect(await widgetView().findByText('18.50')).toBeInTheDocument();
  expect(await widgetView().findByText('2.40')).toBeInTheDocument();
  expect(await findSnapshotStatus('Screener delivery')).toHaveTextContent(qualification);
  expect(widgetView().queryByTitle(receiptTitle)).not.toBeInTheDocument();
  expect(await chartStatus().findByRole('button', { name: 'Data status: As-of unknown' })).toBeInTheDocument();
});

test('qualifies usable ratios without stamping them with an unavailable HTTP 200 screener receipt', async () => {
  screener.mockResolvedValue(httpJson({
    data: [], error: rawFailure, meta: { count: 0, availability: 'unavailable' },
  }));
  ratios.mockResolvedValue(httpJson({
    data: [{ symbol: 'FPT', period: '2025', pe: 16.25 }], meta: { count: 1 }, error: rawFailure,
  }));
  const client = renderChart();

  expect(await widgetView().findByText('16.25')).toBeInTheDocument();
  expect(client.getQueriesData({ queryKey: ['screener'] })[0]?.[1]).toEqual(expect.objectContaining({ data: [] }));
  expect(widgetView().queryByTitle(receiptTitle)).not.toBeInTheDocument();
  expect(await findSnapshotStatus('Screener delivery')).toHaveTextContent(/unavailable/i);
  expect(await findSnapshotStatus('Financial ratios delivery')).toHaveTextContent(/available ratios/i);
  expect(widgetView().queryByText(rawFailure, { exact: false })).not.toBeInTheDocument();
  expect(await chartStatus().findByRole('button', { name: 'Data status: As-of unknown' })).toBeInTheDocument();
});

function chartArea() {
  return within(widgetView().getByRole('region', { name: 'Price history chart' }));
}

function chartStatus() {
  return within(screen.getByRole('group', { name: 'Dashboard chart status' }));
}

test.each([
  { history: 'synthetic missing freshness metadata', session: '2026-11-17', asOf: null },
  { history: 'September observations', session: '2026-09-15', asOf: '2026-09-15' },
])('keeps the fundamentals receipt off the chart for $history', async ({ session, asOf }) => {
  history.mockResolvedValue(httpJson({
    data: [{ ...septemberBar, time: session }],
    meta: { count: 1, freshness_as_of: asOf, last_data_date: asOf },
  }));

  renderChart();

  expect(await chartArea().findByLabelText('Chart units and session basis')).toHaveTextContent('VND');
  const snapshot = within(widgetView().getByRole('region', { name: 'Fundamentals Snapshot' }));
  expect(await snapshot.findByText('18.50')).toBeInTheDocument();
  expect(snapshot.getByTitle(receiptTitle)).toBeInTheDocument();
  const settings = within(widgetView().getByRole('group', { name: 'Chart settings' }));
  expect(settings.queryByTitle(receiptTitle)).not.toBeInTheDocument();
  expect(chartArea().queryByTitle(receiptTitle)).not.toBeInTheDocument();
  fireEvent.click(await chartStatus().findByRole('button', { name: 'Data status: As-of unknown' }));
  expect(chartStatus().queryByText('Fetched at')).not.toBeInTheDocument();
});

const emptyHistoryMeta = {
  count: 0, source_mode: 'empty', completeness_status: 'partial',
  last_data_date: null, freshness_as_of: null,
};

test.each([
  { delivery: 'genuinely empty HTTP 200 history', error: null, overlay: /no chart data available/i, status: 'No observations' },
  { delivery: 'unavailable HTTP 200 history', error: rawFailure, overlay: /chart data unavailable/i, status: 'Unavailable' },
])('distinguishes $delivery', async ({ error, overlay, status }) => {
  history.mockResolvedValue(httpJson({ data: [], meta: emptyHistoryMeta, error }));
  renderChart();

  const loading = chartStatus().queryByRole('button', { name: 'Data status: Loading' });
  const resolvedOverlay = await widgetView().findByText(overlay);
  expect(await chartStatus().findByRole('button', { name: `Data status: ${status}` })).toBeInTheDocument();
  expect(loading).not.toBeNull();
  expect(chartArea().getByText(overlay)).toBe(resolvedOverlay);
  expect(chartArea().queryByText(rawFailure, { exact: false })).not.toBeInTheDocument();
  expect(chartArea().queryByLabelText('Chart units and session basis')).not.toBeInTheDocument();
});

test('keeps the transport failure overlay without exposing raw diagnostics', async () => {
  history.mockRejectedValue(new Error(rawFailure));
  renderChart();

  expect(await widgetView().findByText(/chart data unavailable/i)).toBeInTheDocument();
  expect(widgetView().queryByText(rawFailure, { exact: false })).not.toBeInTheDocument();
  expect(chartArea().getByRole('status', { name: 'History unavailable' })).toBeInTheDocument();
  expect(await chartStatus().findByRole('button', { name: 'Data status: Unavailable' })).toBeInTheDocument();
});

test.each([
  { delivery: 'reported partial history', completeness: 'partial', error: null },
  { delivery: 'usable rows with a response error', completeness: 'unknown', error: rawFailure },
])('qualifies $delivery without withholding the certified series', async ({ completeness, error }) => {
  history.mockResolvedValue(httpJson({
    data: [septemberBar], error,
    meta: {
      count: 1, completeness_status: completeness, source_mode: 'db', fallback_used: true,
      last_data_date: septemberBar.time, freshness_as_of: septemberBar.time,
      warnings: [rawFailure],
    },
  }));
  renderChart();

  expect(await widgetView().findByLabelText('Chart units and session basis')).toHaveTextContent('VND');
  const delivery = await widgetView().findByRole('status', { name: 'History delivery' });
  expect(chartArea().getByRole('status', { name: 'History delivery' })).toBe(delivery);
  expect(delivery).toHaveTextContent(/partial/i);
  expect(delivery).toHaveTextContent(/fallback/i);
  expect(chartArea().queryByText(rawFailure, { exact: false })).not.toBeInTheDocument();
  expect(await chartStatus().findByRole('button', { name: 'Data status: Partial coverage' })).toBeInTheDocument();
});

test('identifies listing venue and service and labels the history route as a summary', async () => {
  renderChart();
  expect(await widgetView().findByLabelText('Chart units and session basis')).toHaveTextContent('VND');
  fireEvent.click(await chartStatus().findByRole('button', { name: 'Data status: As-of unknown' }));
  expect(chartStatus().getByText('Route summary')).toBeInTheDocument();
  expect(chartStatus().getByText('/equity/historical')).toBeInTheDocument();
  expect(chartStatus().queryByText('Endpoint')).not.toBeInTheDocument();
  expect(chartStatus().getByText('VniBB')).toBeInTheDocument();
  const settings = within(widgetView().getByRole('group', { name: 'Chart settings' }));
  expect(await settings.findByText(/listing venue: HOSE/i)).toBeInTheDocument();
  expect(settings.getByText('VniBB')).toBeInTheDocument();

  const historyRequest = fetchMock.mock.calls.map(([input]) => new URL(String(input)))
    .find((url) => url.pathname === '/api/v1/equity/historical');
  expect(historyRequest?.searchParams.get('symbol')).toBe('FPT');
  expect(historyRequest?.searchParams.get('interval')).toBe('1D');
  expect(historyRequest?.searchParams.get('adjustment_mode')).toBe('adjusted');
  expect(historyRequest?.searchParams.get('start_date')).toBe('2025-11-18');
  expect(historyRequest?.searchParams.get('end_date')).toBe('2026-11-18');
});
