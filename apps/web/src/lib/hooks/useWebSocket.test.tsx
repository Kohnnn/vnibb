import { act, render, screen } from '@testing-library/react';
import { useWebSocket } from '@/lib/hooks/useWebSocket';

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

function WebSocketHarness({ symbols, onUpdate }: { symbols: string[]; onUpdate?: (price: number) => void }) {
    const { isConnected, prices } = useWebSocket({
        symbols,
        onUpdate: (update) => onUpdate?.(update.price),
    });
    return <output>{`${isConnected}:${prices.get(symbols[0])?.price ?? 'none'}`}</output>;
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
        act(() => socket.message({ symbol: 'VCI', price: 42 }));

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
        expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ action: 'subscribe', symbols: ['HPG', 'FPT'] }));
    });

    it('retains the last good price after disconnect', () => {
        render(<WebSocketHarness symbols={['VCI']} />);
        const socket = MockWebSocket.instances[0];

        act(() => {
            socket.open();
            socket.message({ symbol: 'VCI', price: 42 });
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
});
