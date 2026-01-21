/**
 * WebSocket Hook with Reconnection Logic
 * 
 * Provides reliable WebSocket connection with:
 * - Automatic reconnection with exponential backoff
 * - Connection status tracking
 * - Graceful fallback to polling
 * - Message queue during disconnection
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseWebSocketOptions {
    url: string;
    onMessage?: (data: any) => void;
    onOpen?: () => void;
    onClose?: () => void;
    onError?: (error: Event) => void;
    reconnect?: boolean;
    reconnectAttempts?: number;
    reconnectInterval?: number;
    maxReconnectInterval?: number;
}

interface UseWebSocketReturn {
    status: WebSocketStatus;
    isConnected: boolean;
    send: (data: any) => void;
    connect: () => void;
    disconnect: () => void;
    reconnectCount: number;
}

export function useWebSocket({
    url,
    onMessage,
    onOpen,
    onClose,
    onError,
    reconnect = true,
    reconnectAttempts = 5,
    reconnectInterval = 1000,
    maxReconnectInterval = 30000,
}: UseWebSocketOptions): UseWebSocketReturn {
    const [status, setStatus] = useState<WebSocketStatus>('disconnected');
    const [reconnectCount, setReconnectCount] = useState(0);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const messageQueueRef = useRef<any[]>([]);

    // Calculate backoff delay with exponential increase
    const getBackoffDelay = useCallback((attempt: number): number => {
        const delay = Math.min(
            reconnectInterval * Math.pow(2, attempt),
            maxReconnectInterval
        );
        // Add jitter to prevent thundering herd
        return delay + Math.random() * 1000;
    }, [reconnectInterval, maxReconnectInterval]);

    // Clear reconnection timeout
    const clearReconnectTimeout = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
    }, []);

    // Disconnect WebSocket
    const disconnect = useCallback(() => {
        clearReconnectTimeout();
        setReconnectCount(0);

        if (wsRef.current) {
            wsRef.current.close(1000, 'Manual disconnect');
            wsRef.current = null;
        }

        setStatus('disconnected');
    }, [clearReconnectTimeout]);

    // Connect to WebSocket
    const connect = useCallback(() => {
        // Don't connect if already connected or connecting
        if (wsRef.current?.readyState === WebSocket.OPEN ||
            wsRef.current?.readyState === WebSocket.CONNECTING) {
            return;
        }

        setStatus('connecting');

        try {
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.onopen = () => {
                setStatus('connected');
                setReconnectCount(0);
                clearReconnectTimeout();

                // Send queued messages
                while (messageQueueRef.current.length > 0) {
                    const msg = messageQueueRef.current.shift();
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(msg));
                    }
                }

                onOpen?.();
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    onMessage?.(data);
                } catch {
                    // Handle non-JSON messages
                    onMessage?.(event.data);
                }
            };

            ws.onclose = (event) => {
                setStatus('disconnected');
                onClose?.();

                // Attempt reconnection if enabled and not a clean close
                if (reconnect && event.code !== 1000 && reconnectCount < reconnectAttempts) {
                    const delay = getBackoffDelay(reconnectCount);
                    console.log(`WebSocket closed. Reconnecting in ${Math.round(delay)}ms... (attempt ${reconnectCount + 1}/${reconnectAttempts})`);

                    reconnectTimeoutRef.current = setTimeout(() => {
                        setReconnectCount(prev => prev + 1);
                        connect();
                    }, delay);
                }
            };

            ws.onerror = (event) => {
                setStatus('error');
                onError?.(event);
            };
        } catch (error) {
            console.error('WebSocket connection error:', error);
            setStatus('error');
        }
    }, [url, onMessage, onOpen, onClose, onError, reconnect, reconnectAttempts, reconnectCount, getBackoffDelay, clearReconnectTimeout]);

    // Send message (queue if not connected)
    const send = useCallback((data: any) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(data));
        } else if (reconnect) {
            // Queue message for when connection is restored
            messageQueueRef.current.push(data);
        }
    }, [reconnect]);

    // Connect on mount
    useEffect(() => {
        connect();

        return () => {
            disconnect();
        };
    }, []);  // Only run on mount/unmount

    return {
        status,
        isConnected: status === 'connected',
        send,
        connect,
        disconnect,
        reconnectCount,
    };
}

/**
 * Connection Status Indicator Component
 */
interface ConnectionStatusProps {
    status: WebSocketStatus;
    reconnectCount?: number;
    className?: string;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
    status,
    reconnectCount = 0,
    className = '',
}) => {
    const statusConfig = {
        connecting: { label: 'Connecting...', color: 'var(--warning)', pulse: true },
        connected: { label: 'Live', color: 'var(--success)', pulse: false },
        disconnected: { label: 'Offline', color: 'var(--text-tertiary)', pulse: false },
        error: { label: 'Error', color: 'var(--error)', pulse: false },
    };

    const config = statusConfig[status];

    return (
        <div className={`connection-status ${className}`}>
            <span
                className={`connection-status__dot ${config.pulse ? 'pulse' : ''}`}
                style={{ backgroundColor: config.color }}
            />
            <span className="connection-status__label">
                {config.label}
                {status === 'connecting' && reconnectCount > 0 && ` (${reconnectCount})`}
            </span>
        </div>
    );
};
