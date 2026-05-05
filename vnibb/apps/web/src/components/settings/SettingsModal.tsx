'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Settings as SettingsIcon, Database, Bell, Palette, RotateCcw, Shield, Sparkles } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { AICopilotTelemetryReview } from '@/components/admin/AICopilotTelemetryReview';
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from '@/lib/analytics';
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
import { formatNumber, formatUnitValue, getUnitCaption, type UnitDisplay } from '@/lib/units';
import {
  clearAdminLayoutKey,
  readAdminLayoutControlsVisible,
  readAdminLayoutKey,
  readAdminLayoutKeyValidated,
  writeAdminLayoutControlsVisible,
  writeAdminLayoutKey,
  writeAdminLayoutKeyValidated,
} from '@/lib/adminLayoutAccess';
import {
  getAdminAIPromptLibrary,
  getAdminAIRuntimeConfig,
  getAdminUnitRuntimeConfig,
  getAdminProviderStatus,
  getCopilotRuntimeConfig,
  getCopilotModelCatalog,
  getAdminSystemDashboardTemplateBundle,
  saveAdminAIPromptLibrary,
  saveAdminUnitRuntimeConfig,
  saveAdminAIRuntimeConfig,
  type ModelOption,
  type PromptTemplate,
  type UnitRuntimeConfigResponse,
} from '@/lib/api';
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

function toRateInputs(ratesByYear?: Record<string, number> | null): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ratesByYear || {}).map(([year, rate]) => [year, String(rate)])
  )
}

