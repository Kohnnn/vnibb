import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback } from 'react';
import { buildVniAgentWorkspaceContext } from '@/lib/vniagentWorkspace';
import { formatAbsoluteTimestamp } from '@/lib/formatDate';
import type { WidgetDataPayload } from '@/lib/widgetRuntime';
import { OfficersManagementWidget } from './OfficersManagementWidget';
import { SubsidiariesWidget } from './SubsidiariesWidget';
import { WidgetWrapper } from './WidgetWrapper';

let mockSymbol = 'HPG';

jest.mock('@/lib/env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }));
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

const cases = [
  {
    Widget: OfficersManagementWidget, title: 'Officers & Management', type: 'officers_management', route: 'officers',
    name: 'Fixture executive', row: { symbol: 'HPG', name: 'Fixture executive', position: 'Director', shares_owned: 100 },
  },
  {
    Widget: SubsidiariesWidget, title: 'Subsidiaries', type: 'subsidiaries', route: 'subsidiaries',
    name: 'Fixture subsidiary', row: { symbol: 'HPG', company_name: 'Fixture subsidiary', ownership_pct: 75 },
  },
] as const;

const firstFetch = '2026-11-23T05:00:00.000Z';
const laterFetch = '2026-11-23T05:20:00.000Z';
const sourceDate = '2026-10-30';
const debug = 'private upstream diagnostic';
const fallback = [{ name: 'Unscoped fallback' }];
const empty = { data: [], meta: { count: 0 }, error: null };
const receiptTitle = 'Retrieval time does not establish source freshness';
const originalFetch = globalThis.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function httpJson(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body } as Response;
}

const referenceFetch = jest.fn<Promise<Response>, [string]>();
const captureDownload = jest.fn<string, [Blob]>(() => 'blob:reference');
let clock: jest.SpyInstance<number, []>;

beforeEach(() => {
  mockSymbol = 'HPG';
  referenceFetch.mockReset();
  captureDownload.mockClear();
  clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(firstFetch));
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/profile')) return httpJson({ data: { exchange: 'HOSE' } });
    return referenceFetch(path);
  });
  URL.createObjectURL = captureDownload;
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  jest.restoreAllMocks();
});

function mount({ Widget, title, type }: typeof cases[number]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCopilotClick = jest.fn<void, [context?: Record<string, unknown>]>();
  const publish = jest.fn<void, [WidgetDataPayload]>();
  const user = userEvent.setup();

  function ReferencePublisher({ id, symbol, onDataChange }: {
    id: string; symbol: string; onDataChange?: (data: WidgetDataPayload) => void;
  }) {
    const relay = useCallback((data: WidgetDataPayload) => {
      publish(data);
      onDataChange?.(data);
    }, [onDataChange]);
    return <Widget id={id} symbol={symbol} onDataChange={relay} />;
  }

  const tree = () => (
    <QueryClientProvider client={client}>
      <WidgetWrapper id="reference" title={title} widgetType={type} dashboardId="fixture" tabId="ownership"
        showGroupLabels={false} data={fallback} onCopilotClick={onCopilotClick}>
        <ReferencePublisher id="reference" symbol={mockSymbol} />
      </WidgetWrapper>
    </QueryClientProvider>
  );
  const view = render(tree());

  return {
    client, user,
    body: () => within(screen.getByRole('region', { name: `${title} content` })),
    published: () => publish.mock.lastCall?.[0].__widgetRuntime,
    select: (symbol: string) => { mockSymbol = symbol; view.rerender(tree()); },
    dispose: () => { view.unmount(); client.clear(); },
    async agent() {
      await user.click(screen.getByRole('button', { name: 'Open VniAgent' }));
      const widgetPayload = onCopilotClick.mock.lastCall?.[0];
      if (!widgetPayload) throw new Error('No widget context published to VniAgent');
      return buildVniAgentWorkspaceContext({ widgetTypeKey: type, symbol: mockSymbol, widgetPayload }).widgetPayload;
    },
    async download(format: 'CSV' | 'JSON') {
      captureDownload.mockClear();
      await user.click(screen.getByRole('button', { name: `Widget actions for ${title}` }));
      await user.click(screen.getByRole('menuitem', { name: 'Export' }));
      await user.click(screen.getByRole('menuitem', { name: `Export as ${format}` }));
      const [blob] = captureDownload.mock.lastCall ?? [];
      if (!blob) throw new Error(`No ${format} downloaded`);
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
      return promise;
    },
  };
}

