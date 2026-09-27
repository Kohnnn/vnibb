import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSymbolsByGroup } from '@/lib/queries';
import * as api from '@/lib/api';
import { widgetRegistry } from './WidgetRegistry';

jest.mock('@/lib/queries', () => ({ useSymbolsByGroup: jest.fn() }));
jest.mock('@/lib/api', () => ({ getTransactionFlow: jest.fn() }));
const universeQuery = jest.mocked(useSymbolsByGroup);
const Positioning = widgetRegistry.get('positioning_dashboard')!.component;

function showPositioning(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={client}>
      <React.Suspense fallback={<span>Loading widget</span>}>
        <Positioning id="saved-positioning" symbol="FPT" />
      </React.Suspense>
    </QueryClientProvider>
  );
}

function showPositioningWithParentState(client: QueryClient) {
  let emissions = 0;
  function Parent() {
    const [, setPayload] = React.useState<unknown>();
    const onDataChange = (payload: unknown) => {
      if (++emissions > 12) throw new Error('Positioning emitted unchanged data repeatedly');
      setPayload(payload);
    };
    return <Positioning id="saved-positioning" symbol="FPT" onDataChange={onDataChange} />;
  }
  render(<QueryClientProvider client={client}><Parent /></QueryClientProvider>);
  return () => emissions;
}

