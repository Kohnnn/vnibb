// Alert Settings Panel - Configure insider trading alert preferences

'use client';

import { useState, useEffect } from 'react';
import { Settings, Save, Bell, Mail, Volume2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAlertSettings, updateAlertSettings } from '@/lib/api';
import type { AlertSettings } from '@/types/insider';

interface AlertSettingsPanelProps {
  userId?: number;
}

export function AlertSettingsPanel({ userId = 1 }: AlertSettingsPanelProps) {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
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

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const notificationPermission = typeof window !== 'undefined' && 'Notification' in window
    ? Notification.permission
    : 'default';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 py-1 mb-3">
        <div className="flex items-center gap-2">
          <Settings size={14} className="text-gray-400" />
          <h3 className="text-sm font-medium text-zinc-100">Alert Settings</h3>
        </div>
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors disabled:opacity-50"
        >
          <Save size={12} />
          {updateMutation.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Settings Form */}
      <div className="flex-1 overflow-y-auto space-y-4">
        {/* Alert Types */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-400 uppercase">Alert Types</h4>
          
          <label className="flex items-center justify-between p-2 bg-gray-800/30 rounded hover:bg-gray-800/50 cursor-pointer">
            <span className="text-sm text-gray-200">Insider Buy Alerts</span>
            <input
              type="checkbox"
              checked={formData.enable_insider_buy_alerts}
              onChange={(e) => setFormData({ ...formData, enable_insider_buy_alerts: e.target.checked })}
              className="w-4 h-4 text-blue-500 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
            />
          </label>

          <label className="flex items-center justify-between p-2 bg-gray-800/30 rounded hover:bg-gray-800/50 cursor-pointer">
            <span className="text-sm text-gray-200">Insider Sell Alerts</span>
            <input
              type="checkbox"
              checked={formData.enable_insider_sell_alerts}
              onChange={(e) => setFormData({ ...formData, enable_insider_sell_alerts: e.target.checked })}
              className="w-4 h-4 text-blue-500 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
            />
          </label>

          <label className="flex items-center justify-between p-2 bg-gray-800/30 rounded hover:bg-gray-800/50 cursor-pointer">
            <span className="text-sm text-gray-200">Ownership Change Alerts</span>
            <input
              type="checkbox"
              checked={formData.enable_ownership_change_alerts}
              onChange={(e) => setFormData({ ...formData, enable_ownership_change_alerts: e.target.checked })}
              className="w-4 h-4 text-blue-500 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
            />
          </label>
        </div>

        {/* Thresholds */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-400 uppercase">Thresholds</h4>
          
          <div className="p-2 bg-gray-800/30 rounded">
            <label className="block text-sm text-gray-200 mb-1">
              Block Trade Threshold (VND billions)
            </label>
            <input
              type="number"
              value={formData.block_trade_threshold}
              onChange={(e) => setFormData({ ...formData, block_trade_threshold: Number(e.target.value) })}
              min={1}
              max={1000}
              className="w-full px-3 py-1.5 text-sm bg-gray-700 text-gray-200 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              Alert when trade value exceeds this amount
            </p>
          </div>

          <div className="p-2 bg-gray-800/30 rounded">
            <label className="block text-sm text-gray-200 mb-1">
              Ownership Change Threshold (%)
            </label>
            <input
              type="number"
              value={formData.ownership_change_threshold}
              onChange={(e) => setFormData({ ...formData, ownership_change_threshold: Number(e.target.value) })}
              min={1}
              max={100}
              step={0.1}
              className="w-full px-3 py-1.5 text-sm bg-gray-700 text-gray-200 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              Alert when ownership changes by this percentage
            </p>
          </div>
        </div>

        {/* Notification Methods */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-400 uppercase">Notification Methods</h4>
          
          <div className="p-2 bg-gray-800/30 rounded">
            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-2">
                <Bell size={14} className="text-blue-400" />
                <span className="text-sm text-gray-200">Browser Notifications</span>
              </div>
              <input
                type="checkbox"
                checked={formData.enable_browser_notifications}
                onChange={(e) => setFormData({ ...formData, enable_browser_notifications: e.target.checked })}
                className="w-4 h-4 text-blue-500 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
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

          <div className="p-2 bg-gray-800/30 rounded">
            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-2">
                <Volume2 size={14} className="text-yellow-400" />
                <span className="text-sm text-gray-200">Sound Alerts</span>
              </div>
              <input
                type="checkbox"
                checked={formData.enable_sound_alerts}
                onChange={(e) => setFormData({ ...formData, enable_sound_alerts: e.target.checked })}
                className="w-4 h-4 text-blue-500 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
              />
            </label>
          </div>

          <div className="p-2 bg-gray-800/30 rounded">
            <label className="flex items-center justify-between mb-2 cursor-pointer">
              <div className="flex items-center gap-2">
                <Mail size={14} className="text-green-400" />
                <span className="text-sm text-gray-200">Email Notifications</span>
              </div>
              <input
                type="checkbox"
                checked={formData.enable_email_notifications}
                onChange={(e) => setFormData({ ...formData, enable_email_notifications: e.target.checked })}
                className="w-4 h-4 text-blue-500 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
              />
            </label>
            {formData.enable_email_notifications && (
              <input
                type="email"
                value={formData.notification_email || ''}
                onChange={(e) => setFormData({ ...formData, notification_email: e.target.value })}
                placeholder="your@email.com"
                className="w-full px-3 py-1.5 text-sm bg-gray-700 text-gray-200 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
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
