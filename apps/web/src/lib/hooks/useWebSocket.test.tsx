import { act, render, screen, waitFor } from '@testing-library/react';
import { useWebSocket } from '@/lib/hooks/useWebSocket';

const BrowserWebSocket = window.WebSocket;

class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances: MockWebSocket[] = [];

    readyState = MockWebSocket.CONNECTING;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    send = jest.fn();
    close = jest.fn(() => {
        if (this.readyState === MockWebSocket.CLOSED) return;
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.(new CloseEvent('close'));
    });

    constructor(public readonly url: string) {
        MockWebSocket.instances.push(this);
    }

    open() {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.(new Event('open'));
    }

    message(data: unknown) {
        this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
}

const admittedPrice = (symbol: string, price: number) => ({
    symbol, price, price_unit: 'VND', source: 'fixture',
    as_of: '2026-10-22T10:00:00+07:00', stale: false,
});

function WebSocketHarness({ symbols, onUpdate }: { symbols: string[]; onUpdate?: (price: number) => void }) {
    const { isConnected, isReceiving, protocolError, prices } = useWebSocket({
        symbols,
        onUpdate: (update) => onUpdate?.(update.price),
    });
    return <><output>{`${isConnected}:${prices.get(symbols[0])?.price ?? 'none'}`}</output><output>{`${isReceiving}:${protocolError ?? 'ok'}`}</output></>;
}

function exhaustReconnects() {
    for (const delay of [1000, 2000, 4000]) {
        act(() => {
            MockWebSocket.instances.at(-1)?.close();
            jest.advanceTimersByTime(delay);
        });
    }
    act(() => MockWebSocket.instances.at(-1)?.close());
}

