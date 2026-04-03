// Price Alerts Widget - Set and manage price alerts with browser notifications

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, Plus, X, ArrowUp, ArrowDown, Check, Percent, BellOff, BellRing, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { config } from '@/lib/config';
import { formatTimestamp } from '@/lib/format';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { fetchStockQuote, quoteQueryKey } from '@/lib/queries';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '@/lib/pollingPolicy';
import { useDashboard } from '@/contexts/DashboardContext';
import { useDashboardWidget } from '@/hooks/useDashboardWidget';

// ============ Types ============

export interface PriceAlert {
    id: string;
    symbol: string;
    condition: 'above' | 'below' | 'change_up' | 'change_down';
    threshold: number;
    createdAt: string;
    triggeredAt?: string;
    isActive: boolean;
    notificationSent: boolean;
    lastPrice?: number;
}

interface PriceUpdate {
    symbol: string;
    price: number;
    change: number;
    change_pct: number;
    volume: number;
    timestamp: string;
}

interface PriceAlertsWidgetProps {
    id: string;
    symbol?: string;
    config?: Record<string, unknown>;
    isEditing?: boolean;
    onRemove?: () => void;
}

// ============ Constants ============

const STORAGE_KEY = 'vnibb_price_alerts';
const PERMISSION_KEY = 'vnibb_notification_permission';
const WS_URL = config.wsPriceUrl;
const MAX_WS_RECONNECT_ATTEMPTS = config.isProd ? 10 : 5;

// ============ Notification Service ============

class NotificationService {
    private static instance: NotificationService;
    private permission: NotificationPermission = 'default';

    static getInstance(): NotificationService {
        if (!NotificationService.instance) {
            NotificationService.instance = new NotificationService();
        }
        return NotificationService.instance;
    }

    async requestPermission(): Promise<boolean> {
        if (!('Notification' in window)) {
            console.warn('Browser does not support notifications');
            return false;
        }

        try {
            this.permission = await Notification.requestPermission();
            localStorage.setItem(PERMISSION_KEY, this.permission);
            return this.permission === 'granted';
        } catch (error) {
            console.error('Failed to request notification permission:', error);
            return false;
        }
    }

    getPermission(): NotificationPermission {
        if (!('Notification' in window)) return 'denied';
        return Notification.permission;
    }

    isGranted(): boolean {
        return this.getPermission() === 'granted';
    }

    show(title: string, options?: NotificationOptions): Notification | null {
        if (!this.isGranted()) return null;

        try {
            const notification = new Notification(title, {
                icon: '/favicon.ico',
                badge: '/favicon.ico',
                ...options,
            });

            // Auto-close after 10 seconds
            setTimeout(() => notification.close(), 10000);

            return notification;
        } catch (error) {
            console.error('Failed to show notification:', error);
            return null;
        }
    }
}

// ============ Alert Storage ============

