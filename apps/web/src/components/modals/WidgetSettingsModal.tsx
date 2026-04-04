// Widget Settings Modal
'use client';

import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save, X } from 'lucide-react';

import { useDashboard } from '@/contexts/DashboardContext';
import { useGlobalMarketsSymbol } from '@/contexts/GlobalMarketsSymbolContext';
import {
    getTradingViewWidgetMetadata,
    getTradingViewDefaultConfig,
    getTradingViewSettingsFields,
    isTradingViewWidget,
    usesTradingViewWidgetSymbol,
    type TradingViewSettingField,
} from '@/lib/tradingViewWidgets';
import type { WidgetConfig } from '@/types/dashboard';

interface WidgetSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    widgetId: string | null;
    dashboardId: string | null;
    tabId: string | null;
}

function toListText(value: unknown): string {
    if (!Array.isArray(value)) return '';

    return value
        .map((entry) => {
            if (typeof entry === 'string') return entry;
            if (entry && typeof entry === 'object' && 'proName' in entry) {
                return String((entry as { proName?: unknown }).proName || '');
            }
            if (entry && typeof entry === 'object' && 'symbol' in entry) {
                return String((entry as { symbol?: unknown }).symbol || '');
            }
            return '';
        })
        .filter(Boolean)
        .join('\n');
}