describe('useWebSocket recovery', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        MockWebSocket.instances = [];
        Object.defineProperty(window, 'WebSocket', { configurable: true, value: MockWebSocket });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('keeps the newest callback without reconnecting on rerender', () => {
        const first = jest.fn();
        const second = jest.fn();
        const { rerender } = render(<WebSocketHarness symbols={['VCI']} onUpdate={first} />);
        const socket = MockWebSocket.instances[0];

        act(() => socket.open());
        rerender(<WebSocketHarness symbols={['VCI']} onUpdate={second} />);
        act(() => socket.message(admittedPrice('VCI', 42)));

        expect(MockWebSocket.instances).toHaveLength(1);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith(42);
    });

    it('subscribes the current symbols without opening another socket', () => {
        const { rerender } = render(<WebSocketHarness symbols={['VCI']} />);
        const socket = MockWebSocket.instances[0];

        act(() => socket.open());
        rerender(<WebSocketHarness symbols={['HPG', 'FPT']} />);

        expect(MockWebSocket.instances).toHaveLength(1);
        expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ action: 'unsubscribe', symbols: ['VCI'] }));
        expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ action: 'subscribe', symbols: ['HPG', 'FPT'] }));
    });

    it('retains the last good price after disconnect', () => {
        render(<WebSocketHarness symbols={['VCI']} />);
        const socket = MockWebSocket.instances[0];

        act(() => {
            socket.open();
            socket.message(admittedPrice('VCI', 42));
            socket.close();
        });

        expect(screen.getByText('false:42')).toBeInTheDocument();
    });

    it('recovers from exhausted reconnects when the browser comes online', () => {
        render(<WebSocketHarness symbols={['VCI']} />);
        exhaustReconnects();

        expect(MockWebSocket.instances).toHaveLength(4);
        act(() => window.dispatchEvent(new Event('online')));

        expect(MockWebSocket.instances).toHaveLength(5);
    });

    it('recovers from exhausted reconnects when the document becomes visible', () => {
        render(<WebSocketHarness symbols={['VCI']} />);
        exhaustReconnects();
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });

        act(() => document.dispatchEvent(new Event('visibilitychange')));

        expect(MockWebSocket.instances).toHaveLength(5);
    });

    it('does not duplicate connections while a socket is open or connecting', () => {
        render(<WebSocketHarness symbols={['VCI']} />);

        act(() => {
            window.dispatchEvent(new Event('online'));
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(MockWebSocket.instances).toHaveLength(1);

        act(() => MockWebSocket.instances[0].open());
        act(() => window.dispatchEvent(new Event('online')));
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('cleans up the socket and reconnect timer on unmount', () => {
        const { unmount } = render(<WebSocketHarness symbols={['VCI']} />);
        const socket = MockWebSocket.instances[0];
        act(() => socket.close());

        unmount();

        expect(socket.close).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('recovers an atomic subscription rejection after shrinking eleven symbols to ten', () => {
        const symbols = ['VCI', 'HPG', 'FPT', 'VNM', 'VIC', 'VHM', 'MSN', 'MWG', 'TCB', 'VCB', 'BID'];
        const onUpdate = jest.fn();
        const { rerender } = render(<WebSocketHarness symbols={symbols} onUpdate={onUpdate} />);
        const socket = MockWebSocket.instances[0];
        act(() => socket.open());
        expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ action: 'subscribe', symbols }));

        act(() => socket.message({ type: 'error', error: 'subscription_limit' }));
        const remaining = symbols.slice(0, 10);
        rerender(<WebSocketHarness symbols={remaining} onUpdate={onUpdate} />);

        expect(MockWebSocket.instances).toHaveLength(1);
        expect(socket.close).not.toHaveBeenCalled();
        expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ action: 'subscribe', symbols: remaining }));
        expect(screen.getByText('false:subscription_limit')).toBeInTheDocument();
        act(() => socket.message({ type: 'market_status', is_open: true, timezone: 'Asia/Ho_Chi_Minh' }));
        expect(screen.getByText('false:subscription_limit')).toBeInTheDocument();

        act(() => remaining.forEach(symbol => socket.message(admittedPrice(symbol, 42))));

        expect(screen.getByText('true:42')).toBeInTheDocument();
        expect(screen.getByText('true:ok')).toBeInTheDocument();
        expect(onUpdate).toHaveBeenCalledTimes(10);
    });

    it('updates pending subscriptions without duplicate sends before any price arrives', () => {
        const { rerender } = render(<WebSocketHarness symbols={['VCI', 'HPG']} />);
        const socket = MockWebSocket.instances[0];
        act(() => socket.open());
        rerender(<WebSocketHarness symbols={['VCI', 'HPG', 'FPT']} />);
        rerender(<WebSocketHarness symbols={['FPT', 'VCI']} />);
        rerender(<WebSocketHarness symbols={['VCI', 'FPT']} />);

        expect(socket.send.mock.calls.map(([payload]) => JSON.parse(payload))).toEqual([
            { action: 'subscribe', symbols: ['VCI', 'HPG'] },
            { action: 'subscribe', symbols: ['FPT'] },
            { action: 'unsubscribe', symbols: ['HPG'] },
        ]);
        act(() => {
            socket.message(admittedPrice('VCI', 42));
            socket.message(admittedPrice('FPT', 91));
        });
        expect(screen.getByText('true:ok')).toBeInTheDocument();
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('preserves observed subscriptions but removes unobserved survivors after a rejected addition', () => {
        const symbols = ['VCI', 'HPG', 'FPT', 'VNM', 'VIC', 'VHM', 'MSN', 'MWG', 'TCB', 'VCB'];
        const { rerender } = render(<WebSocketHarness symbols={symbols} />);
        const socket = MockWebSocket.instances[0];
        act(() => {
            socket.open();
            socket.message(admittedPrice('VCI', 42));
        });
        rerender(<WebSocketHarness symbols={[...symbols, 'BID']} />);
        expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ action: 'subscribe', symbols: ['BID'] }));
        act(() => {
            socket.message({ type: 'error', error: 'subscription_limit' });
            socket.message(admittedPrice('VCI', 43));
        });
        expect(screen.getByText('false:subscription_limit')).toBeInTheDocument();

        const remaining = symbols.filter(symbol => symbol !== 'HPG').concat('BID');
        rerender(<WebSocketHarness symbols={remaining} />);
        expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ action: 'unsubscribe', symbols: ['HPG'] }));
        expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ action: 'subscribe', symbols: remaining.slice(1) }));
        expect(screen.getByText('false:subscription_limit')).toBeInTheDocument();

        act(() => remaining.slice(1).forEach(symbol => socket.message(admittedPrice(symbol, 42))));
        expect(screen.getByText('true:ok')).toBeInTheDocument();
        const sent = socket.send.mock.calls.length;
        act(() => socket.message(admittedPrice('BID', 42)));
        rerender(<WebSocketHarness symbols={[...remaining]} />);
        expect(socket.send).toHaveBeenCalledTimes(sent);
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('resubscribes current symbols after eviction without clearing an unresolved rejection on open', () => {
        const { rerender } = render(<WebSocketHarness symbols={['VCI']} />);
        const socket = MockWebSocket.instances[0];
        act(() => {
            socket.open();
            socket.message(admittedPrice('VCI', 42));
        });
        rerender(<WebSocketHarness symbols={['VCI', 'HPG']} />);
        act(() => {
            socket.message({ type: 'error', error: 'subscription_limit' });
            socket.readyState = MockWebSocket.CLOSED;
            socket.onclose?.(new CloseEvent('close', { code: 1013, reason: 'Slow client' }));
            jest.advanceTimersByTime(1000);
        });

        expect(MockWebSocket.instances).toHaveLength(2);
        const replacement = MockWebSocket.instances[1];
        act(() => replacement.open());
        expect(replacement.send).toHaveBeenLastCalledWith(JSON.stringify({ action: 'subscribe', symbols: ['VCI', 'HPG'] }));
        expect(screen.getByText('true:42')).toBeInTheDocument();
        expect(screen.getByText('false:subscription_limit')).toBeInTheDocument();
        act(() => replacement.message(admittedPrice('VCI', 43)));
        expect(screen.getByText('false:subscription_limit')).toBeInTheDocument();
        act(() => replacement.message(admittedPrice('HPG', 21)));
        expect(screen.getByText('true:ok')).toBeInTheDocument();
    });

    it('waits for fresh admitted observations rather than control messages or stale recovery frames', () => {
        render(<WebSocketHarness symbols={['VCI']} />);
        const socket = MockWebSocket.instances[0];
        act(() => {
            socket.open();
            socket.message({ type: 'error', error: 'subscription_limit' });
            socket.message({ type: 'subscribed', symbols: ['VCI'] });
            socket.message({ type: 'subscribed', symbols: ['VCI'] });
            socket.message({ ...admittedPrice('VCI', 42), stale: true });
        });
        expect(screen.getByText('true:42')).toBeInTheDocument();
        expect(screen.getByText('false:subscription_limit')).toBeInTheDocument();
        act(() => socket.message({ ...admittedPrice('VCI', 43), as_of: '2026-10-21T10:00:00+07:00' }));
        expect(screen.getByText('true:42')).toBeInTheDocument();
        expect(screen.getByText('false:subscription_limit')).toBeInTheDocument();
        act(() => socket.message({ ...admittedPrice('VCI', 43), price_unit: undefined }));
        expect(screen.getByText('false:subscription_limit')).toBeInTheDocument();
        act(() => socket.message(admittedPrice('VCI', 43)));
        expect(screen.getByText('true:43')).toBeInTheDocument();
        expect(screen.getByText('true:ok')).toBeInTheDocument();
        expect(socket.send).toHaveBeenCalledTimes(1);
    });

    it('degrades rejected and stalled sockets without treating transport as delivery', () => {
        render(<WebSocketHarness symbols={['VCI']} />);
        const socket = MockWebSocket.instances[0];
        act(() => socket.open());
        expect(screen.getByText('false:ok')).toBeInTheDocument();
        act(() => socket.message({ type: 'error', error: 'subscription_limit' }));
        expect(screen.getByText('false:subscription_limit')).toBeInTheDocument();
        act(() => socket.message(admittedPrice('VCI', 42)));
        expect(screen.getByText('true:ok')).toBeInTheDocument();
        act(() => jest.advanceTimersByTime(20_000));
        expect(screen.getByText('false:ok')).toBeInTheDocument();
    });
});

