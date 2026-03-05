// Alert Settings Panel - Configure insider trading alert preferences

'use client';

import { useState, useEffect } from 'react';
import { Settings, Save, Bell, Mail, Volume2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAlertSettings, updateAlertSettings } from '@/lib/api';
import type { AlertSettings } from '@/types/insider';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

interface AlertSettingsPanelProps {
  userId?: number;
}

export function AlertSettingsPanel({ userId = 1 }: AlertSettingsPanelProps) {
  const queryClient = useQueryClient();

  const {
    data: settings,
    isLoading,
    error,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ['alert-settings', userId],
    queryFn: () => getAlertSettings(userId),
  });

  const [formData, setFormData] = useState<Partial<AlertSettings>>({
    block_trade_threshold: 10,
    enable_insider_buy_alerts: true,
    enable_insider_sell_alerts: true,
    enable_ownership_change_alerts: true,
    ownership_change_threshold: 5,
    enable_browser_notifications: true,
    enable_email_notifications: false,
    enable_sound_alerts: true,
    notification_email: '',
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        block_trade_threshold: settings.block_trade_threshold,
        enable_insider_buy_alerts: settings.enable_insider_buy_alerts,
        enable_insider_sell_alerts: settings.enable_insider_sell_alerts,
        enable_ownership_change_alerts: settings.enable_ownership_change_alerts,
        ownership_change_threshold: settings.ownership_change_threshold,
        enable_browser_notifications: settings.enable_browser_notifications,
        enable_email_notifications: settings.enable_email_notifications,
        enable_sound_alerts: settings.enable_sound_alerts,
        notification_email: settings.notification_email || '',
      });
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<AlertSettings>) => updateAlertSettings(userId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-settings'] });
    },
  });

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  const handleRequestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setFormData({ ...formData, enable_browser_notifications: true });
      }
    }
  };

  if (isLoading && !settings) {
    return <WidgetSkeleton lines={6} />;
  }

  if (error && !settings) {
    return <WidgetError error={error as Error} onRetry={() => refetch()} />;
  }

  const notificationPermission = typeof window !== 'undefined' && 'Notification' in window
    ? Notification.permission
    : 'default';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 py-1 mb-3">
        <div className="flex items-center gap-2">
          <Settings size={14} className="text-[var(--text-secondary)]" />
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Alert Settings</h3>
        </div>
        <div className="flex items-center gap-2">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching}
            note="Alert preferences"
            align="right"
          />
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors disabled:opacity-50"
          >
            <Save size={12} />
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Settings Form */}
      <div className="flex-1 overflow-y-auto space-y-4">
        {/* Alert Types */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase text-[var(--text-secondary)]">Alert Types</h4>
          
          <label className="flex cursor-pointer items-center justify-between rounded bg-[var(--bg-secondary)] p-2 hover:bg-[var(--bg-tertiary)]">
            <span className="text-sm text-[var(--text-primary)]">Insider Buy Alerts</span>
            <input
              type="checkbox"
              checked={formData.enable_insider_buy_alerts}
              onChange={(e) => setFormData({ ...formData, enable_insider_buy_alerts: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--border-color)] bg-[var(--bg-tertiary)] text-blue-500 focus:ring-blue-500"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between rounded bg-[var(--bg-secondary)] p-2 hover:bg-[var(--bg-tertiary)]">
            <span className="text-sm text-[var(--text-primary)]">Insider Sell Alerts</span>
            <input
              type="checkbox"
              checked={formData.enable_insider_sell_alerts}
              onChange={(e) => setFormData({ ...formData, enable_insider_sell_alerts: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--border-color)] bg-[var(--bg-tertiary)] text-blue-500 focus:ring-blue-500"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between rounded bg-[var(--bg-secondary)] p-2 hover:bg-[var(--bg-tertiary)]">
            <span className="text-sm text-[var(--text-primary)]">Ownership Change Alerts</span>
            <input
              type="checkbox"
              checked={formData.enable_ownership_change_alerts}
              onChange={(e) => setFormData({ ...formData, enable_ownership_change_alerts: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--border-color)] bg-[var(--bg-tertiary)] text-blue-500 focus:ring-blue-500"
            />
          </label>
        </div>

        {/* Thresholds */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase text-[var(--text-secondary)]">Thresholds</h4>
          
          <div className="rounded bg-[var(--bg-secondary)] p-2">
            <label className="mb-1 block text-sm text-[var(--text-primary)]">
              Block Trade Threshold (VND billions)
            </label>
            <input
              type="number"
              value={formData.block_trade_threshold}
              onChange={(e) => setFormData({ ...formData, block_trade_threshold: Number(e.target.value) })}
              min={1}
              max={1000}
              className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Alert when trade value exceeds this amount
            </p>
          </div>

          <div className="rounded bg-[var(--bg-secondary)] p-2">
            <label className="mb-1 block text-sm text-[var(--text-primary)]">
              Ownership Change Threshold (%)
            </label>
            <input
              type="number"
              value={formData.ownership_change_threshold}
              onChange={(e) => setFormData({ ...formData, ownership_change_threshold: Number(e.target.value) })}
              min={1}
              max={100}
              step={0.1}
              className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Alert when ownership changes by this percentage
            </p>
          </div>
        </div>

        {/* Notification Methods */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase text-[var(--text-secondary)]">Notification Methods</h4>
          
          <div className="rounded bg-[var(--bg-secondary)] p-2">
            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-2">
                <Bell size={14} className="text-blue-400" />
                <span className="text-sm text-[var(--text-primary)]">Browser Notifications</span>
              </div>
              <input
                type="checkbox"
                checked={formData.enable_browser_notifications}
                onChange={(e) => setFormData({ ...formData, enable_browser_notifications: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-color)] bg-[var(--bg-tertiary)] text-blue-500 focus:ring-blue-500"
              />
            </label>
            {notificationPermission === 'denied' && (
              <p className="text-xs text-red-400 mt-1">
                Browser notifications are blocked. Enable in browser settings.
              </p>
            )}
            {notificationPermission === 'default' && (
              <button
                onClick={handleRequestNotificationPermission}
                className="text-xs text-blue-400 hover:text-blue-300 mt-1"
              >
                Request permission
              </button>
            )}
          </div>

          <div className="rounded bg-[var(--bg-secondary)] p-2">
            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-2">
                <Volume2 size={14} className="text-yellow-400" />
                <span className="text-sm text-[var(--text-primary)]">Sound Alerts</span>
              </div>
              <input
                type="checkbox"
                checked={formData.enable_sound_alerts}
                onChange={(e) => setFormData({ ...formData, enable_sound_alerts: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-color)] bg-[var(--bg-tertiary)] text-blue-500 focus:ring-blue-500"
              />
            </label>
          </div>

          <div className="rounded bg-[var(--bg-secondary)] p-2">
            <label className="flex items-center justify-between mb-2 cursor-pointer">
              <div className="flex items-center gap-2">
                <Mail size={14} className="text-green-400" />
                <span className="text-sm text-[var(--text-primary)]">Email Notifications</span>
              </div>
              <input
                type="checkbox"
                checked={formData.enable_email_notifications}
                onChange={(e) => setFormData({ ...formData, enable_email_notifications: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-color)] bg-[var(--bg-tertiary)] text-blue-500 focus:ring-blue-500"
              />
            </label>
            {formData.enable_email_notifications && (
              <input
                type="email"
                value={formData.notification_email || ''}
                onChange={(e) => setFormData({ ...formData, notification_email: e.target.value })}
                placeholder="your@email.com"
                className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-blue-500 focus:outline-none"
              />
            )}
          </div>
        </div>
      </div>

      {/* Success Message */}
      {updateMutation.isSuccess && (
        <div className="mt-3 p-2 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-400">
          Settings saved successfully!
        </div>
      )}

      {/* Error Message */}
      {updateMutation.isError && (
        <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
          Failed to save settings. Please try again.
        </div>
      )}
    </div>
  );
}
