import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery, useQueries } from '@tanstack/react-query';
import type * as ReactQuery from '@tanstack/react-query';
import { useWebSocket, type UseWebSocketReturn } from '@/lib/hooks/useWebSocket';
import { parseWatchlistSymbols, WatchlistWidget } from './WatchlistWidget';
import { useDashboard } from '@/contexts/DashboardContext';
import { useDashboardWidget } from '@/hooks/useDashboardWidget';
import * as api from '@/lib/api';
import type { QuoteResponse } from '@/lib/api';

jest.mock('@tanstack/react-query', () => ({
    ...jest.requireActual('@tanstack/react-query'), useQuery: jest.fn(), useQueries: jest.fn(),
}));
jest.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: jest.fn() }));
jest.mock('@/lib/api', () => ({
    ...jest.requireActual('@/lib/api'), getSymbols: jest.fn(), getQuote: jest.fn(),
}));

const setLinkedSymbol = jest.fn();

jest.mock('@/contexts/DashboardContext', () => ({ useDashboard: jest.fn() }));
jest.mock('@/hooks/useDashboardWidget', () => ({ useDashboardWidget: jest.fn() }));

jest.mock('@/hooks/useWidgetSymbolLink', () => ({
    useWidgetSymbolLink: () => ({ setLinkedSymbol }),
}));

jest.mock('@/components/ui/WidgetContainer', () => ({
    WidgetContainer: ({ children, title }: { children: ReactNode; title: string }) => <section><h2>{title}</h2>{children}</section>,
}));

jest.mock('@/components/ui/WidgetMeta', () => ({
    WidgetMeta: ({ updatedAt, fetchedAt, isCached, note, sourceLabel }: { updatedAt?: Date | null; fetchedAt?: Date | null; isCached?: boolean; note?: string; sourceLabel?: string }) => <><div>{`${note ?? ''}|${fetchedAt ? 'Received' : 'No receipt'}|${isCached ? 'Cached' : 'Current'}|${updatedAt ? 'Known as-of' : 'As-of unknown'}`}</div><span>{sourceLabel}</span></>,
}));

jest.mock('@/components/ui/widget-states', () => ({
    WidgetEmpty: ({ message }: { message: string }) => <div>{message}</div>,
}));

const updateWidget = jest.fn();
const dashboardWidget = { dashboardId: 'dashboard', tabId: 'tab', widget: { config: { watchlistSymbols: ['VCI'] } } };
jest.mocked(useDashboard).mockImplementation(() => ({ updateWidget }) as never);
jest.mocked(useDashboardWidget).mockImplementation(() => dashboardWidget as never);

const mockUseQuery = jest.mocked(useQuery);
const mockUseWebSocket = jest.mocked(useWebSocket);

function socketResult(prices = new Map(), isConnected = false, lastUpdate: Date | null = null): UseWebSocketReturn {
    return {
        prices,
        isConnected,
        isReceiving: false,
        protocolError: null,
        lastUpdate,
        marketStatus: null,
        reconnect: jest.fn(),
    };
}

function renderWatchlist(symbols: string[]) {
    return render(<WatchlistWidget id="watchlist" config={{ watchlistSymbols: symbols }} widgetGroup="A" />);
}

