import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DatabaseInspectorWidget } from './DatabaseInspectorWidget';
import { useAuth } from '@/contexts/AuthContext';
import { fetchAPI } from '@/lib/api';

jest.mock('@/contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/api', () => ({ fetchAPI: jest.fn() }));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));
jest.mock('@/components/ui/VirtualizedTable', () => ({
  VirtualizedTable: ({ data }: { data: unknown[] }) => <div>Sample rows: {data.length}</div>,
}));

const mockedAuth = jest.mocked(useAuth);
const mockedFetch = jest.mocked(fetchAPI);

function renderInspector(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <DatabaseInspectorWidget />
    </QueryClientProvider>,
  );
}

let operatorId: string | null = null;

function setOperator(id: string | null) {
  operatorId = id;
}

beforeEach(() => {
  jest.clearAllMocks();
  setOperator(null);
  mockedAuth.mockImplementation(() => ({
    user: operatorId ? { id: operatorId, provider: 'supabase' } : null,
    isAdmin: Boolean(operatorId),
    adminStatus: operatorId ? 'authorized' : 'denied',
  }) as unknown as Parameters<typeof mockedAuth.mockReturnValue>[0]);
  mockedFetch.mockImplementation(async (endpoint) => {
    if (endpoint === '/admin/database/stats') {
      return { tables: [{ name: 'stocks', count: 1 }], last_checked: '2026-09-01T00:00:00Z' };
    }
    return { rows: [{ symbol: 'VNM' }] };
  });
});

test('denies local access without a verified operator, then fetches signed-in operator stats and sample', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderInspector(queryClient);
  expect(screen.getByText(/Admin access required/)).toBeInTheDocument();
  expect(mockedFetch).not.toHaveBeenCalled();

  setOperator('operator-a');
  view.rerender(<QueryClientProvider client={queryClient}><DatabaseInspectorWidget key="operator-a" /></QueryClientProvider>);
  await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
  expect(queryClient.getQueryState(['adminDatabase', 'operator-a', 'stats'])?.error).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: /stocks \(1\)/i })).toBeInTheDocument());
  expect(mockedFetch).toHaveBeenCalledWith('/admin/database/stats', { auth: 'required' });

  fireEvent.click(screen.getByRole('button', { name: /stocks \(1\)/i }));
  await waitFor(() => expect(screen.getByText('Sample rows: 1')).toBeInTheDocument());
  expect(mockedFetch).toHaveBeenCalledWith('/admin/database/sample/stocks', { auth: 'required', params: { limit: 500 } });

  setOperator(null);
  view.rerender(<QueryClientProvider client={queryClient}><DatabaseInspectorWidget key="signed-out" /></QueryClientProvider>);
  expect(screen.queryByText('Sample rows: 1')).not.toBeInTheDocument();
  await waitFor(() => expect(queryClient.getQueryData(['adminDatabase', 'operator-a', 'stats'])).toBeUndefined());
  expect(screen.getByText(/Admin access required/)).toBeInTheDocument();

  setOperator('operator-b');
  view.rerender(<QueryClientProvider client={queryClient}><DatabaseInspectorWidget key="operator-b" /></QueryClientProvider>);
  await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(3));
  expect(queryClient.getQueryData(['adminDatabase', 'operator-b', 'stats'])).toBeDefined();
});

test('surfaces permission failure instead of rendering it as empty data', async () => {
  setOperator('operator-a');
  mockedFetch.mockRejectedValue(new Error('Forbidden: admin role not granted'));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderInspector(queryClient);
  await waitFor(() => expect(screen.getByText('Access Denied')).toBeInTheDocument());
  expect(screen.queryByText('No tables found')).not.toBeInTheDocument();
});
