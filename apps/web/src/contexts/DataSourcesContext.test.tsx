import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { DataSourcesProvider } from './DataSourcesContext';
import { AppProvider, useDataSourcePreference } from './AppContext';
import { useScreenerData as useFacadeScreener } from '@/lib/queries';
import { useScreenerData as useModularScreener } from '@/lib/queries/screener';

jest.mock('@/lib/env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }));

const sourceKey = 'vnibb_vnstock_source';
const stateKey = 'vnibb_data_sources';
const originalFetch = globalThis.fetch;
const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{ symbol: 'FPT', source: 'KBS' }], count: 1 }),
  } as Response);
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  localStorage.clear();
});

function ScreenerConsumer({ useScreener }: { useScreener: typeof useModularScreener }) {
  const query = useScreener({ symbol: 'FPT' });
  return <output>{query.data?.data[0]?.source as string ?? 'Loading'}</output>;
}

describe.each([
  ['facade', useFacadeScreener],
  ['modular', useModularScreener],
] as const)('%s screener provider contract', (_name, useScreener) => {
  test.each([null, 'KBS', 'MSN', 'FMP', 'TCBS', 'DNSE', 'vci'])('requests VCI and replaces saved selection %s without rewriting lineage', async (savedSource) => {
    if (savedSource !== null) localStorage.setItem(sourceKey, savedSource);
    localStorage.setItem(stateKey, JSON.stringify({ dataSources: [], vnstockSource: savedSource }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      render(
        <QueryClientProvider client={client}>
          <DataSourcesProvider>
            <ScreenerConsumer useScreener={useScreener} />
          </DataSourcesProvider>
        </QueryClientProvider>,
      );

      await waitFor(() => expect(screen.getByText('KBS')).toBeInTheDocument());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = new URL(String(fetchMock.mock.calls[0][0]));
      expect(url.pathname).toBe('/api/v1/screener/');
      expect(url.searchParams.get('source')).toBe('VCI');
      expect(localStorage.getItem(sourceKey)).toBe('VCI');
      expect(JSON.parse(localStorage.getItem(stateKey)!)).not.toHaveProperty('vnstockSource');
    } finally {
      client.clear();
    }
  });

  test('requests VCI when mounted without a source settings provider', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      render(
        <QueryClientProvider client={client}>
          <ScreenerConsumer useScreener={useScreener} />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('source')).toBe('VCI');
    } finally {
      client.clear();
    }
  });
});

function AppPreferenceConsumer() {
  const { preferredVnstockSource } = useDataSourcePreference();
  return <output>{preferredVnstockSource}</output>;
}

test.each(['KBS', 'MSN', 'FMP', 'TCBS', 'DNSE'])('unified app preferences replace saved %s with VCI', (savedSource) => {
  localStorage.setItem(sourceKey, savedSource);
  render(<AppProvider><AppPreferenceConsumer /></AppProvider>);
  expect(screen.getByText('VCI')).toBeInTheDocument();
  expect(localStorage.getItem(sourceKey)).toBe('VCI');
});
