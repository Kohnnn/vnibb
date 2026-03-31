'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Settings as SettingsIcon, Database, Bell, Palette, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDataSources, type VnstockSource } from '@/contexts/DataSourcesContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useUnit } from '@/contexts/UnitContext';
import { useSymbolLink } from '@/contexts/SymbolLinkContext';
import { useWidgetGroups } from '@/contexts/WidgetGroupContext';
import { useDashboard } from '@/contexts/DashboardContext';
import { searchStocks } from '@/data/stockData';
import { DEFAULT_TICKER, normalizeTickerSymbol } from '@/lib/defaultTicker';
import {
  requestDashboardWalkthroughRestart,
  resetDashboardWalkthroughPreference,
  DEFAULT_TAB_OPTIONS,
  type DefaultTabPreference,
  findPreferredDashboardId,
  findPreferredTabId,
  readStoredUserPreferences,
  writeStoredUserPreferences,
} from '@/lib/userPreferences';
import { formatUnitValue, getUnitCaption, type UnitDisplay } from '@/lib/units';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingTab = 'general' | 'data' | 'notifications' | 'appearance';

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingTab>('general');
  const [defaultTickerInput, setDefaultTickerInput] = useState(DEFAULT_TICKER);
  const [defaultTab, setDefaultTab] = useState<DefaultTabPreference>('overview');
  const [defaultTickerError, setDefaultTickerError] = useState<string | null>(null);
  const [preferenceStatus, setPreferenceStatus] = useState<string | null>(null);
  const [isTickerMenuOpen, setIsTickerMenuOpen] = useState(false);
  const { preferredVnstockSource, setPreferredVnstockSource } = useDataSources();
  const { resolvedTheme } = useTheme();
  const { config: unitConfig, setUnit, setDecimalPlaces } = useUnit();
  const { globalSymbol, setGlobalSymbol } = useSymbolLink();
  const { setGlobalSymbol: setWidgetGroupGlobalSymbol } = useWidgetGroups();
  const { state, activeDashboard, setActiveDashboard, setActiveTab: setDashboardActiveTab } = useDashboard();

  const tickerSuggestions = useMemo(() => searchStocks(defaultTickerInput, 6), [defaultTickerInput]);

  useEffect(() => {
    if (isOpen) {
      const preferences = readStoredUserPreferences();
      setDefaultTickerInput(globalSymbol || preferences.defaultTicker || DEFAULT_TICKER);
      setDefaultTab(preferences.defaultTab);
      setDefaultTickerError(null);
      setPreferenceStatus(null);
      setIsTickerMenuOpen(false);
    }
  }, [globalSymbol, isOpen]);

  useEffect(() => {
    if (!preferenceStatus) return;
    const timeoutId = window.setTimeout(() => setPreferenceStatus(null), 2400);
    return () => window.clearTimeout(timeoutId);
  }, [preferenceStatus]);
  
  if (!isOpen) return null;

  const handleRestartWalkthrough = () => {
    resetDashboardWalkthroughPreference();
    onClose();
    window.setTimeout(() => {
      requestDashboardWalkthroughRestart();
    }, 180);
  };

  const applyPreferences = () => {
    const normalized = normalizeTickerSymbol(defaultTickerInput);
    if (!normalized) {
      setDefaultTickerError('Enter a valid 3-character ticker, for example VCI or FPT.');
      return;
    }

    const nextPreferences = writeStoredUserPreferences({
      defaultTicker: normalized,
      defaultTab,
    });

    setGlobalSymbol(nextPreferences.defaultTicker);
    setWidgetGroupGlobalSymbol(nextPreferences.defaultTicker);
    setDefaultTickerInput(nextPreferences.defaultTicker);
    setDefaultTickerError(null);
    setIsTickerMenuOpen(false);

    const preferredDashboardId = findPreferredDashboardId(state.dashboards, nextPreferences.defaultTab)
    if (preferredDashboardId) {
      setActiveDashboard(preferredDashboardId)
    }

    const targetDashboard =
      state.dashboards.find((dashboard) => dashboard.id === preferredDashboardId) || activeDashboard
    const preferredTabId = targetDashboard
      ? findPreferredTabId(targetDashboard.tabs, nextPreferences.defaultTab)
      : null;
    if (preferredTabId) {
      setDashboardActiveTab(preferredTabId);
    }

    const tabLabel =
      DEFAULT_TAB_OPTIONS.find((option) => option.value === nextPreferences.defaultTab)?.label ||
      'Overview';
    setPreferenceStatus(`Saved locally: ${nextPreferences.defaultTicker} opens on ${tabLabel}.`);
  };

  const tabs = [
    { id: 'general' as const, label: 'General', icon: SettingsIcon },
    { id: 'data' as const, label: 'Data Sources', icon: Database },
    { id: 'notifications' as const, label: 'Notifications', icon: Bell },
    { id: 'appearance' as const, label: 'Appearance', icon: Palette },
  ];

  const unitOptions: Array<{ value: UnitDisplay; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: 'K', label: 'K' },
    { value: 'M', label: 'M' },
    { value: 'B', label: 'B' },
    { value: 'raw', label: 'Raw' },
  ];

  const decimalOptions = [0, 1, 2, 3];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(2,6,23,0.72)] backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[var(--bg-modal)] rounded-xl border border-[var(--border-default)] w-full max-w-3xl max-h-[80vh] flex shadow-[0_24px_80px_rgba(15,23,42,0.35)] overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 bg-[var(--bg-secondary)] border-r border-[var(--border-default)] p-4 shrink-0 hidden md:block">
          <h2 className="text-lg font-bold text-[var(--text-primary)] mb-6 flex items-center gap-2">
            <SettingsIcon size={20} className="text-blue-500" />
            Settings
          </h2>
          <nav className="space-y-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left",
                  activeTab === tab.id 
                    ? "bg-blue-600/20 text-blue-400 font-bold" 
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                )}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0 bg-[var(--bg-modal)]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)]">
            <h3 className="text-lg font-bold text-[var(--text-primary)]">
              {tabs.find(t => t.id === activeTab)?.label}
            </h3>
            <button
              onClick={onClose}
              className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-auto p-6 text-left">
            {activeTab === 'general' && (
              <div className="space-y-6">
                <div>
                  <label
                    htmlFor="settings-default-ticker"
                    className="text-sm font-bold text-[var(--text-secondary)] mb-2 uppercase tracking-wider text-[10px]"
                  >
                    Default Ticker
                  </label>
                  <input
                    id="settings-default-ticker"
                    type="text"
                    value={defaultTickerInput}
                    onChange={(event) => {
                      setDefaultTickerInput(event.target.value.toUpperCase());
                      if (defaultTickerError) setDefaultTickerError(null);
                      if (preferenceStatus) setPreferenceStatus(null);
                    }}
                    onFocus={() => setIsTickerMenuOpen(true)}
                    onBlur={() => {
                      window.setTimeout(() => setIsTickerMenuOpen(false), 120);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        applyPreferences();
                      }
                    }}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:border-blue-500 outline-none"
                  />
                  {isTickerMenuOpen && tickerSuggestions.length > 0 && (
                    <div className="mt-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-1">
                      {tickerSuggestions.map((stock) => (
                        <button
                          key={stock.symbol}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setDefaultTickerInput(stock.symbol);
                            setDefaultTickerError(null);
                            setIsTickerMenuOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
                        >
                          <span className="text-xs font-bold text-[var(--text-primary)]">{stock.symbol}</span>
                          <span className="ml-3 flex-1 truncate text-[11px] text-[var(--text-secondary)]">
                            {stock.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-[10px] text-[var(--text-muted)]">
                      Local fallback stays on {DEFAULT_TICKER} until a saved preference overrides it.
                    </p>
                    <button
                      type="button"
                      onClick={applyPreferences}
                      className="rounded-lg border border-blue-500/40 bg-blue-600/15 px-3 py-1.5 text-[11px] font-bold text-blue-300 transition-colors hover:bg-blue-600/25"
                    >
                      Save Preferences
                    </button>
                  </div>
                  {defaultTickerError && (
                    <p className="mt-2 text-[11px] text-amber-300">{defaultTickerError}</p>
                  )}
                  {preferenceStatus && (
                    <p className="mt-2 text-[11px] text-emerald-300">{preferenceStatus}</p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="settings-default-tab"
                    className="text-sm font-bold text-[var(--text-secondary)] mb-2 uppercase tracking-wider text-[10px]"
                  >
                    Default Workspace
                  </label>
                  <select
                    id="settings-default-tab"
                    value={defaultTab}
                    onChange={(event) => {
                      setDefaultTab(event.target.value as DefaultTabPreference);
                      if (preferenceStatus) setPreferenceStatus(null);
                    }}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-[var(--text-primary)] outline-none"
                  >
                    {DEFAULT_TAB_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-[10px] text-[var(--text-muted)]">
                    Controls which default workspace or matching view opens first.
                  </p>
                </div>
                <div>
                  <label
                    htmlFor="settings-refresh-interval"
                    className="text-sm font-bold text-[var(--text-secondary)] mb-2 uppercase tracking-wider text-[10px]"
                  >
                    Refresh Interval
                  </label>
                  <select
                    id="settings-refresh-interval"
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-[var(--text-primary)] outline-none"
                  >
                    <option value="10">10 seconds</option>
                    <option value="30">30 seconds</option>
                    <option value="60">1 minute</option>
                  </select>
                </div>

                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="text-sm font-bold text-[var(--text-primary)]">Quick Walkthrough</h4>
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                        Replay the first-run tour for workspaces, header tools, tabs, and widget settings.
                      </p>
                    </div>
                    <button
                      type="button"
                      data-tour="settings-restart-walkthrough"
                      onClick={handleRestartWalkthrough}
                      className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-600/15 px-3 py-2 text-[11px] font-bold text-blue-300 transition-colors hover:bg-blue-600/25"
                    >
                      <RotateCcw size={14} />
                      Restart Walkthrough
                    </button>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'data' && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-bold text-[var(--text-secondary)] mb-2 uppercase tracking-wider text-[10px]">vnstock Data Source</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {(['KBS', 'VCI', 'DNSE'] as VnstockSource[]).map(src => (
                      <button
                        key={src}
                        onClick={() => setPreferredVnstockSource(src)}
                        className={cn(
                          "px-3 py-2 rounded-lg border text-sm transition-all",
                          preferredVnstockSource === src
                            ? "bg-blue-600/20 border-blue-500 text-blue-400 font-bold"
                            : "bg-[var(--bg-secondary)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-accent)]"
                        )}
                      >
                        {src}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] mt-2">KBS is the recommended default for vnstock 3.5.0+</p>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-[var(--text-secondary)] mb-2 uppercase tracking-wider text-[10px]">Display Units</h4>
                  <div className="grid grid-cols-5 gap-2">
                    {unitOptions.map(option => (
                      <button
                        key={option.value}
                        onClick={() => setUnit(option.value)}
                        className={cn(
                          "px-3 py-2 rounded-lg border text-[11px] font-bold transition-all",
                          unitConfig.display === option.value
                            ? "bg-blue-600/20 border-blue-500 text-blue-400"
                            : "bg-[var(--bg-secondary)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-accent)]"
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] mt-2">Applies to financial values across all widgets.</p>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-[var(--text-secondary)] mb-2 uppercase tracking-wider text-[10px]">Decimal Places</h4>
                  <div className="grid grid-cols-4 gap-2">
                    {decimalOptions.map((value) => (
                      <button
                        key={value}
                        onClick={() => setDecimalPlaces(value)}
                        className={cn(
                          "px-3 py-2 rounded-lg border text-[11px] font-bold transition-all",
                          unitConfig.decimalPlaces === value
                            ? "bg-blue-600/20 border-blue-500 text-blue-400"
                            : "bg-[var(--bg-secondary)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-accent)]"
                        )}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">Preview</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-secondary)]">1,234,567,890</span>
                    <span className="text-sm font-mono text-blue-300">
                      {formatUnitValue(1234567890, unitConfig)}
                    </span>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] mt-2">Units: {getUnitCaption(unitConfig)}</p>
                </div>
              </div>
            )}
            {activeTab === 'notifications' && <div className="text-[var(--text-muted)] text-sm">Notification settings coming soon.</div>}
            {activeTab === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-bold text-[var(--text-secondary)] mb-2 uppercase tracking-wider text-[10px]">Theme</h4>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
                    <div className="text-sm font-bold text-blue-300">Dark mode only</div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                      Light mode is temporarily disabled to keep layout, chart, and widget rendering consistent.
                    </div>
                    <div className="mt-3 inline-flex items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold text-blue-300">
                      Active theme: {resolvedTheme}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