function parseUsdRateInputs(
  inputs: Record<string, string>,
  years: number[]
): { rates: Record<string, number>; invalidYear: number | null } {
  const rates: Record<string, number> = {}

  for (const year of years) {
    const rawValue = inputs[String(year)]?.trim()
    if (!rawValue) continue

    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { rates: {}, invalidYear: year }
    }
    rates[String(year)] = parsed
  }

  return { rates, invalidYear: null }
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const hasTrackedOpenRef = useRef(false)
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
  const [adminAiModelInput, setAdminAiModelInput] = useState('openai/gpt-4o-mini');
  const [isAdminAiRuntimeLoading, setIsAdminAiRuntimeLoading] = useState(false);
  const [isAdminAiRuntimeSaving, setIsAdminAiRuntimeSaving] = useState(false);
  const [adminUsdVndDefaultRateInput, setAdminUsdVndDefaultRateInput] = useState('25000');
  const [isAdminUnitRuntimeLoading, setIsAdminUnitRuntimeLoading] = useState(false);
  const [isAdminUnitRuntimeSaving, setIsAdminUnitRuntimeSaving] = useState(false);
  const [usdRateInputs, setUsdRateInputs] = useState<Record<string, string>>({});
  const [adminUsdRateInputs, setAdminUsdRateInputs] = useState<Record<string, string>>({});
  const [adminOpenRouterConfigured, setAdminOpenRouterConfigured] = useState<boolean | null>(null);
  const [adminOpenRouterReachable, setAdminOpenRouterReachable] = useState<boolean | null>(null);
  const [adminOpenRouterCatalogSource, setAdminOpenRouterCatalogSource] = useState<string | null>(null);
  const [adminOpenRouterFreeModelsUrl, setAdminOpenRouterFreeModelsUrl] = useState<string | null>(null);
  const [adminOpenRouterFreeModelCount, setAdminOpenRouterFreeModelCount] = useState<number | null>(null);
  const [adminRuntimeProvider, setAdminRuntimeProvider] = useState<string | null>(null);
  const [sharedPrompts, setSharedPrompts] = useState<PromptTemplate[]>([]);
  const [isAdminPromptLibraryLoading, setIsAdminPromptLibraryLoading] = useState(false);
  const [isAdminPromptLibrarySaving, setIsAdminPromptLibrarySaving] = useState(false);
  const [sharedPromptVersion, setSharedPromptVersion] = useState(0);
  const [sharedPromptHistory, setSharedPromptHistory] = useState<Array<{ version: number; updated_at?: string | null; prompt_count: number }>>([]);
  const [newSharedPromptLabel, setNewSharedPromptLabel] = useState('');
  const [newSharedPromptTemplate, setNewSharedPromptTemplate] = useState('');
  const [newSharedPromptCategory, setNewSharedPromptCategory] = useState<NonNullable<PromptTemplate['category']>>('analysis');
  const [aiProvider, setAiProvider] = useState<AIProvider>('openrouter');
  const [aiMode, setAiMode] = useState<AIProviderMode>('app_default');
  const [aiModelInput, setAiModelInput] = useState('openai/gpt-4o-mini');
  const [aiApiKeyInput, setAiApiKeyInput] = useState('');
  const [aiBaseUrlInput, setAiBaseUrlInput] = useState(OPENROUTER_BASE_URL);
  const [aiWebSearch, setAiWebSearch] = useState(false);
  const [aiPreferAppwriteData, setAiPreferAppwriteData] = useState(true);
  const [aiEnableSidebarWorkflowOutputs, setAiEnableSidebarWorkflowOutputs] = useState(false);
  const [openRouterModels, setOpenRouterModels] = useState<ModelOption[]>([]);
  const [isOpenRouterModelsLoading, setIsOpenRouterModelsLoading] = useState(false);
  const [publicRuntimeModel, setPublicRuntimeModel] = useState<string | null>(null);
  const { preferredVnstockSource, setPreferredVnstockSource } = useDataSources();
  const { resolvedTheme } = useTheme();
  const {
    config: unitConfig,
    globalUsdVndDefaultRate,
    adminUsdVndRatesByYear,
    localUsdVndRatesByYear,
    setUnit,
    setDecimalPlaces,
    setUsdVndRate,
    clearUsdVndRates,
    applyAdminUsdRuntimeConfig,
  } = useUnit();
  const { globalSymbol, setGlobalSymbol } = useSymbolLink();
  const { setGlobalSymbol: setWidgetGroupGlobalSymbol } = useWidgetGroups();
  const { state, activeDashboard, setActiveDashboard, setActiveTab: setDashboardActiveTab } = useDashboard();

  const tickerSuggestions = useMemo(() => searchStocks(defaultTickerInput, 6), [defaultTickerInput]);

  const recommendedOpenRouterModels = useMemo(
    () => openRouterModels.filter((model) => model.recommended).slice(0, 8),
    [openRouterModels]
  )
  const freeOpenRouterModels = useMemo(
    () => openRouterModels.filter((model) => model.is_free).slice(0, 8),
    [openRouterModels]
  )

  const loadOpenRouterModels = useCallback(async () => {
    try {
      setIsOpenRouterModelsLoading(true)
      const response = await getCopilotModelCatalog('openrouter')
      setOpenRouterModels(response.models || [])
    } catch {
      // Keep the UI usable with the existing input even if catalog fetch fails.
    } finally {
      setIsOpenRouterModelsLoading(false)
    }
  }, [])

  const loadPublicRuntimeConfig = useCallback(async () => {
    try {
      const config = await getCopilotRuntimeConfig()
      setPublicRuntimeModel(config.model)
    } catch {
      setPublicRuntimeModel(null)
    }
  }, [])

  const loadAdminPromptLibrary = useCallback(async (adminKey: string) => {
    const trimmedKey = adminKey.trim()
    if (!trimmedKey) return

    try {
      setIsAdminPromptLibraryLoading(true)
      const response = await getAdminAIPromptLibrary(trimmedKey)
      setSharedPrompts(response.data || [])
      setSharedPromptVersion(response.version || 0)
      setSharedPromptHistory(response.history || [])
    } catch (error) {
      setPreferenceStatus(error instanceof Error ? `VniAgent prompt library load failed: ${error.message}` : 'VniAgent prompt library load failed.')
    } finally {
      setIsAdminPromptLibraryLoading(false)
    }
  }, [])

  const loadAdminAiRuntimeConfig = useCallback(async (adminKey: string) => {
    const trimmedKey = adminKey.trim()
    if (!trimmedKey) return

    try {
      setIsAdminAiRuntimeLoading(true)
      const config = await getAdminAIRuntimeConfig(trimmedKey)
      setAdminAiModelInput(config.model || 'openai/gpt-4o-mini')
      const providerStatus = await getAdminProviderStatus(trimmedKey)
      setAdminOpenRouterConfigured(Boolean(providerStatus.providers.openrouter_configured))
      setAdminOpenRouterReachable(typeof providerStatus.providers.openrouter_reachable === 'boolean' ? providerStatus.providers.openrouter_reachable : null)
      setAdminOpenRouterCatalogSource(typeof providerStatus.providers.openrouter_catalog_source === 'string' ? providerStatus.providers.openrouter_catalog_source : null)
      setAdminOpenRouterFreeModelsUrl(typeof providerStatus.providers.openrouter_free_models_url === 'string' ? providerStatus.providers.openrouter_free_models_url : null)
      setAdminOpenRouterFreeModelCount(typeof providerStatus.providers.openrouter_free_model_count === 'number' ? providerStatus.providers.openrouter_free_model_count : null)
      setAdminRuntimeProvider(typeof providerStatus.providers.ai_runtime_provider === 'string' ? providerStatus.providers.ai_runtime_provider : null)
    } catch (error) {
      setPreferenceStatus(error instanceof Error ? `VniAgent runtime load failed: ${error.message}` : 'VniAgent runtime load failed.')
    } finally {
      setIsAdminAiRuntimeLoading(false)
    }
  }, [])

  const loadAdminUnitRuntimeConfig = useCallback(async (adminKey: string) => {
    const trimmedKey = adminKey.trim()
    if (!trimmedKey) return

    try {
      setIsAdminUnitRuntimeLoading(true)
      const config = await getAdminUnitRuntimeConfig(trimmedKey)
      applyAdminUsdRuntimeConfig(config)
      setAdminUsdVndDefaultRateInput(String(config.usd_vnd_default_rate || 25000))
      setAdminUsdRateInputs(toRateInputs(config.usd_vnd_rates_by_year))
    } catch (error) {
      setPreferenceStatus(error instanceof Error ? `Unit runtime load failed: ${error.message}` : 'Unit runtime load failed.')
    } finally {
      setIsAdminUnitRuntimeLoading(false)
    }
  }, [applyAdminUsdRuntimeConfig])

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
      setAiEnableSidebarWorkflowOutputs(aiSettings.enableSidebarWorkflowOutputs);
      setUsdRateInputs(toRateInputs(localUsdVndRatesByYear))
      setAdminUsdRateInputs(toRateInputs(adminUsdVndRatesByYear))
    }
  }, [adminUsdVndRatesByYear, globalSymbol, isOpen, localUsdVndRatesByYear]);

  useEffect(() => {
    if (!isOpen) return;

    if (activeTab === 'ai' || activeTab === 'admin') {
      void loadOpenRouterModels()
      void loadPublicRuntimeConfig()
    }

    if (activeTab === 'admin' && readAdminLayoutKeyValidated()) {
      const adminKey = readAdminLayoutKey()
      void loadAdminAiRuntimeConfig(adminKey)
      void loadAdminUnitRuntimeConfig(adminKey)
      void loadAdminPromptLibrary(adminKey)
    }
  }, [activeTab, isOpen, loadAdminAiRuntimeConfig, loadAdminPromptLibrary, loadAdminUnitRuntimeConfig, loadOpenRouterModels, loadPublicRuntimeConfig])

  useEffect(() => {
    if (!preferenceStatus) return;
    const timeoutId = window.setTimeout(() => setPreferenceStatus(null), 2400);
    return () => window.clearTimeout(timeoutId);
  }, [preferenceStatus]);

  useEffect(() => {
    if (!isOpen) {
      hasTrackedOpenRef.current = false
      return
    }

    if (hasTrackedOpenRef.current) {
      return
    }

    hasTrackedOpenRef.current = true
    captureAnalyticsEvent(ANALYTICS_EVENTS.settingsOpened, {
      source: 'sidebar_modal',
      active_tab: activeTab,
    })
  }, [activeTab, isOpen])

  useEffect(() => {
    if (!isOpen) return
    captureAnalyticsEvent(ANALYTICS_EVENTS.settingsTabViewed, {
      tab: activeTab,
    })
  }, [activeTab, isOpen])

  const usdRateYears = useMemo(() => {
    const startYear = 2016
    const endYear = new Date().getFullYear() + 1
    return Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index)
  }, [])
  
  if (!isOpen) return null;

  const handleRestartWalkthrough = () => {
    captureAnalyticsEvent(ANALYTICS_EVENTS.walkthroughRestartRequested, {
      source: 'settings_modal',
    })
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
    captureAnalyticsEvent(ANALYTICS_EVENTS.preferencesSaved, {
      default_ticker: nextPreferences.defaultTicker,
      default_tab: nextPreferences.defaultTab,
      preferred_dashboard_id: preferredDashboardId,
      preferred_tab_id: preferredTabId,
    })
    setPreferenceStatus(`Saved locally: ${nextPreferences.defaultTicker} opens on ${tabLabel}.`);
  };

  const applyAISettings = () => {
    const normalizedModel = aiModelInput.trim();
    const normalizedBaseUrl = aiBaseUrlInput.trim().replace(/\/$/, '');
    const needsLocalModel = !(aiProvider === 'openrouter' && aiMode === 'app_default')
    if (needsLocalModel && !normalizedModel) {
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
      model: needsLocalModel ? normalizedModel : aiModelInput,
      apiKey: aiApiKeyInput,
      baseUrl: normalizedBaseUrl,
      webSearch: aiWebSearch,
      preferAppwriteData: aiPreferAppwriteData,
      enableSidebarWorkflowOutputs: aiEnableSidebarWorkflowOutputs,
    });

    setAiSettingsError(null);
    setAiProvider(nextSettings.provider);
    setAiMode(nextSettings.mode);
    setAiModelInput(nextSettings.model);
    setAiApiKeyInput(nextSettings.apiKey);
    setAiBaseUrlInput(nextSettings.baseUrl);
    setAiWebSearch(nextSettings.webSearch);
    setAiPreferAppwriteData(nextSettings.preferAppwriteData);
    setAiEnableSidebarWorkflowOutputs(nextSettings.enableSidebarWorkflowOutputs);
    captureAnalyticsEvent(ANALYTICS_EVENTS.aiSettingsSaved, {
      provider: nextSettings.provider,
      mode: nextSettings.mode,
      model: nextSettings.model,
      web_search: nextSettings.webSearch,
      prefer_vnibb_data: nextSettings.preferAppwriteData,
      sidebar_workflow_outputs: nextSettings.enableSidebarWorkflowOutputs,
    })
    setPreferenceStatus(
      nextSettings.mode === 'browser_key'
        ? `VniAgent settings saved locally: ${nextSettings.provider} browser key + ${nextSettings.model}.`
        : 'VniAgent settings saved locally: app default provider + admin-managed model.',
    );
  };

  const addSharedPromptDraft = () => {
    const label = newSharedPromptLabel.trim()
    const template = newSharedPromptTemplate.trim()
    if (!label || !template) {
      setPreferenceStatus('Provide both a prompt title and template before adding a shared VniAgent prompt.')
      return
    }

    const nextPrompt: PromptTemplate = {
      id: `shared-${Date.now()}`,
      label,
      template,
      category: newSharedPromptCategory,
      source: 'shared',
      recommendedWidgetKeys: [],
      isDefault: false,
    }
    setSharedPrompts((prev) => [...prev, nextPrompt])
    setNewSharedPromptLabel('')
    setNewSharedPromptTemplate('')
    setNewSharedPromptCategory('analysis')
    captureAnalyticsEvent(ANALYTICS_EVENTS.adminPromptDraftAdded, {
      category: nextPrompt.category,
      prompt_count: sharedPrompts.length + 1,
    })
  }

  const saveSharedPromptLibrary = async () => {
    const trimmedKey = adminLayoutKeyInput.trim()
    if (!trimmedKey) {
      setPreferenceStatus('Admin key required before saving shared VniAgent prompts.')
      return
    }

    try {
      setIsAdminPromptLibrarySaving(true)
      const response = await saveAdminAIPromptLibrary(trimmedKey, sharedPrompts)
      setSharedPrompts(response.data || [])
      setSharedPromptVersion(response.version || 0)
      setSharedPromptHistory(response.history || [])
      captureAnalyticsEvent(ANALYTICS_EVENTS.adminPromptLibrarySaved, {
        version: response.version || 0,
        prompt_count: response.count,
      })
      setPreferenceStatus(`Shared VniAgent prompt library saved (${response.count} prompts).`)
    } catch (error) {
      setPreferenceStatus(error instanceof Error ? `Shared VniAgent prompt save failed: ${error.message}` : 'Shared VniAgent prompt save failed.')
    } finally {
      setIsAdminPromptLibrarySaving(false)
    }
  }

  const tabs = [
    { id: 'general' as const, label: 'General', icon: SettingsIcon },
    { id: 'ai' as const, label: 'VniAgent', icon: Sparkles },
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
    { value: 'USD', label: 'USD' },
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
                      <h4 className="text-sm font-bold text-[var(--text-primary)]">VniAgent Providers</h4>
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                        VniAgent uses a VNIBB database-first workflow. The Appwrite-backed VNIBB market database stays the intended research corpus, while temporary quota-pressure writes can spill into Supabase without changing that preference.
                      </p>
                    </div>
                    <div className="rounded-full border border-blue-500/30 bg-blue-600/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-300">
                      Settings saved locally
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 space-y-3">
                  <div>
                    <h4 className="text-sm font-bold text-[var(--text-primary)]">Current Runtime Summary</h4>
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      Snapshot of the VniAgent setup currently active in this browser.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-1 font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                      {aiProvider === 'openai_compatible' ? 'OpenAI-Compatible' : 'OpenRouter'}
                    </span>
                    <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-1 font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                      {aiMode === 'browser_key' ? 'Browser Key' : 'App Default'}
                    </span>
                    <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 font-semibold uppercase tracking-[0.16em] text-blue-200">
                      {aiMode === 'browser_key' ? aiModelInput || 'Set model' : publicRuntimeModel || 'Admin runtime model'}
                    </span>
                    <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-1 font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                      {aiPreferAppwriteData ? 'VNIBB DB first' : 'External-first'}
                    </span>
                    <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-1 font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                      {aiEnableSidebarWorkflowOutputs ? 'Workflow panels on' : 'Answer-first sidebar'}
                    </span>
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] text-[10px]">Basics</h4>
                  <p className="mb-3 text-[11px] text-[var(--text-muted)]">
                    Choose the provider, credential source, and model behavior VniAgent should use by default in this browser.
                  </p>
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
                    list="vniagent-openrouter-models"
                    value={aiModelInput}
                    onChange={(event) => {
                      setAiModelInput(event.target.value)
                      if (aiSettingsError) setAiSettingsError(null)
                    }}
                    placeholder="openai/gpt-4o-mini"
                    disabled={aiProvider === 'openrouter' && aiMode === 'app_default'}
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <p className="mt-2 text-[10px] text-[var(--text-muted)]">
                    {aiProvider === 'openrouter' && aiMode === 'app_default'
                      ? `App Default mode uses the global VniAgent model${publicRuntimeModel ? `: ${publicRuntimeModel}` : ''}.`
                      : aiProvider === 'openrouter'
                      ? 'Any OpenRouter model slug is allowed. Start with `openai/gpt-4o-mini` for a low-cost default.'
                      : 'Enter the model ID supported by your OpenAI-compatible provider.'}
                  </p>
                  {aiProvider === 'openrouter' && (
                    <>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
                        {adminOpenRouterFreeModelCount ? (
                          <span>{adminOpenRouterFreeModelCount} free models currently visible in the catalog.</span>
                        ) : null}
                        <a
                          href={adminOpenRouterFreeModelsUrl || 'https://openrouter.ai/collections/free-models'}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-300 underline underline-offset-2"
                        >
                          OpenRouter free models
                        </a>
                      </div>
                      <datalist id="vniagent-openrouter-models">
                        {openRouterModels.map((model) => (
                          <option key={model.id} value={model.id}>{model.name}</option>
                        ))}
                      </datalist>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {recommendedOpenRouterModels.map((model) => (
                          <button
                            key={model.id}
                            type="button"
                            onClick={() => setAiModelInput(model.id)}
                            disabled={aiProvider === 'openrouter' && aiMode === 'app_default'}
                            className="rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[10px] font-semibold text-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
                            title={model.description || model.name}
                          >
                            {model.name}
                          </button>
                        ))}
                        {freeOpenRouterModels.map((model) => (
                          <button
                            key={`free-${model.id}`}
                            type="button"
                            onClick={() => setAiModelInput(model.id)}
                            disabled={aiProvider === 'openrouter' && aiMode === 'app_default'}
                            className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold text-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                            title={model.description || model.name}
                          >
                            {model.name} · free
                          </button>
                        ))}
                        {isOpenRouterModelsLoading && (
                          <span className="text-[10px] text-[var(--text-muted)]">Loading OpenRouter models…</span>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] text-[10px]">Connection</h4>
                  <p className="mb-3 text-[11px] text-[var(--text-muted)]">
                    Browser-key credentials stay local to this browser. App Default mode continues to use the backend-managed OpenRouter runtime.
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

                <div>
                  <h4 className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] text-[10px]">Data & Behavior</h4>
                  <p className="mb-3 text-[11px] text-[var(--text-muted)]">
                    Control whether VniAgent stays VNIBB database-first, whether it can reach the web, and whether the sidebar keeps workflow detail panels visible.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="flex items-start gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
                    <input
                      type="checkbox"
                      checked={aiPreferAppwriteData}
                      onChange={(event) => setAiPreferAppwriteData(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded"
                    />
                    <span>
                      <span className="block text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">Prefer VNIBB database</span>
                      <span className="mt-1 block text-[11px] text-[var(--text-muted)]">Use the Appwrite-backed VNIBB market database first and only fall back when that context is missing or temporarily unavailable.</span>
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
                        ? 'Keep this off unless you want the model to supplement VNIBB database context with external web context.'
                        : 'Web search is currently available only through the OpenRouter path.'}</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
                    <input
                      type="checkbox"
                      checked={aiEnableSidebarWorkflowOutputs}
                      onChange={(event) => setAiEnableSidebarWorkflowOutputs(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded"
                    />
                    <span>
                      <span className="block text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">Enable sidebar workflow outputs</span>
                      <span className="mt-1 block text-[11px] text-[var(--text-muted)]">Show artifact, action, and evidence workflow panels directly in the main VniAgent sidebar. Leave off for a cleaner answer-first experience.</span>
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
                    Save VniAgent Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextSettings = clearStoredAISettings()
                      captureAnalyticsEvent(ANALYTICS_EVENTS.aiSettingsReset, {
                        provider: nextSettings.provider,
                        mode: nextSettings.mode,
                        model: nextSettings.model,
                      })
                      setAiProvider(nextSettings.provider)
                      setAiMode(nextSettings.mode)
                      setAiModelInput(nextSettings.model)
                      setAiApiKeyInput(nextSettings.apiKey)
                      setAiBaseUrlInput(nextSettings.baseUrl)
                      setAiWebSearch(nextSettings.webSearch)
                      setAiPreferAppwriteData(nextSettings.preferAppwriteData)
                      setAiEnableSidebarWorkflowOutputs(nextSettings.enableSidebarWorkflowOutputs)
                      setAiSettingsError(null)
                      setPreferenceStatus('VniAgent settings reset to defaults for this browser.')
                    }}
                    className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    Reset VniAgent Settings
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
                        onClick={() => {
                          captureAnalyticsEvent(ANALYTICS_EVENTS.dataSourceChanged, {
                            previous_source: preferredVnstockSource,
                            source: src,
                          })
                          setPreferredVnstockSource(src)
                        }}
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
                  <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
                    {unitOptions.map(option => (
                      <button
                        key={option.value}
                        onClick={() => {
                          captureAnalyticsEvent(ANALYTICS_EVENTS.unitDisplayChanged, {
                            previous_display: unitConfig.display,
                            display: option.value,
                          })
                          setUnit(option.value)
                        }}
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

                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 space-y-4">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-bold text-[var(--text-secondary)] mb-1 uppercase tracking-wider text-[10px]">Currency & FX</h4>
                      <div className="inline-flex items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                        Current display: {unitConfig.display}
                      </div>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      Financial and fundamental widgets convert VND values to USD using the rate for each report year. You can prepare yearly overrides here even while the site is still displaying VND.
                    </p>
                    <p className="mt-1 text-[10px] text-cyan-300">
                      Admin fallback: {formatNumber(globalUsdVndDefaultRate, { decimals: 0 })} VND/USD. Shared yearly defaults loaded for {Object.keys(adminUsdVndRatesByYear).length} years.
                    </p>
                    {unitConfig.display !== 'USD' ? (
                      <p className="mt-1 text-[10px] text-amber-300">
                        These FX overrides take effect when Display Units is set to USD.
                      </p>
                    ) : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {usdRateYears.map((year) => (
                      <label key={year} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{year}</div>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="1"
                          step="0.01"
                          value={usdRateInputs[String(year)] ?? ''}
                          onChange={(event) => {
                            const nextValue = event.target.value
                            setUsdRateInputs((prev) => ({ ...prev, [String(year)]: nextValue }))
                            if (nextValue === '') {
                              setUsdVndRate(year, null)
                            }
                          }}
                          onBlur={() => {
                            const rawValue = usdRateInputs[String(year)]
                            if (!rawValue) {
                              captureAnalyticsEvent(ANALYTICS_EVENTS.usdRateOverrideUpdated, {
                                year,
                                mode: 'cleared',
                              })
                              setUsdVndRate(year, null)
                              return
                            }
                            const parsed = Number(rawValue)
                            if (!Number.isFinite(parsed) || parsed <= 0) {
                              setPreferenceStatus(`Invalid USD/VND rate for ${year}. Use a number greater than zero.`)
                              return
                            }
                            captureAnalyticsEvent(ANALYTICS_EVENTS.usdRateOverrideUpdated, {
                              year,
                              mode: 'saved',
                            })
                            setUsdVndRate(year, parsed)
                          }}
                          placeholder={String(adminUsdVndRatesByYear[String(year)] || globalUsdVndDefaultRate)}
                          className="mt-2 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-blue-500"
                        />
                        <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                          {localUsdVndRatesByYear[String(year)]
                            ? 'Local override'
                            : adminUsdVndRatesByYear[String(year)]
                              ? 'Using admin yearly default'
                              : 'Using admin global default'}
                        </div>
                        {!localUsdVndRatesByYear[String(year)] && adminUsdVndRatesByYear[String(year)] ? (
                          <div className="mt-1 text-[10px] text-cyan-300">
                            Admin default: {formatNumber(adminUsdVndRatesByYear[String(year)], { decimals: 0 })} VND/USD
                          </div>
                        ) : null}
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        captureAnalyticsEvent(ANALYTICS_EVENTS.usdRateOverridesReset, {
                          override_count: Object.keys(localUsdVndRatesByYear).length,
                        })
                        clearUsdVndRates()
                        setUsdRateInputs({})
                        setPreferenceStatus('Local USD/VND yearly overrides cleared.')
                      }}
                      className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      Reset Local USD Overrides
                    </button>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-[var(--text-secondary)] mb-2 uppercase tracking-wider text-[10px]">Decimal Places</h4>
                  <div className="grid grid-cols-4 gap-2">
                    {decimalOptions.map((value) => (
                      <button
                        key={value}
                        onClick={() => {
                          captureAnalyticsEvent(ANALYTICS_EVENTS.decimalPlacesChanged, {
                            previous_decimal_places: unitConfig.decimalPlaces,
                            decimal_places: value,
                          })
                          setDecimalPlaces(value)
                        }}
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
            {activeTab === 'notifications' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-2 text-blue-300">
                      <Bell size={16} />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-[var(--text-primary)]">Price alerts are managed from widgets</div>
                      <div className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                        Use Price Alerts and Alert Settings widgets to create symbol-specific thresholds. This settings tab is reserved for delivery channels, quiet hours, and global alert defaults once notification delivery is enabled.
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-300">Available Now</div>
                    <div className="mt-2 text-xs text-[var(--text-secondary)]">In-workspace price alerts, alert history, and widget-level thresholds.</div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">Planned</div>
                    <div className="mt-2 text-xs text-[var(--text-secondary)]">Email, browser push, and default notification policies.</div>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-bold text-[var(--text-secondary)] mb-2 uppercase tracking-wider text-[10px]">Theme</h4>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
                    <div className="text-sm font-bold text-blue-300">Dark mode locked for this release</div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                      The dashboard is currently tuned for dark surfaces so TradingView embeds, dense tables, and financial charts stay visually consistent. Light mode will return after widget color tokens and chart overlays are audited together.
                    </div>
                    <div className="mt-3 inline-flex items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold text-blue-300">
                      Active theme: {resolvedTheme}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
                  <div className="text-sm font-bold text-[var(--text-primary)]">Display controls still live in the header</div>
                  <div className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                    Use the header display menu for unit formatting and precision. Appearance settings will consolidate density, theme, and chart-style defaults after the visual QA pass.
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
                            captureAnalyticsEvent(ANALYTICS_EVENTS.adminLayoutKeyCleared, {
                              source: 'empty_save',
                            })
                            clearAdminLayoutKey()
                            writeAdminLayoutControlsVisible(false)
                            setShowGlobalLayoutControls(false)
                            setPreferenceStatus('Admin layout key cleared.')
                            return
                          }

                          try {
                            setIsAdminLayoutKeyValidating(true)
                            await getAdminSystemDashboardTemplateBundle('default-fundamental', trimmedKey)
                            await loadAdminAiRuntimeConfig(trimmedKey)
                            await loadAdminUnitRuntimeConfig(trimmedKey)
                            writeAdminLayoutKey(trimmedKey)
                            writeAdminLayoutKeyValidated(true)
                            captureAnalyticsEvent(ANALYTICS_EVENTS.adminLayoutKeySaved, {
                              status: 'validated',
                            })
                            setPreferenceStatus('Admin layout key validated and saved locally.')
                          } catch (error) {
                            captureAnalyticsEvent(ANALYTICS_EVENTS.adminLayoutKeyValidationFailed, {
                              error_type: error instanceof Error ? error.message : 'validation_failed',
                            })
                            clearAdminLayoutKey()
                            writeAdminLayoutKeyValidated(false)
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
                          captureAnalyticsEvent(ANALYTICS_EVENTS.adminLayoutKeyCleared, {
                            source: 'clear_button',
                          })
                          clearAdminLayoutKey()
                          writeAdminLayoutKeyValidated(false)
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
                      <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${readAdminLayoutKeyValidated() ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-muted)]'}`}>
                        Admin key: {readAdminLayoutKeyValidated() ? 'active' : 'inactive'}
                      </div>
                      <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${showGlobalLayoutControls ? 'border-blue-500/30 bg-blue-500/10 text-blue-300' : 'border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-muted)]'}`}>
                        Layout controls: {showGlobalLayoutControls ? 'visible' : 'hidden'}
                      </div>
                    </div>
                    {readAdminLayoutKeyValidated() ? (
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
                            captureAnalyticsEvent(ANALYTICS_EVENTS.adminLayoutControlsToggled, {
                              enabled: checked,
                            })
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

                {readAdminLayoutKeyValidated() && (
                  <div>
                    <h4 className="text-sm font-bold text-[var(--text-secondary)] mb-2 uppercase tracking-wider text-[10px]">VniAgent Runtime Defaults</h4>
                    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-4">
                      <div className="text-sm font-bold text-[var(--text-primary)]">App default OpenRouter model</div>
                      <div className="mt-1 text-xs text-[var(--text-muted)]">
                        This controls the default model used when users select `App Default` in AI settings.
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${adminOpenRouterConfigured ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
                          OpenRouter: {adminOpenRouterConfigured ? 'configured' : 'missing key'}
                        </div>
                        {adminOpenRouterReachable !== null && (
                          <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${adminOpenRouterReachable ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
                            Catalog: {adminOpenRouterReachable ? 'reachable' : (adminOpenRouterCatalogSource || 'fallback')}
                          </div>
                        )}
                        <div className="inline-flex items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-1 text-[11px] font-semibold text-[var(--text-secondary)]">
                          Runtime provider: {adminRuntimeProvider || 'openrouter'}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
                        {adminOpenRouterFreeModelCount ? <span>{adminOpenRouterFreeModelCount} free models available.</span> : null}
                        <a
                          href={adminOpenRouterFreeModelsUrl || 'https://openrouter.ai/collections/free-models'}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-300 underline underline-offset-2"
                        >
                          OpenRouter free models
                        </a>
                      </div>
                      <input
                        type="text"
                        list="vniagent-admin-openrouter-models"
                        value={adminAiModelInput}
                        onChange={(event) => setAdminAiModelInput(event.target.value)}
                        placeholder="openai/gpt-4o-mini"
                        className="mt-4 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-blue-500"
                      />
                      <datalist id="vniagent-admin-openrouter-models">
                        {openRouterModels.map((model) => (
                          <option key={model.id} value={model.id}>{model.name}</option>
                        ))}
                      </datalist>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {recommendedOpenRouterModels.map((model) => (
                          <button
                            key={model.id}
                            type="button"
                            onClick={() => setAdminAiModelInput(model.id)}
                            className="rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[10px] font-semibold text-blue-300"
                            title={model.description || model.name}
                          >
                            {model.name}
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            const trimmedKey = adminLayoutKeyInput.trim()
                            const trimmedModel = adminAiModelInput.trim()
                            if (!trimmedKey || !trimmedModel) {
                              setPreferenceStatus('Provide both an admin key and a model slug before saving VniAgent runtime defaults.')
                              return
                            }
                            try {
                              setIsAdminAiRuntimeSaving(true)
                              const saved = await saveAdminAIRuntimeConfig(trimmedKey, trimmedModel)
                              setAdminAiModelInput(saved.model || trimmedModel)
                              captureAnalyticsEvent(ANALYTICS_EVENTS.adminAiRuntimeSaved, {
                                model: saved.model || trimmedModel,
                              })
                              setPreferenceStatus(`Admin VniAgent model saved: ${saved.model}.`)
                            } catch (error) {
                              setPreferenceStatus(error instanceof Error ? `VniAgent runtime save failed: ${error.message}` : 'VniAgent runtime save failed.')
                            } finally {
                              setIsAdminAiRuntimeSaving(false)
                            }
                          }}
                          disabled={isAdminAiRuntimeSaving || isAdminAiRuntimeLoading}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isAdminAiRuntimeSaving ? 'Saving…' : 'Save AI Model'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void loadAdminAiRuntimeConfig(adminLayoutKeyInput)}
                          disabled={isAdminAiRuntimeSaving || isAdminAiRuntimeLoading}
                          className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isAdminAiRuntimeLoading ? 'Loading…' : 'Reload'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {readAdminLayoutKeyValidated() && (
                  <div>
                    <h4 className="text-sm font-bold text-[var(--text-secondary)] mb-2 uppercase tracking-wider text-[10px]">Admin USD/VND Defaults</h4>
                    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-4 space-y-4">
                      <div>
                        <div className="text-sm font-bold text-[var(--text-primary)]">Global fallback VND per USD rate</div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">
                          Used when neither a browser-local yearly override nor an admin yearly default exists for the report year.
                        </div>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="1"
                          step="0.01"
                          value={adminUsdVndDefaultRateInput}
                          onChange={(event) => setAdminUsdVndDefaultRateInput(event.target.value)}
                          className="mt-4 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-blue-500"
                        />
                      </div>

                      <div>
                        <div className="text-sm font-bold text-[var(--text-primary)]">Year-specific admin defaults</div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">
                          These shared yearly defaults apply to everyone unless a user overrides the same year in their own browser.
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {usdRateYears.map((year) => (
                            <label key={year} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2">
                              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{year}</div>
                              <input
                                type="number"
                                inputMode="decimal"
                                min="1"
                                step="0.01"
                                value={adminUsdRateInputs[String(year)] ?? ''}
                                onChange={(event) => {
                                  const nextValue = event.target.value
                                  setAdminUsdRateInputs((prev) => ({ ...prev, [String(year)]: nextValue }))
                                }}
                                placeholder={adminUsdVndRatesByYear[String(year)] ? String(adminUsdVndRatesByYear[String(year)]) : 'Use global fallback'}
                                className="mt-2 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-blue-500"
                              />
                              <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                                {adminUsdVndRatesByYear[String(year)] ? 'Admin yearly default' : 'Using global fallback'}
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            const trimmedKey = adminLayoutKeyInput.trim()
                            const parsed = Number(adminUsdVndDefaultRateInput)
                            const { rates: yearlyRates, invalidYear } = parseUsdRateInputs(adminUsdRateInputs, usdRateYears)
                            if (!trimmedKey || !Number.isFinite(parsed) || parsed <= 0) {
                              setPreferenceStatus('Provide a valid admin key and a USD/VND rate greater than zero.')
                              return
                            }
                            if (invalidYear !== null) {
                              setPreferenceStatus(`Invalid admin USD/VND rate for ${invalidYear}. Use a number greater than zero.`)
                              return
                            }
                            try {
                              setIsAdminUnitRuntimeSaving(true)
                              const saved = await saveAdminUnitRuntimeConfig(trimmedKey, parsed, yearlyRates)
                              applyAdminUsdRuntimeConfig(saved as UnitRuntimeConfigResponse)
                              setAdminUsdVndDefaultRateInput(String(saved.usd_vnd_default_rate))
                              setAdminUsdRateInputs(toRateInputs(saved.usd_vnd_rates_by_year))
                              captureAnalyticsEvent(ANALYTICS_EVENTS.adminUnitRuntimeSaved, {
                                usd_vnd_default_rate: saved.usd_vnd_default_rate,
                                yearly_override_count: Object.keys(saved.usd_vnd_rates_by_year || {}).length,
                              })
                              setPreferenceStatus(`Admin USD/VND defaults saved. Global fallback: ${formatNumber(saved.usd_vnd_default_rate, { decimals: 0 })}.`)
                            } catch (error) {
                              setPreferenceStatus(error instanceof Error ? `Unit runtime save failed: ${error.message}` : 'Unit runtime save failed.')
                            } finally {
                              setIsAdminUnitRuntimeSaving(false)
                            }
                          }}
                          disabled={isAdminUnitRuntimeSaving || isAdminUnitRuntimeLoading}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isAdminUnitRuntimeSaving ? 'Saving…' : 'Save Admin USD Defaults'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void loadAdminUnitRuntimeConfig(adminLayoutKeyInput)}
                          disabled={isAdminUnitRuntimeSaving || isAdminUnitRuntimeLoading}
                          className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isAdminUnitRuntimeLoading ? 'Loading…' : 'Reload'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {readAdminLayoutKeyValidated() && (
                  <div>
                    <h4 className="text-sm font-bold text-[var(--text-secondary)] mb-2 uppercase tracking-wider text-[10px]">Shared VniAgent Prompt Library</h4>
                    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-4 space-y-4">
                      <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
                        <span>Version {sharedPromptVersion}</span>
                        {sharedPromptHistory[0]?.updated_at ? <span>· Updated {sharedPromptHistory[0].updated_at}</span> : null}
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">
                        Shared prompts appear in every user&apos;s VniAgent prompt library. Use placeholders like <code>{'{symbol}'}</code>, <code>{'{widget_or_symbol}'}</code>, and <code>{'{tab}'}</code>.
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <input
                          type="text"
                          value={newSharedPromptLabel}
                          onChange={(event) => setNewSharedPromptLabel(event.target.value)}
                          placeholder="Prompt title"
                          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-blue-500"
                        />
                        <select
                          value={newSharedPromptCategory}
                          onChange={(event) => setNewSharedPromptCategory(event.target.value as NonNullable<PromptTemplate['category']>)}
                          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-blue-500"
                        >
                          <option value="analysis">Analysis</option>
                          <option value="comparison">Comparison</option>
                          <option value="fundamentals">Fundamentals</option>
                          <option value="technical">Technical</option>
                          <option value="news">News</option>
                          <option value="custom">Custom</option>
                        </select>
                        <button
                          type="button"
                          onClick={addSharedPromptDraft}
                          className="rounded-lg border border-blue-500/40 bg-blue-600/15 px-4 py-2 text-sm font-semibold text-blue-300 transition-colors hover:bg-blue-600/25"
                        >
                          Add Shared Prompt
                        </button>
                      </div>

                      <textarea
                        value={newSharedPromptTemplate}
                        onChange={(event) => setNewSharedPromptTemplate(event.target.value)}
                        placeholder="Prompt template"
                        rows={3}
                        className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-blue-500"
                      />

                      <div className="space-y-2">
                        {isAdminPromptLibraryLoading ? (
                          <div className="text-xs text-[var(--text-muted)]">Loading shared prompts…</div>
                        ) : sharedPrompts.length ? (
                          sharedPrompts.map((prompt, index) => (
                            <div key={prompt.id} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-[var(--text-primary)]">{prompt.label}</div>
                                  <div className="mt-1 text-[10px] uppercase tracking-wider text-cyan-300">{prompt.category || 'custom'}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    captureAnalyticsEvent(ANALYTICS_EVENTS.adminPromptRemoved, {
                                      category: prompt.category,
                                      prompt_count: sharedPrompts.length - 1,
                                    })
                                    setSharedPrompts((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                                  }}
                                  className="rounded-lg border border-[var(--border-default)] px-3 py-1 text-[10px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                >
                                  Remove
                                </button>
                              </div>
                              <div className="mt-2 text-[11px] text-[var(--text-muted)] whitespace-pre-wrap">{prompt.template}</div>
                            </div>
                          ))
                        ) : (
                          <div className="text-xs text-[var(--text-muted)]">No shared prompts saved yet.</div>
                        )}
                      </div>

                      {sharedPromptHistory.length > 0 && (
                        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3">
                          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">Version History</div>
                          <div className="mt-2 space-y-1 text-[11px] text-[var(--text-secondary)]">
                            {sharedPromptHistory.map((entry) => (
                              <div key={`${entry.version}-${entry.updated_at || 'na'}`} className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-cyan-300">v{entry.version}</span>
                                <span>{entry.prompt_count} prompts</span>
                                {entry.updated_at ? <span className="text-[var(--text-muted)]">{entry.updated_at}</span> : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void loadAdminPromptLibrary(adminLayoutKeyInput)}
                          disabled={isAdminPromptLibraryLoading || isAdminPromptLibrarySaving}
                          className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isAdminPromptLibraryLoading ? 'Loading…' : 'Reload Shared Prompts'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveSharedPromptLibrary()}
                          disabled={isAdminPromptLibraryLoading || isAdminPromptLibrarySaving}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isAdminPromptLibrarySaving ? 'Saving…' : 'Save Shared Prompts'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <AICopilotTelemetryReview
                  adminKey={adminLayoutKeyInput}
                  enabled={readAdminLayoutKeyValidated()}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
