/**
 * WebSocket Hook for Real-time Price Updates
 * 
 * Provides real-time price streaming for subscribed symbols.
 * Includes market hours awareness and price change detection.
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { config } from '@/lib/config';

const WS_URL = config.wsUrl;

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
    const symbolsRef = useRef<string[]>(symbols);
    const previousPricesRef = useRef<Map<string, number>>(new Map());

    // Update symbols ref
    symbolsRef.current = symbols;

    const connect = useCallback(() => {
        if (!enabled || symbols.length === 0) return;

        try {
            const ws = new WebSocket(WS_URL);
            wsRef.current = ws;

            ws.onopen = () => {
                setIsConnected(true);
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
                // Reconnect after 5 seconds
                reconnectTimeoutRef.current = setTimeout(() => {
                    if (enabled) connect();
                }, 5000);
            };

            ws.onerror = () => {
                ws.close();
            };

        } catch (error) {
            console.error('WebSocket connection failed:', error);
        }
    }, [enabled, symbols, onUpdate]);

    const disconnect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
    }, []);

    const reconnect = useCallback(() => {
        disconnect();
        connect();
    }, [disconnect, connect]);

    // Connect on mount
    useEffect(() => {
        if (enabled) {
            connect();
        }
        return () => disconnect();
    }, [enabled, connect, disconnect]);

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