describe.each(cases)('$title', fixture => {
  const { route, name, row } = fixture;

  test('does not publish entities during loading or HTTP-200 provider failure; retry can return a successful empty result', async () => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    referenceFetch.mockReturnValueOnce(promise).mockResolvedValueOnce(httpJson(empty));
    const widget = mount(fixture);
    try {
      expect(widget.body().getByRole('status', { name: 'Loading records' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Data status: Loading' })).toBeInTheDocument();
      expect(widget.body().queryByText(/\b0 (executives|subsidiaries)\b/i)).not.toBeInTheDocument();
      expect(widget.published()?.exportData).toBeNull();

      await act(async () => resolve(httpJson({ ...empty, error: `Provider unavailable: ${debug}` })));
      expect(await widget.body().findByText('Data unavailable for HPG')).toBeInTheDocument();
      expect(widget.body().getByText('Provider unavailable')).toBeInTheDocument();
      expect(widget.body().queryByText(/No records returned|\b0 (executives|subsidiaries)\b/i)).not.toBeInTheDocument();
      expect(widget.body().queryByTitle(receiptTitle)).not.toBeInTheDocument();
      const provenance = {
        observationStatus: 'unavailable', refreshStatus: 'failed', failureKind: 'envelope',
        coverage: 'unknown', updatedAt: null, fetchedAt: null, failedAt: firstFetch, warnings: ['Provider unavailable'],
      };
      expect(widget.published()).toMatchObject({ requestScope: { symbol: 'HPG', widgetType: fixture.type },
        exportData: null, provenance });

      const status = screen.getByRole('button', { name: 'Data status: Unavailable' });
      await widget.user.click(status);
      expect(screen.getByText('Failed at', { exact: true, selector: 'span' })).toBeInTheDocument();
      expect(screen.getAllByText('Provider unavailable')).toHaveLength(2);
      await widget.user.click(status);
      const agent = await widget.agent();
      expect(agent).toMatchObject({ symbol: 'HPG', dataSample: null, dataProvenance: provenance });
      expect(JSON.stringify(agent)).not.toContain(debug);
      const json = JSON.parse(await widget.download('JSON'));
      expect(json).toMatchObject({ data: null, _provenance: { symbol: 'HPG', ...provenance } });
      const failedCSV = await widget.download('CSV');
      expect(failedCSV).toContain('# observation_status,unavailable');
      expect(failedCSV).toContain(`# failed_at,${firstFetch}`);
      expect(failedCSV).toContain('# warnings,Provider unavailable');
      expect(failedCSV.trimEnd().split('\n').every(line => line.startsWith('# '))).toBe(true);
      expect(failedCSV).not.toMatch(/fetched_at|Unscoped fallback|private upstream/);

      clock.mockReturnValue(Date.parse(laterFetch));
      await widget.user.click(widget.body().getByRole('button', { name: 'Retry' }));
      expect(await widget.body().findByText('No records returned for HPG')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Data status: No observations' })).toBeInTheDocument();
      expect(widget.body().queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
      expect(widget.body().getByText('As-of unknown')).toBeInTheDocument();
      expect(widget.body().getByTitle(receiptTitle)).toHaveTextContent(formatAbsoluteTimestamp(laterFetch));
      const emptyProvenance = { observationStatus: 'empty', refreshStatus: 'succeeded', coverage: 'unknown', updatedAt: null, fetchedAt: laterFetch };
      expect(widget.published()).toMatchObject({ exportData: [], provenance: emptyProvenance });
      expect(await widget.agent()).toMatchObject({ dataSample: null, dataProvenance: emptyProvenance });
      expect(JSON.parse(await widget.download('JSON'))).toMatchObject({ data: [], _provenance: emptyProvenance });
      const emptyCSV = await widget.download('CSV');
      expect(emptyCSV).toContain('# observation_status,empty');
      expect(emptyCSV).not.toMatch(/failed_at|warnings/);
      expect(emptyCSV.trimEnd().split('\n').every(line => line.startsWith('# '))).toBe(true);
      expect(referenceFetch.mock.calls).toEqual([[`/api/v1/equity/HPG/${route}`], [`/api/v1/equity/HPG/${route}`]]);
    } finally {
      widget.dispose();
    }
  });

  test('retains only same-symbol successful rows, with separate as-of, fetched and failed timestamps', async () => {
    const unverifiedFields = route === 'subsidiaries' ? { charter_capital: 1000 } : {};
    referenceFetch.mockResolvedValueOnce(httpJson({ data: [{ ...row, ...unverifiedFields, raw_data: { debug } }],
      meta: { count: 1, last_data_date: sourceDate }, error: null }));
    const widget = mount(fixture);
    try {
      expect(await widget.body().findByText(name)).toBeInTheDocument();
      expect(widget.body().queryByText(/Capital:/)).not.toBeInTheDocument();
      expect(widget.body().getByText(`As of ${sourceDate}`)).toBeInTheDocument();

      clock.mockReturnValue(Date.parse(laterFetch));
      referenceFetch.mockResolvedValueOnce(httpJson({ data: [{ ...row, name: debug, company_name: debug }],
        error: `Provider request timed out: ${debug}`, meta: { count: 1, last_data_date: '2026-11-23' } }));
      await act(async () => { await widget.client.refetchQueries({ queryKey: [route, 'HPG'], exact: true }); });
      expect(await widget.body().findByText('Refresh failed. Showing previous records.')).toBeInTheDocument();
      expect(widget.body().getByText(name)).toBeInTheDocument();
      expect(widget.body().queryByText(debug)).not.toBeInTheDocument();
      expect(widget.body().getByText(`As of ${sourceDate}`)).toBeInTheDocument();
      expect(widget.body().getByTitle(receiptTitle)).toHaveTextContent(formatAbsoluteTimestamp(firstFetch));
      expect(widget.body().getByRole('button', { name: 'Retry' })).toBeEnabled();
      const provenance = { observationStatus: 'available', refreshStatus: 'failed', failureKind: 'envelope',
        updatedAt: sourceDate, fetchedAt: firstFetch, failedAt: laterFetch, cached: true, warnings: ['Provider request timed out'] };
      expect(widget.published()).toMatchObject({ exportData: [row], provenance });
      const status = screen.getByRole('button', { name: 'Data status: Stale' });
      await widget.user.click(status);
      expect(screen.getAllByText('Provider request timed out')).toHaveLength(2);
      expect(screen.getByText('Fetched at')).toBeInTheDocument();
      expect(screen.getByText('Failed at', { exact: true, selector: 'span' })).toBeInTheDocument();
      await widget.user.click(status);
      const agentContext = await widget.agent();
      expect(agentContext).toMatchObject({ symbol: 'HPG', dataSample: [row], dataProvenance: provenance });
      const json = await widget.download('JSON');
      expect(JSON.parse(json)).toMatchObject({ data: [row], _provenance: { symbol: 'HPG', ...provenance } });
      const csv = await widget.download('CSV');
      expect(csv).toContain(`# source_as_of,${sourceDate}`);
      expect(csv).toContain(`# fetched_at,${firstFetch}`);
      expect(csv).toContain(`# failed_at,${laterFetch}`);
      expect(csv).toContain('# refresh_status,failed');
      expect(csv).toContain(`# warnings,Provider request timed out`);
      expect(csv.split('\n').filter(line => !line.startsWith('# '))).toEqual([expect.stringContaining('symbol'), expect.stringContaining(name)]);
      expect(JSON.stringify(agentContext) + json + csv).not.toMatch(/raw_data|charter_capital|private upstream/);

      const { promise, resolve } = Promise.withResolvers<Response>();
      referenceFetch.mockReturnValueOnce(promise);
      widget.select('FPT');
      expect(widget.body().getByRole('status', { name: 'Loading records' })).toBeInTheDocument();
      expect(widget.body().queryByText(name)).not.toBeInTheDocument();
      expect(await widget.agent()).toMatchObject({ symbol: 'FPT', dataSample: null, dataProvenance: { observationStatus: 'loading' } });
      await act(async () => resolve(httpJson({ detail: debug }, 503)));
      expect(await widget.body().findByText('Request failed (HTTP 503)')).toBeInTheDocument();
      expect(widget.body().queryByText(/\b0 (executives|subsidiaries)\b/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Data status: Unavailable' })).toBeInTheDocument();
      await waitFor(() => expect(widget.published()).toMatchObject({ requestScope: { symbol: 'FPT' }, exportData: null,
        provenance: { observationStatus: 'unavailable', refreshStatus: 'failed', failureKind: 'request', updatedAt: null, fetchedAt: null } }));
      const agent = await widget.agent();
      expect(agent).toMatchObject({ symbol: 'FPT', dataSample: null,
        dataProvenance: { failureKind: 'request', warnings: ['Request failed (HTTP 503)'] } });
      expect(JSON.stringify(agent)).not.toMatch(/Unscoped fallback|private upstream|Fixture executive|Fixture subsidiary/);

      referenceFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await widget.user.click(widget.body().getByRole('button', { name: 'Retry' }));
      expect(await widget.body().findByText('Could not reach the server')).toBeInTheDocument();
      expect(widget.body().queryByText(name)).not.toBeInTheDocument();
      expect(widget.published()).toMatchObject({ exportData: null, provenance: {
        observationStatus: 'unavailable', failureKind: 'request', warnings: ['Could not reach the server'],
      } });
      expect(referenceFetch.mock.calls).toEqual([
        [`/api/v1/equity/HPG/${route}`], [`/api/v1/equity/HPG/${route}`],
        [`/api/v1/equity/FPT/${route}`], [`/api/v1/equity/FPT/${route}`],
      ]);
    } finally {
      widget.dispose();
    }
  });
});
