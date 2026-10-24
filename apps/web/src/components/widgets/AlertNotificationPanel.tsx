// Alert Notification Panel - Bell icon with dropdown for insider alerts

'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import { Bell, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getInsiderAlerts, markAlertRead } from '@/lib/api';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '@/lib/pollingPolicy';
import { formatTimestamp } from '@/lib/format';
import { markAlertActivityRead, readAlertActivity, recordAlertActivity, subscribeAlertActivity, type AlertActivity } from '@/lib/alertActivity';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap';
import { normalizeTickerSymbol } from '@/lib/defaultTicker';

interface AlertNotificationPanelProps {
  userId?: number;
  onDataChange?: (data: WidgetDataPayload) => void;
}


export function AlertNotificationPanel({ userId = 1, onDataChange }: AlertNotificationPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showUnreadOnly, setShowUnreadOnly] = useState(true);
  const [activity, setActivity] = useState<AlertActivity[]>([]);
  const panelId = useId();
  const closePanel = useCallback(() => setIsOpen(false), []);
  const panelRef = useDialogFocusTrap<HTMLDivElement>({ enabled: isOpen, onClose: closePanel });
  const queryClient = useQueryClient();
  const { setLinkedSymbol } = useWidgetSymbolLink(undefined, { widgetType: 'alert_notification_panel' });

  const { data: alerts = [], isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['insider-alerts', userId, showUnreadOnly],
    queryFn: () => getInsiderAlerts({ userId, unreadOnly: showUnreadOnly, limit: 50 }),
    refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.alerts),
    refetchIntervalInBackground: false,
    networkMode: 'online',
  });

  const markReadMutation = useMutation({
    mutationFn: (alertId: number) => markAlertRead(alertId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insider-alerts'] });
    },
  });

  const unreadCount = activity.filter((item) => !item.read).length;
  const visibleActivity = showUnreadOnly ? activity.filter((item) => !item.read) : activity;

  useEffect(() => {
    const refresh = () => setActivity(readAlertActivity());
    refresh();
    return subscribeAlertActivity(refresh);
  }, []);

  useEffect(() => {
    for (const alert of alerts) {
      recordAlertActivity({
        id: `insider:${alert.id}`,
        source: 'insider',
        triggerTime: alert.timestamp,
        deliveryClass: 'server_backed',
        serverBacked: true,
        title: alert.title,
        detail: alert.description,
        symbol: alert.symbol,
        read: alert.read,
      });
    }
  }, [alerts]);

  useEffect(() => {
    onDataChange?.(buildWidgetRuntime({
      empty: activity.length === 0,
      apiGroup: '/alerts',
      endpoint: '/api/v1/alerts/insider',
      sourceLabel: 'Browser activity + insider API',
      lastDataDate: null,
      fetchedAt: dataUpdatedAt,
      extra: {
        alertCount: activity.length,
        unreadCount,
        serverBackedCount: activity.filter((item) => item.serverBacked).length,
      },
    }));
  }, [activity, dataUpdatedAt, onDataChange, unreadCount]);

  // Request browser notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Show browser notification for new alerts
  useEffect(() => {
    if (alerts.length > 0 && 'Notification' in window && Notification.permission === 'granted') {
      const latestUnread = alerts.find((a) => !a.read);
      if (latestUnread) {
        // Only show notification if alert is very recent (< 1 minute)
        const alertTime = new Date(latestUnread.timestamp).getTime();
        const now = Date.now();
        if (now - alertTime < 60000) {
          new Notification(latestUnread.title, {
            body: latestUnread.description,
            icon: '/favicon.ico',
            tag: `alert-${latestUnread.id}`,
          });
        }
      }
    }
  }, [alerts]);

  const openActivity = (item: AlertActivity) => {
    markAlertActivityRead(item.id);
    if (item.source === 'insider' && item.serverBacked) {
      const alertId = Number(item.id.replace('insider:', ''));
      if (Number.isInteger(alertId)) markReadMutation.mutate(alertId);
    }
    const symbol = normalizeTickerSymbol(item.symbol);
    if (symbol) setLinkedSymbol(symbol);
  };

  const handleMarkAllAsRead = () => {
    activity.filter((item) => !item.read).forEach((item) => markAlertActivityRead(item.id));
    alerts.filter((alert) => !alert.read).forEach((alert) => markReadMutation.mutate(alert.id));
  };

  return (
    <div className="relative">
      {/* Bell Icon Button */}
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={`Alert activity${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-haspopup="dialog"
        className="relative min-h-11 min-w-11 rounded-lg border border-transparent p-2 text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={closePanel}
          />

          {/* Panel */}
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${panelId}-title`}
            tabIndex={-1}
            className="fixed inset-x-2 top-20 z-50 flex max-h-[min(600px,calc(100dvh-6rem))] flex-col overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 sm:max-w-[calc(100vw-1rem)]"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] p-3">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-[var(--text-secondary)]" />
                <h3 id={`${panelId}-title`} className="text-sm font-medium text-[var(--text-primary)]">Alerts</h3>
                {unreadCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-red-500/20 text-red-400 rounded">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={closePanel}
                aria-label="Close alert activity"
                className="min-h-9 min-w-9 rounded p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                <X size={16} />
              </button>
            </div>

            {/* Filter Toggle */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] p-3">
              <button
                onClick={() => setShowUnreadOnly(!showUnreadOnly)}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                {showUnreadOnly ? 'Show all' : 'Show unread only'}
              </button>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllAsRead}
                  className="text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                >
                  Mark all as read
                </button>
              )}
            </div>
            {isError && (
              <div role="alert" className="shrink-0 border-b border-[var(--border-subtle)] bg-red-500/5 p-3">
                <p className="text-sm text-red-400">Unable to load insider alerts.</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Local and previously observed activity is still available.</p>
                <button
                  type="button"
                  onClick={() => { void refetch(); }}
                  disabled={isFetching}
                  className="mt-2 min-h-9 rounded px-2 text-xs text-blue-400 hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-50"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Alerts List */}
            <div role="region" aria-label="Alert activity list" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40">
              {isLoading && visibleActivity.length === 0 ? (
                <div className="p-4 space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <div className="mb-2 h-4 w-3/4 rounded bg-[var(--bg-tertiary)]" />
                      <div className="h-3 w-1/2 rounded bg-[var(--bg-tertiary)]" />
                    </div>
                  ))}
                </div>
              ) : visibleActivity.length === 0 ? isError ? null : (
                <div className="flex h-40 flex-col items-center justify-center text-[var(--text-muted)]">
                  <Bell size={32} className="mb-2 opacity-30" />
                  <p className="text-sm">No alert activity</p>
                  <p className="text-xs mt-1">No observed {showUnreadOnly ? 'unread ' : ''}triggers.</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {visibleActivity.map((item) => {
                    const symbol = normalizeTickerSymbol(item.symbol);
                    return <button
                      key={item.id}
                      type="button"
                      onClick={() => openActivity(item)}
                      aria-label={symbol ? `Open ${symbol} from ${item.title}` : `Mark ${item.title} read`}
                      className={`min-h-11 w-full p-3 text-left transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${!item.read ? 'bg-blue-500/5' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)]">{item.title}</span>
                        {!item.read && <span className="shrink-0 text-[10px] text-blue-300">Unread</span>}
                      </div>
                      {item.detail && <p className="mt-1 line-clamp-2 text-xs text-[var(--text-secondary)]">{item.detail}</p>}
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-[var(--text-muted)]">
                        {symbol && <span className="font-medium text-blue-400">{symbol} ·</span>}
                        <span>{item.source.replace('_', ' ')} · {item.serverBacked ? 'server-backed record; delivery unverified' : `${item.deliveryClass.replace('_', ' ')} browser observation`} · {formatTimestamp(item.triggerTime)}</span>
                      </div>
                    </button>;
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