function loadLegacyAlerts(): PriceAlert[] {
    if (typeof window === 'undefined') return [];
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

function hasOwnConfigKey(config: Record<string, unknown> | undefined, key: string): boolean {
    return Boolean(config) && Object.prototype.hasOwnProperty.call(config, key);
}

function parsePersistedAlerts(config: Record<string, unknown> | undefined): PriceAlert[] {
    const rawValue = config?.alerts;
    if (!Array.isArray(rawValue)) {
        return hasOwnConfigKey(config, 'alerts') ? [] : loadLegacyAlerts();
    }

    return rawValue.filter((alert): alert is PriceAlert => {
        if (!alert || typeof alert !== 'object') return false;
        const candidate = alert as Partial<PriceAlert>;
        return typeof candidate.id === 'string'
            && typeof candidate.symbol === 'string'
            && typeof candidate.condition === 'string'
            && typeof candidate.threshold === 'number'
            && typeof candidate.createdAt === 'string'
            && typeof candidate.isActive === 'boolean'
            && typeof candidate.notificationSent === 'boolean';
    });
}

// ============ Alert Checker ============

function checkAlert(alert: PriceAlert, currentPrice: number, previousPrice?: number): boolean {
    if (!alert.isActive || alert.triggeredAt) return false;

    switch (alert.condition) {
        case 'above':
            return currentPrice >= alert.threshold;
        case 'below':
            return currentPrice <= alert.threshold;
        case 'change_up':
            if (!previousPrice || previousPrice === 0) return false;
            const changeUp = ((currentPrice - previousPrice) / previousPrice) * 100;
            return changeUp >= alert.threshold;
        case 'change_down':
            if (!previousPrice || previousPrice === 0) return false;
            const changeDown = ((previousPrice - currentPrice) / previousPrice) * 100;
            return changeDown >= alert.threshold;
        default:
            return false;
    }
}

function formatCondition(condition: PriceAlert['condition']): string {
    switch (condition) {
        case 'above': return 'Price Above';
        case 'below': return 'Price Below';
        case 'change_up': return 'Change +%';
        case 'change_down': return 'Change -%';
    }
}

function formatThreshold(alert: PriceAlert): string {
    if (alert.condition === 'change_up' || alert.condition === 'change_down') {
        return `${alert.threshold.toFixed(1)}%`;
    }
    return alert.threshold.toLocaleString();
}

// ============ Component ============

export function PriceAlertsWidget({ id, symbol: initialSymbol, config: widgetConfig }: PriceAlertsWidgetProps) {
    const { updateWidget } = useDashboard();
    const widgetLocation = useDashboardWidget(id);
    const queryClient = useQueryClient();
    const [alerts, setAlerts] = useState<PriceAlert[]>(() => parsePersistedAlerts(widgetConfig));
    const [showAdd, setShowAdd] = useState(false);
    const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
    const [newAlert, setNewAlert] = useState({
        symbol: initialSymbol || '',
        condition: 'above' as PriceAlert['condition'],
        threshold: '',
    });
    const [wsConnected, setWsConnected] = useState(false);

    const wsRef = useRef<WebSocket | null>(null);
    const pollIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttemptRef = useRef(0);
    const shouldReconnectRef = useRef(true);
    const priceCacheRef = useRef<Record<string, number>>({});
    const notificationServiceRef = useRef(NotificationService.getInstance());

    // Load alerts and check permission on mount
    useEffect(() => {
        setAlerts(parsePersistedAlerts(widgetConfig));
        setNotificationPermission(notificationServiceRef.current.getPermission());
    }, [widgetConfig]);

    // Persist alerts in widget config so they follow dashboard sync instead of separate browser-only storage.
    useEffect(() => {
        if (!widgetLocation) {
            return;
        }

        const currentAlerts = Array.isArray(widgetLocation.widget.config?.alerts)
            ? widgetLocation.widget.config?.alerts
            : [];

        if (JSON.stringify(currentAlerts) === JSON.stringify(alerts)) {
            return;
        }

        updateWidget(widgetLocation.dashboardId, widgetLocation.tabId, id, {
            config: {
                ...widgetLocation.widget.config,
                alerts,
            },
        });
    }, [alerts, id, updateWidget, widgetLocation]);

    // Get unique symbols from active alerts
    const activeSymbols = [...new Set(
        alerts.filter(a => a.isActive && !a.triggeredAt).map(a => a.symbol)
    )];

    // WebSocket connection for real-time price updates
    useEffect(() => {
        shouldReconnectRef.current = true;

        if (activeSymbols.length === 0) {
            // No active alerts, close WebSocket
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            reconnectAttemptRef.current = 0;
            setWsConnected(false);
            return;
        }

        const connectWebSocket = () => {
            if (!shouldReconnectRef.current) return;
            if (!WS_URL) {
                setWsConnected(false);
                return;
            }
            if (reconnectAttemptRef.current >= MAX_WS_RECONNECT_ATTEMPTS) {
                setWsConnected(false);
                return;
            }

            try {
                const ws = new WebSocket(WS_URL);

                ws.onopen = () => {
                    setWsConnected(true);
                    reconnectAttemptRef.current = 0;
                    if (reconnectTimeoutRef.current) {
                        clearTimeout(reconnectTimeoutRef.current);
                        reconnectTimeoutRef.current = null;
                    }
                    // Subscribe to all active alert symbols
                    ws.send(JSON.stringify({
                        action: 'subscribe',
                        symbols: activeSymbols,
                    }));
                };

                ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data) as PriceUpdate | { type: string };
                        if ('type' in data && data.type === 'market_status') return;

                        const priceUpdate = data as PriceUpdate;
                        if (priceUpdate.symbol && priceUpdate.price) {
                            handlePriceUpdate(priceUpdate.symbol, priceUpdate.price);
                        }
                    } catch (e) {
                        console.debug('WebSocket message parse error:', e);
                    }
                };

                ws.onclose = () => {
                    setWsConnected(false);
                    if (!shouldReconnectRef.current) return;
                    const attempt = reconnectAttemptRef.current;
                    if (attempt >= MAX_WS_RECONNECT_ATTEMPTS) return;

                    const delayMs = Math.min(1000 * Math.pow(2, attempt), 30000);
                    reconnectAttemptRef.current = attempt + 1;

                    reconnectTimeoutRef.current = setTimeout(() => {
                        connectWebSocket();
                    }, delayMs);
                };

                ws.onerror = () => {
                    setWsConnected(false);
                };

                wsRef.current = ws;
            } catch (error) {
                console.error('WebSocket connection failed:', error);
                setWsConnected(false);
            }
        };

        connectWebSocket();

        return () => {
            shouldReconnectRef.current = false;
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [activeSymbols.join(',')]);

    // Fallback polling when WebSocket is not connected
    useEffect(() => {
        if (wsConnected || activeSymbols.length === 0) {
            if (pollIntervalRef.current) {
                clearTimeout(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
            return;
        }

        const pollPrices = async () => {
            if (typeof document !== 'undefined' && document.hidden) {
                return;
            }

            if (typeof navigator !== 'undefined' && !navigator.onLine) {
                return;
            }

            for (const symbol of activeSymbols) {
                try {
                    const quote = await queryClient.fetchQuery({
                        queryKey: quoteQueryKey(symbol),
                        queryFn: ({ signal }) => fetchStockQuote(symbol, signal),
                        staleTime: 30 * 1000,
                    });

                    if (quote.price) {
                        handlePriceUpdate(symbol, quote.price);
                    }
                } catch (error) {
                    console.debug(`Failed to poll price for ${symbol}:`, error);
                }
            }
        };

        const scheduleNextPoll = () => {
            const nextInterval = getAdaptiveRefetchInterval(POLLING_PRESETS.alerts);
            const delay = nextInterval === false ? 60_000 : nextInterval;

            pollIntervalRef.current = setTimeout(async () => {
                await pollPrices();
                scheduleNextPoll();
            }, delay);
        };

        pollPrices();
        scheduleNextPoll();

        return () => {
            if (pollIntervalRef.current) {
                clearTimeout(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
        };
    }, [wsConnected, activeSymbols.join(','), queryClient]);

    // Trigger browser notification for alert
    const triggerAlertNotification = useCallback((alert: PriceAlert, currentPrice: number) => {
        const conditionText = alert.condition === 'above' ? 'exceeded' :
            alert.condition === 'below' ? 'dropped below' :
            alert.condition === 'change_up' ? 'increased by' : 'decreased by';

        const thresholdText = alert.condition.includes('change') 
            ? `${alert.threshold}%` 
            : alert.threshold.toLocaleString();

        notificationServiceRef.current.show(`${alert.symbol} Alert Triggered`, {
            body: `Price ${conditionText} ${thresholdText}. Current: ${currentPrice.toLocaleString()}`,
            tag: alert.id,
            requireInteraction: true,
        });
    }, []);

    // Handle price update and check alerts
    const handlePriceUpdate = useCallback((symbol: string, price: number) => {
        const previousPrice = priceCacheRef.current[symbol];
        priceCacheRef.current[symbol] = price;
        
        // Check alerts for this symbol
        setAlerts(currentAlerts => {
            let hasChanges = false;
            const updatedAlerts = currentAlerts.map(alert => {
                if (alert.symbol !== symbol || !alert.isActive || alert.triggeredAt) {
                    return alert;
                }

                const triggered = checkAlert(alert, price, previousPrice);
                if (triggered) {
                    hasChanges = true;
                    // Trigger notification
                    triggerAlertNotification(alert, price);
                    return {
                        ...alert,
                        triggeredAt: new Date().toISOString(),
                        notificationSent: true,
                        lastPrice: price,
                    };
                }
                return { ...alert, lastPrice: price };
            });

            return hasChanges ? updatedAlerts : currentAlerts;
        });
    }, [triggerAlertNotification]);

    // Request notification permission
    const handleRequestPermission = async () => {
        const granted = await notificationServiceRef.current.requestPermission();
        setNotificationPermission(granted ? 'granted' : 'denied');
    };

    // Add new alert
    const addAlert = () => {
        if (!newAlert.symbol || !newAlert.threshold) return;

        const alert: PriceAlert = {
            id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            symbol: newAlert.symbol.toUpperCase().trim(),
            condition: newAlert.condition,
            threshold: parseFloat(newAlert.threshold),
            createdAt: new Date().toISOString(),
            isActive: true,
            notificationSent: false,
        };

        setAlerts(prev => [...prev, alert]);
        setNewAlert({ symbol: '', condition: 'above', threshold: '' });
        setShowAdd(false);
    };

    // Remove alert
    const removeAlert = (id: string) => {
        setAlerts(prev => prev.filter(a => a.id !== id));
    };

    // Toggle alert active state
    const toggleAlert = (id: string) => {
        setAlerts(prev => prev.map(a => 
            a.id === id ? { ...a, isActive: !a.isActive } : a
        ));
    };

    // Clear all triggered alerts
    const clearTriggered = () => {
        setAlerts(prev => prev.filter(a => !a.triggeredAt));
    };

    const activeAlerts = alerts.filter(a => a.isActive && !a.triggeredAt);
    const triggeredAlerts = alerts.filter(a => a.triggeredAt);
    const inactiveAlerts = alerts.filter(a => !a.isActive && !a.triggeredAt);

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--border-color)]">
                <div className="flex items-center gap-2 text-xs">
                    <Bell size={12} className="text-yellow-400" />
                    <span className="text-[var(--text-muted)]">{activeAlerts.length} active</span>
                    {wsConnected && (
                        <span className="flex items-center gap-1 text-green-500">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                            Live
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <WidgetMeta note={wsConnected ? 'Live stream' : 'Polling'} align="right" />
                    {notificationPermission !== 'granted' && (
                        <button
                            onClick={handleRequestPermission}
                            className="p-1 text-yellow-500 hover:text-yellow-400 hover:bg-[var(--bg-hover)] rounded"
                            title="Enable notifications"
                        >
                            <BellOff size={12} />
                        </button>
                    )}
                    <button
                        onClick={() => setShowAdd(!showAdd)}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded"
                    >
                        <Plus size={12} />
                    </button>
                </div>
            </div>

            {/* Notification Permission Banner */}
            {notificationPermission === 'default' && (
                <div className="px-2 py-1.5 bg-yellow-500/10 border-b border-yellow-500/20">
                    <button
                        onClick={handleRequestPermission}
                        className="flex items-center gap-2 text-xs text-yellow-400 hover:text-yellow-300 w-full"
                    >
                        <BellRing size={12} />
                        <span>Enable browser notifications for alerts</span>
                    </button>
                </div>
            )}

            {/* Add Form */}
            {showAdd && (
                <div className="px-2 py-2 border-b border-[var(--border-color)] space-y-2 bg-[var(--bg-secondary)]">
                    <div className="flex gap-1">
                        <input
                            type="text"
                            placeholder="Symbol"
                            value={newAlert.symbol}
                            onChange={(e) => setNewAlert({ ...newAlert, symbol: e.target.value.toUpperCase() })}
                            className="w-20 bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs px-2 py-1.5 rounded border border-[var(--border-color)] focus:border-blue-500 focus:outline-none"
                            maxLength={10}
                        />
                        <select
                            value={newAlert.condition}
                            onChange={(e) => setNewAlert({ ...newAlert, condition: e.target.value as PriceAlert['condition'] })}
                            className="bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs px-2 py-1.5 rounded border border-[var(--border-color)] focus:border-blue-500 focus:outline-none"
                        >
                            <option value="above">Price Above</option>
                            <option value="below">Price Below</option>
                            <option value="change_up">Change +%</option>
                            <option value="change_down">Change -%</option>
                        </select>
                    </div>
                    <div className="flex gap-1">
                        <input
                            type="number"
                            placeholder={newAlert.condition.includes('change') ? 'Percent' : 'Price'}
                            value={newAlert.threshold}
                            onChange={(e) => setNewAlert({ ...newAlert, threshold: e.target.value })}
                            className="flex-1 bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs px-2 py-1.5 rounded border border-[var(--border-color)] focus:border-blue-500 focus:outline-none"
                            min={0}
                            step={newAlert.condition.includes('change') ? 0.1 : 100}
                        />
                        <button
                            onClick={addAlert}
                            disabled={!newAlert.symbol || !newAlert.threshold}
                            className="px-3 bg-yellow-600 hover:bg-yellow-500 disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-muted)] text-white text-xs rounded font-medium transition-colors"
                        >
                            Add
                        </button>
                    </div>
                </div>
            )}

            {/* Alerts List */}
            <div className="flex-1 overflow-auto">
                {alerts.length === 0 ? (
                    <WidgetEmpty
                        message="No price alerts set"
                        icon={<Bell size={18} />}
                        action={{ label: 'Create alert', onClick: () => setShowAdd(true) }}
                    />
                ) : (
                    <div className="p-1 space-y-1">
                        {/* Active Alerts */}
                        {activeAlerts.length > 0 && (
                            <>
                                <div className="text-[10px] text-[var(--text-muted)] px-1 pt-1 uppercase tracking-wider">Active</div>
                                {activeAlerts.map((alert) => (
                                    <AlertItem
                                        key={alert.id}
                                        alert={alert}
                                        onRemove={removeAlert}
                                        onToggle={toggleAlert}
                                    />
                                ))}
                            </>
                        )}

                        {/* Inactive Alerts */}
                        {inactiveAlerts.length > 0 && (
                            <>
                                <div className="text-[10px] text-[var(--text-muted)] px-1 pt-2 uppercase tracking-wider">Paused</div>
                                {inactiveAlerts.map((alert) => (
                                    <AlertItem
                                        key={alert.id}
                                        alert={alert}
                                        onRemove={removeAlert}
                                        onToggle={toggleAlert}
                                    />
                                ))}
                            </>
                        )}

                        {/* Triggered Alerts */}
                        {triggeredAlerts.length > 0 && (
                            <>
                                <div className="flex items-center justify-between px-1 pt-2">
                                    <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Triggered</span>
                                    <button
                                        onClick={clearTriggered}
                                        className="text-[10px] text-[var(--text-muted)] hover:text-red-400 flex items-center gap-1"
                                    >
                                        <Trash2 size={10} />
                                        Clear
                                    </button>
                                </div>
                                {triggeredAlerts.map((alert) => (
                                    <TriggeredAlertItem
                                        key={alert.id}
                                        alert={alert}
                                        onRemove={removeAlert}
                                    />
                                ))}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ============ Sub-components ============

interface AlertItemProps {
    alert: PriceAlert;
    onRemove: (id: string) => void;
    onToggle: (id: string) => void;
}

function AlertItem({ alert, onRemove, onToggle }: AlertItemProps) {
    const isPercentCondition = alert.condition.includes('change');
    const Icon = alert.condition === 'above' || alert.condition === 'change_up' ? ArrowUp : ArrowDown;
    const iconColor = alert.condition === 'above' || alert.condition === 'change_up' ? 'text-green-400' : 'text-red-400';

    return (
        <div
            className={`flex items-center justify-between p-2 rounded transition-colors group ${
                alert.isActive ? 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]' : 'bg-[var(--bg-primary)] opacity-60'
            }`}
        >
            <div className="flex items-center gap-2 min-w-0">
                {isPercentCondition ? (
                    <Percent size={14} className={iconColor} />
                ) : (
                    <Icon size={14} className={iconColor} />
                )}
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)]">{alert.symbol}</span>
                        <span className="text-xs text-[var(--text-secondary)] truncate">
                            {formatCondition(alert.condition)} {formatThreshold(alert)}
                        </span>
                    </div>
                    {alert.lastPrice && (
                        <span className="text-[10px] text-[var(--text-muted)]">
                            Current: {alert.lastPrice.toLocaleString()}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={() => onToggle(alert.id)}
                    className="p-1 text-[var(--text-muted)] hover:text-blue-400"
                    title={alert.isActive ? 'Pause alert' : 'Resume alert'}
                >
                    {alert.isActive ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                </button>
                <button
                    onClick={() => onRemove(alert.id)}
                    className="p-1 text-[var(--text-muted)] hover:text-red-400"
                    title="Delete alert"
                >
                    <X size={12} />
                </button>
            </div>
        </div>
    );
}

interface TriggeredAlertItemProps {
    alert: PriceAlert;
    onRemove: (id: string) => void;
}

function TriggeredAlertItem({ alert, onRemove }: TriggeredAlertItemProps) {
    const triggeredLabel = alert.triggeredAt ? formatTimestamp(alert.triggeredAt) : '—';

    return (
        <div className="flex items-center justify-between p-2 rounded bg-green-500/10 border border-green-500/20 group">
            <div className="flex items-center gap-2 min-w-0">
                <Check size={14} className="text-green-400 shrink-0" />
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-green-400">{alert.symbol}</span>
                        <span className="text-xs text-[var(--text-secondary)] truncate">
                            {formatCondition(alert.condition)} {formatThreshold(alert)}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                        {alert.lastPrice && <span>At {alert.lastPrice.toLocaleString()}</span>}
                        <span>• {triggeredLabel}</span>
                    </div>
                </div>
            </div>
            <button
                onClick={() => onRemove(alert.id)}
                className="p-1 text-[var(--text-muted)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
                <X size={12} />
            </button>
        </div>
    );
}