const backendSmoke = process.env.VNIBB_WS_SMOKE === '1' ? it : it.skip;

backendSmoke('recovers rejected subscriptions through the configured real backend', async () => {
    const sockets: WebSocket[] = [];
    class RealWebSocket extends BrowserWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            sockets.push(this);
        }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: RealWebSocket });
    const send = jest.spyOn(BrowserWebSocket.prototype, 'send');
    function BackendHarness({ symbols }: { symbols: string[] }) {
        const { isConnected, isReceiving, protocolError, prices } = useWebSocket({ symbols });
        return <output data-testid="backend-hook">{JSON.stringify({
            isConnected, isReceiving, protocolError, prices: [...prices.values()],
        })}</output>;
    }
    const symbols = ['VCI', 'HPG', 'FPT', 'VNM', 'VIC', 'VHM', 'MSN', 'MWG', 'TCB', 'VCB', 'BID'];
    const { rerender, unmount } = render(<BackendHarness symbols={symbols} />);
    const state = () => JSON.parse(screen.getByTestId('backend-hook').textContent || '{}');
    try {
        await waitFor(() => expect(state().protocolError).toMatch(/at most 10 symbols/), { timeout: 15_000 });
        expect(state().prices).toHaveLength(0);
        const remaining = symbols.slice(0, 10);
        rerender(<BackendHarness symbols={remaining} />);
        expect(send).toHaveBeenLastCalledWith(JSON.stringify({ action: 'subscribe', symbols: remaining }));
        await waitFor(() => expect(state().prices.length).toBeGreaterThan(0), { timeout: 60_000 });
        expect(sockets).toHaveLength(1);
        expect(sockets[0].readyState).toBe(BrowserWebSocket.OPEN);
        const observation = state().prices[0];
        expect(remaining).toContain(observation.symbol);
        expect(observation.price).toBeGreaterThan(0);
        expect(observation.price_unit).toBe('VND');
        expect(observation.source).toEqual(expect.any(String));
        expect(Number.isFinite(Date.parse(observation.as_of))).toBe(true);
        expect(typeof observation.stale).toBe('boolean');
        if (state().prices.every((price: { stale: boolean }) => price.stale)) {
            expect(state().isReceiving).toBe(false);
        }
    } finally {
        unmount();
        sockets.forEach(socket => socket.close());
        jest.restoreAllMocks();
        Object.defineProperty(window, 'WebSocket', { configurable: true, value: BrowserWebSocket });
    }
}, 90_000);
