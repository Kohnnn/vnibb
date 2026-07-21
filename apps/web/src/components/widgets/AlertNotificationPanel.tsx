// Alert Notification Panel - Bell icon with dropdown for insider alerts

'use client';

import { useState, useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getInsiderAlerts, markAlertRead } from '@/lib/api';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '@/lib/pollingPolicy';
import { formatTimestamp } from '@/lib/format';
import { markAlertActivityRead, readAlertActivity, recordAlertActivity, subscribeAlertActivity, type AlertActivity } from '@/lib/alertActivity';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import { normalizeTickerSymbol } from '@/lib/defaultTicker';

interface AlertNotificationPanelProps {
  userId?: number;
  onDataChange?: (data: WidgetDataPayload) => void;
}


export function AlertNotificationPanel({ userId = 1, onDataChange }: AlertNotificationPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showUnreadOnly, setShowUnreadOnly] = useState(true);
  const [activity, setActivity] = useState<AlertActivity[]>([]);
  const queryClient = useQueryClient();
  const { setLinkedSymbol } = useWidgetSymbolLink(undefined, { widgetType: 'alert_notification_panel' });

  const { data: alerts = [], isLoading } = useQuery({
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
      extra: {
        alertCount: activity.length,
        unreadCount,
        serverBackedCount: activity.filter((item) => item.serverBacked).length,
      },
    }));
  }, [activity, onDataChange, unreadCount]);

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
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Alert activity${unreadCount ? `, ${unreadCount} unread` : ''}`}
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
            onClick={() => setIsOpen(false)}
          />

          {/* Panel */}
          <div className="absolute right-0 top-full z-50 mt-2 flex max-h-[600px] w-96 flex-col rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-3">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-[var(--text-secondary)]" />
                <h3 className="text-sm font-medium text-[var(--text-primary)]">Alerts</h3>
                {unreadCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-red-500/20 text-red-400 rounded">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close alert activity"
                className="min-h-9 min-w-9 rounded p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                <X size={16} />
              </button>
            </div>

            {/* Filter Toggle */}
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-3">
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

            {/* Alerts List */}
            <div className="flex-1 overflow-y-auto">
              {isLoading && activity.length === 0 ? (
                <div className="p-4 space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <div className="mb-2 h-4 w-3/4 rounded bg-[var(--bg-tertiary)]" />
                      <div className="h-3 w-1/2 rounded bg-[var(--bg-tertiary)]" />
                    </div>
                  ))}
                </div>
              ) : visibleActivity.length === 0 ? (
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