describe('positioning_dashboard saved dashboard widget', () => {
  it('emits once when its parent stores loading-state data', async () => {
    universeQuery.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: jest.fn() } as never);
    const emissions = showPositioningWithParentState(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await waitFor(() => expect(emissions()).toBe(1));
    expect(emissions()).toBe(1);
  });

  it('emits once when its parent stores loaded flow data', async () => {
    universeQuery.mockReturnValue({
      data: { data: [{ symbol: 'FPT' }] }, isLoading: false, error: null, refetch: jest.fn(),
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['transactionFlow', 'FPT', 5], {
      data: { data: [{ date: '2025-06-01', foreign_net_value: 1000000000 }] },
    });
    const emissions = showPositioningWithParentState(client);
    await screen.findByRole('button', { name: 'FPT' });
    expect(emissions()).toBe(1);
  });

  it('emits a new payload when loading resolves without echoing parent rerenders', async () => {
    universeQuery.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: jest.fn() } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['transactionFlow', 'FPT', 5], {
      data: { data: [{ date: '2025-06-01', foreign_net_value: 1000000000 }] },
    });
    const payloads: unknown[] = [];
    function Parent() {
      const [, setPayload] = React.useState<unknown>();
      return <Positioning id="saved-positioning" symbol="FPT" onDataChange={(payload: unknown) => {
        if (payloads.push(payload) > 12) throw new Error('Positioning emitted unchanged data repeatedly');
        setPayload(payload);
      }} />;
    }
    const view = render(<QueryClientProvider client={client}><Parent /></QueryClientProvider>);
    expect(payloads).toHaveLength(1);
    universeQuery.mockReturnValue({
      data: { data: [{ symbol: 'FPT' }] }, isLoading: false, error: null, refetch: jest.fn(),
    } as never);
    view.rerender(<QueryClientProvider client={client}><Parent /></QueryClientProvider>);
    await screen.findByRole('button', { name: 'FPT' });
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toMatchObject({ rows: [{ symbol: 'FPT', foreign_net: 1000000000 }] });
  });
  it('distinguishes failed universe lookup from a valid universe with no flow', async () => {
    universeQuery.mockReturnValue({
      data: undefined, isLoading: false, error: new Error('Universe feed unavailable'),
      refetch: jest.fn(),
    } as never);
    showPositioning();
    expect(await screen.findByText('Universe feed unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No investor-bucket flow available')).not.toBeInTheDocument();
  });

  it('honestly displays an empty universe without implying a fetch failure', async () => {
    universeQuery.mockReturnValue({
      data: { data: [] }, isLoading: false, error: null, refetch: jest.fn(),
    } as never);
    showPositioning();
    expect(await screen.findByText('No investor-bucket flow available')).toBeInTheDocument();
    expect(screen.getByText('0/0 with flow')).toBeInTheDocument();
  });

  it('keeps available symbols visible alongside symbols without investor flow', async () => {
    universeQuery.mockReturnValue({
      data: { data: [{ symbol: 'FPT' }, { symbol: 'VCB' }] }, isLoading: false, error: null,
      refetch: jest.fn(),
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['transactionFlow', 'FPT', 5], {
      data: { data: [{ date: '2025-06-01', foreign_net_value: 1000000000, proprietary_net_value: -1000000000 }] },
    });
    client.setQueryData(['transactionFlow', 'VCB', 5], { data: { data: [] } });
    showPositioning(client);
    const fpt = await screen.findByRole('button', { name: 'FPT' });
    expect(fpt.closest('tr')).toHaveTextContent('+1.0B');
    expect(screen.getByRole('button', { name: 'VCB' }).closest('tr')).toHaveTextContent('—');
    expect(screen.getByText('1/2 with flow')).toBeInTheDocument();
  });

  it('keeps null investor buckets unknown even when the total is positive, while displaying measured zero', async () => {
    universeQuery.mockReturnValue({
      data: { data: [{ symbol: 'FPT' }, { symbol: 'VCB' }] }, isLoading: false, error: null,
      refetch: jest.fn(),
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['transactionFlow', 'FPT', 5], {
      data: { data: [{ date: '2025-06-01', total_net_value: 1000000000, foreign_net_value: null, proprietary_net_value: null, domestic_net_value: null }] },
    });
    client.setQueryData(['transactionFlow', 'VCB', 5], {
      data: { data: [{ date: '2025-06-01', total_net_value: 0, foreign_net_value: 0, proprietary_net_value: null, domestic_net_value: null }] },
    });
    showPositioning(client);
    const unknown = (await screen.findByRole('button', { name: 'FPT' })).closest('tr')!;
    expect(Array.from(unknown.querySelectorAll('td')).map((cell) => cell.textContent?.trim())).toEqual(['FPT', '—', '—', '—', '+1.0B']);
    const measured = screen.getByRole('button', { name: 'VCB' }).closest('tr')!;
    expect(Array.from(measured.querySelectorAll('td')).map((cell) => cell.textContent?.trim())).toEqual(['VCB', '0', '—', '—', '0']);
    expect(screen.getByText('1/2 with flow')).toBeInTheDocument();
  });

  it('shows a failed flow request instead of saying the symbol has no flow', async () => {
    universeQuery.mockReturnValue({
      data: { data: [{ symbol: 'FPT' }] }, isLoading: false, error: null,
      refetch: jest.fn(),
    } as never);
    jest.mocked(api.getTransactionFlow).mockRejectedValue(new Error('Flow service unavailable'));
    showPositioning();
    expect(await screen.findByText('Flow service unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No investor-bucket flow available')).not.toBeInTheDocument();
  });

  it('retains cached symbols and names the failed refresh instead of hiding the rows', async () => {
    universeQuery.mockReturnValue({
      data: { data: [{ symbol: 'FPT' }] }, isLoading: false, error: null,
      refetch: jest.fn(),
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['transactionFlow', 'FPT', 5], {
      data: { data: [{ date: '2025-06-01', foreign_net_value: 1000000000 }] },
    });
    jest.mocked(api.getTransactionFlow).mockRejectedValue(new Error('Flow refresh unavailable'));
    client.invalidateQueries({ queryKey: ['transactionFlow', 'FPT', 5] });
    showPositioning(client);
    expect(await screen.findByRole('button', { name: 'FPT' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Some flow data is unavailable: Flow refresh unavailable');
  });

  it('preserves a healthy symbol while another symbol request fails', async () => {
    universeQuery.mockReturnValue({
      data: { data: [{ symbol: 'FPT' }, { symbol: 'VCB' }] }, isLoading: false, error: null,
      refetch: jest.fn(),
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['transactionFlow', 'FPT', 5], {
      data: { data: [{ date: '2025-06-01', foreign_net_value: 1000000000 }] },
    });
    jest.mocked(api.getTransactionFlow).mockRejectedValue(new Error('VCB flow unavailable'));
    showPositioning(client);
    expect(await screen.findByRole('button', { name: 'FPT' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Some flow data is unavailable: VCB flow unavailable');
    expect(screen.getByText('1/2 with flow')).toBeInTheDocument();
  });
});
