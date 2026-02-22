// Widget Settings Modal
'use client';

import { useState, useEffect } from 'react';
import { X, Save, RotateCcw } from 'lucide-react';
import { useDashboard } from '@/contexts/DashboardContext';
import type { WidgetInstance } from '@/types/dashboard';

interface WidgetSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    widgetId: string | null;
    dashboardId: string | null;
    tabId: string | null;
}

export function WidgetSettingsModal({
    isOpen,
    onClose,
    widgetId,
    dashboardId,
    tabId
}: WidgetSettingsModalProps) {
    const { state, updateWidget } = useDashboard();
    const [config, setConfig] = useState<string>('{}');
    const [refreshInterval, setRefreshInterval] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);

    const widget = (dashboardId && tabId && widgetId)
        ? state.dashboards.find(d => d.id === dashboardId)
            ?.tabs.find(t => t.id === tabId)
            ?.widgets.find(w => w.id === widgetId)
        : null;

    useEffect(() => {
        if (isOpen && widget) {
            // Initialize form state
            setRefreshInterval(widget.config.refreshInterval || 0);

            // For other config, stringify it generally or handle specific fields
            // We'll exclude known fields from the JSON editor if we map them explicitly
            const { refreshInterval: _, ...otherConfig } = widget.config;
            setConfig(JSON.stringify(otherConfig, null, 2));
        }
    }, [isOpen, widget]);

    const handleSave = () => {
        if (!widget || !dashboardId || !tabId || !widgetId) return;

        try {
            const parsedConfig = JSON.parse(config);
            const newConfig = {
                ...parsedConfig,
                refreshInterval: refreshInterval > 0 ? refreshInterval : undefined
            };

            updateWidget(dashboardId, tabId, widgetId, { config: newConfig });
            onClose();
        } catch (e) {
            setError('Invalid JSON configuration');
        }
    };

    if (!isOpen || !widget) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-lg bg-[var(--bg-modal)] border border-[var(--border-default)] rounded-xl shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)]">
                    <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                        Settings: <span className="text-blue-400">{widget.type}</span>
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
                        aria-label="Close widget settings"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Common Settings */}
                    <div className="space-y-4">
                        <label
                            htmlFor="widget-refresh-interval"
                            className="block text-sm font-medium text-[var(--text-secondary)]"
                        >
                            Auto-Refresh Interval (seconds)
                        </label>
                        <div className="flex items-center gap-4">
                            <input
                                id="widget-refresh-interval"
                                type="number"
                                min="0"
                                value={refreshInterval}
                                onChange={(e) => setRefreshInterval(parseInt(e.target.value) || 0)}
                                className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-blue-500 w-32"
                            />
                            <span className="text-xs text-[var(--text-muted)]">Set to 0 to disable</span>
                        </div>
                    </div>

                    <div className="border-t border-[var(--border-default)]" />

                    {/* Advanced Configuration (JSON) */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label
                                htmlFor="widget-advanced-config"
                                className="block text-sm font-medium text-[var(--text-secondary)]"
                            >
                                Advanced Configuration (JSON)
                            </label>
                            <button
                                onClick={() => setConfig('{}')}
                            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                            >
                                <RotateCcw size={12} /> Reset
                            </button>
                        </div>
                        <textarea
                            id="widget-advanced-config"
                            value={config}
                            onChange={(e) => {
                                setConfig(e.target.value);
                                setError(null);
                            }}
                            className={`w-full h-40 bg-[var(--bg-secondary)] border ${error ? 'border-red-500' : 'border-[var(--border-default)]'} rounded-lg p-3 text-sm font-mono text-[var(--text-secondary)] focus:outline-none focus:border-blue-500 resize-none`}
                        />
                        {error && <p className="text-xs text-red-400">{error}</p>}
                        <p className="text-xs text-[var(--text-muted)]">
                            Edit widget-specific properties directly.
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-default)] bg-[var(--bg-surface)]">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-900/20 flex items-center gap-2"
                    >
                        <Save size={16} />
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
}
