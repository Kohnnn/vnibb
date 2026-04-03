'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Settings as SettingsIcon, Database, Bell, Palette, RotateCcw, Shield, Sparkles } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
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
import {
  clearAdminLayoutKey,
  readAdminLayoutControlsVisible,
  readAdminLayoutKey,
  writeAdminLayoutControlsVisible,
  writeAdminLayoutKey,
} from '@/lib/adminLayoutAccess';
import { getAdminSystemDashboardTemplateBundle } from '@/lib/api';
import {
  clearStoredAISettings,
  OPENAI_COMPATIBLE_BASE_URL,
  OPENROUTER_BASE_URL,
  type AIProvider,
  readStoredAISettings,
  writeStoredAISettings,
  type AIProviderMode,
} from '@/lib/aiSettings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingTab = 'general' | 'ai' | 'data' | 'notifications' | 'appearance' | 'admin';

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingTab>('general');
  const [defaultTickerInput, setDefaultTickerInput] = useState(DEFAULT_TICKER);
  const [defaultTab, setDefaultTab] = useState<DefaultTabPreference>('overview');
  const [defaultTickerError, setDefaultTickerError] = useState<string | null>(null);
  const [preferenceStatus, setPreferenceStatus] = useState<string | null>(null);
  const [aiSettingsError, setAiSettingsError] = useState<string | null>(null);
  const [isTickerMenuOpen, setIsTickerMenuOpen] = useState(false);
  const [adminLayoutKeyInput, setAdminLayoutKeyInput] = useState('');
  const [showGlobalLayoutControls, setShowGlobalLayoutControls] = useState(false);
  const [isAdminLayoutKeyValidating, setIsAdminLayoutKeyValidating] = useState(false);
  const [aiProvider, setAiProvider] = useState<AIProvider>('openrouter');
  const [aiMode, setAiMode] = useState<AIProviderMode>('app_default');
  const [aiModelInput, setAiModelInput] = useState('openai/gpt-4o-mini');
  const [aiApiKeyInput, setAiApiKeyInput] = useState('');
  const [aiBaseUrlInput, setAiBaseUrlInput] = useState(OPENROUTER_BASE_URL);
  const [aiWebSearch, setAiWebSearch] = useState(false);
  const [aiPreferAppwriteData, setAiPreferAppwriteData] = useState(true);
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
      setAiSettingsError(null);
      setIsTickerMenuOpen(false);
      setAdminLayoutKeyInput(readAdminLayoutKey());
      setShowGlobalLayoutControls(readAdminLayoutControlsVisible());
      const aiSettings = readStoredAISettings();
      setAiProvider(aiSettings.provider);
      setAiMode(aiSettings.mode);
      setAiModelInput(aiSettings.model);
      setAiApiKeyInput(aiSettings.apiKey);
      setAiBaseUrlInput(aiSettings.baseUrl);
      setAiWebSearch(aiSettings.webSearch);
      setAiPreferAppwriteData(aiSettings.preferAppwriteData);
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

  const applyAISettings = () => {
    const normalizedModel = aiModelInput.trim();
    const normalizedBaseUrl = aiBaseUrlInput.trim().replace(/\/$/, '');
    if (!normalizedModel) {
      setAiSettingsError('Enter a model slug, for example openai/gpt-4o-mini.');
      return;
    }

    if (aiProvider === 'openrouter' && aiMode === 'browser_key' && !aiApiKeyInput.trim()) {
      setAiSettingsError('Enter an OpenRouter API key or switch back to App default mode.');
      return;
    }

    if (aiProvider === 'openai_compatible' && !normalizedBaseUrl) {
      setAiSettingsError('Enter a base URL for the OpenAI-compatible provider.');
      return;
    }

    if (aiProvider === 'openai_compatible' && !aiApiKeyInput.trim()) {
      setAiSettingsError('Enter a browser-local API key for the OpenAI-compatible provider.');
      return;
    }

    const nextSettings = writeStoredAISettings({
      provider: aiProvider,
      mode: aiMode,
      model: normalizedModel,
      apiKey: aiApiKeyInput,
      baseUrl: normalizedBaseUrl,
      webSearch: aiWebSearch,
      preferAppwriteData: aiPreferAppwriteData,
    });

    setAiSettingsError(null);
    setAiProvider(nextSettings.provider);
    setAiMode(nextSettings.mode);
    setAiModelInput(nextSettings.model);
    setAiApiKeyInput(nextSettings.apiKey);
    setAiBaseUrlInput(nextSettings.baseUrl);
    setAiWebSearch(nextSettings.webSearch);
    setAiPreferAppwriteData(nextSettings.preferAppwriteData);
    setPreferenceStatus(
      nextSettings.mode === 'browser_key'
        ? `AI settings saved locally: ${nextSettings.provider} browser key + ${nextSettings.model}.`
        : `AI settings saved locally: app OpenRouter key + ${nextSettings.model}.`,
    );
  };

  const tabs = [
    { id: 'general' as const, label: 'General', icon: SettingsIcon },
    { id: 'ai' as const, label: 'AI', icon: Sparkles },
    { id: 'data' as const, label: 'Data Sources', icon: Database },
    { id: 'notifications' as const, label: 'Notifications', icon: Bell },
    { id: 'appearance' as const, label: 'Appearance', icon: Palette },
    { id: 'admin' as const, label: 'Admin', icon: Shield },
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
            {activeTab === 'ai' && (
              <div className="space-y-6">
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="text-sm font-bold text-[var(--text-primary)]">AI Providers</h4>
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                        VNIBB uses an Appwrite-first AI flow. Market data from your runtime Appwrite database is preferred over internet sources.
                      </p>
                    </div>
                    <div className="rounded-full border border-blue-500/30 bg-blue-600/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-300">
                      Browser-local only
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] text-[10px]">Provider</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAiProvider('openrouter')
                        setAiBaseUrlInput(OPENROUTER_BASE_URL)
                        if (aiSettingsError) setAiSettingsError(null)
                      }}
                      className={cn(
                        'rounded-lg border px-3 py-3 text-left transition-all',
                        aiProvider === 'openrouter'
                          ? 'border-blue-500 bg-blue-600/15 text-blue-300'
                          : 'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-accent)]'
                      )}
                    >
                      <div className="text-xs font-bold uppercase tracking-wider">OpenRouter</div>
                      <div className="mt-1 text-[11px] text-[var(--text-muted)]">Recommended. Use your Oracle app key or a browser-local OpenRouter key.</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAiProvider('openai_compatible')
                        setAiMode('browser_key')
                        setAiWebSearch(false)
                        if (!aiBaseUrlInput || aiBaseUrlInput === OPENROUTER_BASE_URL) {
                          setAiBaseUrlInput(OPENAI_COMPATIBLE_BASE_URL)
                        }
                        if (aiSettingsError) setAiSettingsError(null)
                      }}
                      className={cn(
                        'rounded-lg border px-3 py-3 text-left transition-all',
                        aiProvider === 'openai_compatible'
                          ? 'border-blue-500 bg-blue-600/15 text-blue-300'
                          : 'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-accent)]'
                      )}
                    >
                      <div className="text-xs font-bold uppercase tracking-wider">OpenAI-Compatible</div>
                      <div className="mt-1 text-[11px] text-[var(--text-muted)]">Bring your own API key and base URL for OpenAI-style `/chat/completions` providers.</div>
                    </button>
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] text-[10px]">Credential Source</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={aiProvider !== 'openrouter'}
                      onClick={() => {
                        setAiMode('app_default')
                        if (aiSettingsError) setAiSettingsError(null)
                      }}
                      className={cn(
                        'rounded-lg border px-3 py-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50',
                        aiMode === 'app_default'
                          ? 'border-blue-500 bg-blue-600/15 text-blue-300'
                          : 'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-accent)]'
                      )}
                    >
                      <div className="text-xs font-bold uppercase tracking-wider">App Default</div>
                      <div className="mt-1 text-[11px] text-[var(--text-muted)]">Use the OpenRouter key configured on your Oracle backend.</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAiMode('browser_key')
                        if (aiSettingsError) setAiSettingsError(null)
                      }}
                      className={cn(
                        'rounded-lg border px-3 py-3 text-left transition-all',
                        aiMode === 'browser_key'
                          ? 'border-blue-500 bg-blue-600/15 text-blue-300'
                          : 'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-accent)]'
                      )}
                    >
                      <div className="text-xs font-bold uppercase tracking-wider">Browser Key</div>
                      <div className="mt-1 text-[11px] text-[var(--text-muted)]">Store your provider key only in this browser instance.</div>
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="settings-ai-model"
                    className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] text-[10px]"
                  >
                    Model Slug
                  </label>
                  <input
                    id="settings-ai-model"
                    type="text"
                    value={aiModelInput}
                    onChange={(event) => {
                      setAiModelInput(event.target.value)
                      if (aiSettingsError) setAiSettingsError(null)
                    }}
                    placeholder="openai/gpt-4o-mini"
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-blue-500"
                  />
                  <p className="mt-2 text-[10px] text-[var(--text-muted)]">
                    {aiProvider === 'openrouter'
                      ? 'Any OpenRouter model slug is allowed. Start with `openai/gpt-4o-mini` for a low-cost default.'
                      : 'Enter the model ID supported by your OpenAI-compatible provider.'}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="settings-ai-api-key"
                    className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] text-[10px]"
                  >
                    {aiProvider === 'openrouter' ? 'Provider API Key' : 'OpenAI-Compatible API Key'}
                  </label>
                  <input
                    id="settings-ai-api-key"
                    type="password"
                    value={aiApiKeyInput}
                    onChange={(event) => {
                      setAiApiKeyInput(event.target.value)
                      if (aiSettingsError) setAiSettingsError(null)
                    }}
                    placeholder={aiMode === 'browser_key' ? 'Required for browser-local mode' : 'Optional unless Browser Key mode is enabled'}
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-blue-500"
                  />
                  <p className="mt-2 text-[10px] text-[var(--text-muted)]">
                    This key stays in your browser local storage. VNIBB does not persist it server-side.
                  </p>
                </div>

                {aiProvider === 'openai_compatible' && (
                  <div>
                    <label
                      htmlFor="settings-ai-base-url"
                      className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] text-[10px]"
                    >
                      Base URL
                    </label>
                    <input
                      id="settings-ai-base-url"
                      type="text"
                      value={aiBaseUrlInput}
                      onChange={(event) => {
                        setAiBaseUrlInput(event.target.value)
                        if (aiSettingsError) setAiSettingsError(null)
                      }}
                      placeholder="https://api.openai.com/v1"
                      className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-blue-500"
                    />
                    <p className="mt-2 text-[10px] text-[var(--text-muted)]">
                      This must expose an OpenAI-style `/chat/completions` endpoint.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="flex items-start gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
                    <input
                      type="checkbox"
                      checked={aiPreferAppwriteData}
                      onChange={(event) => setAiPreferAppwriteData(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded"
                    />
                    <span>
                      <span className="block text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">Prefer Appwrite data</span>
                      <span className="mt-1 block text-[11px] text-[var(--text-muted)]">Use runtime Appwrite market data first and only fall back when that data is missing.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
                    <input
                      type="checkbox"
                      checked={aiWebSearch}
                      onChange={(event) => setAiWebSearch(event.target.checked)}
                      disabled={aiProvider !== 'openrouter'}
                      className="mt-0.5 h-4 w-4 rounded"
                    />
                    <span>
                      <span className="block text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">Allow web search</span>
                      <span className="mt-1 block text-[11px] text-[var(--text-muted)]">{aiProvider === 'openrouter'
                        ? 'Keep this off unless you want the model to supplement Appwrite data with external web context.'
                        : 'Web search is currently available only through the OpenRouter path.'}</span>
                    </span>
                  </label>
                </div>

                {aiSettingsError && (
                  <p className="text-[11px] text-amber-300">{aiSettingsError}</p>
                )}
                {preferenceStatus && (
                  <p className="text-[11px] text-emerald-300">{preferenceStatus}</p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={applyAISettings}
                    className="rounded-lg border border-blue-500/40 bg-blue-600/15 px-4 py-2 text-sm font-semibold text-blue-300 transition-colors hover:bg-blue-600/25"
                  >
                    Save AI Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextSettings = clearStoredAISettings()
                      setAiProvider(nextSettings.provider)
                      setAiMode(nextSettings.mode)
                      setAiModelInput(nextSettings.model)
                      setAiApiKeyInput(nextSettings.apiKey)
                      setAiBaseUrlInput(nextSettings.baseUrl)
                      setAiWebSearch(nextSettings.webSearch)
                      setAiPreferAppwriteData(nextSettings.preferAppwriteData)
                      setAiSettingsError(null)
                      setPreferenceStatus('AI settings reset to defaults for this browser.')
                    }}
                    className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    Reset AI Settings
                  </button>
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
            {activeTab === 'admin' && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-bold text-[var(--text-secondary)] mb-2 uppercase tracking-wider text-[10px]">Global Layout Admin Key</h4>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-4">
                    <div className="text-sm font-bold text-[var(--text-primary)]">Admin-first Initial layout publishing</div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                      Store your admin hash key locally on this machine to unlock draft and publish controls for the Initial system dashboards.
                    </div>
                    <input
                      type="password"
                      value={adminLayoutKeyInput}
                      onChange={(event) => setAdminLayoutKeyInput(event.target.value)}
                      placeholder="Enter admin layout key"
                      className="mt-4 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-blue-500"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const trimmedKey = adminLayoutKeyInput.trim()
                          if (!trimmedKey) {
                            clearAdminLayoutKey()
                            writeAdminLayoutControlsVisible(false)
                            setShowGlobalLayoutControls(false)
                            setPreferenceStatus('Admin layout key cleared.')
                            return
                          }

                          try {
                            setIsAdminLayoutKeyValidating(true)
                            await getAdminSystemDashboardTemplateBundle('default-fundamental', trimmedKey)
                            writeAdminLayoutKey(trimmedKey)
                            setPreferenceStatus('Admin layout key validated and saved locally.')
                          } catch (error) {
                            clearAdminLayoutKey()
                            writeAdminLayoutControlsVisible(false)
                            setShowGlobalLayoutControls(false)
                            setPreferenceStatus(error instanceof Error ? `Admin key invalid: ${error.message}` : 'Admin key validation failed.')
                          } finally {
                            setIsAdminLayoutKeyValidating(false)
                          }
                        }}
                        disabled={isAdminLayoutKeyValidating}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isAdminLayoutKeyValidating ? 'Validating…' : 'Save Key'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          clearAdminLayoutKey()
                          writeAdminLayoutControlsVisible(false)
                          setAdminLayoutKeyInput('')
                          setShowGlobalLayoutControls(false)
                          setPreferenceStatus('Admin layout key removed from this browser.')
                        }}
                        className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      >
                        Clear Key
                      </button>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${readAdminLayoutKey().trim() ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-muted)]'}`}>
                        Admin key: {readAdminLayoutKey().trim() ? 'active' : 'inactive'}
                      </div>
                      <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${showGlobalLayoutControls ? 'border-blue-500/30 bg-blue-500/10 text-blue-300' : 'border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-muted)]'}`}>
                        Layout controls: {showGlobalLayoutControls ? 'visible' : 'hidden'}
                      </div>
                    </div>
                    {readAdminLayoutKey().trim() ? (
                      <div className="mt-4 flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3">
                        <div className="pr-4">
                          <div className="text-sm font-semibold text-[var(--text-primary)]">Show global layout controls</div>
                          <div className="mt-1 text-xs text-[var(--text-muted)]">
                            Toggle the floating admin controls for Initial dashboards. Keep this off when you are not actively editing layouts.
                          </div>
                        </div>
                        <Switch
                          checked={showGlobalLayoutControls}
                          onCheckedChange={(checked) => {
                            setShowGlobalLayoutControls(checked)
                            writeAdminLayoutControlsVisible(checked)
                            setPreferenceStatus(checked ? 'Global layout controls enabled.' : 'Global layout controls hidden.')
                          }}
                        />
                      </div>
                    ) : null}
                    <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-3 text-xs text-amber-100/80">
                      This is an initial admin-only flow. Later tenant roles can replace the raw key with a proper server-issued admin session.
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
