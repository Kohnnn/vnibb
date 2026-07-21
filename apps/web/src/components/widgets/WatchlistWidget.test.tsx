import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { useWebSocket } from '@/lib/hooks/useWebSocket';
import { parseWatchlistSymbols, WatchlistWidget } from './WatchlistWidget';

jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn() }));
jest.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: jest.fn() }));

const setLinkedSymbol = jest.fn();

jest.mock('@/contexts/DashboardContext', () => ({
    useDashboard: () => ({ updateWidget: jest.fn() }),
}));

jest.mock('@/hooks/useDashboardWidget', () => ({
    useDashboardWidget: () => undefined,
}));

jest.mock('@/hooks/useWidgetSymbolLink', () => ({
    useWidgetSymbolLink: () => ({ setLinkedSymbol }),
}));

jest.mock('@/components/ui/WidgetContainer', () => ({
    WidgetContainer: ({ children, title }: { children: ReactNode; title: string }) => <section><h2>{title}</h2>{children}</section>,
}));

jest.mock('@/components/ui/WidgetMeta', () => ({
    WidgetMeta: ({ updatedAt, isCached, note }: { updatedAt?: Date | null; isCached?: boolean; note?: string }) => <div>{`${note ?? ''}|${updatedAt ? 'Received' : 'No receipt'}|${isCached ? 'Cached' : 'Current'}`}</div>,
}));

jest.mock('@/components/ui/widget-states', () => ({
    WidgetEmpty: ({ message }: { message: string }) => <div>{message}</div>,
}));

const mockUseQuery = jest.mocked(useQuery);
const mockUseWebSocket = jest.mocked(useWebSocket);

function socketResult(prices = new Map(), isConnected = false, lastUpdate: Date | null = null) {
    return {
        prices,
        isConnected,
        lastUpdate,
        marketStatus: null,
        reconnect: jest.fn(),
    } as ReturnType<typeof useWebSocket>;
}

function renderWatchlist(symbols: string[]) {
    return render(<WatchlistWidget id="watchlist" config={{ watchlistSymbols: symbols }} widgetGroup="A" />);
}

describe('WatchlistWidget quotes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUseQuery.mockReturnValue({ data: { data: [] } } as ReturnType<typeof useQuery>);
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
        expect(screen.getByText('Disconnected · Unavailable|No receipt|Current')).toBeInTheDocument();
    });

    it('shows observed values and the global quote receipt status', () => {
        mockUseWebSocket.mockReturnValue(socketResult(new Map([
            ['VCI', { symbol: 'VCI', price: 42, change: 1, change_pct: 2.38, direction: 'up', previousPrice: 41 }],
        ]), true, new Date('2026-07-18T10:00:00Z')));

        renderWatchlist(['VCI']);

        expect(screen.getByText('42')).toBeInTheDocument();
        expect(screen.getByText('+2.38%')).toBeInTheDocument();
        expect(screen.getByText('Live feed · Last quote received|Received|Current')).toBeInTheDocument();
    });

    it('retains and labels the last observed quote after disconnect', () => {
        mockUseWebSocket.mockReturnValue(socketResult(new Map([
            ['VCI', { symbol: 'VCI', price: 42, change: 1, change_pct: 2.38, direction: 'up', previousPrice: 41 }],
        ]), false, new Date('2026-07-18T10:00:00Z')));

        renderWatchlist(['VCI']);

        expect(screen.getByText('42')).toBeInTheDocument();
        expect(screen.getByText('Disconnected · Cached quote receipt|Received|Cached')).toBeInTheDocument();
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
});
