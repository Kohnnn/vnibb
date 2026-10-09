import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { useWebSocket } from '@/lib/hooks/useWebSocket';
import { parseWatchlistSymbols, WatchlistWidget } from './WatchlistWidget';
import { useDashboard } from '@/contexts/DashboardContext';
import { useDashboardWidget } from '@/hooks/useDashboardWidget';

jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn() }));
jest.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: jest.fn() }));

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
    WidgetMeta: ({ updatedAt, fetchedAt, isCached, note }: { updatedAt?: Date | null; fetchedAt?: Date | null; isCached?: boolean; note?: string }) => <div>{`${note ?? ''}|${fetchedAt ? 'Received' : 'No receipt'}|${isCached ? 'Cached' : 'Current'}|${updatedAt ? 'Known as-of' : 'As-of unknown'}`}</div>,
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
        dashboardWidget.widget.config = { watchlistSymbols: ['VCI'] };
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
        expect(screen.getByText('Disconnected · Unavailable|No receipt|Current|As-of unknown')).toBeInTheDocument();
    });

    it('shows observed values and the global quote receipt status', () => {
        mockUseWebSocket.mockReturnValue(socketResult(new Map([
            ['VCI', { symbol: 'VCI', price: 42, change: 1, change_pct: 2.38, direction: 'up', previousPrice: 41 }],
        ]), true, new Date('2026-07-18T10:00:00Z')));

        renderWatchlist(['VCI']);

        expect(screen.getByText('42')).toBeInTheDocument();
        expect(screen.getByText('+2.38%')).toBeInTheDocument();
        expect(screen.getByText('Live feed · Last quote received|Received|Current|As-of unknown')).toBeInTheDocument();
    });

    it('retains and labels the last observed quote after disconnect', () => {
        mockUseWebSocket.mockReturnValue(socketResult(new Map([
            ['VCI', { symbol: 'VCI', price: 42, change: 1, change_pct: 2.38, direction: 'up', previousPrice: 41 }],
        ]), false, new Date('2026-07-18T10:00:00Z')));

        renderWatchlist(['VCI']);

        expect(screen.getByText('42')).toBeInTheDocument();
        expect(screen.getByText('Disconnected · Cached quote receipt|Received|Cached|As-of unknown')).toBeInTheDocument();
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
