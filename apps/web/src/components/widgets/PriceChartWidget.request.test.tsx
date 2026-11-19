import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { WidgetDataPayload } from '@/lib/widgetRuntime';
import { PriceChartWidget } from './PriceChartWidget';

jest.mock('@/lib/env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }));
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }));

type HistoryRequest = {
  readonly query: Record<string, string>;
  readonly signal: AbortSignal;
};

type Publication = {
  readonly timeframe: unknown;
  readonly observation: string | null;
  readonly coverage: string | null;
};

const session = {
  time: '2026-11-16', open: 57000, high: 57500, low: 56000, close: 57000,
  volume: 100, price_unit: 'VND',
};
const partial = { data: [session], meta: { completeness_status: 'partial', fallback_used: true } };
const unavailable = { data: [], error: 'Synthetic acquisition failure' };
const empty = { data: [] };
const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

function historyGate() {
  const started = Promise.withResolvers<HistoryRequest>();
  const bodyEvenAfterAbort = Promise.withResolvers<unknown>();
  return { started, bodyEvenAfterAbort };
}

function offlineHistory() {
  const gates: ReturnType<typeof historyGate>[] = [];
  const requests: HistoryRequest[] = [];
  const fetchFixture = async (input: string, init?: RequestInit): Promise<Pick<Response, 'ok' | 'json'>> => {
    const url = new URL(input);
    if (url.origin !== 'https://api.example.test') throw new Error(`Unexpected origin: ${url.origin}`);
    switch (url.pathname) {
      case '/api/v1/equity/historical': {
        const gate = gates.shift();
        if (!gate || !init?.signal) throw new Error(`Unexpected history request: ${url.search}`);
        const request = { query: Object.fromEntries(url.searchParams), signal: init.signal };
        requests.push(request);
        gate.started.resolve(request);
        const data = await gate.bodyEvenAfterAbort.promise;
        return { ok: true, json: async () => data };
      }
      case '/api/v1/equity/FPT/quote':
      case '/api/v1/equity/VNM/quote':
        return { ok: true, json: async () => ({ data: null }) };
      case '/api/v1/equity/FPT/events':
      case '/api/v1/equity/VNM/events':
      case '/api/v1/equity/FPT/profile':
      case '/api/v1/equity/VNM/profile':
      case '/api/v1/equity/FPT/ratios':
      case '/api/v1/equity/VNM/ratios':
      case '/api/v1/screener/':
        return { ok: true, json: async () => ({ data: [] }) };
      default:
        throw new Error(`Unexpected route: ${url.pathname}`);
    }
  };
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchFixture });
  return {
    requests,
    next() {
      const gate = historyGate();
      gates.push(gate);
      return {
        started: gate.started.promise,
        async release(body: unknown) {
          await act(async () => { gate.bodyEvenAfterAbort.resolve(body); });
        },
      };
    },
  };
}

beforeEach(() => {
  jest.useFakeTimers({
    now: new Date('2026-11-18T10:30:00Z'),
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
  });
});

afterEach(() => {
  if (fetchDescriptor) Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
  else Reflect.deleteProperty(globalThis, 'fetch');
  jest.useRealTimers();
});

test('publishes only the effective range and ticker history health during request replacement', async () => {
  const history = offlineHistory();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const publications: Publication[] = [];
  const publish = (payload: WidgetDataPayload) => {
    const provenance = payload.__widgetRuntime?.provenance;
    publications.push({
      timeframe: payload.timeframe,
      observation: provenance?.observationStatus ?? null,
      coverage: provenance?.coverage ?? null,
    });
  };
  const view = (symbol: string) => (
    <QueryClientProvider client={client}>
      <PriceChartWidget id="chart" symbol={symbol} onDataChange={publish} />
    </QueryClientProvider>
  );

  const fptYear = history.next();
  const { rerender } = render(view('FPT'));
  await fptYear.started;
  await fptYear.release(partial);
  const fromYear = publications.length;

  const fptMonth = history.next();
  fireEvent.click(screen.getByRole('button', { name: /^1M$/ }));
  await fptMonth.started;
  const monthPending = publications.length;
  await fptMonth.release(unavailable);
  const fromMonth = publications.length;

  const vnmMonth = history.next();
  rerender(view('VNM'));
  const obsolete = await vnmMonth.started;
  const tickerPending = publications.length;

  const vnmWeek = history.next();
  fireEvent.click(screen.getByRole('button', { name: /^5D$/ }));
  await vnmWeek.started;
  const weekPending = publications.length;
  await vnmWeek.release(empty);
  const weekSettled = publications.length;
  await vnmMonth.release(partial);

  const trace = {
    fptYear: publications.slice(0, fromYear),
    fptMonthPending: publications.slice(fromYear, monthPending),
    fptMonthSettled: publications.slice(monthPending, fromMonth),
    vnmMonthPending: publications.slice(fromMonth, tickerPending),
    vnmWeekPending: publications.slice(tickerPending, weekPending),
    vnmWeekSettled: publications.slice(weekPending, weekSettled),
    afterObsolete: publications.slice(weekSettled),
  };
  const queries = history.requests.map(request => request.query);
  if (process.env.PRICE_HISTORY_TRACE === '1') {
    console.info('PRICE_HISTORY_TRACE ' + JSON.stringify({ trace, queries, obsoleteAborted: obsolete.signal.aborted }));
  }

  expect(queries).toEqual([
    { symbol: 'FPT', start_date: '2025-11-18', end_date: '2026-11-18', interval: '1D', adjustment_mode: 'adjusted' },
    { symbol: 'FPT', start_date: '2026-10-18', end_date: '2026-11-18', interval: '1D', adjustment_mode: 'adjusted' },
    { symbol: 'VNM', start_date: '2026-10-18', end_date: '2026-11-18', interval: '1D', adjustment_mode: 'adjusted' },
    { symbol: 'VNM', start_date: '2026-11-11', end_date: '2026-11-18', interval: '1D', adjustment_mode: 'adjusted' },
  ]);
  expect(obsolete.signal.aborted).toBe(true);
  expect(trace.fptYear.at(-1)).toEqual({ timeframe: '1Y', observation: 'available', coverage: 'partial' });
  expect(trace.fptMonthSettled.at(-1)).toEqual({ timeframe: '1M', observation: 'unavailable', coverage: null });
  expect(trace.vnmWeekSettled.at(-1)).toEqual({ timeframe: '5D', observation: 'empty', coverage: null });
  expect(trace.afterObsolete).toEqual([]);
  const pending = [trace.fptMonthPending, trace.vnmMonthPending, trace.vnmWeekPending];
  expect(pending.map(entries => entries.length > 0)).toEqual([true, true, true]);
  expect(pending).toEqual([
    trace.fptMonthPending.map(() => ({ timeframe: '1M', observation: 'loading', coverage: null })),
    trace.vnmMonthPending.map(() => ({ timeframe: '1M', observation: 'loading', coverage: null })),
    trace.vnmWeekPending.map(() => ({ timeframe: '5D', observation: 'loading', coverage: null })),
  ]);
}, 8000);
