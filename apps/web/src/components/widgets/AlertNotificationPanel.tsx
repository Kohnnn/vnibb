// Alert Notification Panel - Bell icon with dropdown for insider alerts

'use client';

import { useState, useEffect } from 'react';
import { Bell, X, TrendingUp, TrendingDown, Users, AlertCircle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getInsiderAlerts, markAlertRead } from '@/lib/api';
import type { InsiderAlert, AlertType, AlertSeverity } from '@/types/insider';

interface AlertNotificationPanelProps {
  userId?: number;
}

function getAlertIcon(type: AlertType) {
  switch (type) {
    case 'INSIDER_BUY':
      return TrendingUp;
    case 'INSIDER_SELL':
      return TrendingDown;
    case 'OWNERSHIP_CHANGE':
      return Users;
    case 'BLOCK_TRADE':
      return AlertCircle;
    default:
      return Bell;
  }
}

function getAlertColor(severity: AlertSeverity): string {
  switch (severity) {
    case 'high':
      return 'text-red-400 bg-red-500/10 border-red-500/30';
    case 'medium':
      return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
    case 'low':
      return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
    default:
      return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
  }
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  
  const diffDays = Math.floor(diffMins / 1440);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('vi-VN');
}

export function AlertNotificationPanel({ userId = 1 }: AlertNotificationPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showUnreadOnly, setShowUnreadOnly] = useState(true);
  const queryClient = useQueryClient();

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ['insider-alerts', userId, showUnreadOnly],
    queryFn: () => getInsiderAlerts({ userId, unreadOnly: showUnreadOnly, limit: 50 }),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const markReadMutation = useMutation({
    mutationFn: (alertId: number) => markAlertRead(alertId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insider-alerts'] });
    },
  });

  const unreadCount = alerts.filter((a) => !a.read).length;

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

  const handleMarkAsRead = (alertId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    markReadMutation.mutate(alertId);
  };

  const handleMarkAllAsRead = () => {
    alerts.filter((a) => !a.read).forEach((alert) => {
      markReadMutation.mutate(alert.id);
    });
  };

  return (
    <div className="relative">
      {/* Bell Icon Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
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
          <div className="absolute right-0 top-full mt-2 w-96 max-h-[600px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-zinc-700">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-gray-400" />
                <h3 className="text-sm font-medium text-zinc-100">Alerts</h3>
                {unreadCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-red-500/20 text-red-400 rounded">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Filter Toggle */}
            <div className="flex items-center justify-between p-3 border-b border-zinc-800">
              <button
                onClick={() => setShowUnreadOnly(!showUnreadOnly)}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                {showUnreadOnly ? 'Show all' : 'Show unread only'}
              </button>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllAsRead}
                  className="text-xs text-gray-400 hover:text-white transition-colors"
                >
                  Mark all as read
                </button>
              )}
            </div>

            {/* Alerts List */}
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="p-4 space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <div className="h-4 bg-gray-800 rounded w-3/4 mb-2" />
                      <div className="h-3 bg-gray-800 rounded w-1/2" />
                    </div>
                  ))}
                </div>
              ) : alerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-gray-500">
                  <Bell size={32} className="mb-2 opacity-30" />
                  <p className="text-sm">No alerts</p>
                  <p className="text-xs mt-1">You're all caught up!</p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-800">
                  {alerts.map((alert) => {
                    const Icon = getAlertIcon(alert.alert_type);
                    const colorClass = getAlertColor(alert.severity);

                    return (
                      <div
                        key={alert.id}
                        className={`p-3 hover:bg-zinc-800/50 transition-colors ${
                          !alert.read ? 'bg-blue-500/5' : ''
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg border ${colorClass}`}>
                            <Icon size={16} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <h4 className="text-sm font-medium text-zinc-100 truncate">
                                {alert.title}
                              </h4>
                              {!alert.read && (
                                <button
                                  onClick={(e) => handleMarkAsRead(alert.id, e)}
                                  className="shrink-0 text-xs text-blue-400 hover:text-blue-300"
                                >
                                  Mark read
                                </button>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 mb-1 line-clamp-2">
                              {alert.description}
                            </p>
                            <div className="flex items-center gap-2 text-[10px] text-gray-500">
                              <span className="font-medium text-blue-400">{alert.symbol}</span>
                              <span>•</span>
                              <span>{formatTime(alert.timestamp)}</span>
                              <span>•</span>
                              <span className={getAlertColor(alert.severity).split(' ')[0]}>
                                {alert.severity.toUpperCase()}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
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