function parseListText(value: string): string[] {
    return value
        .split(/[,\n]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function groupFieldsBySection(fields: TradingViewSettingField[]): Array<{ section: string; fields: TradingViewSettingField[] }> {
    const sections = new Map<string, TradingViewSettingField[]>();

    fields.forEach((field) => {
        const section = field.section || 'General';
        const current = sections.get(section) || [];
        current.push(field);
        sections.set(section, current);
    });

    return Array.from(sections.entries()).map(([section, sectionFields]) => ({ section, fields: sectionFields }));
}

function buildAdvancedConfigDraft(config: WidgetConfig, fields: TradingViewSettingField[]): string {
    const typedKeys = new Set(['refreshInterval', ...fields.map((field) => field.key)]);
    const advancedConfig = Object.fromEntries(
        Object.entries(config).filter(([key]) => !typedKeys.has(key))
    );

    return JSON.stringify(advancedConfig, null, 2);
}

function pruneConfig(config: WidgetConfig): WidgetConfig {
    return Object.fromEntries(
        Object.entries(config).filter(([, value]) => {
            if (value === undefined || value === null) return false;
            if (typeof value === 'string') return value.trim().length > 0;
            if (Array.isArray(value)) return value.length > 0;
            return true;
        })
    );
}

export function WidgetSettingsModal({
    isOpen,
    onClose,
    widgetId,
    dashboardId,
    tabId
}: WidgetSettingsModalProps) {
    const { state, updateWidget } = useDashboard();
    const { setGlobalMarketsSymbol } = useGlobalMarketsSymbol();
    const [draftConfig, setDraftConfig] = useState<WidgetConfig>({});
    const [advancedConfig, setAdvancedConfig] = useState<string>('{}');
    const [refreshInterval, setRefreshInterval] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);

    const targetDashboard = dashboardId
        ? state.dashboards.find((dashboard) => dashboard.id === dashboardId) || null
        : null;
    const widget = (targetDashboard && tabId && widgetId)
        ? targetDashboard.tabs.find(t => t.id === tabId)
            ?.widgets.find(w => w.id === widgetId)
        : null;

    const tradingViewFields = useMemo(
        () => getTradingViewSettingsFields(widget?.type),
        [widget?.type]
    );
    const tradingViewMetadata = useMemo(
        () => getTradingViewWidgetMetadata(widget?.type),
        [widget?.type]
    );
    const tradingViewSections = useMemo(
        () => groupFieldsBySection(tradingViewFields),
        [tradingViewFields]
    );
    const tradingViewMode = isTradingViewWidget(widget?.type);
    const isAdminManagedGlobalMarketsDashboard = targetDashboard?.id === 'default-global-markets';
    const isWidgetSettingsReadOnly = Boolean(
        isAdminManagedGlobalMarketsDashboard && targetDashboard?.adminUnlocked !== true
    );

    useEffect(() => {
        if (!isOpen || !widget) {
            return;
        }

        const resolvedConfig = tradingViewMode
            ? {
                ...getTradingViewDefaultConfig(widget.type),
                ...widget.config,
            }
            : { ...widget.config };

        setDraftConfig(resolvedConfig);
        setRefreshInterval(typeof widget.config.refreshInterval === 'number' ? widget.config.refreshInterval : 0);
        setAdvancedConfig(buildAdvancedConfigDraft(resolvedConfig, tradingViewFields));
        setError(null);
    }, [isOpen, tradingViewFields, tradingViewMode, widget]);

    const handleConfigValueChange = (key: string, value: unknown) => {
        setDraftConfig((current) => ({
            ...current,
            [key]: value,
        }));
    };

    const handleReset = () => {
        if (!widget) return;

        const resetConfig = tradingViewMode ? getTradingViewDefaultConfig(widget.type) : {};
        setDraftConfig(resetConfig);
        setRefreshInterval(0);
        setAdvancedConfig('{}');
        setError(null);
    };

    const handleSave = () => {
        if (!widget || !dashboardId || !tabId || !widgetId) return;

        if (isWidgetSettingsReadOnly) {
            setError('Enable Admin Mode in Global Layout Controls before editing Global Markets widget settings.');
            return;
        }

        try {
            const parsedAdvancedConfig = advancedConfig.trim().length > 0
                ? JSON.parse(advancedConfig)
                : {};

            const nextConfig = pruneConfig({
                ...parsedAdvancedConfig,
                ...draftConfig,
                refreshInterval: refreshInterval > 0 ? refreshInterval : undefined,
            });

            if (
                tradingViewMode &&
                usesTradingViewWidgetSymbol(widget.type) &&
                nextConfig.useLinkedSymbol !== false &&
                typeof nextConfig.symbol === 'string' &&
                nextConfig.symbol.trim().length > 0
            ) {
                setGlobalMarketsSymbol(nextConfig.symbol);
            }

            updateWidget(dashboardId, tabId, widgetId, { config: nextConfig });
            onClose();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Invalid JSON configuration');
        }
    };

    if (!isOpen || !widget) return null;

    return (
        <div data-tour="widget-settings-modal" className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(2,6,23,0.72)] backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-2xl bg-[var(--bg-modal)] border border-[var(--border-default)] rounded-xl shadow-[0_24px_80px_rgba(15,23,42,0.35)] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-modal)]">
                    <div>
                        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                            Settings: <span className="text-blue-400">{tradingViewMetadata?.name || widget.type}</span>
                        </h2>
                        {tradingViewMode ? (
                            <div className="mt-1 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-200">
                                TradingView Native
                            </div>
                        ) : null}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
                        aria-label="Close widget settings"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
                    {isAdminManagedGlobalMarketsDashboard ? (
                        <div className={`rounded-lg border px-4 py-3 text-xs ${isWidgetSettingsReadOnly ? 'border-amber-500/20 bg-amber-500/8 text-amber-100/85' : 'border-blue-500/20 bg-blue-500/8 text-blue-100/85'}`}>
                            {isWidgetSettingsReadOnly
                                ? 'This Global Markets widget is part of an admin-managed system dashboard. Enable Admin Mode to edit settings, then use Save Draft or Publish Global in the floating admin controls.'
                                : 'You are editing an admin-managed Global Markets widget. Save changes here, then use Save Draft or Publish Global in the floating admin controls to ship them.'}
                        </div>
                    ) : null}
                    <fieldset disabled={isWidgetSettingsReadOnly} className={isWidgetSettingsReadOnly ? 'space-y-6 opacity-60' : 'space-y-6'}>
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
                                onChange={(event) => setRefreshInterval(parseInt(event.target.value, 10) || 0)}
                                className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-blue-500 w-32"
                            />
                            <span className="text-xs text-[var(--text-muted)]">Set to 0 to disable</span>
                        </div>
                    </div>

                    {tradingViewMode && tradingViewFields.length > 0 ? (
                        <div className="space-y-4 border-t border-[var(--border-default)] pt-6">
                            <div>
                                <div className="text-sm font-medium text-[var(--text-secondary)]">TradingView Settings</div>
                                <p className="mt-1 text-xs text-[var(--text-muted)]">
                                    These controls are mapped from the TradingView widget settings surface. Advanced JSON remains available for nested objects and edge-case options.
                                </p>
                            </div>
                            <div className="space-y-3">
                                {tradingViewSections.map(({ section, fields }) => (
                                    <details key={section} open className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]/55">
                                        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
                                            {section}
                                        </summary>
                                        <div className="grid gap-4 border-t border-[var(--border-default)] px-4 py-4 md:grid-cols-2">
                                            {fields.map((field) => {
                                                const fieldId = `widget-config-${field.key}`;

                                                if (field.type === 'boolean') {
                                                    return (
                                                        <label key={field.key} htmlFor={fieldId} className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] md:col-span-2">
                                                            <div>
                                                                <div>{field.label}</div>
                                                                {field.description ? (
                                                                    <div className="mt-1 text-xs text-[var(--text-muted)]">{field.description}</div>
                                                                ) : null}
                                                            </div>
                                                            <input
                                                                id={fieldId}
                                                                type="checkbox"
                                                                checked={Boolean(draftConfig[field.key])}
                                                                onChange={(event) => handleConfigValueChange(field.key, event.target.checked)}
                                                                className="h-4 w-4 rounded border-[var(--border-default)] bg-[var(--bg-primary)] text-blue-500 focus:ring-blue-500"
                                                            />
                                                        </label>
                                                    );
                                                }

                                                if (field.type === 'select') {
                                                    return (
                                                        <label key={field.key} htmlFor={fieldId} className="space-y-2">
                                                            <span className="block text-sm font-medium text-[var(--text-secondary)]">{field.label}</span>
                                                            <select
                                                                id={fieldId}
                                                                value={String(draftConfig[field.key] ?? '')}
                                                                onChange={(event) => handleConfigValueChange(field.key, event.target.value)}
                                                                className="w-full bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
                                                            >
                                                                <option value="">Default</option>
                                                                {(field.options || []).map((option) => (
                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                ))}
                                                            </select>
                                                            {field.description ? <p className="text-xs text-[var(--text-muted)]">{field.description}</p> : null}
                                                        </label>
                                                    );
                                                }

                                                if (field.type === 'symbol_list' || field.type === 'list') {
                                                    return (
                                                        <label key={field.key} htmlFor={fieldId} className="space-y-2 md:col-span-2">
                                                            <span className="block text-sm font-medium text-[var(--text-secondary)]">{field.label}</span>
                                                            <textarea
                                                                id={fieldId}
                                                                value={toListText(draftConfig[field.key])}
                                                                onChange={(event) => handleConfigValueChange(field.key, parseListText(event.target.value))}
                                                                className="w-full bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 resize-y"
                                                                rows={field.rows || 4}
                                                                placeholder={field.placeholder || 'One item per line'}
                                                            />
                                                            {field.description ? <p className="text-xs text-[var(--text-muted)]">{field.description}</p> : null}
                                                        </label>
                                                    );
                                                }

                                                if (field.type === 'color') {
                                                    const colorValue = String(draftConfig[field.key] ?? '');
                                                    return (
                                                        <label key={field.key} htmlFor={fieldId} className="space-y-2">
                                                            <span className="block text-sm font-medium text-[var(--text-secondary)]">{field.label}</span>
                                                            <div className="flex items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2">
                                                                <span
                                                                    className="h-8 w-8 rounded-md border border-[var(--border-default)]"
                                                                    style={{ background: colorValue || 'transparent' }}
                                                                />
                                                                <input
                                                                    id={fieldId}
                                                                    type="text"
                                                                    value={colorValue}
                                                                    onChange={(event) => handleConfigValueChange(field.key, event.target.value)}
                                                                    className="w-full bg-transparent text-[var(--text-primary)] focus:outline-none"
                                                                    placeholder={field.placeholder}
                                                                />
                                                            </div>
                                                            {field.description ? <p className="text-xs text-[var(--text-muted)]">{field.description}</p> : null}
                                                        </label>
                                                    );
                                                }

                                                return (
                                                    <label key={field.key} htmlFor={fieldId} className="space-y-2">
                                                        <span className="block text-sm font-medium text-[var(--text-secondary)]">{field.label}</span>
                                                        <input
                                                            id={fieldId}
                                                            type={field.type === 'number' ? 'number' : 'text'}
                                                            min={field.min}
                                                            step={field.step}
                                                            value={String(draftConfig[field.key] ?? '')}
                                                            onChange={(event) => handleConfigValueChange(field.key, field.type === 'number' ? Number(event.target.value) : event.target.value)}
                                                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
                                                            placeholder={field.placeholder}
                                                        />
                                                        {field.description ? <p className="text-xs text-[var(--text-muted)]">{field.description}</p> : null}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </details>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    <div className="border-t border-[var(--border-default)] pt-6 space-y-2">
                        <div className="flex items-center justify-between">
                            <label
                                htmlFor="widget-advanced-config"
                                className="block text-sm font-medium text-[var(--text-secondary)]"
                            >
                                Advanced Configuration (JSON)
                            </label>
                            <button
                                onClick={handleReset}
                                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                                type="button"
                            >
                                <RotateCcw size={12} /> Reset
                            </button>
                        </div>
                        <textarea
                            id="widget-advanced-config"
                            value={advancedConfig}
                            onChange={(event) => {
                                setAdvancedConfig(event.target.value);
                                setError(null);
                            }}
                            className={`w-full h-40 bg-[var(--bg-secondary)] border ${error ? 'border-red-500' : 'border-[var(--border-default)]'} rounded-lg p-3 text-sm font-mono text-[var(--text-secondary)] focus:outline-none focus:border-blue-500 resize-none`}
                        />
                        {error ? <p className="text-xs text-red-400">{error}</p> : null}
                        <p className="text-xs text-[var(--text-muted)]">
                            {tradingViewMode
                                ? 'This JSON is merged with the typed controls above. Nested TradingView options belong here.'
                                : 'Edit widget-specific properties directly.'}
                        </p>
                    </div>
                    </fieldset>
                </div>

                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-default)] bg-[var(--bg-modal)]">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isWidgetSettingsReadOnly}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/30 disabled:text-white/60 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-900/20 flex items-center gap-2"
                    >
                        <Save size={16} />
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
}
