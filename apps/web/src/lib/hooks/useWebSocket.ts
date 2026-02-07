/**
 * WebSocket Hook for Real-time Price Updates
 * 
 * Provides real-time price streaming for subscribed symbols.
 * Includes market hours awareness and price change detection.
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { config } from '@/lib/config';

const WS_URL = config.wsPriceUrl;

// Type definitions
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
    onUpdate
}: UseWebSocketOptions): UseWebSocketReturn {
    const [isConnected, setIsConnected] = useState(false);
    const [prices, setPrices] = useState<Map<string, PriceWithDirection>>(new Map());
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttemptRef = useRef(0);
    const symbolsRef = useRef<string[]>(symbols);
    const previousPricesRef = useRef<Map<string, number>>(new Map());
    const intentionalCloseRef = useRef(false);

    // Update symbols ref
    symbolsRef.current = symbols;

    const shouldEnable = enabled && config.enableRealtime && Boolean(WS_URL);
    const maxReconnectAttempts = config.isProd ? 10 : 3;

    const connect = useCallback(() => {
        if (!shouldEnable || symbolsRef.current.length === 0) return;

        if (reconnectAttemptRef.current >= maxReconnectAttempts) {
            return;
        }

        // Prevent multiple connections
        if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

        try {
            intentionalCloseRef.current = false;
            const ws = new WebSocket(WS_URL);
            wsRef.current = ws;

            ws.onopen = () => {
                setIsConnected(true);
                reconnectTimeoutRef.current = null; // Reset backoff on successful connection
                reconnectAttemptRef.current = 0;
                // Subscribe to symbols
                ws.send(JSON.stringify({
                    action: 'subscribe',
                    symbols: symbolsRef.current
                }));
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    // Handle market status messages
                    if (data.type === 'market_status') {
                        setMarketStatus({
                            is_open: data.is_open,
                            current_time: data.current_time,
                            timezone: data.timezone,
                            message: data.message
                        });
                        return;
                    }

                    // Handle price updates
                    if (data.symbol && data.price !== undefined) {
                        const priceUpdate = data as PriceUpdate;
                        const previousPrice = previousPricesRef.current.get(priceUpdate.symbol);

                        // Determine price direction
                        let direction: 'up' | 'down' | 'unchanged' = 'unchanged';
                        if (previousPrice !== undefined && previousPrice !== priceUpdate.price) {
                            direction = priceUpdate.price > previousPrice ? 'up' : 'down';
                        }

                        // Store current price for next comparison
                        previousPricesRef.current.set(priceUpdate.symbol, priceUpdate.price);

                        const priceWithDirection: PriceWithDirection = {
                            ...priceUpdate,
                            direction,
                            previousPrice: previousPrice ?? null
                        };

                        setPrices(prev => {
                            const next = new Map(prev);
                            next.set(priceUpdate.symbol, priceWithDirection);
                            return next;
                        });
                        setLastUpdate(new Date());
                        onUpdate?.(priceUpdate);
                    }
                } catch {
                    // Ignore parse errors
                }
            };

            ws.onclose = () => {
                setIsConnected(false);
                wsRef.current = null;

                if (intentionalCloseRef.current) {
                    return;
                }

                // Exponential backoff for reconnection
                const attempt = reconnectAttemptRef.current;
                const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // Max 30s

                if (attempt >= maxReconnectAttempts) {
                    return;
                }

                const timeoutId = setTimeout(() => {
                    if (shouldEnable) connect();
                }, delay);

                reconnectAttemptRef.current = attempt + 1;
                reconnectTimeoutRef.current = timeoutId;
            };

            ws.onerror = (err) => {
                if (intentionalCloseRef.current) {
                    return;
                }
                if (!config.isDev) {
                    console.warn('WebSocket encountered error:', err);
                }
                ws.close(); // Ensure close is called to trigger onclose for reconnection
            };

        } catch (error) {
            console.error('WebSocket connection initialization failed:', error);
            // Retry after delay even if init failed
            reconnectTimeoutRef.current = setTimeout(() => {
                if (enabled) connect();
            }, 5000);
        }
    }, [shouldEnable, onUpdate, maxReconnectAttempts]);

    const disconnect = useCallback(() => {
        intentionalCloseRef.current = true;
        if (wsRef.current) {
            if (wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.close();
            } else if (wsRef.current.readyState === WebSocket.CONNECTING) {
                wsRef.current.onopen = null;
                wsRef.current.onmessage = null;
                wsRef.current.onerror = null;
                wsRef.current.onclose = null;
            }
            wsRef.current = null;
        }
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
        reconnectAttemptRef.current = 0;
    }, []);

    const reconnect = useCallback(() => {
        reconnectAttemptRef.current = 0;
        disconnect();
        connect();
    }, [disconnect, connect]);

    // Connect on mount
    useEffect(() => {
        if (shouldEnable) {
            connect();
        }
        return () => disconnect();
    }, [shouldEnable, connect, disconnect]);

    // Update subscriptions when symbols change
    useEffect(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                action: 'subscribe',
                symbols
            }));
        }
    }, [symbols]);

    return {
        isConnected,
        prices,
        lastUpdate,
        marketStatus,
        reconnect
    };
}

/**
 * Hook for single symbol price streaming
 * Convenience wrapper around useWebSocket for single symbol use cases
 */
export function usePriceStream(symbol: string, enabled = true) {
    const symbols = symbol ? [symbol] : [];
    const { prices, isConnected, lastUpdate, marketStatus, reconnect } = useWebSocket({
        symbols,
        enabled: enabled && !!symbol
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
        reconnect
    };
}