describe('WatchlistWidget quotes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        dashboardWidget.widget.config = { watchlistSymbols: ['VCI'] };
        mockUseQuery.mockReturnValue({ data: { data: [] } } as ReturnType<typeof useQuery>);
        jest.mocked(useQueries).mockReturnValue([]);
        mockUseWebSocket.mockReturnValue(socketResult());
    });

    it('normalizes, trims, and deduplicates configured symbols in first-seen order', () => {
        expect(parseWatchlistSymbols({ watchlistSymbols: [' fpt.vn ', 'FPT', '', 'vnm', 'invalid', 1] })).toEqual(['FPT', 'VNM']);
    });

    it('shows unavailable unknown quotes without a synthetic zero', () => {
        renderWatchlist(['VCI']);

        expect(screen.getByText('Unavailable')).toBeInTheDocument();
        expect(screen.getAllByText('—')).toHaveLength(2);
        expect(screen.queryByText('0')).not.toBeInTheDocument();
        expect(screen.getByText('Disconnected · Unavailable|No receipt|Current|As-of unknown')).toBeInTheDocument();
    });

    it('shows observed values and the global quote receipt status', () => {
        mockUseWebSocket.mockReturnValue(socketResult(new Map([
            ['VCI', { symbol: 'VCI', price: 42, change: 1, change_pct: 2.38, direction: 'up', previousPrice: 41 }],
        ]), true, new Date('2026-07-18T10:00:00Z')));

        renderWatchlist(['VCI']);

        expect(screen.getByText('42')).toBeInTheDocument();
        expect(screen.getByText('+2.38%')).toBeInTheDocument();
        expect(screen.getByText('Connected · Stored or observed quote|Received|Current|As-of unknown')).toBeInTheDocument();
    });

    it('retains and labels the last observed quote after disconnect', () => {
        mockUseWebSocket.mockReturnValue(socketResult(new Map([
            ['VCI', { symbol: 'VCI', price: 42, change: 1, change_pct: 2.38, direction: 'up', previousPrice: 41 }],
        ]), false, new Date('2026-07-18T10:00:00Z')));

        renderWatchlist(['VCI']);

        expect(screen.getByText('42')).toBeInTheDocument();
        expect(screen.getByText('Disconnected · Cached quote receipt|Received|Cached|As-of unknown')).toBeInTheDocument();
    });

    it('seeds a closed-session watchlist from admitted stored quotes', () => {
        jest.mocked(useQueries).mockReturnValue([{ data: {
            symbol: 'VCI', price: 42000, price_unit: 'VND', change: null,
            changePct: null, volume: null, updatedAt: '2026-10-21T00:00:00',
            asOf: '2026-10-21T00:00:00+07:00', stale: true, source: 'postgres:stored_quote',
        } }] as never);
        renderWatchlist(['VCI']);
        const priceCell = screen.getByRole('button', { name: 'View VCI' }).querySelectorAll('td')[1];
        expect(Number(priceCell.textContent?.replace(/\D/g, ''))).toBe(42000);
        expect(screen.getByText('Disconnected · Cached quote receipt|No receipt|Cached|Known as-of')).toBeInTheDocument();
        expect(screen.getByText('HTTP quote · postgres:stored_quote · Supplier unknown')).toBeInTheDocument();
    });

    it('does not overlay an older stream observation on a newer stored quote', () => {
        jest.mocked(useQueries).mockReturnValue([{ data: {
            symbol: 'VCI', price: 43000, price_unit: 'VND', updatedAt: '2026-10-22T10:00:00+07:00',
            asOf: '2026-10-22T10:00:00+07:00',
        } }] as never);
        mockUseWebSocket.mockReturnValue(socketResult(new Map([['VCI', {
            symbol: 'VCI', price: 42000, as_of: '2026-10-21T10:00:00+07:00', stale: true,
        }]]), true));
        renderWatchlist(['VCI']);
        const priceCell = screen.getByRole('button', { name: 'View VCI' }).querySelectorAll('td')[1];
        expect(Number(priceCell.textContent?.replace(/\D/g, ''))).toBe(43000);
    });

    it('retains HTTP values and exposes refresh failure with truthful provenance', async () => {
        const actualQuery = jest.requireActual<typeof ReactQuery>('@tanstack/react-query');
        jest.mocked(useQuery).mockImplementation(actualQuery.useQuery);
        jest.mocked(useQueries).mockImplementation(actualQuery.useQueries);
        jest.mocked(api.getSymbols).mockResolvedValue({ count: 0, data: [] });
        jest.mocked(api.getQuote).mockResolvedValue({ data: {
            symbol: 'VCI', price: 42000, price_unit: 'VND', updatedAt: '2026-10-23T12:30:00',
            open: null, high: null, low: null, prevClose: null, change: null, changePct: null,
            volume: null, value: null,
        }, error: 'Live quote unavailable; showing stored price.', meta: {
            source: 'postgres:stored_quote', upstream_source: 'vnstock_vnd:VCI',
            as_of: '2025-01-09T00:00:00+07:00', stale: true,
        } } as never);
        mockUseWebSocket.mockReturnValue({ ...socketResult(new Map(), true), protocolError: 'subscription_limit' });
        const onDataChange = jest.fn();
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
        const view = render(<QueryClientProvider client={client}><WatchlistWidget id="watchlist" config={{ watchlistSymbols: ['VCI'] }} onDataChange={onDataChange} /></QueryClientProvider>);
        try {
            expect(await screen.findByText('VCI: Live quote unavailable; showing stored price.')).toBeVisible();
            const priceCell = screen.getByRole('button', { name: 'View VCI' }).querySelectorAll('td')[1];
            expect(Number(priceCell.textContent?.replace(/\D/g, ''))).toBe(42000);
            expect(screen.getByText(/postgres:stored_quote/)).toHaveTextContent('vnstock_vnd:VCI');
            expect(screen.getByText('WebSocket: subscription_limit')).toBeVisible();
            expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({
                __widgetRuntime: expect.objectContaining({ provenance: expect.objectContaining({
                    updatedAt: '2025-01-08T17:00:00.000Z', stale: true,
                    warnings: expect.arrayContaining(['VCI: Live quote unavailable; showing stored price.', 'WebSocket: subscription_limit']),
                }) }),
            }));
        } finally {
            view.unmount();
            client.clear();
        }
    });

    it('does not infer HTTP staleness or as-of from receipt', () => {
        jest.mocked(useQueries).mockReturnValue([{ data: {
            symbol: 'VCI', price: 42000, price_unit: 'VND', updatedAt: '2026-10-23T12:30:00',
            source: 'redis:price_snapshot', upstreamSource: null, asOf: null, stale: null,
        } }] as never);
        const onDataChange = jest.fn();
        render(<WatchlistWidget id="watchlist" config={{ watchlistSymbols: ['VCI'] }} onDataChange={onDataChange} />);

        expect(screen.getByText('HTTP quote · redis:price_snapshot · Supplier unknown')).toBeInTheDocument();
        expect(screen.getByText('VCI: Observation time unknown; freshness unknown.')).toBeVisible();
        expect(screen.getByText(/As-of unknown/)).toBeInTheDocument();
        expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({
            __widgetRuntime: expect.objectContaining({ provenance: expect.objectContaining({ updatedAt: null, stale: undefined }) }),
        }));
    });

    it('does not mark known fresh HTTP delivery stale merely because WebSocket is disconnected', () => {
        jest.mocked(useQueries).mockReturnValue([{ data: {
            symbol: 'VCI', price: 42000, price_unit: 'VND',
            source: 'redis:price_snapshot', upstreamSource: null, asOf: '2026-10-23T12:30:00+07:00', stale: false,
        } }] as never);
        const onDataChange = jest.fn();
        render(<WatchlistWidget id="watchlist" config={{ watchlistSymbols: ['VCI'] }} onDataChange={onDataChange} />);

        expect(screen.queryByText('VCI: Observation time unknown; freshness unknown.')).not.toBeInTheDocument();
        expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({
            __widgetRuntime: expect.objectContaining({ provenance: expect.objectContaining({ stale: false, cached: true }) }),
        }));
    });

    it('preserves the selected stream source without claiming it is an upstream supplier', () => {
        mockUseWebSocket.mockReturnValue(socketResult(new Map([['VCI', {
            symbol: 'VCI', price: 42000, source: 'postgres:stored_quote',
            as_of: '2025-01-09T00:00:00+07:00', stale: true,
        }]]), true));

        renderWatchlist(['VCI']);

        expect(screen.getByText('WebSocket · postgres:stored_quote · Supplier unknown')).toBeInTheDocument();
    });

    it.each([false, true])('refreshes HTTP only while delivery is degraded (receiving=%s)', async (isReceiving) => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-10-22T10:00:00+07:00'));
        const actualQuery = jest.requireActual<typeof ReactQuery>('@tanstack/react-query');
        jest.mocked(useQuery).mockImplementation(actualQuery.useQuery);
        jest.mocked(useQueries).mockImplementation(actualQuery.useQueries);
        jest.mocked(api.getSymbols).mockResolvedValue({ count: 0, data: [] });
        const response = (price: number): QuoteResponse => ({ data: {
            symbol: 'VCI', price, price_unit: 'VND', updatedAt: '2026-10-22T10:00:00+07:00',
            open: null, high: null, low: null, prevClose: null, change: null, changePct: null,
            volume: null, value: null,
        } });
        const transport = jest.mocked(api.getQuote)
            .mockResolvedValueOnce(response(42000)).mockResolvedValue(response(43000));
        mockUseWebSocket.mockReturnValue({ ...socketResult(new Map(), true), isReceiving });
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
        const view = render(<QueryClientProvider client={client}><WatchlistWidget id="watchlist" config={{ watchlistSymbols: ['VCI'] }} /></QueryClientProvider>);
        try {
            await act(async () => { await jest.advanceTimersByTimeAsync(1); });
            const priceCell = screen.getByRole('button', { name: 'View VCI' }).querySelectorAll('td')[1];
            expect(Number(priceCell.textContent?.replace(/\D/g, ''))).toBe(42000);
            await act(async () => { await jest.advanceTimersByTimeAsync(30_001); });
            expect(Number(priceCell.textContent?.replace(/\D/g, ''))).toBe(isReceiving ? 42000 : 43000);
            expect(transport).toHaveBeenCalledTimes(isReceiving ? 1 : 2);
        } finally {
            view.unmount();
            client.clear();
            jest.restoreAllMocks();
            jest.useRealTimers();
        }
    });

    it('sorts unavailable prices last in both directions', () => {
        mockUseWebSocket.mockReturnValue(socketResult(new Map([
            ['HIG', { symbol: 'HIG', price: 30, change: 3, change_pct: 3, direction: 'unchanged', previousPrice: null }],
            ['LOW', { symbol: 'LOW', price: 10, change: 1, change_pct: 1, direction: 'unchanged', previousPrice: null }],
        ]), true, new Date('2026-07-18T10:00:00Z')));

        renderWatchlist(['NUL', 'HIG', 'LOW']);
        fireEvent.click(screen.getByText(/^Price/));
        expect(screen.getAllByRole('button', { name: /^View / }).map((row) => row.getAttribute('aria-label'))).toEqual(['View LOW', 'View HIG', 'View NUL']);

        fireEvent.click(screen.getByText(/^Price/));
        expect(screen.getAllByRole('button', { name: /^View / }).map((row) => row.getAttribute('aria-label'))).toEqual(['View HIG', 'View LOW', 'View NUL']);

        fireEvent.click(screen.getByText(/^Chg%/));
        expect(screen.getAllByRole('button', { name: /^View / }).map((row) => row.getAttribute('aria-label'))).toEqual(['View LOW', 'View HIG', 'View NUL']);

        fireEvent.click(screen.getByText(/^Chg%/));
        expect(screen.getAllByRole('button', { name: /^View / }).map((row) => row.getAttribute('aria-label'))).toEqual(['View HIG', 'View LOW', 'View NUL']);
    });

    it('keeps row selection', () => {
        renderWatchlist(['VCI']);

        fireEvent.click(screen.getByRole('button', { name: 'View VCI' }));
        expect(setLinkedSymbol).toHaveBeenCalledWith('VCI');
    });

    it('names watchlist controls and operates selection from the keyboard', () => {
        renderWatchlist(['VCI']);

        expect(screen.getByRole('button', { name: 'Add watchlist symbol' })).toHaveClass('min-h-11', 'focus-visible:ring-2');
        expect(screen.getByRole('button', { name: 'Clear watchlist' })).toHaveClass('min-w-11', 'focus-visible:ring-2');
        const row = screen.getByRole('button', { name: 'View VCI' });
        row.focus();
        fireEvent.keyDown(row, { key: 'Enter' });
        expect(setLinkedSymbol).toHaveBeenCalledWith('VCI');
        fireEvent.click(screen.getByRole('button', { name: 'Add watchlist symbol' }));
        expect(screen.getByRole('textbox', { name: 'Watchlist symbol' })).toHaveFocus();
    });
    it('keeps malformed input editable and accepts normalized symbols without catalogue coverage', () => {
        renderWatchlist(['VCI']);
        fireEvent.click(screen.getByRole('button', { name: 'Add watchlist symbol' }));
        const input = screen.getByRole('textbox', { name: 'Watchlist symbol' });
        for (const value of ['F!T', 'ABCD', 'A B']) {
            fireEvent.change(input, { target: { value } });
            fireEvent.click(screen.getByRole('button', { name: 'Add' }));
            expect(input).toHaveValue(value);
            expect(input).toHaveAttribute('aria-invalid', 'true');
            expect(screen.getByRole('alert')).toBeVisible();
            expect(screen.queryByRole('button', { name: `View ${value}` })).not.toBeInTheDocument();
        }
        fireEvent.change(input, { target: { value: ' zzz ' } });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(screen.getByRole('button', { name: 'View ZZZ' })).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Watchlist symbol' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Add watchlist symbol' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Watchlist symbol' }), { target: { value: 'zzz' } });
        fireEvent.keyDown(screen.getByRole('textbox', { name: 'Watchlist symbol' }), { key: 'Enter' });
        expect(screen.getAllByRole('button', { name: 'View ZZZ' })).toHaveLength(1);
    });

    it('preserves an externally added symbol when dashboard config catches up to the mounted watchlist', () => {
        const view = renderWatchlist(['VCI']);
        updateWidget.mockClear();

        dashboardWidget.widget.config = { watchlistSymbols: ['VCI', 'FPT'] };
        view.rerender(<WatchlistWidget id="watchlist" config={dashboardWidget.widget.config} widgetGroup="A" />);

        expect(screen.getByRole('button', { name: 'View FPT' })).toBeInTheDocument();
        expect(updateWidget).not.toHaveBeenCalledWith('dashboard', 'tab', 'watchlist', expect.objectContaining({
            config: expect.objectContaining({ watchlistSymbols: ['VCI'] }),
        }));
    });
});
