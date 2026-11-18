'use client';

import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { Bell, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getInsiderAlerts, markAlertRead } from '@/lib/api';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '@/lib/pollingPolicy';
import { markAlertActivityRead, readAlertActivity, recordAlertActivity, subscribeAlertActivity, type AlertActivity } from '@/lib/alertActivity';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap';
import { normalizeTickerSymbol } from '@/lib/defaultTicker';
import { sendDesktopAlerts } from '@/lib/desktopAlertDelivery';
import { DesktopAlertControls } from '@/components/settings/DesktopAlertControls';
import { AlertInbox } from './AlertInbox';

interface AlertNotificationPanelProps {
  readonly userId?: number;
  readonly onDataChange?: (data: WidgetDataPayload) => void;
}

const EMPTY_ALERTS: Awaited<ReturnType<typeof getInsiderAlerts>> = [];

export function AlertNotificationPanel({ userId = 1, onDataChange }: AlertNotificationPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showUnreadOnly, setShowUnreadOnly] = useState(true);
  const [activity, setActivity] = useState<AlertActivity[]>([]);
  const [readSyncError, setReadSyncError] = useState(false);
  const panelId = useId();
  const bellRef = useRef<HTMLButtonElement>(null);
  const filterRef = useRef<HTMLButtonElement>(null);
  const closePanel = useCallback(() => setIsOpen(false), []);
  const panelRef = useDialogFocusTrap<HTMLDivElement>({ enabled: isOpen, onClose: closePanel, returnFocusTo: bellRef });
  const queryClient = useQueryClient();
  const { setLinkedSymbol } = useWidgetSymbolLink(undefined, { widgetType: 'alert_notification_panel' });

  const { data: alerts = EMPTY_ALERTS, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['insider-alerts', userId, showUnreadOnly],
    queryFn: () => getInsiderAlerts({ userId, unreadOnly: showUnreadOnly, limit: 50 }),
    refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.alerts),
    refetchIntervalInBackground: false,
    networkMode: 'online',
  });

  const markReadMutation = useMutation({
    mutationFn: (alertId: number) => markAlertRead(alertId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['insider-alerts', userId] }),
    onError: () => setReadSyncError(true),
  });

  const unreadCount = activity.filter((item) => !item.read).length;

  useEffect(() => {
    const refresh = () => setActivity(readAlertActivity());
    refresh();
    return subscribeAlertActivity(refresh);
  }, []);

  useEffect(() => {
    if (alerts.length === 0) return;
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

    // Show all can load already-read rows, and a later response can carry stale read flags.
    const readIds = new Set(readAlertActivity().filter((item) => item.source === 'insider' && item.read).map((item) => item.id));
    sendDesktopAlerts(alerts.filter((alert) => !alert.read && !readIds.has(`insider:${alert.id}`)).map((alert) => ({
      id: `insider:${userId}:${alert.id}`,
      triggerTime: alert.timestamp,
      title: alert.title,
      detail: alert.description,
    })));
  }, [alerts, userId]);

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

  const markActivityRead = (items: readonly AlertActivity[]) => {
    setReadSyncError(false);
    markAlertActivityRead(...items.map((item) => item.id));
    for (const item of items) {
      if (item.source !== 'insider' || !item.serverBacked) continue;
      const id = Number(/^insider:([1-9]\d*)$/.exec(item.id)?.[1]);
      if (Number.isSafeInteger(id)) markReadMutation.mutate(id);
    }
  };

  const openActivity = (item: AlertActivity) => {
    if (showUnreadOnly && !item.read) filterRef.current?.focus();
    markActivityRead([item]);
    const symbol = normalizeTickerSymbol(item.symbol);
    if (symbol) setLinkedSymbol(symbol);
  };

  const handleMarkAllAsRead = () => {
    filterRef.current?.focus();
    markActivityRead(activity.filter((item) => !item.read));
  };

  return (
    <div className="relative">
      {/* Bell Icon Button */}
      <button
        ref={bellRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={`Alert activity${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-haspopup="dialog"
        className="relative min-h-11 min-w-11 rounded-lg border border-transparent p-2 text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-negative)] text-[10px] font-bold text-[var(--color-bg-primary)]">
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
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-negative-bg)] text-[var(--color-negative)] rounded">
                    {unreadCount} unread
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={closePanel}
                aria-label="Close alert activity"
                className="min-h-9 min-w-9 rounded p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
              >
                <X size={16} />
              </button>
            </div>

            {/* Filter Toggle */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] p-3">
              <button
                ref={filterRef}
                type="button"
                onClick={() => setShowUnreadOnly((only) => !only)}
                className="min-h-9 rounded px-1 text-xs text-[var(--color-accent-primary)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
              >
                {showUnreadOnly ? 'Show all' : 'Show unread only'}
              </button>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllAsRead}
                  className="min-h-9 rounded px-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                >
                  Mark all as read
                </button>
              )}
            </div>
            {readSyncError && <p role="status" className="shrink-0 px-3 py-2 text-xs text-[var(--text-secondary)]">Marked read here. Some insider records could not sync.</p>}
            {isError && (
              <div role="alert" className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--color-negative-bg)] p-3">
                <p className="text-sm text-[var(--color-negative)]">Unable to load insider alerts.</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Local and previously observed activity is still available.</p>
                <button
                  type="button"
                  onClick={() => { void refetch(); }}
                  disabled={isFetching}
                  className="mt-2 min-h-9 rounded px-2 text-xs text-[var(--color-accent-primary)] hover:text-[var(--color-accent-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] disabled:opacity-50"
                >
                  Retry
                </button>
              </div>
            )}

            <div className="shrink-0 border-b border-[var(--border-subtle)] px-3 py-2">
              <DesktopAlertControls />
            </div>

            <AlertInbox activity={activity} unreadOnly={showUnreadOnly} isLoading={isLoading} isError={isError} onOpen={openActivity} />
          </div>
        </>
      )}
    </div>
  );
}
