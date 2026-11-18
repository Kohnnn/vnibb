// Price Alerts Widget - Set and manage price alerts with browser notifications

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, Plus, X, ArrowUp, ArrowDown, Check, Percent, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { formatTimestamp } from '@/lib/formatDate';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { logClientWarn } from '@/lib/clientLogger';
import { fetchStockQuote, quoteQueryKey } from '@/lib/queries';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '@/lib/pollingPolicy';
import { useDashboard } from '@/contexts/DashboardContext';
import { useDashboardWidget } from '@/hooks/useDashboardWidget';
import { useWebSocket } from '@/lib/hooks/useWebSocket';
import { recordAlertActivity } from '@/lib/alertActivity';
import { sendDesktopAlerts } from '@/lib/desktopAlertDelivery';
import { normalizeTickerSymbol } from '@/lib/defaultTicker';
import { EMPTY_VALUE } from '@/lib/units';

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

interface PriceAlertsWidgetProps {
    id: string;
    symbol?: string;
    config?: Record<string, unknown>;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: WidgetDataPayload) => void;
}

// ============ Constants ============

const STORAGE_KEY = 'vnibb_price_alerts';

// ============ Alert Storage ============

function loadLegacyAlerts(): unknown {
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
    const rawValue = hasOwnConfigKey(config, 'alerts') ? config?.alerts : loadLegacyAlerts();
    if (!Array.isArray(rawValue)) return [];

    return rawValue.filter((alert): alert is PriceAlert => {
        if (!alert || typeof alert !== 'object') return false;
        const candidate = alert as Partial<PriceAlert>;
        return typeof candidate.id === 'string'
            && typeof candidate.symbol === 'string'
            && normalizeTickerSymbol(candidate.symbol) !== null
            && (candidate.condition === 'above' || candidate.condition === 'below' || candidate.condition === 'change_up' || candidate.condition === 'change_down')
            && typeof candidate.threshold === 'number'
            && Number.isFinite(candidate.threshold)
            && candidate.threshold > 0
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

export function isValidAlertThreshold(value: string): boolean {
    const threshold = Number(value);
    return value.trim() !== '' && Number.isFinite(threshold) && threshold > 0;
}

function formatThreshold(alert: PriceAlert): string {
    if (alert.condition === 'change_up' || alert.condition === 'change_down') {
        return `${alert.threshold.toFixed(1)}%`;
    }
    return alert.threshold.toLocaleString();
}

// ============ Component ============

export function PriceAlertsWidget({ id, symbol: initialSymbol, config: widgetConfig, onDataChange }: PriceAlertsWidgetProps) {
    const { updateWidget } = useDashboard();
    const widgetLocation = useDashboardWidget(id);
    const queryClient = useQueryClient();
    const [alerts, setAlerts] = useState<PriceAlert[]>(() => parsePersistedAlerts(widgetConfig));
    const [showAdd, setShowAdd] = useState(false);
    const [newAlert, setNewAlert] = useState({
        symbol: initialSymbol || '',
        condition: 'above' as PriceAlert['condition'],
        threshold: '',
    });

    // Feed ticks can arrive in a batch before React commits. Update the rules
    // synchronously, without putting storage or delivery inside a React updater.
    const alertsRef = useRef(alerts);
    const priceCacheRef = useRef<Record<string, number>>({});
    const replaceAlerts = useCallback((next: PriceAlert[]) => {
        alertsRef.current = next;
        setAlerts(next);
    }, []);

    useEffect(() => {
        replaceAlerts(parsePersistedAlerts(widgetConfig));
    }, [replaceAlerts, widgetConfig]);

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

    const handlePriceUpdate = useCallback((symbol: string, price: number, deliveryClass: 'browser_local' | 'polled') => {
        if (!Number.isFinite(price)) return;
        const previousPrice = priceCacheRef.current[symbol];
        priceCacheRef.current[symbol] = price;
        const matches = alertsRef.current.filter((alert) => alert.symbol === symbol && checkAlert(alert, price, previousPrice));
        if (matches.length === 0) return;

        const triggerTime = new Date().toISOString();
        const events = matches.map((alert) => ({
            // A price rule fires just once; a recreated rule has a new ID.
            id: `price:${alert.id}`,
            triggerTime,
            title: `${alert.symbol} price alert triggered`,
            detail: `${formatCondition(alert.condition)} ${formatThreshold(alert)} at ${price.toLocaleString()}`,
        }));
        for (const [index, event] of events.entries()) {
            recordAlertActivity({
                ...event,
                source: 'price',
                deliveryClass,
                serverBacked: false,
                symbol: matches[index].symbol,
            });
        }
        const notificationSent = sendDesktopAlerts(events);
        const matchedIds = new Set(matches.map((alert) => alert.id));
        replaceAlerts(alertsRef.current.map((alert) => matchedIds.has(alert.id)
            ? { ...alert, triggeredAt: triggerTime, notificationSent, lastPrice: price }
            : alert));
    }, [replaceAlerts]);

    const activeSymbols = [...new Set(alerts.filter((alert) => alert.isActive && !alert.triggeredAt).map((alert) => alert.symbol))];
    const activeSymbolsKey = activeSymbols.join(',');

    // Only fresh admitted observations suppress the existing HTTP fallback.
    const { isReceiving: wsConnected } = useWebSocket({
        symbols: activeSymbols,
        enabled: activeSymbols.length > 0,
        onUpdate: (update) => {
            if (!update.stale && update.symbol) handlePriceUpdate(update.symbol, update.price, 'browser_local');
        },
    });

    useEffect(() => {
        if (wsConnected || !activeSymbolsKey) return;
        const symbols = activeSymbolsKey.split(',');
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const pollPrices = async () => {
            if (document.hidden || !navigator.onLine) return;
            for (const symbol of symbols) {
                if (cancelled) return;
                try {
                    const quote = await queryClient.fetchQuery({
                        queryKey: quoteQueryKey(symbol),
                        queryFn: ({ signal }) => fetchStockQuote(symbol, signal),
                        staleTime: 30 * 1000,
                    });
                    if (!cancelled && !quote.stale && quote.price !== null && quote.price_unit === 'VND') {
                        handlePriceUpdate(symbol, quote.price, 'polled');
                    }
                } catch (error) {
                    if (!cancelled) logClientWarn(`Failed to poll price for ${symbol}:`, error);
                }
            }
        };

        const pollAndSchedule = async () => {
            await pollPrices();
            if (cancelled) return;
            const interval = getAdaptiveRefetchInterval(POLLING_PRESETS.alerts);
            timer = setTimeout(pollAndSchedule, interval === false ? 60_000 : interval);
        };
        void pollAndSchedule();

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [activeSymbolsKey, handlePriceUpdate, queryClient, wsConnected]);

    const openAddForm = () => {
        if (showAdd) {
            setShowAdd(false);
            return;
        }
        setNewAlert((current) => ({ ...current, symbol: normalizeTickerSymbol(initialSymbol) ?? '' }));
        setShowAdd(true);
    };

    const duplicateAlert = alerts.some(alert =>
        normalizeTickerSymbol(alert.symbol) === normalizeTickerSymbol(newAlert.symbol)
        && alert.condition === newAlert.condition
        && alert.threshold === Number(newAlert.threshold)
    );

    // Add new alert
    const addAlert = () => {
        const symbol = normalizeTickerSymbol(newAlert.symbol);
        if (!symbol || !isValidAlertThreshold(newAlert.threshold) || duplicateAlert) return;

        const alert: PriceAlert = {
            id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            symbol,
            condition: newAlert.condition,
            threshold: Number(newAlert.threshold),
            createdAt: new Date().toISOString(),
            isActive: true,
            notificationSent: false,
        };

        if (alertsRef.current.some((existing) =>
            normalizeTickerSymbol(existing.symbol) === symbol
            && existing.condition === alert.condition
            && existing.threshold === alert.threshold
        )) return;
        replaceAlerts([...alertsRef.current, alert]);
        setNewAlert({ symbol: '', condition: 'above', threshold: '' });
        setShowAdd(false);
    };

    const removeAlert = (id: string) => replaceAlerts(alertsRef.current.filter((alert) => alert.id !== id));
    const toggleAlert = (id: string) => replaceAlerts(alertsRef.current.map((alert) =>
        alert.id === id ? { ...alert, isActive: !alert.isActive } : alert));
    const clearTriggered = () => replaceAlerts(alertsRef.current.filter((alert) => !alert.triggeredAt));

    const activeAlerts = alerts.filter(a => a.isActive && !a.triggeredAt);
    const triggeredAlerts = alerts.filter(a => a.triggeredAt);
    const inactiveAlerts = alerts.filter(a => !a.isActive && !a.triggeredAt);

    useEffect(() => {
        onDataChange?.(buildWidgetRuntime({
            empty: alerts.length === 0,
            apiGroup: '/alerts',
            endpoint: '/api/v1/alerts/price',
            sourceLabel: wsConnected ? 'Live stream' : 'Polling',
            extra: {
                alertCount: alerts.length,
                activeCount: activeAlerts.length,
                triggeredCount: triggeredAlerts.length,
            },
        }));
    }, [activeAlerts.length, alerts.length, onDataChange, triggeredAlerts.length, wsConnected]);

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--border-color)]">
                <div className="flex items-center gap-2 text-xs">
                    <Bell size={12} className="text-[var(--color-accent-primary)]" />
                    <span className="text-[var(--text-muted)]">{activeAlerts.length} active</span>
                    {wsConnected && (
                        <span className="flex items-center gap-1 text-[var(--color-accent-primary)]">
                            <span className="w-1.5 h-1.5 bg-[var(--color-accent-fill)] rounded-full animate-pulse" />
                            Live
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <WidgetMeta note={wsConnected ? 'Live stream' : 'Polling'} align="right" />
                    <button
                        type="button"
                        onClick={openAddForm}
                        aria-label={showAdd ? 'Close price alert form' : 'Add price alert'}
                        className="min-h-11 min-w-11 rounded p-2 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                    >
                        <Plus size={12} />
                    </button>
                </div>
            </div>
            <p className="px-2 py-1.5 text-[10px] text-[var(--text-muted)]">
                Browser-local alert checks. Rules are saved in this dashboard. Checks run only while this page is open and market data is available. Matches appear in the alert inbox. Desktop alerts are optional in Settings &gt; Notifications; not server, email, or SMS delivery.
            </p>

            {/* Add Form */}
            {showAdd && (
                <div className="px-2 py-2 border-b border-[var(--border-color)] space-y-2 bg-[var(--bg-secondary)]">
                    <div className="flex gap-1">
                        <input
                            type="text"
                            aria-label="Alert symbol"
                            placeholder="Symbol"
                            value={newAlert.symbol}
                            onChange={(e) => setNewAlert({ ...newAlert, symbol: e.target.value.toUpperCase() })}
                            className="w-20 bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs px-2 py-1.5 rounded border border-[var(--border-color)] focus:border-[var(--color-state-border)] focus:outline-none"
                            maxLength={10}
                        />
                        <select
                            aria-label="Alert condition"
                            value={newAlert.condition}
                            onChange={(e) => setNewAlert({ ...newAlert, condition: e.target.value as PriceAlert['condition'] })}
                            className="bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs px-2 py-1.5 rounded border border-[var(--border-color)] focus:border-[var(--color-state-border)] focus:outline-none"
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
                            aria-label="Alert threshold"
                            placeholder={newAlert.condition.includes('change') ? 'Percent' : 'Price'}
                            value={newAlert.threshold}
                            onChange={(e) => setNewAlert({ ...newAlert, threshold: e.target.value })}
                            className="flex-1 bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs px-2 py-1.5 rounded border border-[var(--border-color)] focus:border-[var(--color-state-border)] focus:outline-none"
                            min={0}
                            step={newAlert.condition.includes('change') ? 0.1 : 100}
                        />
                        <button
                            type="button"
                            onClick={addAlert}
                            disabled={!normalizeTickerSymbol(newAlert.symbol) || !isValidAlertThreshold(newAlert.threshold) || duplicateAlert}
                            className="min-h-11 rounded bg-[var(--color-accent-fill)] px-3 text-xs font-medium text-[var(--color-on-accent)] transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-muted)]"
                        >
                            Add
                        </button>
                    </div>
                    {duplicateAlert && <p role="status" className="text-xs text-[var(--color-warning)]">This alert already exists. Resume or delete the existing rule instead.</p>}
                </div>
            )}

            {/* Alerts List */}
            <div className="flex-1 overflow-auto">
                {alerts.length === 0 ? (
                    <WidgetEmpty
                        message="No price alerts set"
                        icon={<Bell size={18} />}
                        action={{ label: 'Create alert', onClick: openAddForm }}
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
                                        className="text-[10px] text-[var(--text-muted)] hover:text-[var(--color-negative)] flex items-center gap-1"
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
    // A threshold's direction is not a gain or a loss: the arrow carries the
    // direction, the colour stays interaction blue (#200).
    const iconColor = 'text-[var(--color-accent-primary)]';

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
                        <span className="break-words whitespace-normal text-xs text-[var(--text-secondary)]">
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
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => onToggle(alert.id)}
                    aria-label={`${alert.isActive ? 'Pause' : 'Resume'} ${alert.symbol} alert`}
                    className="flex min-h-11 min-w-11 items-center justify-center text-[var(--text-muted)] hover:text-[var(--color-accent-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                    title={alert.isActive ? 'Pause alert' : 'Resume alert'}
                >
                    {alert.isActive ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                </button>
                <button
                    type="button"
                    onClick={() => onRemove(alert.id)}
                    aria-label={`Delete ${alert.symbol} alert`}
                    className="flex min-h-11 min-w-11 items-center justify-center text-[var(--text-muted)] hover:text-[var(--color-negative)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
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
    const triggeredLabel = alert.triggeredAt ? formatTimestamp(alert.triggeredAt) : EMPTY_VALUE;

    return (
        <div className="flex items-center justify-between p-2 rounded bg-[var(--color-state-bg)] border border-[var(--color-state-border)] group">
            <div className="flex items-center gap-2 min-w-0">
                <Check size={14} className="text-[var(--color-accent-primary)] shrink-0" />
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)]">{alert.symbol}</span>
                        <span className="break-words whitespace-normal text-xs text-[var(--text-secondary)]">
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
                type="button"
                onClick={() => onRemove(alert.id)}
                aria-label={`Delete triggered ${alert.symbol} alert`}
                className="flex min-h-11 min-w-11 items-center justify-center text-[var(--text-muted)] hover:text-[var(--color-negative)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            >
                <X size={12} />
            </button>
        </div>
    );
}

