'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { config } from '@/lib/config';
import { logClientError, logClientWarn } from '@/lib/clientLogger';

const WS_URL = config.wsPriceUrl;
const MAX_RECONNECT_ATTEMPTS = config.isProd ? 10 : 3;

type ReconnectTimer = ReturnType<typeof setTimeout>;

export interface PriceUpdate {
    symbol: string;
    price: number;
    change?: number;
    change_pct?: number;
    volume?: number;
    timestamp?: string;
}

export interface PriceWithDirection extends PriceUpdate {
    direction: 'up' | 'down' | 'unchanged';
    previousPrice: number | null;
}

export interface MarketStatus {
    is_open: boolean;
    current_time: string;
    timezone: string;
    message?: string;
}

export interface UseWebSocketOptions {
    symbols: string[];
    enabled?: boolean;
    onUpdate?: (update: PriceUpdate) => void;
}

export interface UseWebSocketReturn {
    isConnected: boolean;
    prices: Map<string, PriceWithDirection>;
    lastUpdate: Date | null;
    marketStatus: MarketStatus | null;
    reconnect: () => void;
}

export function useWebSocket({
    symbols,
    enabled = true,
    onUpdate,
}: UseWebSocketOptions): UseWebSocketReturn {
    const [isConnected, setIsConnected] = useState(false);
    const [prices, setPrices] = useState<Map<string, PriceWithDirection>>(new Map());
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<ReconnectTimer | null>(null);
    const reconnectAttemptRef = useRef(0);
    const symbolsRef = useRef(symbols);
    const onUpdateRef = useRef(onUpdate);
    const previousPricesRef = useRef<Map<string, number>>(new Map());
    const shouldEnableRef = useRef(false);
    const mountedRef = useRef(true);
    const connectRef = useRef<() => void>(() => {});
    const shouldEnable = enabled && config.enableRealtime && Boolean(WS_URL);
    const symbolsKey = symbols.join('\u0000');

    const clearReconnectTimer = useCallback(() => {
        if (reconnectTimeoutRef.current !== null) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
    }, []);

    const closeCurrentSocket = useCallback(() => {
        const ws = wsRef.current;
        wsRef.current = null;
        if (!ws) return;
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
        }
    }, []);

    const connect = useCallback(() => {
        if (!mountedRef.current || !shouldEnableRef.current || symbolsRef.current.length === 0) return;
        if (reconnectTimeoutRef.current !== null) return;
        if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

        try {
            const ws = new WebSocket(WS_URL);
            wsRef.current = ws;

            ws.onopen = () => {
                if (wsRef.current !== ws) return;
                reconnectAttemptRef.current = 0;
                if (mountedRef.current) setIsConnected(true);
                ws.send(JSON.stringify({ action: 'subscribe', symbols: symbolsRef.current }));
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'market_status') {
                        if (mountedRef.current) {
                            setMarketStatus({
                                is_open: data.is_open,
                                current_time: data.current_time,
                                timezone: data.timezone,
                                message: data.message,
                            });
                        }
                        return;
                    }
                    if (!data.symbol || data.price === undefined) return;

                    const priceUpdate = data as PriceUpdate;
                    const previousPrice = previousPricesRef.current.get(priceUpdate.symbol);
                    const direction = previousPrice === undefined || previousPrice === priceUpdate.price
                        ? 'unchanged'
                        : priceUpdate.price > previousPrice ? 'up' : 'down';
                    previousPricesRef.current.set(priceUpdate.symbol, priceUpdate.price);
                    if (mountedRef.current) {
                        setPrices((current) => new Map(current).set(priceUpdate.symbol, {
                            ...priceUpdate,
                            direction,
                            previousPrice: previousPrice ?? null,
                        }));
                        setLastUpdate(new Date());
                    }
                    onUpdateRef.current?.(priceUpdate);
                } catch {
                }
            };

            ws.onclose = () => {
                if (wsRef.current !== ws) return;
                wsRef.current = null;
                if (mountedRef.current) setIsConnected(false);
                if (!mountedRef.current || !shouldEnableRef.current || symbolsRef.current.length === 0) return;
                if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS || reconnectTimeoutRef.current !== null) return;

                const attempt = reconnectAttemptRef.current;
                reconnectAttemptRef.current = attempt + 1;
                const timer = setTimeout(() => {
                    if (reconnectTimeoutRef.current !== timer) return;
                    reconnectTimeoutRef.current = null;
                    connectRef.current();
                }, Math.min(1000 * 2 ** attempt, 30000));
                reconnectTimeoutRef.current = timer;
            };

            ws.onerror = (error) => {
                if (!config.isDev) logClientWarn('WebSocket encountered error:', error);
                ws.close();
            };
        } catch (error) {
            logClientError('WebSocket connection initialization failed:', error);
            if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS || reconnectTimeoutRef.current !== null) return;
            reconnectAttemptRef.current += 1;
            const timer = setTimeout(() => {
                if (reconnectTimeoutRef.current !== timer) return;
                reconnectTimeoutRef.current = null;
                connectRef.current();
            }, 5000);
            reconnectTimeoutRef.current = timer;
        }
    }, []);

    const disconnect = useCallback(() => {
        clearReconnectTimer();
        reconnectAttemptRef.current = 0;
        closeCurrentSocket();
        if (mountedRef.current) setIsConnected(false);
    }, [clearReconnectTimer, closeCurrentSocket]);

    const reconnect = useCallback(() => {
        clearReconnectTimer();
        reconnectAttemptRef.current = 0;
        closeCurrentSocket();
        setIsConnected(false);
        connect();
    }, [clearReconnectTimer, closeCurrentSocket, connect]);

    useEffect(() => {
        symbolsRef.current = symbols;
        onUpdateRef.current = onUpdate;
        shouldEnableRef.current = shouldEnable;
        connectRef.current = connect;
    });

    useEffect(() => {
        mountedRef.current = true;
        if (shouldEnable) connect();
        return () => {
            mountedRef.current = false;
            disconnect();
        };
    }, [shouldEnable, connect, disconnect]);

    useEffect(() => {
        if (!shouldEnable || symbolsRef.current.length === 0) {
            disconnect();
            return;
        }
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: 'subscribe', symbols: symbolsRef.current }));
            return;
        }
        connect();
    }, [shouldEnable, symbolsKey, connect, disconnect]);

    useEffect(() => {
        const recover = () => {
            if (!shouldEnableRef.current || symbolsRef.current.length === 0) return;
            if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;
            clearReconnectTimer();
            reconnectAttemptRef.current = 0;
            connect();
        };
        const recoverWhenVisible = () => {
            if (!document.hidden) recover();
        };

        window.addEventListener('online', recover);
        document.addEventListener('visibilitychange', recoverWhenVisible);
        return () => {
            window.removeEventListener('online', recover);
            document.removeEventListener('visibilitychange', recoverWhenVisible);
        };
    }, [clearReconnectTimer, connect]);

    return { isConnected, prices, lastUpdate, marketStatus, reconnect };
}

export function usePriceStream(symbol: string, enabled = true) {
    const { prices, isConnected, lastUpdate, marketStatus, reconnect } = useWebSocket({
        symbols: symbol ? [symbol] : [],
        enabled: enabled && Boolean(symbol),
    });
    const priceData = symbol ? prices.get(symbol.toUpperCase()) : undefined;

    return {
        price: priceData?.price ?? null,
        change: priceData?.change ?? null,
        changePct: priceData?.change_pct ?? null,
        volume: priceData?.volume ?? null,
        direction: priceData?.direction ?? 'unchanged',
        isConnected,
        lastUpdate,
        marketStatus,
        reconnect,
    };
}
